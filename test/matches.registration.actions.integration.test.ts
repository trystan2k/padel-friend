import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it, vi } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

vi.setConfig({ testTimeout: 120000, hookTimeout: 120000 });

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Actor = { id: string; token: string; client: SupabaseClient<Database>; name: string };

type SqlResult = { code: number | null; stdout: string; stderr: string };
type SqlHandle = { done: Promise<SqlResult>; stop: (gracePeriodMs?: number) => Promise<void> };
type SqlRow = Record<string, unknown>;
type RpcError = { code?: string | null; message?: string | null } | null;
type RpcResult = { data: unknown; error: RpcError };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withDeadline<T>(task: Promise<T>, deadlineMs: number, label: string): Promise<T> {
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
function startSql(sql: string): SqlHandle {
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

function isRecord(value: unknown): value is SqlRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
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
async function sqlRows(sql: string): Promise<SqlRow[]> {
  const handle = startSql(sql);
  try {
    return parseSqlRows(await withDeadline(handle.done, 30000, 'local SQL query'));
  } catch (error) {
    await handle.stop();
    throw error;
  }
}

/** Trusted fixture SQL whose only observable output is success. */
async function fixtureSql(sql: string): Promise<void> {
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
async function waitForRows(
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

const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

describe('match registration actions integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  // Shared fixture: real JWT actors, trusted SQL events, one public and one
  // private community. Every test below runs against this state sequentially.
  const actors: Record<string, Actor> = {};
  const events: Record<string, string> = {};
  let publicCommunity = '';
  let privateCommunity = '';
  // Untyped client used only for the null-argument 22023 guard: without the
  // generated Database generic the RPC args are Record<string, unknown>.
  let untypedCreator: SupabaseClient | null = null;
  // REST endpoint + anon key for raw concurrency contenders.
  let restUrl = '';
  let anonKey = '';
  /**
   * A raw PostgREST call. supabase-js serializes every authenticated request
   * behind a per-storage-key mutex (same URL + anon key = same key), so two
   * client instances can never reach Postgres concurrently — raw fetch calls
   * are the only way two contenders genuinely block on the same row lock.
   */
  const rawRpc = async (
    who: Actor,
    name: string,
    body: Record<string, unknown>
  ): Promise<RpcResult> => {
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

  const submit = (who: Actor, eventKey: string): PromiseLike<RpcResult> =>
    who.client.rpc('submit_match_registration', { p_match_event_id: events[eventKey]! });
  /**
   * The current attempt identity for (event, user) — the value the creator
   * queue exposes and the client echoes back. Ordered latest-first so it names
   * the newest attempt after a re-application.
   */
  const latestAttemptId = async (eventKey: string, userId: string): Promise<string> => {
    const rows = await sqlRows(
      `select id::text as id from public.match_event_registration_attempts
        where match_event_id = '${events[eventKey]!}' and user_id = '${userId}'
        order by requested_at desc, id desc limit 1`
    );
    expect(rows, `attempt for ${userId} on ${eventKey}`).toHaveLength(1);
    return String(rows[0]!['id']);
  };
  const decide = async (
    who: Actor,
    eventKey: string,
    targetId: string,
    decision: 'approve' | 'reject'
  ): Promise<RpcResult> => {
    const attemptId = await latestAttemptId(eventKey, targetId);
    return who.client.rpc('decide_match_registration', {
      p_match_event_id: events[eventKey]!,
      p_attempt_id: attemptId,
      p_decision: decision
    });
  };
  const expectDomainError = async (
    promise: PromiseLike<RpcResult>,
    token: string
  ): Promise<void> => {
    const result = await promise;
    expect(result.error, `expected ${token}, got success`).not.toBeNull();
    expect(result.error!.code, `${token} sqlstate`).toBe('P0001');
    expect(result.error!.message, `${token} message`).toBe(token);
  };
  const expectDeniedWithCode = async (
    promise: PromiseLike<RpcResult>,
    code: string,
    message: string
  ): Promise<void> => {
    const result = await promise;
    expect(result.error, `expected ${code}, got success`).not.toBeNull();
    expect(result.error!.code, `${message} sqlstate`).toBe(code);
    expect(result.error!.message, `${message} text`).toBe(message);
  };
  /** The creator reads any registration row through RLS (creator policy). */
  const creatorRow = async (eventKey: string, userId: string) => {
    const result = await actors
      .creator!.client.from('match_event_registrations')
      .select('*')
      .eq('match_event_id', events[eventKey]!)
      .eq('user_id', userId);
    expect(result.error, `creator row read ${eventKey}/${userId}`).toBeNull();
    expect(result.data, `row for ${userId} on ${eventKey}`).toHaveLength(1);
    return result.data![0]!;
  };
  const registrationState = async (
    eventKey: string
  ): Promise<{ next: number; revision: number }> => {
    const rows = await sqlRows(
      `select next_accepted_ordinal::int as next, transition_revision::int as revision
        from public.match_event_registration_state where match_event_id = '${events[eventKey]!}'`
    );
    expect(rows, `state row for ${eventKey}`).toHaveLength(1);
    return { next: Number(rows[0]!['next']), revision: Number(rows[0]!['revision']) };
  };
  const attemptsOf = async (eventKey: string, userId: string): Promise<SqlRow[]> =>
    sqlRows(
      `select outcome, decided_at, actor_id from public.match_event_registration_attempts
        where match_event_id = '${events[eventKey]!}' and user_id = '${userId}'
        order by requested_at, id`
    );
  const notificationsOf = async (
    who: Actor,
    kind: string,
    targetId?: string
  ): Promise<SqlRow[]> => {
    let query = who.client
      .from('notifications')
      .select('id,recipient_user_id,event_key,kind,category,target_type,target_id,community_id')
      .eq('kind', kind);
    if (targetId) query = query.eq('target_id', targetId);
    const result = await query;
    expect(result.error, `${who.name} notifications ${kind}`).toBeNull();
    return result.data ?? [];
  };
  const allNotifications = async (who: Actor): Promise<SqlRow[]> => {
    const result = await who.client
      .from('notifications')
      .select('id,recipient_user_id,event_key,kind');
    expect(result.error, `${who.name} notification inbox`).toBeNull();
    return result.data ?? [];
  };
  const detailOf = async (who: Actor, eventKey: string): Promise<Record<string, unknown>> => {
    const result = await who.client.rpc('get_match_event', { p_event_id: events[eventKey]! });
    expect(result.error, `${who.name} detail ${eventKey}`).toBeNull();
    return asRecord(result.data);
  };
  /**
   * Builds a proven concurrency barrier: a retained trusted-SQL holder locks the
   * community row every registration RPC must take first. The confirm-and-
   * release probe is spawned BEFORE the contenders fire and polls
   * pg_stat_activity INSIDE the database (50 ms granularity), because the RPC
   * role runs with an 8 s statement_timeout — slow out-of-process probing would
   * miss the blocked window entirely. Postgres queues the waiters in a chain
   * (holder → contender A → contender B), so "proven overlap" means: exactly
   * two backends for this event are blocked on locks, at least one of them
   * directly behind the holder, and no contender waits on anything outside
   * that chain. Once proven, the probe terminates the holder, so the
   * contenders proceed back-to-back with zero gap. Overlap is therefore
   * observed, never assumed from Promise.all. The marker sweep in the finally
   * block kills any orphaned holder backend even if process-tree cleanup fails.
   */
  const barrier = async (
    eventKey: string,
    rpcToken: string,
    fire: () => [PromiseLike<RpcResult>, PromiseLike<RpcResult>]
  ): Promise<[RpcResult, RpcResult]> => {
    const marker = `paf52-holder-${crypto.randomUUID().replaceAll('-', '')}`;
    const eventId = events[eventKey]!;
    void eventId;
    const holder = startSql(
      `/* ${marker} */ select pg_catalog.pg_sleep(900) from (select id from public.communities where id = '${publicCommunity}' for update) locked;`
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
             and query like '%${rpcToken}%'
             and pid <> pg_catalog.pg_backend_pid()
             and pid <> ${holderPid};
          select pg_catalog.count(*) into v_stray
            from pg_catalog.pg_stat_activity a
           where a.wait_event_type = 'Lock'
             and a.query like '%${eventId}%'
             and a.pid <> pg_catalog.pg_backend_pid()
             and a.pid <> ${holderPid}
             and exists (
                   select 1 from pg_catalog.unnest(pg_catalog.pg_blocking_pids(a.pid)) b
                    where b <> ${holderPid}
                      and not exists (
                            select 1 from pg_catalog.pg_stat_activity c
                             where c.pid = b
                               and c.wait_event_type = 'Lock'
                               and c.query like '%${eventId}%'));
          exit when (v_blocked = 2 and v_holder_direct >= 1 and v_stray = 0)
                 or pg_catalog.clock_timestamp() > v_deadline;
          perform pg_catalog.pg_sleep(0.05);
        end loop;
        if v_blocked <> 2 or v_holder_direct < 1 or v_stray <> 0 then
          raise exception 'barrier not proven: blocked=% holder_direct=% stray=%', v_blocked, v_holder_direct, v_stray;
        end if;
        perform pg_catalog.pg_terminate_backend(${holderPid});
       end $barrier$;`);
      const [first, second] = fire();
      const confirmResult = await withDeadline(confirm.done, 30000, 'barrier confirm-and-release');
      if (confirmResult.code !== 0)
        throw new Error(
          `Barrier confirmation failed (${confirmResult.code}): ${confirmResult.stdout}\n${confirmResult.stderr}`
        );
      return Promise.all([first, second]);
    } finally {
      // Belt and suspenders: sweep any backend still running the holder query.
      await sqlRows(
        `select pg_catalog.pg_terminate_backend(pid) as swept from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and pid <> pg_catalog.pg_backend_pid()`
      ).catch(() => []);
      if (confirm) await confirm.stop();
      await holder.stop();
    }
  };

  it('seeds actors, communities and events through the trusted channel', async () => {
    const env = environment.env!;
    const { url, key } = env;
    restUrl = url;
    anonKey = key;
    const newActor = async (label: string, displayName?: string, level = 3.5): Promise<Actor> => {
      const signup = await createClient(url, key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `reg-actions-${label}-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error, `${label} signup`).toBeNull();
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      const token = signup.data.session!.access_token;
      const client = createClient<Database>(url, key, {
        auth: { persistSession: false, autoRefreshToken: false },
        global: { headers: { Authorization: `Bearer ${token}` } }
      });
      expect(
        (
          await client.rpc('onboard_player', {
            p_display_name: displayName ?? `Actions ${label}`,
            p_preferred_side: 'EITHER',
            p_initial_level: level
          })
        ).error
      ).toBeNull();
      return { id: signup.data.user!.id, token, client, name: displayName ?? `Actions ${label}` };
    };
    const roster: [string, string, number][] = [
      ['creator', 'Actions Creator', 3.5],
      ['admin', 'Actions Admin', 3.5],
      ['memberInRange', 'Actions In Range', 3.5],
      ['memberNoRating', 'Actions No Rating', 3.5],
      ['memberOutOfRange', 'Actions Out Of Range', 5.5],
      ['memberC', 'Actions Member C', 5.5],
      ['memberB', 'Actions Member B', 5.5],
      ['memberD', 'Actions Member D', 5.5],
      ['memberLate', 'Actions Late', 3.5],
      ['guest1', 'Actions Guest One', 3.5],
      ['guestDuplicate', 'Actions Guest Duplicate', 3.5],
      ['guestApprove', 'Actions Guest Approve', 3.5],
      ['guestRace', 'Actions Guest Race', 3.5],
      ['guestReplay', 'Actions Guest Replay', 3.5],
      ['privateOutsider', 'Actions Private Outsider', 3.5],
      ['capA', 'Actions Cap A', 3.5],
      ['capB', 'Actions Cap B', 3.5],
      ['uni1', 'Actions Uni One', 3.5],
      ['uni2', 'Actions Uni Two', 3.5],
      ['uni3', 'Actions Uni Three', 3.5],
      ['uniFive', 'Actions Uni Five', 3.5]
    ];
    const created = await Promise.all(
      roster.map(([actorKey, name, level]) => newActor(actorKey, name, level))
    );
    roster.forEach(([actorKey], index) => {
      actors[actorKey] = created[index]!;
    });
    for (const eventKey of [
      'open',
      'ranged',
      'invite',
      'privateEvent',
      'closed',
      'boundary',
      'replay',
      'capacity',
      'capacity2',
      'unlimited',
      'queue'
    ])
      events[eventKey] = crypto.randomUUID();
    publicCommunity = crypto.randomUUID();
    privateCommunity = crypto.randomUUID();

    const members = [
      'memberInRange',
      'memberNoRating',
      'memberOutOfRange',
      'memberC',
      'memberB',
      'memberD',
      'memberLate',
      'capA',
      'capB',
      'uni1',
      'uni2',
      'uni3',
      'uniFive'
    ];
    const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
    const insertEvent = (
      eventKey: string,
      options: {
        community?: string;
        visibility?: string;
        restriction?: [number, number];
        maximum?: number | null;
        cutoff?: string;
      } = {}
    ) => {
      const [minLevel, maxLevel] = options.restriction ?? [null, null];
      const maximum = options.maximum === undefined ? 'null' : String(options.maximum);
      const cutoff = options.cutoff ?? "now() + interval '7 days'";
      return `insert into public.match_events(
        id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,
        venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
        values (${q(events[eventKey]!)},${q(options.community ?? publicCommunity)},${q(actors.creator!.id)},
          now() + interval '10 days','UTC','friendly',${q(options.visibility ?? 'community_open')},'POST_MATCH_TEAMS',
          'Actions court','https://maps.google.com/maps/place/actions','${crypto.randomUUID()}/photo.webp',
          ${options.restriction ? 'true' : 'false'},${minLevel === null ? 'null' : minLevel},${maxLevel === null ? 'null' : maxLevel},${maximum},${cutoff});`;
    };
    await fixtureSql(
      [
        `do $$ begin`,
        `insert into public.communities(id,name,visibility,created_by) values
          (${q(publicCommunity)},'Actions public fixture','public',${q(actors.creator!.id)}),
          (${q(privateCommunity)},'Actions private fixture','private',${q(actors.creator!.id)});`,
        `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          (${q(publicCommunity)},${q(actors.creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(publicCommunity)},${q(actors.admin!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(privateCommunity)},${q(actors.creator!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute'),
          (${q(privateCommunity)},${q(actors.admin!.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');`,
        `insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
          ${members
            .map(
              (memberKey) =>
                `(${q(publicCommunity)},${q(actors[memberKey]!.id)},'member','active',now()-interval '1 minute',now()-interval '1 minute')`
            )
            .join(',')};`,
        `delete from public.global_player_ratings where user_id = ${q(actors.memberNoRating!.id)};`,
        `alter table public.match_events disable trigger lock_match_photo_publication;`,
        insertEvent('open'),
        insertEvent('ranged', { restriction: [3, 4] }),
        insertEvent('invite', { visibility: 'invite_only' }),
        insertEvent('privateEvent', { community: privateCommunity }),
        insertEvent('closed', { cutoff: "now() - interval '1 hour'" }),
        insertEvent('boundary'),
        insertEvent('replay'),
        insertEvent('capacity', { maximum: 2 }),
        insertEvent('capacity2', { maximum: 2 }),
        insertEvent('unlimited'),
        insertEvent('queue'),
        `alter table public.match_events enable trigger lock_match_photo_publication;`,
        `end $$;`
      ].join('\n')
    );
    // The publication trigger gave every event an accepted creator slot and the
    // matching ordinal state: each event starts at next_accepted_ordinal = 2.
    for (const eventKey of Object.keys(events)) {
      expect(await registrationState(eventKey), `${eventKey} initial state`).toEqual({
        next: 2,
        revision: 0
      });
    }
    untypedCreator = createClient(env.url, env.key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${actors.creator!.token}` } }
    });
  });

  it('routes the four entry paths: direct accept, pending member, guest request, private denial', async () => {
    // Enabled range with NO rating is part of this suite: the fixture removed it.
    const ratingRows = await sqlRows(
      `select count(*)::int as n from public.global_player_ratings where user_id = '${actors.memberNoRating!.id}'`
    );
    expect(ratingRows[0]!['n']).toBe(0);

    // 1) In-range active member on a Community Open event: accepted directly.
    const inRange = await submit(actors.memberInRange!, 'open');
    expect(inRange.error).toBeNull();
    expect(asRecord(inRange.data)).toMatchObject({
      event_id: events.open,
      user_id: actors.memberInRange!.id,
      lifecycle: 'accepted',
      participation: 'reserve',
      accepted_order: 2,
      registration_source: 'member',
      approved_at: null,
      already_registered: false
    });
    expect(typeof asRecord(inRange.data)['accepted_at']).toBe('string');
    const inRangeRow = await creatorRow('open', actors.memberInRange!.id);
    // Direct acceptance never fabricates an approval anchor.
    expect(inRangeRow['approved_at']).toBeNull();
    expect(inRangeRow['lifecycle']).toBe('accepted');

    // 2) Out-of-range member: pending, no anchors.
    const outOfRange = await submit(actors.memberOutOfRange!, 'ranged');
    expect(outOfRange.error).toBeNull();
    expect(asRecord(outOfRange.data)).toMatchObject({
      lifecycle: 'pending',
      registration_source: 'member',
      participation: null,
      accepted_order: null,
      accepted_at: null,
      approved_at: null
    });
    const outRow = await creatorRow('ranged', actors.memberOutOfRange!.id);
    for (const anchor of [
      'accepted_at',
      'accepted_order',
      'participation_status',
      'approved_at',
      'resolved_at',
      'resolved_by'
    ])
      expect(asRecord(outRow)[anchor], `${anchor} on a pending row`).toBeNull();
    expect(outRow['requested_at']).not.toBeNull();
    expect(outRow['lifecycle']).toBe('pending');

    // 3) Enabled range + member with NO rating: approval required, not auto-accept.
    const noRating = await submit(actors.memberNoRating!, 'ranged');
    expect(noRating.error).toBeNull();
    expect(asRecord(noRating.data)).toMatchObject({
      lifecycle: 'pending',
      registration_source: 'member'
    });

    // 4) Public-community nonmember (guest): pending request, source guest.
    const guest = await submit(actors.guest1!, 'open');
    expect(guest.error).toBeNull();
    expect(asRecord(guest.data)).toMatchObject({
      lifecycle: 'pending',
      registration_source: 'guest',
      participation: null,
      accepted_order: null
    });
    const guestRow = await creatorRow('open', actors.guest1!.id);
    expect(guestRow['accepted_at']).toBeNull();
    expect(guestRow['approved_at']).toBeNull();

    // 5) Private-community nonmember: denied outright, no row ever appears.
    await expectDomainError(
      submit(actors.privateOutsider!, 'privateEvent'),
      'MATCH_REGISTRATION_DENIED'
    );
    const deniedRows = await sqlRows(
      `select count(*)::int as n from public.match_event_registrations
        where match_event_id = '${events.privateEvent!}' and user_id = '${actors.privateOutsider!.id}'`
    );
    expect(deniedRows[0]!['n']).toBe(0);

    // Pending rows never count toward accepted/playing/reserve counts.
    const detail = await detailOf(actors.creator!, 'open');
    expect(detail['accepted_count']).toBe(2); // creator slot + in-range member only
    expect(detail['playing_count']).toBe(0);
    expect(detail['reserve_count']).toBe(2);
  });

  it('approves a guest request without ever creating or mutating a community_members row', async () => {
    const membershipRows = (userId: string) =>
      sqlRows(
        `select community_id, role, status from public.community_members where user_id = '${userId}'`
      );
    const before = await membershipRows(actors.guest1!.id);
    expect(before).toEqual([]);

    const approved = await decide(actors.creator!, 'open', actors.guest1!.id, 'approve');
    expect(approved.error).toBeNull();
    expect(asRecord(approved.data)).toMatchObject({
      lifecycle: 'accepted',
      registration_source: 'guest',
      replayed: false
    });
    // approved_at == accepted_at in the same transaction.
    const row = await creatorRow('open', actors.guest1!.id);
    expect(row['lifecycle']).toBe('accepted');
    expect(row['approved_at']).toBe(row['accepted_at']);
    expect(row['participation_status']).toBe('reserve');
    // Guest approval is not a membership backdoor.
    expect(await membershipRows(actors.guest1!.id)).toEqual(before);
  });

  it('delivers the request alert once and rejects duplicates while pending and accepted', async () => {
    // memberLate is an in-range member on an unrestricted event: the submit
    // accepts directly, so the resubmit proves the accepted-side duplicate.
    const direct = await submit(actors.memberLate!, 'open');
    expect(direct.error).toBeNull();
    expect(asRecord(direct.data)['lifecycle']).toBe('accepted');
    await expectDomainError(submit(actors.memberLate!, 'open'), 'MATCH_REGISTRATION_DUPLICATE');
    // Still exactly one identity row per (event, user).
    const memberRows = await actors
      .creator!.client.from('match_event_registrations')
      .select('id')
      .eq('match_event_id', events.open!)
      .eq('user_id', actors.memberLate!.id);
    expect(memberRows.error).toBeNull();
    expect(memberRows.data).toHaveLength(1);

    // A guest request is pending, so the resubmit proves the pending-side
    // duplicate. A new request notifies exactly the creator, keyed per
    // registration+attempt.
    const keysBefore = (
      await notificationsOf(actors.creator!, 'match_registration_requested', events.open)
    ).map((row) => row['event_key']);
    const first = await submit(actors.guestDuplicate!, 'open');
    expect(first.error).toBeNull();
    expect(asRecord(first.data)['lifecycle']).toBe('pending');
    const keysAfter = (
      await notificationsOf(actors.creator!, 'match_registration_requested', events.open)
    ).map((row) => row['event_key']);
    expect(keysAfter).toHaveLength(keysBefore.length + 1);
    for (const key of keysAfter)
      expect(String(key)).toMatch(/^match\.registration_requested:[0-9a-f-]{36}:[0-9a-f-]{36}$/);

    // Second submission while pending: PENDING_DUPLICATE, no second alert.
    await expectDomainError(
      submit(actors.guestDuplicate!, 'open'),
      'MATCH_REGISTRATION_PENDING_DUPLICATE'
    );
    expect(
      await notificationsOf(actors.creator!, 'match_registration_requested', events.open)
    ).toHaveLength(keysAfter.length);
    const guestRows = await actors
      .creator!.client.from('match_event_registrations')
      .select('id')
      .eq('match_event_id', events.open!)
      .eq('user_id', actors.guestDuplicate!.id);
    expect(guestRows.error).toBeNull();
    expect(guestRows.data).toHaveLength(1);
  });

  it('reuses the identity row for re-application after rejection and expiry without ordinal reuse', async () => {
    // First attempt: out-of-range member requests on the ranged event.
    const firstAttempt = await submit(actors.memberC!, 'ranged');
    expect(firstAttempt.error).toBeNull();
    const firstAttemptId = await latestAttemptId('ranged', actors.memberC!.id);
    const rowAfterRequest = await creatorRow('ranged', actors.memberC!.id);
    expect(rowAfterRequest['lifecycle']).toBe('pending');

    // Rejection resolves the row and alerts the requester.
    const rejected = await decide(actors.creator!, 'ranged', actors.memberC!.id, 'reject');
    expect(rejected.error).toBeNull();
    expect(asRecord(rejected.data)).toMatchObject({
      lifecycle: 'rejected',
      registration_source: 'member',
      resolved_by: actors.creator!.id,
      replayed: false
    });
    const rowAfterReject = await creatorRow('ranged', actors.memberC!.id);
    expect(rowAfterReject['lifecycle']).toBe('rejected');
    expect(rowAfterReject['resolved_at']).not.toBeNull();
    expect(rowAfterReject['id']).toBe(rowAfterRequest['id']);
    expect(
      await notificationsOf(actors.memberC!, 'match_registration_rejected', events.ranged)
    ).toHaveLength(1);
    // A rejected row can never silently become accepted.
    await expectDomainError(
      decide(actors.creator!, 'ranged', actors.memberC!.id, 'approve'),
      'MATCH_REGISTRATION_ALREADY_RESOLVED'
    );

    // Re-application reuses the SAME row as a fresh pending attempt.
    const requestsBefore = (
      await notificationsOf(actors.creator!, 'match_registration_requested', events.ranged)
    ).map((row) => String(row['event_key']));
    const secondAttempt = await submit(actors.memberC!, 'ranged');
    expect(secondAttempt.error).toBeNull();
    expect(asRecord(secondAttempt.data)['lifecycle']).toBe('pending');
    const rowAfterReapply = await creatorRow('ranged', actors.memberC!.id);
    expect(rowAfterReapply['id']).toBe(rowAfterRequest['id']);
    expect(rowAfterReapply['lifecycle']).toBe('pending');
    expect(rowAfterReapply['resolved_at']).toBeNull();
    expect(rowAfterReapply['resolved_by']).toBeNull();
    expect(rowAfterReapply['accepted_at']).toBeNull();
    expect(rowAfterReapply['accepted_order']).toBeNull();
    expect(new Date(String(rowAfterReapply['requested_at'])).getTime()).toBeGreaterThan(
      new Date(String(rowAfterRequest['requested_at'])).getTime()
    );
    // The attempts ledger appended a fresh attempt: [rejected, pending].
    const attempts = await attemptsOf('ranged', actors.memberC!.id);
    expect(attempts.map((attempt) => attempt['outcome'])).toEqual(['rejected', 'pending']);
    // Re-application DOES produce a fresh, attempt-scoped creator alert.
    const requestsAfter = (
      await notificationsOf(actors.creator!, 'match_registration_requested', events.ranged)
    ).map((row) => String(row['event_key']));
    expect(requestsAfter).toHaveLength(requestsBefore.length + 1);
    expect(requestsBefore.every((key) => requestsAfter.includes(key))).toBe(true);

    // F21: a stale decision naming the OLD (rejected) attempt must not resolve
    // the NEW pending attempt the creator never reviewed.
    await expectDomainError(
      actors.creator!.client.rpc('decide_match_registration', {
        p_match_event_id: events.ranged!,
        p_attempt_id: firstAttemptId,
        p_decision: 'approve'
      }),
      'MATCH_REGISTRATION_ALREADY_RESOLVED'
    );
    const rowAfterStale = await creatorRow('ranged', actors.memberC!.id);
    expect(rowAfterStale['lifecycle']).toBe('pending');
    expect(rowAfterStale['accepted_order']).toBeNull();
    expect(
      (await attemptsOf('ranged', actors.memberC!.id)).map((attempt) => attempt['outcome'])
    ).toEqual(['rejected', 'pending']);

    // Approving the fresh attempt allocates the NEXT ordinal, never a reused one.
    const stateBefore = await registrationState('ranged');
    const approved = await decide(actors.creator!, 'ranged', actors.memberC!.id, 'approve');
    expect(approved.error).toBeNull();
    expect(asRecord(approved.data)['accepted_order']).toBe(stateBefore.next);
    expect((await registrationState('ranged')).next).toBe(stateBefore.next + 1);
    expect(
      (await attemptsOf('ranged', actors.memberC!.id)).map((attempt) => attempt['outcome'])
    ).toEqual(['rejected', 'accepted']);

    // Expired rows are re-applied the same way: seeded expired identity is reused.
    await fixtureSql(
      `insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,registration_source) values
        ('${events.ranged!}','${actors.memberB!.id}','expired',now()-interval '2 hours','member'),
        ('${events.ranged!}','${actors.memberD!.id}','expired',now()-interval '3 hours','member');`
    );
    await fixtureSql(
      `insert into public.match_event_registration_attempts(match_event_id,user_id,requested_at,decided_at,outcome)
        values ('${events.ranged!}','${actors.memberD!.id}',now()-interval '3 hours',now()-interval '3 hours','expired');`
    );
    const expiredSubmit = await submit(actors.memberB!, 'ranged');
    expect(expiredSubmit.error).toBeNull();
    expect(asRecord(expiredSubmit.data)['lifecycle']).toBe('pending');
    const expiredRow = await creatorRow('ranged', actors.memberB!.id);
    expect(expiredRow['lifecycle']).toBe('pending');
    expect(expiredRow['resolved_at']).toBeNull();
    expect(expiredRow['accepted_order']).toBeNull();
    expect(
      (await attemptsOf('ranged', actors.memberB!.id)).map((attempt) => attempt['outcome'])
    ).toEqual(['pending']);
    const stateForB = await registrationState('ranged');
    const approvedB = await decide(actors.creator!, 'ranged', actors.memberB!.id, 'approve');
    expect(approvedB.error).toBeNull();
    expect(asRecord(approvedB.data)['accepted_order']).toBe(stateForB.next);
    expect(asRecord(approvedB.data)['accepted_order']).toBeGreaterThan(
      Number(asRecord(approved.data)['accepted_order'])
    );
    // Approving an untouched expired row is refused; it can never become accepted.
    await expectDomainError(
      decide(actors.creator!, 'ranged', actors.memberD!.id, 'approve'),
      'MATCH_REGISTRATION_ALREADY_RESOLVED'
    );
    const rowD = await creatorRow('ranged', actors.memberD!.id);
    expect(rowD['lifecycle']).toBe('expired');
    expect(rowD['accepted_at']).toBeNull();
  });

  it('restricts decisions to the creator alone and refuses self-decisions', async () => {
    // A community Admin is NOT an approver.
    await expectDeniedWithCode(
      decide(actors.admin!, 'ranged', actors.memberNoRating!.id, 'approve'),
      '42501',
      'Registration decisions are creator-only'
    );
    // The creator cannot decide their own registration. The decision names an
    // attempt, so seed the creator's own attempt and prove the guard fires on
    // the requester derived from that attempt.
    const creatorAttemptRows = await sqlRows(
      `insert into public.match_event_registration_attempts(match_event_id,user_id,requested_at,outcome)
        values ('${events.ranged!}','${actors.creator!.id}',now(),'pending')
        returning id::text as id`
    );
    const creatorAttemptId = String(creatorAttemptRows[0]!['id']);
    try {
      await expectDeniedWithCode(
        actors.creator!.client.rpc('decide_match_registration', {
          p_match_event_id: events.ranged!,
          p_attempt_id: creatorAttemptId,
          p_decision: 'approve'
        }),
        '42501',
        'Creator cannot decide their own registration'
      );
    } finally {
      await fixtureSql(
        `delete from public.match_event_registration_attempts where id = '${creatorAttemptId}';`
      );
    }
    // Unknown attempt identity.
    await expectDomainError(
      actors.creator!.client.rpc('decide_match_registration', {
        p_match_event_id: events.ranged!,
        p_attempt_id: crypto.randomUUID(),
        p_decision: 'approve'
      }),
      'MATCH_REGISTRATION_NOT_FOUND'
    );
    // Invalid decision text and a null attempt are parameter errors. The null
    // attempt goes through a deliberately untyped client: the generated RPC map
    // cannot express the null argument this server-side guard exists for.
    await expectDeniedWithCode(
      actors.creator!.client.rpc('decide_match_registration', {
        p_match_event_id: events.ranged!,
        p_attempt_id: crypto.randomUUID(),
        p_decision: 'maybe'
      }),
      '22023',
      'Invalid registration decision'
    );
    await expectDeniedWithCode(
      untypedCreator!.rpc('decide_match_registration', {
        p_match_event_id: events.ranged!,
        p_attempt_id: null,
        p_decision: 'approve'
      }),
      '22023',
      'Match registration attempt required'
    );
    // Unknown events for both entry points.
    const missing = crypto.randomUUID();
    await expectDomainError(
      actors.creator!.client.rpc('submit_match_registration', { p_match_event_id: missing }),
      'MATCH_REGISTRATION_EVENT_NOT_FOUND'
    );
    await expectDomainError(
      actors.creator!.client.rpc('decide_match_registration', {
        p_match_event_id: missing,
        p_attempt_id: crypto.randomUUID(),
        p_decision: 'approve'
      }),
      'MATCH_REGISTRATION_EVENT_NOT_FOUND'
    );
    // Invite-only events stay behind the T06 door for this entry point.
    const inviteResult = await submit(actors.memberInRange!, 'invite');
    expect(inviteResult.error).not.toBeNull();
    expect(inviteResult.error!.code).toBe('P0001');
    expect(inviteResult.error!.message).toBe('MATCH_REGISTRATION_INVITE_ONLY');
  });

  it('approves atomically and replays idempotently without a second ordinal or alert', async () => {
    const stateBefore = await registrationState('ranged');
    const acceptedBefore = Number(
      (
        await sqlRows(
          `select count(*)::int as n from public.match_event_registrations
            where match_event_id = '${events.ranged!}' and lifecycle = 'accepted'`
        )
      )[0]!['n']
    );
    // floor(N/4)*4 playing: an approval completing a quartet reconciles to
    // playing, every other headcount lands in Reserve.
    const expectedParticipation = (acceptedBefore + 1) % 4 === 0 ? 'playing' : 'reserve';
    expect(
      await notificationsOf(actors.memberNoRating!, 'match_registration_approved', events.ranged)
    ).toHaveLength(0);

    const approved = await decide(actors.creator!, 'ranged', actors.memberNoRating!.id, 'approve');
    expect(approved.error).toBeNull();
    const data = asRecord(approved.data);
    expect(data).toMatchObject({
      lifecycle: 'accepted',
      participation: expectedParticipation,
      registration_source: 'member',
      replayed: false
    });
    expect(data['accepted_order']).toBe(stateBefore.next);
    // approved_at == accepted_at, set in one transaction.
    expect(data['approved_at']).toBe(data['accepted_at']);
    const row = await creatorRow('ranged', actors.memberNoRating!.id);
    expect(row['approved_at']).toBe(row['accepted_at']);
    expect(row['accepted_order']).toBe(stateBefore.next);
    const stateAfter = await registrationState('ranged');
    expect(stateAfter.next).toBe(stateBefore.next + 1);
    const attempts = await attemptsOf('ranged', actors.memberNoRating!.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!['outcome']).toBe('accepted');
    expect(attempts[0]!['actor_id']).toBe(actors.creator!.id);
    expect(attempts[0]!['decided_at']).not.toBeNull();
    // Exactly one requester alert.
    expect(
      await notificationsOf(actors.memberNoRating!, 'match_registration_approved', events.ranged)
    ).toHaveLength(1);

    // Idempotent replay: ORIGINAL anchors/time/order, no new ordinal, no new alert.
    const replay = await decide(actors.creator!, 'ranged', actors.memberNoRating!.id, 'approve');
    expect(replay.error).toBeNull();
    const replayData = asRecord(replay.data);
    expect(replayData['replayed']).toBe(true);
    expect(replayData['accepted_at']).toBe(data['accepted_at']);
    expect(replayData['approved_at']).toBe(data['approved_at']);
    expect(replayData['accepted_order']).toBe(data['accepted_order']);
    expect((await registrationState('ranged')).next).toBe(stateAfter.next);
    expect(
      await notificationsOf(actors.memberNoRating!, 'match_registration_approved', events.ranged)
    ).toHaveLength(1);
    expect(await attemptsOf('ranged', actors.memberNoRating!.id)).toHaveLength(1);
  });

  it('closes entries and approvals at the DB-time cutoff while committed approvals still replay', async () => {
    // A cutoff already in the past refuses new submissions with the closed token.
    await expectDomainError(submit(actors.memberLate!, 'closed'), 'MATCH_REGISTRATION_CLOSED');

    // An unapproved request submitted BEFORE the cutoff cannot be approved at it.
    const request = await submit(actors.guest1!, 'boundary');
    expect(request.error).toBeNull();
    expect(asRecord(request.data)['lifecycle']).toBe('pending');
    // DB-time fixture: move the cutoff to the database clock's now (trusted,
    // transaction-scoped trigger bypass; the production clock is never touched).
    await fixtureSql(
      [
        `do $$ begin`,
        `alter table public.match_events disable trigger match_event_immutable;`,
        `update public.match_events set registration_cutoff_at = pg_catalog.clock_timestamp() where id = '${events.boundary!}';`,
        `alter table public.match_events enable trigger match_event_immutable;`,
        `end $$;`
      ].join('\n')
    );
    const stateBefore = await registrationState('boundary');
    await expectDomainError(
      decide(actors.creator!, 'boundary', actors.guest1!.id, 'approve'),
      'MATCH_REGISTRATION_CLOSED'
    );
    expect((await registrationState('boundary')).next).toBe(stateBefore.next);
    const stillPending = await creatorRow('boundary', actors.guest1!.id);
    expect(stillPending['lifecycle']).toBe('pending');
    expect(stillPending['approved_at']).toBeNull();
    // The refusal also consumed no alerts.
    expect(
      await notificationsOf(actors.guest1!, 'match_registration_approved', events.boundary)
    ).toHaveLength(0);
    // At/after the boundary, brand-new submissions are refused too (equality closed).
    await expectDomainError(submit(actors.memberLate!, 'boundary'), 'MATCH_REGISTRATION_CLOSED');

    // An approval already committed BEFORE the cutoff still replays after it.
    const pendingReplay = await submit(actors.guestReplay!, 'replay');
    expect(pendingReplay.error).toBeNull();
    const committed = await decide(actors.creator!, 'replay', actors.guestReplay!.id, 'approve');
    expect(committed.error).toBeNull();
    const committedData = asRecord(committed.data);
    expect(committedData['replayed']).toBe(false);
    await fixtureSql(
      [
        `do $$ begin`,
        `alter table public.match_events disable trigger match_event_immutable;`,
        `update public.match_events set registration_cutoff_at = pg_catalog.clock_timestamp() where id = '${events.replay!}';`,
        `alter table public.match_events enable trigger match_event_immutable;`,
        `end $$;`
      ].join('\n')
    );
    const replay = await decide(actors.creator!, 'replay', actors.guestReplay!.id, 'approve');
    expect(replay.error).toBeNull();
    const replayData = asRecord(replay.data);
    expect(replayData['replayed']).toBe(true);
    expect(replayData['accepted_at']).toBe(committedData['accepted_at']);
    expect(replayData['approved_at']).toBe(committedData['approved_at']);
    expect(replayData['accepted_order']).toBe(committedData['accepted_order']);
    // The replay allocated no new ordinal and no new alert.
    expect(
      await notificationsOf(actors.guestReplay!, 'match_registration_approved', events.replay)
    ).toHaveLength(1);
    // And new submissions stay closed after the boundary.
    await expectDomainError(submit(actors.memberLate!, 'replay'), 'MATCH_REGISTRATION_CLOSED');
  });

  it('binds finite capacity to accepted players, never to pending requests, and never closes unlimited events', async () => {
    // capacity event: creator (accepted) + capA fill the maximum of 2.
    const second = await submit(actors.capA!, 'capacity');
    expect(second.error).toBeNull();
    expect(asRecord(second.data)).toMatchObject({ lifecycle: 'accepted', accepted_order: 2 });
    // Third accepted-bound contender: FULL.
    await expectDomainError(submit(actors.capB!, 'capacity'), 'MATCH_REGISTRATION_FULL');
    // Pending requests still enter while full: capacity binds accepted players only.
    const guestWhileFull = await submit(actors.guestRace!, 'capacity');
    expect(guestWhileFull.error).toBeNull();
    expect(asRecord(guestWhileFull.data)).toMatchObject({
      lifecycle: 'pending',
      registration_source: 'guest'
    });
    const capacityDetail = await detailOf(actors.creator!, 'capacity');
    expect(capacityDetail['accepted_count']).toBe(2);
    expect(capacityDetail['reserve_count']).toBe(2);
    expect(capacityDetail['playing_count']).toBe(0);

    // Unlimited events stay open at four players and beyond.
    for (const [index, who] of [actors.uni1!, actors.uni2!, actors.uni3!].entries()) {
      const accepted = await submit(who, 'unlimited');
      expect(accepted.error).toBeNull();
      expect(asRecord(accepted.data)['accepted_order']).toBe(index + 2);
    }
    const atFour = await detailOf(actors.creator!, 'unlimited');
    expect(atFour['accepted_count']).toBe(4);
    expect(atFour['playing_count']).toBe(4);
    expect(atFour['reserve_count']).toBe(0);
    expect(atFour['registration_open']).toBe(true);
    // A fifth player is still admitted: unlimited never closes.
    const fifth = await submit(actors.uniFive!, 'unlimited');
    expect(fifth.error).toBeNull();
    expect(asRecord(fifth.data)).toMatchObject({
      lifecycle: 'accepted',
      accepted_order: 5,
      participation: 'reserve'
    });
    const atFive = await detailOf(actors.creator!, 'unlimited');
    expect(atFive['accepted_count']).toBe(5);
    expect(atFive['playing_count']).toBe(4);
    expect(atFive['reserve_count']).toBe(1);
    expect(atFive['registration_open']).toBe(true);
  });

  it('admits exactly one of two concurrent approvals behind a proven lock barrier', async () => {
    const request = await submit(actors.guestApprove!, 'open');
    expect(request.error).toBeNull();
    expect(asRecord(request.data)['lifecycle']).toBe('pending');
    const stateBefore = await registrationState('open');
    const attemptId = await latestAttemptId('open', actors.guestApprove!.id);

    const [first, second] = await barrier('open', 'decide_match_registration', () => [
      rawRpc(actors.creator!, 'decide_match_registration', {
        p_match_event_id: events.open!,
        p_attempt_id: attemptId,
        p_decision: 'approve'
      }),
      rawRpc(actors.creator!, 'decide_match_registration', {
        p_match_event_id: events.open!,
        p_attempt_id: attemptId,
        p_decision: 'approve'
      })
    ]);
    // Approve-on-accepted is an idempotent replay by design: one real approval
    // plus one replayed success — never a double effect, never a double ordinal.
    expect(first.error).toBeNull();
    expect(second.error).toBeNull();
    const outcomes = [asRecord(first.data), asRecord(second.data)];
    expect(
      outcomes.map((outcome) => String(outcome['replayed'])).sort((a, b) => a.localeCompare(b))
    ).toEqual(['false', 'true']);
    const original = outcomes.find((outcome) => outcome['replayed'] === false)!;
    const replayed = outcomes.find((outcome) => outcome['replayed'] === true)!;
    expect(original['lifecycle']).toBe('accepted');
    expect(original['accepted_order']).toBe(stateBefore.next);
    // The replay returns the ORIGINAL anchors and order.
    expect(replayed['accepted_at']).toBe(original['accepted_at']);
    expect(replayed['approved_at']).toBe(original['approved_at']);
    expect(replayed['accepted_order']).toBe(original['accepted_order']);
    // Exactly one ordinal was allocated from the state counter.
    expect((await registrationState('open')).next).toBe(stateBefore.next + 1);
    const row = await creatorRow('open', actors.guestApprove!.id);
    expect(row['lifecycle']).toBe('accepted');
    expect(row['accepted_order']).toBe(stateBefore.next);
    expect(row['approved_at']).toBe(row['accepted_at']);
    // Exactly one resolved attempt and exactly one logical alert.
    const attempts = await attemptsOf('open', actors.guestApprove!.id);
    expect(attempts).toHaveLength(1);
    expect(attempts[0]!['outcome']).toBe('accepted');
    expect(
      await notificationsOf(actors.guestApprove!, 'match_registration_approved', events.open)
    ).toHaveLength(1);
  });

  it('resolves concurrent approve versus reject to one effect and one deterministic failure', async () => {
    const request = await submit(actors.guestRace!, 'open');
    expect(request.error).toBeNull();
    expect(asRecord(request.data)['lifecycle']).toBe('pending');
    const stateBefore = await registrationState('open');
    const attemptId = await latestAttemptId('open', actors.guestRace!.id);

    const [first, second] = await barrier('open', 'decide_match_registration', () => [
      rawRpc(actors.creator!, 'decide_match_registration', {
        p_match_event_id: events.open!,
        p_attempt_id: attemptId,
        p_decision: 'approve'
      }),
      rawRpc(actors.creator!, 'decide_match_registration', {
        p_match_event_id: events.open!,
        p_attempt_id: attemptId,
        p_decision: 'reject'
      })
    ]);
    const results = [first, second];
    const errors = results.filter((result) => result.error !== null);
    const successes = results.filter((result) => result.error === null);
    // Exactly one winner and one deterministic domain failure.
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error!.code).toBe('P0001');
    expect(errors[0]!.error!.message).toBe('MATCH_REGISTRATION_ALREADY_RESOLVED');
    expect(successes).toHaveLength(1);
    const outcome = asRecord(successes[0]!.data);
    expect(outcome['replayed']).toBe(false);

    const row = await creatorRow('open', actors.guestRace!.id);
    const attempts = await attemptsOf('open', actors.guestRace!.id);
    // The winner decides every observable: outcome, ordinal, anchors and alert.
    const winnerOutcome = String(outcome['lifecycle']);
    const approveWon = winnerOutcome === 'accepted';
    const expectedNext = stateBefore.next + (approveWon ? 1 : 0);
    const expectedKind = approveWon ? 'match_registration_approved' : 'match_registration_rejected';
    const oppositeKind = approveWon ? 'match_registration_rejected' : 'match_registration_approved';
    const expectedAnchors = approveWon ? [row['accepted_at'], row['accepted_at']] : [null, null];
    const expectedOrder = approveWon ? stateBefore.next : null;
    const expectedOutcomeOrder = approveWon ? stateBefore.next : undefined;
    const expectedResolvedBy = approveWon ? null : actors.creator!.id;
    expect(row['lifecycle']).toBe(winnerOutcome);
    expect(row['resolved_by']).toBe(expectedResolvedBy);
    expect([row['approved_at'], row['accepted_at']]).toEqual(expectedAnchors);
    expect(row['accepted_at'] !== null).toBe(approveWon);
    expect(row['accepted_order']).toBe(expectedOrder);
    // The reject jsonb carries no accepted_order key at all.
    expect(outcome['accepted_order']).toBe(expectedOutcomeOrder);
    expect(row['resolved_at'] !== null).toBe(!approveWon);
    expect((await registrationState('open')).next).toBe(expectedNext);
    expect(attempts).toHaveLength(1);
    expect(String(attempts[0]!['outcome'])).toBe(winnerOutcome);
    const winnerAlerts = await notificationsOf(actors.guestRace!, expectedKind, events.open);
    expect(winnerAlerts.map((alert) => String(alert['kind']))).toEqual([expectedKind]);
    expect(await notificationsOf(actors.guestRace!, oppositeKind, events.open)).toEqual([]);
    // The requester holds exactly one decision alert, plus the derived FIFO
    // status effect when the winning decision was an approval into Reserve.
    const inbox = await allNotifications(actors.guestRace!);
    expect(inbox.map((entry) => String(entry['kind'])).sort((a, b) => a.localeCompare(b))).toEqual(
      approveWon
        ? ['match_registration_approved', 'match_registration_reserve']
        : ['match_registration_rejected']
    );
  });

  it('admits exactly one contender for the last finite capacity slot', async () => {
    const stateBefore = await registrationState('capacity2');
    const [first, second] = await barrier('capacity2', 'submit_match_registration', () => [
      rawRpc(actors.capA!, 'submit_match_registration', { p_match_event_id: events.capacity2! }),
      rawRpc(actors.capB!, 'submit_match_registration', { p_match_event_id: events.capacity2! })
    ]);
    const results = [first, second];
    const successes = results.filter((result) => result.error === null);
    const errors = results.filter((result) => result.error !== null);
    expect(successes).toHaveLength(1);
    expect(errors).toHaveLength(1);
    expect(errors[0]!.error!.code).toBe('P0001');
    expect(errors[0]!.error!.message).toBe('MATCH_REGISTRATION_FULL');
    const accepted = asRecord(successes[0]!.data);
    expect(accepted).toMatchObject({
      lifecycle: 'accepted',
      accepted_order: stateBefore.next,
      registration_source: 'member'
    });
    expect((await registrationState('capacity2')).next).toBe(stateBefore.next + 1);
    const detail = await detailOf(actors.creator!, 'capacity2');
    expect(detail['accepted_count']).toBe(2); // creator slot + exactly one contender
    expect(detail['reserve_count']).toBe(2);
    const winnerId = accepted['user_id'] === actors.capA!.id ? actors.capA!.id : actors.capB!.id;
    const loser = winnerId === actors.capA!.id ? actors.capB! : actors.capA!;
    const winnerRows = await actors
      .creator!.client.from('match_event_registrations')
      .select('lifecycle')
      .eq('match_event_id', events.capacity2!)
      .eq('user_id', winnerId);
    expect(winnerRows.data).toHaveLength(1);
    expect(winnerRows.data![0]!.lifecycle).toBe('accepted');
    expect(
      await actors
        .creator!.client.from('match_event_registrations')
        .select('id')
        .eq('match_event_id', events.capacity2!)
        .eq('user_id', loser.id)
        .then((result) => result.data)
    ).toEqual([]);
  });

  it('exposes the request queue to the creator alone and the own-state read to the caller alone', async () => {
    // Two fresh guest requests on a dedicated event.
    for (const who of [actors.guest1!, actors.guestApprove!]) {
      const request = await submit(who, 'queue');
      expect(request.error).toBeNull();
      expect(asRecord(request.data)['lifecycle']).toBe('pending');
    }

    // The creator sees one queue row with requester context and counts.
    const queueResult = await actors.creator!.client.rpc('list_match_event_registration_requests', {
      p_match_event_id: events.queue!
    });
    expect(queueResult.error).toBeNull();
    const rows: unknown[] = Array.isArray(queueResult.data) ? queueResult.data : [];
    expect(rows).toHaveLength(1);
    const queue = asRecord(rows[0]);
    expect(queue['event_id']).toBe(events.queue);
    expect(queue['accepted_count']).toBe(1); // creator slot only; pending never counts
    expect(queue['playing_count']).toBe(0);
    expect(queue['reserve_count']).toBe(1);
    expect(queue['maximum_registrations']).toBeNull();
    expect(typeof queue['registration_cutoff_at']).toBe('string');
    const requests = (Array.isArray(queue['requests']) ? queue['requests'] : []).map(asRecord);
    expect(
      requests.map((request) => String(request['user_id'])).sort((a, b) => a.localeCompare(b))
    ).toEqual([actors.guest1!.id, actors.guestApprove!.id].sort((a, b) => a.localeCompare(b)));
    for (const request of requests) {
      expect(request['registration_source']).toBe('guest');
      expect(typeof request['requested_at']).toBe('string');
      expect(typeof request['display_name']).toBe('string');
      expect(typeof request['display_level']).toBe('number');
    }

    // Zero rows for everyone else — including a community Admin and requesters.
    for (const who of [
      actors.admin!,
      actors.guest1!,
      actors.guestApprove!,
      actors.privateOutsider!
    ]) {
      const result = await who.client.rpc('list_match_event_registration_requests', {
        p_match_event_id: events.queue!
      });
      expect(result.error, `${who.name} queue read`).toBeNull();
      expect(result.data, `${who.name} queue rows`).toEqual([]);
    }

    // The own-state read exposes only the caller's row: flat, caller-scoped keys.
    const own = asRecord(
      (
        await actors.guest1!.client.rpc('get_my_match_registration', {
          p_match_event_id: events.queue!
        })
      ).data
    );
    expect(own['lifecycle']).toBe('pending');
    expect(own).not.toHaveProperty('user_id');
    expect(Object.keys(own).sort()).toEqual(
      [
        'event_id',
        'lifecycle',
        'participation',
        'accepted_order',
        'position',
        'registration_source',
        'requested_at',
        'approved_at',
        'accepted_at',
        'resolved_at'
      ].sort()
    );
    const creatorOwn = asRecord(
      (
        await actors.creator!.client.rpc('get_my_match_registration', {
          p_match_event_id: events.queue!
        })
      ).data
    );
    expect(creatorOwn).toMatchObject({
      lifecycle: 'accepted',
      participation: 'reserve',
      accepted_order: 1,
      position: 1,
      registration_source: 'creator'
    });
    // An event reader with no row resolves to the none state, never to someone else.
    const adminOwn = asRecord(
      (
        await actors.admin!.client.rpc('get_my_match_registration', {
          p_match_event_id: events.queue!
        })
      ).data
    );
    expect(adminOwn['lifecycle']).toBeNull();
    // An unreadable event with no row yields null data.
    const hidden = await actors.privateOutsider!.client.rpc('get_my_match_registration', {
      p_match_event_id: events.privateEvent!
    });
    expect(hidden.error).toBeNull();
    expect(hidden.data).toBeNull();

    // Recipient scoping: alerts are readable only by their recipients. The
    // creator is also a participant on this event, so the inbox now carries the
    // FIFO quartet effects alongside the creator-side request alerts.
    const creatorKinds = new Set([
      'match_registration_requested',
      'match_registration_playing',
      'match_registration_reserve',
      'match_registration_promoted',
      'match_registration_quartet_complete'
    ]);
    const creatorInbox = await allNotifications(actors.creator!);
    expect(creatorInbox.length).toBeGreaterThan(0);
    for (const row of creatorInbox) {
      expect(row['recipient_user_id']).toBe(actors.creator!.id);
      expect(creatorKinds.has(String(row['kind']))).toBe(true);
    }
    // guest1 was approved into Reserve (approval + Reserve place) and later
    // promoted when the quartet completed (promotion + group completion).
    const guestInbox = await allNotifications(actors.guest1!);
    expect(
      guestInbox.map((entry) => String(entry['kind'])).sort((a, b) => a.localeCompare(b))
    ).toEqual([
      'match_registration_approved',
      'match_registration_promoted',
      'match_registration_quartet_complete',
      'match_registration_reserve'
    ]);
    expect(await allNotifications(actors.privateOutsider!)).toEqual([]);
  });
});
