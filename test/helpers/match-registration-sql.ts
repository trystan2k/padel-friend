import { expect } from 'vitest';
import {
  executeTrustedSql,
  queryTrustedSql,
  sqlErrorMessage,
  startCliSql,
  startSql,
  type SqlHandle,
  type SqlRow
} from './sql-transport';
import { createFixtureCleanupRegistry, type FixtureCleanupRegistry } from './fixture-cleanup';

export { startCliSql, startSql };
export type { SqlHandle, SqlRow };

type MatchFixtureCleanupScope = {
  communityIds: Set<string>;
  eventIds: Set<string>;
  hasStorageObjects: boolean;
};

const matchFixtureCleanupScopes = new WeakMap<FixtureCleanupRegistry, MatchFixtureCleanupScope>();

function matchFixtureScope(registry: FixtureCleanupRegistry): MatchFixtureCleanupScope {
  let scope = matchFixtureCleanupScopes.get(registry);
  if (!scope) {
    scope = { communityIds: new Set(), eventIds: new Set(), hasStorageObjects: false };
    matchFixtureCleanupScopes.set(registry, scope);
  }
  return scope;
}

/** Register auth- and notification-owned rows for one newly created test actor. */
export function registerMatchActorFixtureRows(
  registry: FixtureCleanupRegistry,
  actor: { id?: string; email?: string }
): void {
  if (actor.email) registry.register('auth.users', { email: actor.email });
  if (!actor.id) return;

  registry.register('auth.users', { id: actor.id });
  registry.register('public.community_notifications', { recipient_user_id: actor.id });
  registry.register('public.community_request_messages', { sender_user_id: actor.id });
  registry.register('public.community_request_messages', { recipient_user_id: actor.id });
  registry.register('public.community_invitee_directory_preferences', { user_id: actor.id });
  registry.register('public.notification_preferences', { user_id: actor.id });
  registry.register('public.notifications', { recipient_user_id: actor.id });
}

/** Register a test-owned community and all rows that reference it directly. */
export function registerMatchCommunityFixtureRows(
  registry: FixtureCleanupRegistry,
  communityId: string
): void {
  matchFixtureScope(registry).communityIds.add(communityId);
  registry.register('public.communities', { id: communityId });
  registry.register('public.community_members', { community_id: communityId });
  registry.register('public.community_audit_log', { community_id: communityId });
  registry.register('public.community_invitations', { community_id: communityId });
  registry.register('public.community_request_messages', { community_id: communityId });
  registry.register('public.community_venues', { community_id: communityId });
  registry.register('public.notifications', { community_id: communityId });
}

/** Register an exact uploaded object path; never clean a whole Storage bucket. */
export function registerMatchStorageFixtureObject(
  registry: FixtureCleanupRegistry,
  bucketId: string,
  objectName: string
): void {
  matchFixtureScope(registry).hasStorageObjects = true;
  registry.register('storage.objects', { bucket_id: bucketId, name: objectName });
}

/** Register one event and every direct child identity before fixture creation. */
export function registerMatchEventFixtureRows(
  registry: FixtureCleanupRegistry,
  eventId: string,
  photoPath?: string
): void {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(eventId))
    throw new Error(`Invalid match fixture event ID: ${eventId}`);
  matchFixtureScope(registry).eventIds.add(eventId);
  registry.register('public.match_events', { id: eventId });
  registry.register('public.match_event_invites', { match_event_id: eventId });
  registry.register('public.match_event_management_commands', { match_event_id: eventId });
  registry.register('public.match_event_audit_log', { match_event_id: eventId });
  registry.register('public.match_event_registration_attempts', { match_event_id: eventId });
  registry.register('public.match_event_registrations', { match_event_id: eventId });
  registry.register('public.match_event_registration_state', { match_event_id: eventId });
  registry.register('public.match_event_result_proposals', { match_event_id: eventId });
  registry.register('public.notifications', { target_id: eventId });
  if (photoPath) registerMatchStorageFixtureObject(registry, 'match-event-photos', photoPath);
}

/**
 * Creates a scoped registry for real match/community fixtures. Cleanup first
 * discovers owned event/message children, then removes only registered rows in
 * FK order. DDL guards are disabled only for the cleanup transaction and are
 * restored by commit or transaction rollback.
 */
