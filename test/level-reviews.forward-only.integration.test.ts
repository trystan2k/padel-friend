import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  drainDueRegistrationCutoffs,
  adjustmentFingerprint,
  adjustmentStates,
  approveOk,
  kernelRows,
  leagueFingerprint,
  ownRatingSummary,
  platformAdminPlayer,
  ratingRow,
  submitExact,
  type KernelState,
  type LevelReviewActor
} from './helpers/level-review-fixtures';
import {
  activateRatingProjection,
  confirmAuto,
  confirmedGroup,
  ledgerFingerprint,
  ledgerOf,
  nextTailPlayedAt,
  ratingStates,
  ratingWorld,
  submitPendingGroup,
  toQuartet,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

type Player = Awaited<ReturnType<RatingWorld['player']>>;

describe('forward-only adjustment in the chronological stream', { timeout: 180_000 }, () => {
  let world: RatingWorld;
  let admin: LevelReviewActor;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'fwd');
    admin = await platformAdminPlayer(world);
  });

  afterAll(async () => {
    if (environment.env) await drainDueRegistrationCutoffs();
  });

  async function table(label: string): Promise<{ players: Player[]; quartet: Quartet }> {
    const players = await Promise.all(
      [4, 4.5, 5, 3.5].map((level, index) => world.player(`${label}${index}`, level))
    );
    return { players, quartet: toQuartet(players.map((player) => player.id)) };
  }

  async function play(
    quartet: Quartet,
    playedAt: string,
    classification: 'team_a' | 'team_b' | 'draw' = 'team_a'
  ) {
    return confirmedGroup({
      eventId: await world.newEvent(),
      players: quartet,
      playedAt,
      submittedBy: world.admin.id,
      classification
    });
  }

  async function kernelStates(quartet: Quartet) {
    const [a, b, c, d] = await Promise.all(quartet.map((id) => ratingRow(id)));
    const state = (row: Awaited<ReturnType<typeof ratingRow>> | undefined): KernelState => ({
      mu: Number(row?.['mu']),
      reliability: Number(row?.['reliability']),
      groups: Number(row?.['groups']),
      highest: Number(row?.['highest'])
    });
    return [state(a), state(b), state(c), state(d)] as const;
  }

  async function approveTo(owner: LevelReviewActor, level: number) {
    return (await approveOk(admin, await submitExact(owner, level), { target: level })).adjustment!;
  }

  it.skipIf(!environment.env)(
    'the next confirmed group starts from the corrected state, via the tail path, leaving history untouched',
    async () => {
      const { players, quartet } = await table('next');
      const owner = players[0]!;
      const first = await play(quartet, await nextTailPlayedAt());
      await approveTo(owner, 5.5);
      const history = await ledgerFingerprint(quartet);
      const league = await leagueFingerprint();
      const pre = await kernelStates(quartet);
      expect(pre[0]).toMatchObject({ mu: 5.5, groups: 1 });

      const next = await play(quartet, await nextTailPlayedAt(), 'team_b');
      // Appended, not replayed: the earlier group's calculation revisions are untouched.
      const firstLedger = await ledgerOf([first.proposalId]);
      expect(firstLedger.every((entry) => entry.calculations.length === 1)).toBe(true);
      expect(await ledgerFingerprint(quartet)).not.toBe(history);

      const expected = await kernelRows('1.0.0', 'team_b', quartet, pre);
      const observed = await ratingStates(quartet);
      expected.forEach((row, index) => {
        expect(observed[quartet[index]!]).toMatchObject({ mu: row['after_mu'], groups: 2 });
      });
      const ownerCalc = (await ledgerOf([next.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      expect(ownerCalc.calculations[0]).toMatchObject({
        beforeMu: 5.5,
        beforeGroups: 1,
        afterGroups: 2
      });
      expect(await leagueFingerprint()).toBe(league);
    }
  );

  it.skipIf(!environment.env)(
    'a late group played before the checkpoint uses the pre-adjustment state and never erases the correction',
    async () => {
      const { players, quartet } = await table('late');
      const owner = players[0]!;
      const anchor = Date.parse(await nextTailPlayedAt());
      await play(quartet, new Date(anchor).toISOString());
      const event = await approveTo(owner, 5.5);
      const fingerprint = await adjustmentFingerprint(owner.id);
      const league = await leagueFingerprint();
      expect(await adjustmentStates(owner.id)).toHaveLength(1);

      const late = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: new Date(anchor - 7_200_000).toISOString(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      await confirmAuto(late);

      // The late group is computed before the checkpoint, from the initial level...
      const lateOwner = (await ledgerOf([late.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      expect(lateOwner.calculations[0]).toMatchObject({
        beforeMu: 4,
        beforeGroups: 0,
        afterGroups: 1
      });
      // ...and the absolute correction still decides the final level.
      expect(await ratingRow(owner.id)).toMatchObject({
        mu: 5.5,
        display_level: 5.5,
        groups: 2,
        reliability: 22,
        highest: 5.5
      });
      // The immutable event is untouched; the reconstructed checkpoint state is a new revision.
      expect(await adjustmentFingerprint(owner.id)).toBe(fingerprint);
      const states = await adjustmentStates(owner.id);
      expect(states).toHaveLength(2);
      expect(states[0]).toMatchObject({ reliability_percent: 16, confirmed_groups: 1 });
      expect(states[1]).toMatchObject({ reliability_percent: 22, confirmed_groups: 2 });
      expect(Number(states[1]!['projection_revision'])).toBeGreaterThan(event.projection_revision);
      expect((await ownRatingSummary(owner)).summary).toMatchObject({
        display_level: 5.5,
        reliability_percent: 22,
        confirmed_competitive_game_groups: 2
      });
      expect(await leagueFingerprint()).toBe(league);

      // Replay and activation are idempotent over the merged stream.
      const stable = await ratingStates(quartet);
      const ledger = await ledgerFingerprint(quartet);
      for (let run = 0; run < 2; run += 1) {
        expect((await activateRatingProjection()).changed).toBe(false);
        expect(await ratingStates(quartet)).toEqual(stable);
        expect(await ledgerFingerprint(quartet)).toBe(ledger);
        expect(await adjustmentFingerprint(owner.id)).toBe(fingerprint);
        expect(await adjustmentStates(owner.id)).toHaveLength(2);
      }
    }
  );

  it.skipIf(!environment.env)(
    'a group sorting between the watermark and the checkpoint is routed through the replay',
    async () => {
      const { players, quartet } = await table('route');
      const owner = players[0]!;
      await play(quartet, await nextTailPlayedAt());
      const preMu = Number((await ratingRow(owner.id))['mu']);
      const event = await approveTo(owner, 5.5);

      // Same instant as the checkpoint boundary: after the watermark, before the checkpoint.
      const edge = await play(quartet, event.boundary_played_at, 'team_b');
      const ownerCalc = (await ledgerOf([edge.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      expect(ownerCalc.calculations.at(-1)).toMatchObject({ beforeMu: preMu, beforeGroups: 1 });
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5.5, groups: 2 });
    }
  );

  it.skipIf(!environment.env)(
    'a player without matches keeps the correction when a past group is confirmed later',
    async () => {
      const { players, quartet } = await table('only');
      const owner = players[0]!;
      await approveTo(owner, 5);
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5, groups: 0 });

      const past = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: new Date(Date.now() - 86_400_000).toISOString(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      await confirmAuto(past);
      const ownerCalc = (await ledgerOf([past.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      expect(ownerCalc.calculations[0]).toMatchObject({
        beforeMu: 4,
        beforeGroups: 0,
        afterGroups: 1
      });
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5, groups: 1, reliability: 16 });

      // A second correction on top of the merged stream, then a full replay: both survive.
      await approveTo(owner, 4.5);
      const stable = await ratingStates([owner.id]);
      expect((await activateRatingProjection()).changed).toBe(false);
      expect(await ratingStates([owner.id])).toEqual(stable);
      const states = await queryTrustedSql(
        'select count(*)::int as count from public.player_rating_admin_adjustments where user_id = $1',
        { values: [owner.id] }
      );
      expect(states.rows[0]?.['count']).toBe(2);
    }
  );
});
