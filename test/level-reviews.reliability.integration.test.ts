import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  drainDueRegistrationCutoffs,
  adjustmentStates,
  approveOk,
  approveRequest,
  committedRevision,
  kernelRows,
  platformAdminPlayer,
  ratingRow,
  submitExact,
  type KernelState,
  type LevelReviewActor,
  type ReliabilityArgs
} from './helpers/level-review-fixtures';
import {
  activateRatingProjection,
  confirmedGroup,
  ledgerFingerprint,
  nextTailPlayedAt,
  ratingWorld,
  submitPendingGroup,
  confirmAuto,
  toQuartet,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

const IDS = [
  '00000000-0000-4000-8000-000000000001',
  '00000000-0000-4000-8000-000000000002',
  '00000000-0000-4000-8000-000000000003',
  '00000000-0000-4000-8000-000000000004'
] as const;

const state = (mu: number, reliability: number, groups: number): KernelState => ({
  mu,
  reliability,
  groups
});

describe('versioned reliability kernel (pure SQL, no tables)', { timeout: 60_000 }, () => {
  it.skipIf(!environment.env)(
    '1.0.0 stays strict and unchanged; 1.1.0 has identical arithmetic from an effective reliability',
    async () => {
      const onCurve = [
        state(4, 16, 1),
        state(4.5, 22, 2),
        state(5, 10, 0),
        state(3.5, 100, 15)
      ] as const;
      const v1 = await kernelRows('1.0.0', 'team_a', IDS, onCurve);
      const v11 = await kernelRows('1.1.0', 'team_a', IDS, onCurve);
      // Same score, expectation, rounding, clamping: only the engine stamp differs.
      expect(v11.map((row) => ({ ...row, version: '1.0.0' }))).toEqual(v1);
      expect(v1.map((row) => row['version'])).toEqual(Array(4).fill('1.0.0'));
      expect(v11.map((row) => row['version'])).toEqual(Array(4).fill('1.1.0'));

      // Golden values of the unadjusted engine (calibration document example family).
      expect(v1.map((row) => [row['after_rel'], row['after_groups']])).toEqual([
        [22, 2],
        [28, 3],
        [16, 1],
        [100, 16]
      ]);

      // Off-curve reliability: 1.0.0 refuses it, 1.1.0 continues from the effective value.
      const offCurve = [
        state(4, 3, 1),
        state(4.5, 40, 2),
        state(5, 97, 9),
        state(3.5, 0, 4)
      ] as const;
      await expect(kernelRows('1.0.0', 'team_a', IDS, offCurve)).rejects.toThrow(
        /RATING_INPUT_INVALID/
      );
      const exception = await kernelRows('1.1.0', 'draw', IDS, offCurve);
      expect(exception.map((row) => row['after_rel'])).toEqual([9, 46, 100, 6]);
      expect(exception.map((row) => row['after_groups'])).toEqual([2, 3, 10, 5]);
      expect(exception.map((row) => row['sigma'])).toEqual([1, 1, 1, 1]);

      // Other versions still fail closed.
      await expect(
        queryTrustedSql(
          "select * from public.rating_v1_calculate_group('app-wide-level', '1.2.0', 1, '{}'::jsonb)"
        )
      ).rejects.toThrow(/RATING_ENGINE_UNSUPPORTED/);
    }
  );
});

describe('audited reliability exceptions through level reviews', { timeout: 180_000 }, () => {
  let world: RatingWorld;
  let admin: LevelReviewActor;

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'rel');
    admin = await platformAdminPlayer(world);
  });

  afterAll(async () => {
    if (environment.env) await drainDueRegistrationCutoffs();
  });

  async function ratedTable(label: string) {
    const players = await Promise.all(
      [4, 4.5, 5, 3.5].map((level, index) => world.player(`${label}${index}`, level))
    );
    const quartet: Quartet = toQuartet(players.map((player) => player.id));
    const play = async (classification: 'team_a' | 'team_b' | 'draw' = 'team_a') =>
      confirmedGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id,
        classification
      });
    await play();
    return { players, owner: players[0]!, quartet, play };
  }

  async function calcRows(groupId: string) {
    const result = await queryTrustedSql(
      `select e.user_id::text as user_id, c.before_reliability_percent::int as before_rel,
              c.after_reliability_percent::int as after_rel, c.after_confirmed_groups as after_groups,
              c.rating_engine_version as version, c.after_sigma::float8 as sigma
         from public.player_rating_events e
         join lateral (select k.* from public.player_rating_event_calculations k
             where k.rating_event_id = e.id order by k.projection_revision desc limit 1) c on true
        where e.game_group_id = $1`,
      { values: [groupId] }
    );
    return Object.fromEntries(result.rows.map((row) => [String(row['user_id']), row]));
  }

  async function approveWith(
    owner: LevelReviewActor,
    level: number,
    reliability?: ReliabilityArgs
  ) {
    return (
      await approveOk(admin, await submitExact(owner, level), {
        target: level,
        ...(reliability ? { reliability } : {})
      })
    ).adjustment!;
  }

  it.skipIf(!environment.env)(
    'preserves reliability, count and sigma by default and keeps the original 1.0.0 stamps',
    async () => {
      const { owner, quartet, play } = await ratedTable('keep');
      const event = await approveWith(owner, 5);
      expect(event).toMatchObject({
        reliability_mode: 'preserve',
        before_engine_version: '1.0.0',
        after_engine_version: '1.0.0'
      });
      expect(await ratingRow(owner.id)).toMatchObject({
        reliability: 16,
        groups: 1,
        sigma: 1,
        version: '1.0.0'
      });
      const next = await play('team_b');
      const rows = await calcRows(next.proposalId);
      expect(Object.values(rows).map((row) => row['version'])).toEqual(Array(4).fill('1.0.0'));
      expect(rows[owner.id]).toMatchObject({ before_rel: 16, after_rel: 22, after_groups: 2 });
      expect(quartet).toHaveLength(4);
    }
  );

  it.skipIf(!environment.env)(
    'a justified reset restarts the progression at 10% while the real game count keeps counting, on every later match',
    async () => {
      const { owner, quartet, play } = await ratedTable('reset');
      const event = await approveWith(owner, 5, {
        mode: 'reset',
        justification: 'Returned after a long break'
      });
      expect(event).toMatchObject({
        reliability_mode: 'reset',
        reliability_target: 10,
        exception_justification: 'Returned after a long break',
        before_reliability_percent: 16,
        after_reliability_percent: 10,
        before_confirmed_groups: 1,
        after_confirmed_groups: 1,
        before_engine_version: '1.0.0',
        after_engine_version: '1.1.0'
      });
      expect(await ratingRow(owner.id)).toMatchObject({
        reliability: 10,
        groups: 1,
        sigma: 1,
        version: '1.1.0'
      });

      // First match after the exception: +6 from the EFFECTIVE value, count 2, stamped 1.1.0 for all four.
      const first = await play('team_b');
      const firstRows = await calcRows(first.proposalId);
      expect(Object.values(firstRows).map((row) => row['version'])).toEqual(Array(4).fill('1.1.0'));
      expect(firstRows[owner.id]).toMatchObject({
        before_rel: 10,
        after_rel: 16,
        after_groups: 2,
        sigma: 1
      });
      // The exception-free peers stay on their own curve inside the shared 1.1.0 group.
      expect(firstRows[quartet[1]]).toMatchObject({
        before_rel: 16,
        after_rel: 22,
        after_groups: 2
      });
      expect(await ratingRow(owner.id)).toMatchObject({
        reliability: 16,
        groups: 2,
        version: '1.1.0'
      });

      // The exception stays effective on the second and every later match.
      const second = await play('draw');
      expect((await calcRows(second.proposalId))[owner.id]).toMatchObject({
        before_rel: 16,
        after_rel: 22,
        after_groups: 3
      });
      expect(await ratingRow(owner.id)).toMatchObject({ reliability: 22, groups: 3 });
      expect((await ratingRow(quartet[1]))['reliability']).toBe(28);

      // Replay and activation reproduce the very same exception stream.
      const ledger = await ledgerFingerprint(quartet);
      expect((await activateRatingProjection()).changed).toBe(false);
      expect(await ledgerFingerprint(quartet)).toBe(ledger);
      expect(await ratingRow(owner.id)).toMatchObject({
        reliability: 22,
        groups: 3,
        version: '1.1.0'
      });
    }
  );

  it.skipIf(!environment.env)(
    'a justified reduction sets an explicit percent, including 0, and progresses from it',
    async () => {
      const { owner, play } = await ratedTable('reduce');
      const event = await approveWith(owner, 4.5, {
        mode: 'reduce',
        target: 3,
        justification: 'Injury return'
      });
      expect(event).toMatchObject({
        reliability_mode: 'reduce',
        reliability_target: 3,
        after_reliability_percent: 3,
        after_engine_version: '1.1.0'
      });
      const group = await play('team_a');
      expect((await calcRows(group.proposalId))[owner.id]).toMatchObject({
        before_rel: 3,
        after_rel: 9,
        after_groups: 2
      });

      const zero = await world.player('reducezero', 4);
      const zeroPlayers = await Promise.all(
        [4.5, 5, 3.5].map((level, index) => world.player(`rz${index}`, level))
      );
      const zeroQuartet = toQuartet([zero, ...zeroPlayers].map((player) => player.id));
      await confirmedGroup({
        eventId: await world.newEvent(),
        players: zeroQuartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id
      });
      await approveWith(zero, 4, {
        mode: 'reduce',
        target: 0,
        justification: 'Fresh start requested'
      });
      expect(await ratingRow(zero.id)).toMatchObject({ reliability: 0, groups: 1 });
      const after = await confirmedGroup({
        eventId: await world.newEvent(),
        players: zeroQuartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      expect((await calcRows(after.proposalId))[zero.id]).toMatchObject({
        before_rel: 0,
        after_rel: 6
      });
    }
  );

  it.skipIf(!environment.env)(
    'rejects an unjustified, inconsistent or no-op exception without side effects',
    async () => {
      const { owner } = await ratedTable('badrel');
      const requestId = await submitExact(owner, 5);
      const revision = await committedRevision();
      const attempt = (reliability: ReliabilityArgs) =>
        approveRequest(admin, requestId, { target: 5, reliability });
      // Missing justification (blank after trimming) and a preserve with exception fields.
      expect((await attempt({ mode: 'reset', justification: '   ' })).error?.message).toBe(
        'LEVEL_REVIEW_INVALID_ARGUMENT'
      );
      expect(
        (
          await admin.client.rpc('resolve_level_review_request', {
            p_request_id: requestId,
            p_command_id: crypto.randomUUID(),
            p_decision: 'approve',
            p_note: 'ok',
            p_target_level: 5,
            p_expected_revision: revision,
            p_exception_justification: 'stray'
          })
        ).error?.message
      ).toBe('LEVEL_REVIEW_INVALID_ARGUMENT');
      // A reduction must lower the current reliability (16): equal or higher is refused.
      expect(
        (await attempt({ mode: 'reduce', target: 16, justification: 'No-op' })).error?.message
      ).toBe('LEVEL_REVIEW_RELIABILITY_INVALID');
      expect(
        (await attempt({ mode: 'reduce', target: 50, justification: 'Raise' })).error?.message
      ).toBe('LEVEL_REVIEW_RELIABILITY_INVALID');
      expect(
        (await attempt({ mode: 'reduce', target: 100, justification: 'Raise' })).error?.message
      ).toBe('LEVEL_REVIEW_INVALID_ARGUMENT');
      expect(await committedRevision()).toBe(revision);
      expect(await adjustmentStates(owner.id)).toHaveLength(0);

      // A reset of a player already at the initial 10% is a no-op and refused.
      const fresh = await world.player('resetfresh', 4);
      const freshRequest = await submitExact(fresh, 5);
      const noop = await approveRequest(admin, freshRequest, {
        target: 5,
        reliability: { mode: 'reset', justification: 'Nothing to reset' }
      });
      expect(noop.error?.message).toBe('LEVEL_REVIEW_RELIABILITY_INVALID');
    }
  );

  it.skipIf(!environment.env)(
    'unadjusted players stay on the strict curve; only a recorded exception may leave it',
    async () => {
      const { owner, quartet } = await ratedTable('strict');
      // The 1.0.0 state constraint still refuses an off-curve row.
      await expect(
        executeTrustedSql(
          `update public.global_player_ratings set reliability_percent = 50 where user_id = '${quartet[1]}'`
        )
      ).rejects.toThrow(/global_player_ratings_v1_state/);
      // The consistency gate refuses an off-curve 1.1.0 row without a backing adjustment.
      await expect(
        executeTrustedSql(`do $$ begin
          update public.global_player_ratings set reliability_percent = 50, rating_engine_version = '1.1.0'
           where user_id = '${owner.id}';
          perform public.rating_projection_assert_consistent(array['${owner.id}'::uuid]);
        end $$;`)
      ).rejects.toThrow(/RATING_PROJECTION_INCONSISTENT/);
      expect(await ratingRow(owner.id)).toMatchObject({ reliability: 16, version: '1.0.0' });
    }
  );

  it.skipIf(!environment.env)(
    'a late group before the checkpoint keeps the recorded exception and counts the game',
    async () => {
      const { owner, quartet, play } = await ratedTable('latex');
      const anchor = Date.parse(await nextTailPlayedAt());
      await confirmedGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: new Date(anchor).toISOString(),
        submittedBy: world.admin.id
      });
      await approveWith(owner, 5, { mode: 'reset', justification: 'Return after break' });
      const late = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: new Date(anchor - 7_200_000).toISOString(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      await confirmAuto(late);
      // Incoming reliability is overridden by the checkpoint; the genuine count includes the late game.
      expect(await ratingRow(owner.id)).toMatchObject({
        mu: 5,
        reliability: 10,
        groups: 3,
        version: '1.1.0'
      });
      const states = await adjustmentStates(owner.id);
      expect(states.at(-1)).toMatchObject({
        reliability_percent: 10,
        confirmed_groups: 3,
        rating_engine_version: '1.1.0'
      });
      const next = await play('draw');
      expect((await calcRows(next.proposalId))[owner.id]).toMatchObject({
        before_rel: 10,
        after_rel: 16,
        after_groups: 4
      });
    }
  );
});