export function createMatchFixtureCleanupRegistry(scopeName: string): FixtureCleanupRegistry {
  const registry = createFixtureCleanupRegistry(scopeName);
  const scope = matchFixtureScope(registry);
  registry.setCleanupExecutor(async (current) => {
    const communityIds = [...scope.communityIds];
    if (communityIds.length > 0) {
      const events = await queryTrustedSql(
        `select id::text as id, photo_path from public.match_events where community_id = any($1::uuid[])`,
        { values: [communityIds] }
      );
      for (const row of events.rows) {
        const eventId = String(row['id']);
        const photoPath = typeof row['photo_path'] === 'string' ? row['photo_path'] : undefined;
        registerMatchEventFixtureRows(current, eventId, photoPath);
      }

      const messages = await queryTrustedSql(
        `select id::text as id from public.community_request_messages where community_id = any($1::uuid[])`,
        { values: [communityIds] }
      );
      for (const row of messages.rows)
        current.register('public.community_notifications', {
          request_message_id: String(row['id'])
        });
    }

    const eventIds = [...scope.eventIds];
    if (eventIds.length > 0) {
      const proposals = await queryTrustedSql(
        `select id::text as id from public.match_event_result_proposals where match_event_id = any($1::uuid[])`,
        { values: [eventIds] }
      );
      for (const row of proposals.rows)
        current.register('public.match_event_result_proposal_versions', {
          proposal_id: String(row['id'])
        });
    }

    const beforeStatements: string[] = [];
    const afterStatements: string[] = [];
    const triggerPairs: Array<[table: string, trigger: string]> = [];
    if (scope.communityIds.size > 0) {
      beforeStatements.push(
        'alter table public.community_members disable trigger community_member_guard'
      );
      afterStatements.push(
        'alter table public.community_members enable trigger community_member_guard'
      );
    }
    if (scope.eventIds.size > 0) {
      const eventTriggerPairs: Array<[table: string, trigger: string]> = [
        ['match_events', 'match_event_immutable'],
        ['match_event_invites', 'match_invite_immutable'],
        ['match_event_registrations', 'match_registration_identity_guard'],
        ['match_event_registrations', 'match_registration_final_state'],
        ['match_event_registration_attempts', 'match_attempt_history_guard'],
        ['match_event_registration_attempts', 'match_attempt_final_state'],
        ['match_event_audit_log', 'match_audit_immutable'],
        ['match_event_result_proposals', 'match_result_proposal_immutable'],
        ['match_event_result_proposal_versions', 'match_result_proposal_version_immutable']
      ];
      for (const [table, trigger] of eventTriggerPairs) {
        triggerPairs.push([table, trigger]);
        beforeStatements.push(`alter table public.${table} disable trigger ${trigger}`);
        afterStatements.unshift(`alter table public.${table} enable trigger ${trigger}`);
      }
      beforeStatements.push(
        `update public.match_event_registrations set current_attempt_id = null where match_event_id = any(array[${[
          ...scope.eventIds
        ]
          .map((id) => `'${id}'::uuid`)
          .join(',')}])`
      );
    }
    if (triggerPairs.length > 0) {
      const triggerPredicates = triggerPairs
        .map(([table, trigger]) => `(c.relname = '${table}' and t.tgname = '${trigger}')`)
        .join(' or ');
      const triggerStates = await queryTrustedSql(
        `select c.relname as table_name, t.tgname as trigger_name, t.tgenabled as enabled
           from pg_catalog.pg_trigger t
           join pg_catalog.pg_class c on c.oid = t.tgrelid
           join pg_catalog.pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and not t.tgisinternal and (${triggerPredicates})`
      );
      if (
        triggerStates.rows.length !== triggerPairs.length ||
        triggerStates.rows.some((row) => row['enabled'] !== 'O')
      )
        throw new Error(
          `Refusing fixture cleanup because expected triggers are missing or not enabled: ${JSON.stringify(triggerStates.rows)}`
        );
    }
    if (scope.hasStorageObjects)
      beforeStatements.unshift(`select set_config('storage.allow_delete_query','true',true)`);

    await current.deleteRegisteredRowsInOrder({
      beforeStatements,
      afterStatements,
      restoreOnFailure: afterStatements
    });
  });
  return registry;
}

