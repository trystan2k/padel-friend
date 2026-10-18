import { spawn } from 'node:child_process';
import { expect } from 'vitest';

// Shared trusted-SQL harness for the PAF-5.3 registration suites (model, FIFO,
// notifications). Same process-isolated `supabase db query` pattern as the
// PAF-5.2 actions suite: every fixture or probe runs on its own connection as
// the local database owner, and the retained-lock barrier proves that RPC
// contenders genuinely block on the event lock chain before being released.
// Nothing here touches production code; everything fails closed without a
// loopback Supabase env (see helpers/local-supabase-env.ts).

export type SqlResult = { code: number | null; stdout: string; stderr: string };
export type SqlHandle = {
  done: Promise<SqlResult>;
  stop: (gracePeriodMs?: number) => Promise<void>;
};
export type SqlRow = Record<string, unknown>;
export type RpcError = { code?: string | null; message?: string | null } | null;
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

/**
 * Spawns one `supabase db query` child as a process-group leader on its own
 * connection. Used both for trusted fixture SQL and for the retained lock
 * holder that proves RPC contenders genuinely overlap. `stop` escalates
 * SIGTERM → SIGKILL across the whole tree so no psql grandchild survives.
 */
export function startSql(sql: string): SqlHandle {
  const child = spawn(
    'pnpm',
    ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
    {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: process.platform !== 'win32'
    }
  );
  let stdout = '';
  let stderr = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const done = new Promise<SqlResult>((resolve) => {
    child.once('error', (error: Error) =>
      resolve({ code: null, stdout, stderr: `${stderr}${error}` })
    );
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      child.kill(signal);
    }
  };
  const isGroupAlive = (): boolean => {
    if (child.pid === undefined) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      return (
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
      );
    }
  };
  const stop = async (gracePeriodMs = 1000): Promise<void> => {
    if (!exited()) {
      signalTree('SIGTERM');
      await new Promise<boolean>((resolve) => {
        const timer = setTimeout(() => resolve(false), gracePeriodMs);
        child.once('close', () => {
          clearTimeout(timer);
          resolve(true);
        });
      });
    }
    // Leader exit alone never implies an empty group: the supabase CLI's psql
    // grandchild survives pnpm's SIGTERM and would keep its lock for 900s.
    if (isGroupAlive()) {
      signalTree('SIGKILL');
      for (let waitedMs = 0; waitedMs < gracePeriodMs && isGroupAlive(); waitedMs += 25)
        await sleep(25);
    }
  };
  return { done, stop };
}

export function isRecord(value: unknown): value is SqlRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function asRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function parseSqlRows(result: SqlResult): SqlRow[] {
  if (result.code !== 0)
    throw new Error(`Local SQL failed (${result.code}): ${result.stdout}\n${result.stderr}`);
  const start = result.stdout.indexOf('[');
  const end = result.stdout.lastIndexOf(']');
  if (start < 0 || end <= start)
    throw new Error(`Local SQL returned no JSON rows: ${result.stdout.slice(0, 400)}`);
  const parsed: unknown = JSON.parse(result.stdout.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error(`Local SQL returned invalid rows: ${result.stdout}`);
  const rows = parsed.filter(isRecord);
  if (rows.length !== parsed.length)
    throw new Error(`Local SQL returned invalid rows: ${result.stdout}`);
  return rows;
}

/** Trusted read/fixture query that must succeed and return JSON rows. */
export async function sqlRows(sql: string): Promise<SqlRow[]> {
  const handle = startSql(sql);
  try {
    return parseSqlRows(await withDeadline(handle.done, 30000, 'local SQL query'));
  } catch (error) {
    await handle.stop();
    throw error;
  }
}

/** Trusted fixture SQL whose only observable output is success. */
export async function fixtureSql(sql: string): Promise<void> {
  const handle = startSql(sql);
  try {
    const result = await withDeadline(handle.done, 30000, 'local fixture SQL');
    if (result.code !== 0)
      throw new Error(
        `Trusted fixture SQL failed (${result.code}): ${result.stdout}\n${result.stderr}`
      );
  } catch (error) {
    await handle.stop();
    throw error;
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
          message: typeof record['message'] === 'string' ? record['message'] : response.statusText
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
 * `blockedExpected` (default two) backends for this event are blocked on
 * locks, at least one of them directly behind the holder, and no contender
 * waits on anything outside that chain. Once proven, the probe terminates the
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
    // In-database poll: wait until both contenders are provably blocked on
    // this event's lock chain (rooted at the holder), then release them in
    // the same transaction. The 5 s deadline stays inside the RPC role's
    // 8 s statement_timeout.
    confirm = startSql(`do $barrier$
      declare
        v_blocked integer;
        v_holder_direct integer;
        v_stray integer;
        v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '5 seconds';
       begin
        loop
          select pg_catalog.count(*),
                 pg_catalog.count(*) filter (where ${holderPid} = any(pg_catalog.pg_blocking_pids(pid)))
            into v_blocked, v_holder_direct
            from pg_catalog.pg_stat_activity
           where wait_event_type = 'Lock'
             and query like '%${params.rpcToken}%'
             and pid <> pg_catalog.pg_backend_pid()
             and pid <> ${holderPid};
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
          raise exception 'barrier not proven: blocked=% holder_direct=% stray=%', v_blocked, v_holder_direct, v_stray;
        end if;
        perform pg_catalog.pg_terminate_backend(${holderPid});
       end $barrier$;`);
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
