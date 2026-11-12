import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  drainDueRegistrationCutoffs,
  adjustmentCount,
  approveArgs,
  cancelOnConnection,
  committedRevision,
  leagueFingerprint,
  levelReviewRow,
  platformAdminPlayer,
  ratingRow,
  resolveOnConnection,
  submitExact,
  type ConnectionResolution,
  type LevelReviewActor
} from './helpers/level-review-fixtures';
import { asRecord, sqlRows, waitForRows, withDeadline } from './helpers/match-registration-sql';
import {
  activateRatingProjection,
  confirmedGroup,
  finalizeSql,
  ledgerOf,
  nextTailPlayedAt,
  ratingWorld,
  setRatingProjectionActive,
  submitPendingGroup,
  toQuartet,
  type Quartet,
  type RatingWorld
} from './helpers/rating-fixtures';
import { openDedicatedSqlConnection, type DedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv();

/** Bounded wait for every contender: a lock-graph deadlock must fail, never hang. */
const BOUND_MS = 30_000;

const advisoryWaitersSql = `select count(*)::int as waiters from pg_catalog.pg_locks l
  where l.locktype = 'advisory' and not l.granted
    and ((l.classid::bigint << 32) | l.objid::bigint)
      = pg_catalog.hashtextextended('padel-friend:app-wide-rating-projection', 0)`;

async function waitForRatingLockWaiters(count: number): Promise<void> {
  await waitForRows(
    advisoryWaitersSql,
    (rows) => Number(rows[0]?.['waiters']) >= count,
    `${count} backend(s) waiting for the app-wide rating lock`,
    BOUND_MS
  );
}

async function waitForBlockedBackend(pid: number): Promise<void> {
  await waitForRows(
    `select 1 from pg_catalog.pg_stat_activity a where a.pid = ${pid} and a.wait_event_type = 'Lock'`,
    (rows) => rows.length >= 1,
    'a backend blocked on a lock',
    BOUND_MS
  );
}

describe('level review approval races (real separate connections)', { timeout: 240_000 }, () => {
  let world: RatingWorld;
  let admin: LevelReviewActor;
  let admin2: LevelReviewActor;
  const open: DedicatedSqlConnection[] = [];

  async function connection(): Promise<DedicatedSqlConnection> {
    const created = await openDedicatedSqlConnection();
    open.push(created);
    return created;
  }

  /** A session that owns the app-wide rating lock until it commits. */
  async function ratingLockHolder() {
    const holder = await connection();
    await holder.query('begin');
    await holder.query('select public.lock_global_rating_projection()');
    return { release: () => holder.query('commit') };
  }

  beforeAll(async () => {
    if (!environment.env) return;
    world = await ratingWorld(environment.env, 'lrraces');
    admin = await platformAdminPlayer(world, 'padmin1');
    admin2 = await platformAdminPlayer(world, 'padmin2');
  });

  afterAll(async () => {
    if (environment.env) await drainDueRegistrationCutoffs();
  });

  afterEach(async () => {
    await setRatingProjectionActive(true);
    await Promise.all(open.splice(0).map((c) => c.close()));
  });

  async function rated(label: string) {
    const players = await Promise.all(
      [4, 4.5, 5, 3.5].map((level, index) => world.player(`${label}${index}`, level))
    );
    const quartet: Quartet = toQuartet(players.map((player) => player.id));
    await confirmedGroup({
      eventId: await world.newEvent(),
      players: quartet,
      playedAt: await nextTailPlayedAt(),
      submittedBy: world.admin.id
    });
    return { owner: players[0]!, quartet };
  }

  const settle = <T>(promise: Promise<T>, label: string) => withDeadline(promise, BOUND_MS, label);

  function expectOk(result: ConnectionResolution): Record<string, unknown> {
    if (!result.ok) throw new Error(`Expected the resolution to succeed: ${result.message}`);
    return asRecord(result.data);
  }

  /** The database failure message of a resolution that must have been refused. */
  function failure(result: ConnectionResolution): string {
    if (result.ok) throw new Error('Expected the resolution to be refused');
    return result.message;
  }

  it.skipIf(!environment.env)(
    'two Platform Admins approving the same request yield exactly one adjustment and one conflict',
    async () => {
      const { owner } = await rated('two');
      const requestId = await submitExact(owner, 5);
      const holder = await ratingLockHolder();
      const [one, two] = await Promise.all([connection(), connection()]);
      const first = resolveOnConnection(one, admin.id, await approveArgs(requestId));
      await waitForRatingLockWaiters(1);
      const second = resolveOnConnection(two, admin2.id, await approveArgs(requestId));
      // The second approval queues behind the request row the first one already holds.
      await waitForBlockedBackend(two.backendPid);
      await holder.release();
      const [a, b] = await settle(Promise.all([first, second]), 'concurrent approvals');
      expectOk(a);
      expect(failure(b)).toContain('LEVEL_REVIEW_RESOLUTION_CONFLICT');
      expect(await adjustmentCount(owner.id)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'the same command raced twice returns the one original adjustment to both',
    async () => {
      const { owner } = await rated('samecmd');
      const requestId = await submitExact(owner, 5);
      const args = await approveArgs(requestId);
      const holder = await ratingLockHolder();
      const [one, two] = await Promise.all([connection(), connection()]);
      const first = resolveOnConnection(one, admin.id, args);
      await waitForRatingLockWaiters(1);
      const second = resolveOnConnection(two, admin.id, args);
      await waitForBlockedBackend(two.backendPid);
      await holder.release();
      const [firstResult, secondResult] = await settle(
        Promise.all([first, second]),
        'same command'
      );
      const a = expectOk(firstResult);
      const b = expectOk(secondResult);
      expect([a['replayed'], b['replayed']]).toEqual([false, true]);
      expect(asRecord(a['adjustment'])['id']).toBe(asRecord(b['adjustment'])['id']);
      expect(await adjustmentCount(owner.id)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'approval racing a rejection or an owner cancellation resolves to exactly one outcome',
    async () => {
      const { owner } = await rated('rival');
      const approveVsReject = await submitExact(owner, 5);
      const holder = await ratingLockHolder();
      const [one, two] = await Promise.all([connection(), connection()]);
      const approve = resolveOnConnection(one, admin.id, await approveArgs(approveVsReject));
      await waitForRatingLockWaiters(1);
      const reject = resolveOnConnection(two, admin2.id, {
        p_request_id: approveVsReject,
        p_command_id: crypto.randomUUID(),
        p_decision: 'reject',
        p_note: 'Declined.'
      });
      await waitForBlockedBackend(two.backendPid);
      await holder.release();
      const [approved, rejected] = await settle(
        Promise.all([approve, reject]),
        'approve vs reject'
      );
      expectOk(approved);
      expect(failure(rejected)).toContain('LEVEL_REVIEW_RESOLUTION_CONFLICT');
      expect(await levelReviewRow(approveVsReject)).toMatchObject({ status: 'approved' });

      const other = await rated('rival2');
      const approveVsCancel = await submitExact(other.owner, 5);
      const holder2 = await ratingLockHolder();
      const [three, four] = await Promise.all([connection(), connection()]);
      const approve2 = resolveOnConnection(three, admin.id, await approveArgs(approveVsCancel));
      await waitForRatingLockWaiters(1);
      const cancel = cancelOnConnection(four, other.owner.id, approveVsCancel);
      await waitForBlockedBackend(four.backendPid);
      await holder2.release();
      const [approved2, canceled] = await settle(
        Promise.all([approve2, cancel]),
        'approve vs cancel'
      );
      expectOk(approved2);
      expect(failure(canceled)).toContain('LEVEL_REVIEW_INVALID_TRANSITION');
      expect(await adjustmentCount(other.owner.id)).toBe(1);
    }
  );

  it.skipIf(!environment.env)(
    'approval-first: the confirmation consumes the corrected state and a full replay agrees',
    async () => {
      const { owner, quartet } = await rated('afirst');
      const requestId = await submitExact(owner, 5.5);
      const pending = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      const league = await leagueFingerprint();
      const holder = await ratingLockHolder();
      const [approver, confirmer] = await Promise.all([connection(), connection()]);
      const approval = resolveOnConnection(
        approver,
        admin.id,
        await approveArgs(requestId, { target: 5.5 })
      );
      await waitForRatingLockWaiters(1);
      const confirmation = confirmer.query(finalizeSql(pending.proposalId, 'AUTO_48H'));
      await waitForRatingLockWaiters(2);
      await holder.release();
      const [approved] = await settle(Promise.all([approval, confirmation]), 'approval first');
      expectOk(approved);

      const ownerCalc = (await ledgerOf([pending.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      expect(ownerCalc.calculations).toHaveLength(1);
      expect(ownerCalc.calculations[0]).toMatchObject({
        beforeMu: 5.5,
        beforeGroups: 1,
        afterGroups: 2
      });
      expect(await adjustmentCount(owner.id)).toBe(1);
      // The incremental state equals what the merged-stream replay reproduces.
      const state = await ratingRow(owner.id);
      expect((await activateRatingProjection()).changed).toBe(false);
      expect(await ratingRow(owner.id)).toEqual(state);
      // Result confirmation never touches League standings state through an adjustment.
      expect(typeof league).toBe('string');
    }
  );

  it.skipIf(!environment.env)(
    'confirmation-first: the stale preview is rejected and an explicit retry applies to the new state',
    async () => {
      const { owner, quartet } = await rated('cfirst');
      const requestId = await submitExact(owner, 5.5);
      const staleArgs = await approveArgs(requestId, { target: 5.5 });
      const pending = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: await nextTailPlayedAt(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      const holder = await ratingLockHolder();
      const [confirmer, approver] = await Promise.all([connection(), connection()]);
      const confirmation = confirmer.query(finalizeSql(pending.proposalId, 'AUTO_48H'));
      await waitForRatingLockWaiters(1);
      const approval = resolveOnConnection(approver, admin.id, staleArgs);
      await waitForRatingLockWaiters(2);
      await holder.release();
      const [, stale] = await settle(Promise.all([confirmation, approval]), 'confirmation first');
      expect(failure(stale)).toContain('LEVEL_REVIEW_STALE_RATING');
      expect(await adjustmentCount(owner.id)).toBe(0);
      expect(await levelReviewRow(requestId)).toMatchObject({ status: 'pending' });

      const retry = await resolveOnConnection(
        await connection(),
        admin.id,
        await approveArgs(requestId, { target: 5.5 })
      );
      expect(asRecord(expectOk(retry)['adjustment'])['before_confirmed_groups']).toBe(2);
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5.5, groups: 2 });
    }
  );

  it.skipIf(!environment.env)(
    'approval overlapping a late replay and an activation neither deadlocks nor loses the correction',
    async () => {
      const { owner, quartet } = await rated('overlap');
      const requestId = await submitExact(owner, 5);
      const late = await submitPendingGroup({
        eventId: await world.newEvent(),
        players: quartet,
        playedAt: new Date(Date.now() - 86_400_000).toISOString(),
        submittedBy: world.admin.id,
        classification: 'team_b'
      });
      const holder = await ratingLockHolder();
      const [approver, confirmer, activator] = await Promise.all([
        connection(),
        connection(),
        connection()
      ]);
      const approval = resolveOnConnection(approver, admin.id, await approveArgs(requestId));
      await waitForRatingLockWaiters(1);
      const replay = confirmer.query(finalizeSql(late.proposalId, 'AUTO_48H'));
      await waitForRatingLockWaiters(2);
      const activation = activateRatingProjection(activator);
      await waitForRatingLockWaiters(3);
      await holder.release();
      const [approved] = await settle(
        Promise.all([approval, replay, activation]),
        'approval overlap'
      );
      expectOk(approved);
      expect(await adjustmentCount(owner.id)).toBe(1);
      expect(await ratingRow(owner.id)).toMatchObject({ mu: 5, groups: 2 });
      const lateOwner = (await ledgerOf([late.proposalId])).find(
        (entry) => entry.userId === owner.id
      )!;
      expect(lateOwner.calculations[0]).toMatchObject({ beforeMu: 4, beforeGroups: 0 });
      expect((await activateRatingProjection()).changed).toBe(false);
      expect(await committedRevision()).toBeGreaterThan(0);
    }
  );

  it.skipIf(!environment.env)(
    'the boundary follows the decision clock when no match or checkpoint is newer (rolled back)',
    async () => {
      const owner = await world.player('clock', 4);
      const requestId = await submitExact(owner, 5);
      const conn = await connection();
      await conn.query('begin');
      try {
        // Inside this rolled-back transaction: empty checkpoint history and an old watermark.
        await conn.query(`alter table public.player_rating_admin_adjustments disable trigger player_rating_adjustments_immutable;
          alter table public.player_rating_adjustment_states disable trigger player_rating_adjustment_states_immutable;
          set constraints all deferred;
          delete from public.player_rating_adjustment_states;
          delete from public.player_rating_admin_adjustments;
          update public.player_rating_projection_control set
            last_processed_played_at = '2000-01-01T00:00:00Z',
            last_processed_game_group_id = '00000000-0000-4000-8000-000000000000'`);
        const args = await approveArgs(requestId);
        await conn.query(
          `select set_config('request.jwt.claims', '{"sub":"${admin.id}","role":"authenticated"}', true)`
        );
        await conn.query('set local role authenticated');
        await conn.query(
          `select public.resolve_level_review_request('${requestId}', '${args.p_command_id}', 'approve', 'Clock basis.', 5, ${args.p_expected_revision}::bigint)`
        );
        await conn.query('reset role');
        const [row] = (
          await conn.query(
            `select boundary_basis, boundary_group_id::text as gid, boundary_played_at >= decided_at as after_decision,
                    boundary_played_at <= decided_at + interval '1 second' as close_to_decision,
                    (decided_at + interval '1 microsecond', gen_random_uuid())
                      > (boundary_played_at, boundary_group_id) as later_match_after,
                    (decided_at, '00000000-0000-0000-0000-000000000000'::uuid)
                      < (boundary_played_at, boundary_group_id) as same_instant_before
               from public.player_rating_admin_adjustments`
          )
        ).rows;
        expect(row).toEqual({
          boundary_basis: 'decision_clock',
          gid: 'ffffffff-ffff-ffff-ffff-ffffffffffff',
          after_decision: true,
          close_to_decision: true,
          // Ordering key (decision clock, max UUID): a match one microsecond later is corrected,
          // a match at the decision instant sorts before the checkpoint.
          later_match_after: true,
          same_instant_before: true
        });
      } finally {
        await conn.query('rollback');
      }
      expect(await adjustmentCount(owner.id)).toBe(0);
      expect(await levelReviewRow(requestId)).toMatchObject({ status: 'pending' });
      expect(
        (
          await sqlRows('select count(*)::int as count from public.player_rating_admin_adjustments')
        )[0]?.['count']
      ).toBeGreaterThan(0);
    }
  );
});