// Shared trusted-SQL harness for the PAF-5.3 registration suites (model, FIFO,
// notifications). Fixtures use the bounded pool; independent holders and probes
// preserve the retained-lock barrier that proves RPC contenders genuinely block
// on the event lock chain before being released.
// Nothing here touches production code; everything fails closed without a
// loopback Supabase env (see helpers/local-supabase-env.ts).

export type RpcError = {
  code?: string | null;
  message?: string | null;
  details?: string | null;
} | null;
export type RpcResult = { data: unknown; error: RpcError };
export type RawRpcActor = { token: string };
export type RawRpc = (
  who: RawRpcActor,
  name: string,
  body: Record<string, unknown>
) => Promise<RpcResult>;

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function withDeadline<T>(
  task: Promise<T>,
  deadlineMs: number,
  label: string
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      task,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`Timed out after ${deadlineMs}ms: ${label}`)),
          deadlineMs
        );
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
}

export function isRecord(value: unknown): value is SqlRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

/** Trusted read/fixture query that must succeed and return JSON rows. */
export async function sqlRows(sql: string): Promise<SqlRow[]> {
  return (await queryTrustedSql(sql)).rows;
}

/** Trusted fixture SQL whose only observable output is success. */
export async function fixtureSql(sql: string): Promise<void> {
  try {
    await executeTrustedSql(sql);
  } catch (error) {
    throw new Error(`Trusted fixture SQL failed: ${sqlErrorMessage(error)}`, { cause: error });
  }
}

