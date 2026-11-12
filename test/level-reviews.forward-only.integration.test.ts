import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { decodeLevelReviewAdminDetail } from '../src/features/level-reviews/level-review-decoders';
import {
  parseRatingHistoryPage,
  parseRatingProgress,
  type RatingHistoryItem
} from '../src/features/player/rating-contracts';
import { localSupabaseEnv } from './helpers/local-supabase-env';
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
  ratingProjectionControl,
  ratingStates,
  ratingWorld,
  submitPendingGroup,
  toQuartet,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();

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

  /** The committed match watermark shifted by whole microseconds, as a fixed-width UTC instant. */
  async function watermarkPlus(microseconds: number): Promise<string> {
    const result = await queryTrustedSql(
      `select to_char((last_processed_played_at at time zone 'UTC') + ($1 || ' microseconds')::interval,
                      'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as at
         from public.player_rating_projection_control`,
      { values: [String(microseconds)] }
    );
    return String(result.rows[0]?.['at']);
  }

  /** Newest-first history, one item per page, following the opaque keyset cursor. */
  async function historyOneByOne(owner: LevelReviewActor): Promise<RatingHistoryItem[]> {
    const items: RatingHistoryItem[] = [];
    let args: Record<string, unknown> = { p_limit: 1 };
    for (let guard = 0; guard < 20; guard += 1) {
      const page = parseRatingHistoryPage(
        (await owner.client.rpc('get_my_rating_history', args)).data
      )!;
      items.push(...page.items);
      if (!page.next_cursor) return items;
      args = {
        p_limit: 1,
        p_revision: page.revision,
        p_before_played_at: page.next_cursor.played_at,
        p_before_game_group_id: page.next_cursor.game_group_id
      };
    }
    throw new Error('history did not terminate');
  }
  const idOf = (item: RatingHistoryItem) =>
    item.kind === 'adjustment' ? item.adjustment_id : item.game_group_id;

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
    'the boundary is the match watermark key itself, not an inflated instant',
    async () => {
      const { players } = await table('key');
      const owner = players[0]!;
      const control = await ratingProjectionControl();
      const event = await approveTo(owner, 5.5);
      const key = await queryTrustedSql(
        'select a.boundary_played_at = c.last_processed_played_at as same_time, ' +
          'a.boundary_group_id = c.last_processed_game_group_id as same_group, a.boundary_basis ' +
          'from public.player_rating_admin_adjustments a, public.player_rating_projection_control c ' +
          'where a.id = $1',
        { values: [event.id] }
      );
      expect(control['watermark_group']).not.toBeNull();
      expect(key.rows[0]).toEqual({
        same_time: true,
        same_group: true,
        boundary_basis: 'match_watermark'
      });
    }
  );

  it.skipIf(!environment.env)(
    'a match exactly one microsecond after the watermark key, confirmed after the decision, starts from the corrected state',
    async () => {
      const { players, quartet } = await table('edgea');
      const owner = players[0]!;
      const first = await play(quartet, await nextTailPlayedAt());
      await approveTo(owner, 5.5);

      const edge = await play(quartet, await watermarkPlus(1), 'team_b');
      const ownerCalc = (await ledgerOf([edge.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      // Appended through the tail path from the corrected state; the earlier group is untouched.
      expect(ownerCalc.calculations).toHaveLength(1);
      expect(ownerCalc.calculations[0]).toMatchObject({ beforeMu: 5.5, beforeGroups: 1 });
      expect((await ledgerOf([first.proposalId])).every((e) => e.calculations.length === 1)).toBe(
        true
      );
      expect(await ratingRow(owner.id)).toMatchObject({ groups: 2 });
    }
  );

  it.skipIf(!environment.env)(
    'a match one microsecond before the watermark key, confirmed after the decision, uses the pre-adjustment state',
    async () => {
      const { players, quartet } = await table('edgec');
      const owner = players[0]!;
      await play(quartet, await nextTailPlayedAt());
      await approveTo(owner, 5.5);

      const early = await play(quartet, await watermarkPlus(-1), 'team_b');
      const ownerCalc = (await ledgerOf([early.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      // It sorts before the earlier group, so it starts from the initial level...
      expect(ownerCalc.calculations.at(-1)).toMatchObject({ beforeMu: 4, beforeGroups: 0 });
      // ...and the absolute correction still decides the current level.
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5.5, groups: 2 });
    }
  );

  it.skipIf(!environment.env)(
    'a checkpoint sharing its key with a match orders after it, and history pages never repeat or skip',
    async () => {
      const { players, quartet } = await table('tie');
      const owner = players[0]!;
      const first = await play(quartet, await nextTailPlayedAt());
      const event = await approveTo(owner, 5.5);
      const second = await approveTo(owner, 5);
      expect(second.boundary_played_at >= event.boundary_played_at).toBe(true);

      const full = parseRatingHistoryPage((await owner.client.rpc('get_my_rating_history')).data)!;
      expect(full.items.map(idOf)).toEqual([second.id, event.id, first.proposalId]);
      expect((await historyOneByOne(owner)).map(idOf)).toEqual([
        second.id,
        event.id,
        first.proposalId
      ]);
      const progress = parseRatingProgress(
        (await owner.client.rpc('get_my_rating_progress')).data
      )!;
      expect(progress.points.map((point) => point.event_id)).toEqual([
        first.proposalId,
        event.id,
        second.id
      ]);
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5, groups: 1 });
    }
  );

  it.skipIf(!environment.env)(
    'after a late pre-checkpoint replay the history item, chart point and summary present one effective state',
    async () => {
      const { players, quartet } = await table('eff');
      const owner = players[0]!;
      const anchor = Date.parse(await nextTailPlayedAt());
      await play(quartet, new Date(anchor).toISOString());
      const event = await approveTo(owner, 5.5);
      const detailBefore = decodeLevelReviewAdminDetail(
        (
          await admin.client.rpc('get_level_review_admin_detail', {
            p_request_id: event.level_review_request_id
          })
        ).data
      );
      const late = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: new Date(anchor - 7_200_000).toISOString(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      await confirmAuto(late);

      const page = parseRatingHistoryPage((await owner.client.rpc('get_my_rating_history')).data)!;
      const [adjustmentItem, previousMatch] = page.items;
      expect(page.items.map((item) => item.kind)).toEqual(['adjustment', 'match', 'match']);
      if (adjustmentItem?.kind !== 'adjustment' || previousMatch?.kind !== 'match')
        throw new Error('unexpected timeline shape');
      // Effective values: what flows into / out of the checkpoint in the reconstructed stream.
      expect(adjustmentItem.before_display_level).toBe(previousMatch.after_display_level);
      expect(adjustmentItem.before_reliability_percent).toBe(
        previousMatch.after_reliability_percent
      );
      expect(adjustmentItem).toMatchObject({
        after_display_level: 5.5,
        after_reliability_percent: 22,
        after_confirmed_groups: 2,
        reliability_changed: false
      });
      const progress = parseRatingProgress(
        (await owner.client.rpc('get_my_rating_progress')).data
      )!;
      expect(progress.points.at(-1)).toMatchObject({
        event_id: event.id,
        display_level: adjustmentItem.after_display_level
      });
      expect(progress.points.at(-2)?.display_level).toBe(previousMatch.after_display_level);
      expect((await ownRatingSummary(owner)).summary).toMatchObject({
        display_level: adjustmentItem.after_display_level,
        reliability_percent: adjustmentItem.after_reliability_percent,
        confirmed_competitive_game_groups: adjustmentItem.after_confirmed_groups
      });

      // The decision-time evidence stays immutable and is labeled as such for admins only.
      const detailAfter = decodeLevelReviewAdminDetail(
        (
          await admin.client.rpc('get_level_review_admin_detail', {
            p_request_id: event.level_review_request_id
          })
        ).data
      );
      expect(detailAfter.adjustment).toEqual(detailBefore.adjustment);
      expect(detailAfter.adjustment).toMatchObject({
        before_reliability_percent: 16,
        after_reliability_percent: 16,
        before_confirmed_groups: 1
      });
      expect(detailAfter.adjustment!.before_display_level).not.toBe(
        adjustmentItem.before_display_level
      );
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