/** Polls a probe query until `ready` matches, proving backend-level states. */
export async function waitForRows(
  sql: string,
  ready: (rows: SqlRow[]) => boolean,
  description: string,
  timeoutMs = 20000,
  pollIntervalMs = 150
): Promise<SqlRow[]> {
  const deadline = Date.now() + timeoutMs;
  let rows: SqlRow[] = [];
  while (Date.now() < deadline) {
    rows = await sqlRows(sql);
    if (ready(rows)) return rows;
    await sleep(pollIntervalMs);
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(rows)}`);
}

/**
 * A raw PostgREST call. supabase-js serializes every authenticated request
 * behind a per-storage-key mutex (same URL + anon key = same key), so two
 * client instances can never reach Postgres concurrently — raw fetch calls
 * are the only way two contenders genuinely block on the same row lock.
 */
export function makeRawRpc(restUrl: string, anonKey: string): RawRpc {
  return async (who, name, body) => {
    const response = await fetch(`${restUrl}/rest/v1/rpc/${name}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${who.token}`,
        apikey: anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    const payload: unknown = await response.json();
    if (!response.ok) {
      const record = asRecord(payload);
      return {
        data: null,
        error: {
          code: typeof record['code'] === 'string' ? record['code'] : String(response.status),
          message: typeof record['message'] === 'string' ? record['message'] : response.statusText,
          details: typeof record['details'] === 'string' ? record['details'] : null
        }
      };
    }
    return { data: payload, error: null };
  };
}

/**
 * Builds a proven concurrency barrier: a retained trusted-SQL holder locks the
 * community row every registration RPC must take first. The confirm-and-
 * release probe is spawned BEFORE the contenders fire and polls
 * pg_stat_activity INSIDE the database (50 ms granularity), because the RPC
 * role runs with an 8 s statement_timeout — slow out-of-process probing would
 * miss the blocked window entirely. Postgres queues the waiters in a chain
 * (holder → contender A → contender B), so "proven overlap" means: exactly
 * `blockedExpected` (default two) contender backends are blocked on THIS
 * barrier's lock chain — counted via a one-level closure rooted at the
 * holder, since pg_blocking_pids reports immediate blockers only — so
 * lock-waiters from other vitest suites sharing the same local database
 * (they match the same RPC-name fragment) can never satisfy or distort the
 * count — at least one of them directly behind the
 * holder, and no contender waits on anything outside that chain. Once proven, the probe terminates the
 * holder, so the contenders proceed back-to-back with zero gap. Overlap is
 * therefore observed, never assumed from Promise.all. The marker sweep in the
 * finally block kills any orphaned holder backend even if process-tree cleanup
 * fails.
 */
export async function proveEventLockBarrier(params: {
  markerPrefix?: string;
  communityId: string;
  eventId: string;
  /** LIKE fragment matching every contender query, e.g. an RPC name. */
  rpcToken: string;
  fire: () => [PromiseLike<RpcResult>, PromiseLike<RpcResult>];
  blockedExpected?: number;
  /** Boundary proof: retain this proven lock chain until event cutoff. */
  releaseAtCutoff?: boolean;
}): Promise<[RpcResult, RpcResult]> {
  const blockedExpected = params.blockedExpected ?? 2;
  const marker = `${params.markerPrefix ?? 'paf53'}-holder-${crypto.randomUUID().replaceAll('-', '')}`;
  const holder = startSql(
    `/* ${marker} */ select pg_catalog.pg_sleep(900) from (select id from public.communities where id = '${params.communityId}' for update) locked;`
  );
  let confirm: SqlHandle | null = null;
  try {
    const [holderRow] = await waitForRows(
      `select pid as value from pg_catalog.pg_stat_activity
        where query like '%${marker}%' and state = 'active' and pid <> pg_catalog.pg_backend_pid()`,
      (rows) => rows.length === 1,
      'the trusted lock holder backend',
      20000,
      100
    );
    const holderPid = Number(holderRow!['value']);
    expect(Number.isInteger(holderPid), 'holder pid').toBe(true);
    expect(await holder.backendPid, 'holder uses its dedicated PostgreSQL backend').toBe(holderPid);
    // In-database poll: wait until both contenders are provably blocked on
    // this event's lock chain (rooted at the holder), then release them in
    // the same transaction. Contenders are counted via a one-level chain
    // closure rooted at THIS barrier's holder: a backend counts as blocked
    // when the holder is among its blocking pids, or when it is blocked by
    // another token-matching waiter that the holder blocks directly. The
    // closure is needed because pg_blocking_pids reports the immediate
    // blocker only — in the canonical chain holder → A → B, blockers(A)
    // contains the holder but blockers(B) contains A — so a naive
    // holder-membership filter would only ever see contender A. Scoping to
    // the closure keeps the count immune to parallel vitest suites sharing
    // the local database: their lock-waiters match the same RPC-name LIKE
    // fragment but never join this chain (previously counted, that noise
    // made the proof unsatisfiable under full-suite load — observed as
    // `blocked=4 holder_direct=1 stray=0`). The 6.5 s deadline is a widened
    // HARNESS ceiling for that same load: contender arrival and probe
    // startup can lag when every suite shares one Postgres + PostgREST, and
    // the old 5 s ceiling tripped intermittently. It deliberately stays
    // inside the RPC role's 8 s statement_timeout, so once the holder is
    // terminated the released contenders keep >=1.5 s of their own statement
    // budget to finish. The proof itself is unchanged and not relaxed:
    // exactly `blockedExpected` contenders blocked on this chain, at least
    // one of them directly behind the holder, zero strays.
    confirm = startSql(`do $barrier$
      declare
        v_blocked integer;
        v_holder_direct integer;
        v_stray integer;
        v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '6.5 seconds';
       begin
        loop
          -- pg_stat_activity is transaction-snapshot cached. Independent CLI
          -- contenders can arrive on different iterations; refresh evidence.
          perform pg_catalog.pg_stat_clear_snapshot();
          select pg_catalog.count(*) into v_blocked
            from pg_catalog.pg_stat_activity a
           where a.wait_event_type = 'Lock'
             and a.query like '%${params.rpcToken}%'
             and a.pid <> pg_catalog.pg_backend_pid()
             and a.pid <> ${holderPid}
             and (
                   ${holderPid} = any(pg_catalog.pg_blocking_pids(a.pid))
                or exists (
                     select 1 from pg_catalog.pg_stat_activity p
                      where p.wait_event_type = 'Lock'
                        and p.query like '%${params.rpcToken}%'
                        and p.pid <> a.pid
                        and ${holderPid} = any(pg_catalog.pg_blocking_pids(p.pid))
                        and p.pid = any(pg_catalog.pg_blocking_pids(a.pid))));
          select pg_catalog.count(*) into v_holder_direct
            from pg_catalog.pg_stat_activity a
           where a.wait_event_type = 'Lock'
             and a.query like '%${params.rpcToken}%'
             and ${holderPid} = any(pg_catalog.pg_blocking_pids(a.pid))
             and a.pid <> pg_catalog.pg_backend_pid()
             and a.pid <> ${holderPid};
          select pg_catalog.count(*) into v_stray
            from pg_catalog.pg_stat_activity a
           where a.wait_event_type = 'Lock'
             and a.query like '%${params.eventId}%'
             and a.pid <> pg_catalog.pg_backend_pid()
             and a.pid <> ${holderPid}
             and exists (
                   select 1 from pg_catalog.unnest(pg_catalog.pg_blocking_pids(a.pid)) b
                    where b <> ${holderPid}
                      and not exists (
                            select 1 from pg_catalog.pg_stat_activity c
                             where c.pid = b
                               and c.wait_event_type = 'Lock'
                               and c.query like '%${params.eventId}%'));
          exit when (v_blocked = ${blockedExpected} and v_holder_direct >= 1 and v_stray = 0)
                 or pg_catalog.clock_timestamp() > v_deadline;
          perform pg_catalog.pg_sleep(0.05);
        end loop;
        if v_blocked <> ${blockedExpected} or v_holder_direct < 1 or v_stray <> 0 then
          raise exception 'barrier not proven: blocked=% holder_direct=% stray=% waits=%', v_blocked, v_holder_direct, v_stray,
            (select jsonb_agg(jsonb_build_object('pid', pid, 'query', left(query, 300), 'blockers', pg_catalog.pg_blocking_pids(pid))) from pg_catalog.pg_stat_activity where wait_event_type='Lock');
        end if;
        ${params.releaseAtCutoff ? `perform pg_catalog.pg_sleep(greatest(0, extract(epoch from (select registration_cutoff_at - clock_timestamp() from public.match_events where id = '${params.eventId}'))));` : ''}
        perform pg_catalog.pg_terminate_backend(${holderPid});
        end $barrier$;`);
    expect(await confirm.backendPid, 'probe uses a separate PostgreSQL backend').not.toBe(
      holderPid
    );
    const contenders = params.fire();
    const confirmResult = await withDeadline(confirm.done, 30000, 'barrier confirm-and-release');
    if (confirmResult.code !== 0)
      throw new Error(
        `Barrier confirmation failed (${confirmResult.code}): ${confirmResult.stdout}\n${confirmResult.stderr}`
      );
    return await Promise.all([contenders[0], contenders[1]]);
  } finally {
    // Belt and suspenders: sweep any backend still running the holder query.
    await sqlRows(
      `select pg_catalog.pg_terminate_backend(pid) as swept from pg_catalog.pg_stat_activity
        where query like '%${marker}%' and pid <> pg_catalog.pg_backend_pid()`
    ).catch(() => []);
    if (confirm) await confirm.stop();
    await holder.stop();
  }
}

/** Number of leaked retained-holder backends still visible in pg_stat_activity. */
export async function leakedHolderBackends(markerPrefix = 'paf53-holder-'): Promise<number> {
  const rows = await sqlRows(
    `select pg_catalog.count(*)::int as n from pg_catalog.pg_stat_activity
      where query like '%${markerPrefix}%' and pid <> pg_catalog.pg_backend_pid()`
  );
  return Number(rows[0]!['n']);
}

export async function registrationStateById(
  eventId: string
): Promise<{ next: number; revision: number }> {
  const rows = await sqlRows(
    `select next_accepted_ordinal::int as next, transition_revision::int as revision
      from public.match_event_registration_state where match_event_id = '${eventId}'`
  );
  expect(rows, `state row for ${eventId}`).toHaveLength(1);
  return { next: Number(rows[0]!['next']), revision: Number(rows[0]!['revision']) };
}

export type RegistrationSnapshot = {
  state: { next: number; revision: number };
  cutoffMarker: string | null;
};

/** Reads committed registration state for a suite's fixture set in one snapshot. */
export async function registrationSnapshotsByEventIds(
  eventIds: readonly string[]
): Promise<Map<string, RegistrationSnapshot>> {
  if (eventIds.length === 0) return new Map();
  const { rows } = await queryTrustedSql(
    `select match_event_id::text as event_id,
            next_accepted_ordinal::int as next,
            transition_revision::int as revision,
            cutoff_processed_at::text as cutoff_marker
       from public.match_event_registration_state
      where match_event_id = any($1::uuid[])`,
    { values: [[...eventIds]] }
  );
  return new Map(
    rows.map((row) => [
      String(row['event_id']),
      {
        state: { next: Number(row['next']), revision: Number(row['revision']) },
        cutoffMarker: typeof row['cutoff_marker'] === 'string' ? row['cutoff_marker'] : null
      }
    ])
  );
}

export async function expectDomainError(
  promise: PromiseLike<RpcResult>,
  token: string
): Promise<void> {
  const result = await promise;
  expect(result.error, `expected ${token}, got success`).not.toBeNull();
  expect(result.error!.code, `${token} sqlstate`).toBe('P0001');
  expect(result.error!.message, `${token} message`).toBe(token);
}

/**
 * Positional invariant: every accepted row's stored participation_status must
 * equal the derived roster expectation, positions must be contiguous from 1,
 * and the counts function must agree with the roster totals. The roster
 * function itself is the oracle here — the stored column is never recomputed
 * from a second formula in the test.
 */
export async function expectRosterAgreement(eventId: string): Promise<{
  acceptedTotal: number;
  playingTotal: number;
  reserveTotal: number;
}> {
  const rows = await sqlRows(
    `select r.id::text as registration_id, r.participation_status::text as stored,
            q.roster_position::int as pos, q.participation_status::text as derived,
            q.accepted_total::int as accepted_total, q.playing_total::int as playing_total,
            q.reserve_total::int as reserve_total
       from public.match_event_registrations r
       join public.match_registration_roster('${eventId}') q on q.registration_id = r.id
      order by q.roster_position`
  );
  let position = 1;
  let playing = 0;
  let acceptedTotal = -1;
  for (const row of rows) {
    expect(Number(row['pos']), `roster position at row ${position} of ${eventId}`).toBe(position);
    expect(row['stored'], `stored participation of ${String(row['registration_id'])}`).toBe(
      row['derived']
    );
    expect(Number(row['accepted_total'])).toBe(rows.length);
    if (acceptedTotal < 0) {
      acceptedTotal = Number(row['accepted_total']);
      expect(Number(row['playing_total'])).toBeLessThanOrEqual(acceptedTotal);
      expect(Number(row['reserve_total'])).toBe(acceptedTotal - Number(row['playing_total']));
    }
    if (row['derived'] === 'playing') playing++;
    position++;
  }
  const counts = await sqlRows(
    `select accepted_count::int as accepted, playing_count::int as playing, reserve_count::int as reserve
      from public.match_registration_counts('${eventId}')`
  );
  expect(Number(counts[0]!['accepted'])).toBe(rows.length);
  expect(Number(counts[0]!['playing'])).toBe(playing);
  expect(Number(counts[0]!['reserve'])).toBe(rows.length - playing);
  return { acceptedTotal: rows.length, playingTotal: playing, reserveTotal: rows.length - playing };
}

/** Ordinal uniqueness + state-counter consistency for one event. */
export async function expectOrdinalInvariants(
  eventId: string,
  options: { nextAcceptedOrdinal?: number } = {}
): Promise<void> {
  const rows = await sqlRows(
    `select pg_catalog.count(*)::int as total,
            pg_catalog.count(distinct r.accepted_order)::int as distinct_orders,
            coalesce(pg_catalog.min(r.accepted_order), 0)::int as min_order,
            coalesce(pg_catalog.max(r.accepted_order), 0)::int as max_order
       from public.match_event_registrations r
      where r.match_event_id = '${eventId}' and r.lifecycle = 'accepted'`
  );
  const total = Number(rows[0]!['total']);
  expect(Number(rows[0]!['distinct_orders']), `distinct ordinals on ${eventId}`).toBe(total);
  if (total > 0) {
    expect(Number(rows[0]!['min_order'])).toBe(1);
    expect(Number(rows[0]!['max_order'])).toBe(total);
  }
  const state = await registrationStateById(eventId);
  expect(state.next, `next ordinal mirrors accepted count on ${eventId}`).toBe(total + 1);
  if (options.nextAcceptedOrdinal !== undefined)
    expect(state.next).toBe(options.nextAcceptedOrdinal);
}
