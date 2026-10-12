import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const serverClient = vi.hoisted(() => ({ current: null as SupabaseClient | null }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) =>
        (options: { data?: unknown } = {}) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: vi.fn<() => void>() }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: () => serverClient.current }));
import {
  addCommunityVenue,
  approveCommunityMember,
  archiveCommunityVenue,
  demoteCommunityMember,
  denyCommunityMember,
  editCommunityVenue,
  getCommunityMemberById,
  issueInvitation,
  listMyAdminCommunities,
  listCommunityAudit,
  listCommunityVenues,
  promoteCommunityMember,
  reactivateCommunityMember,
  removeCommunityMember,
  revokeInvitation,
  searchCommunityMembers
} from '../src/features/community/community-admin.functions';
import {
  acceptInvitation,
  leaveCommunity,
  updateCommunitySettings
} from '../src/features/community/community.functions';

vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
if (!environment.env)
  process.stderr.write(`[community.admin.integration] suite NOT RUN: ${environment.reason}\n`);
const url = environment.env?.url ?? '';
const key = environment.env?.key ?? '';
function anon() {
  return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}
type Actor = { id: string; client: SupabaseClient };
async function actor(label: string): Promise<Actor> {
  const result = await anon().auth.signUp({
    email: `${label}-${crypto.randomUUID()}@test.local`,
    password: 'Password123!'
  });
  expect(result.error).toBeNull();
  const session = result.data.session!;
  const client = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { headers: { Authorization: `Bearer ${session.access_token}` } }
  });
  expect((await client.auth.setSession(session)).error).toBeNull();
  expect(
    (
      await client.rpc('onboard_player', {
        p_display_name: label,
        p_preferred_side: 'EITHER',
        p_initial_level: 3
      })
    ).error
  ).toBeNull();
  return { id: result.data.user!.id, client };
}
async function community(admin: Actor) {
  const created = await admin.client.rpc('create_community', {
    p_name: `Club ${crypto.randomUUID()}`,
    p_visibility: 'private',
    p_join_policy: 'instant'
  });
  expect(created.error).toBeNull();
  if (typeof created.data !== 'string') throw new Error('Community creation failed');
  return created.data;
}
async function membership(
  admin: Actor,
  community_id: string,
  user: Actor,
  status: 'pending' | 'active',
  role: 'member' | 'admin' = 'member'
) {
  const result = await admin.client
    .from('community_members')
    .insert({ community_id, user_id: user.id, status, role })
    .select('id')
    .single();
  expect(result.error).toBeNull();
  if (!result.data) throw new Error('Membership creation failed');
  return result.data.id;
}
async function audit(admin: Actor, id: string) {
  const result = await admin.client
    .from('community_audit_log')
    .select('id,actor_user_id,entity,entity_id,action,details')
    .eq('community_id', id)
    .order('id');
  expect(result.error).toBeNull();
  return result.data!;
}
let admin: Actor, member: Actor, outsider: Actor, target: Actor, alternate: Actor;

type LocalSqlResult = {
  code: number | null;
  stdout: string;
  stderr: string;
};

type LocalSqlCommand = {
  done: Promise<LocalSqlResult>;
  readonly pid: number | undefined;
  /**
   * Idempotently stop the spawned process tree: SIGTERM, wait for close, then
   * probe the process group and escalate SIGKILL while any member survives —
   * leader exit alone never suppresses group cleanup.
   */
  stop: (gracePeriodMs?: number) => Promise<void>;
  /** True while any member of the child's process group is still alive. */
  isGroupAlive: () => boolean;
};

const CHILD_STOP_GRACE_MS = 1000;
const TEARDOWN_DEADLINE_MS = 10000;
const TEARDOWN_MARGIN_MS = 500;
const LOCAL_SQL_DEADLINE_MS = 20000;
const QUEUE_PROBE_TIMEOUT_MS = 20000;
const QUEUE_PROBE_POLL_MS = 200;

function startLocalProcess(command: string, args: string[]): LocalSqlCommand {
  // detached: true makes the child a process-group leader so stop() can signal the
  // whole tree (pnpm → supabase CLI → psql) instead of orphaning grandchildren.
  const child = spawn(command, args, {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    detached: process.platform !== 'win32'
  });
  let stdout = '';
  let stderr = '';
  let stopped = false;
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => (stdout += chunk));
  child.stderr.on('data', (chunk: string) => (stderr += chunk));
  const done = new Promise<LocalSqlResult>((resolve) => {
    child.once('error', (error) => resolve({ code: null, stdout, stderr: `${stderr}${error}` }));
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
  const exited = () => child.exitCode !== null || child.signalCode !== null;
  const signalTree = (signal: NodeJS.Signals) => {
    try {
      if (child.pid !== undefined) process.kill(-child.pid, signal);
    } catch {
      // Process group already gone; fall back to a direct (no-op) signal.
      child.kill(signal);
    }
  };
  const isGroupAlive = (): boolean => {
    if (child.pid === undefined) return false;
    try {
      process.kill(-child.pid, 0);
      return true;
    } catch (error) {
      // ESRCH (no such group) means everyone is gone; EPERM means the group
      // still exists but we lack permission to signal it.
      return (
        typeof error === 'object' && error !== null && 'code' in error && error.code === 'EPERM'
      );
    }
  };
  const waitForClose = (ms: number) =>
    new Promise<boolean>((resolve) => {
      if (exited()) {
        resolve(true);
        return;
      }
      const timer = setTimeout(() => resolve(false), ms);
      child.once('close', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  const stop = async (gracePeriodMs = CHILD_STOP_GRACE_MS): Promise<void> => {
    if (stopped) return;
    stopped = true;
    if (!exited()) {
      signalTree('SIGTERM');
      await waitForClose(gracePeriodMs);
    }
    // The leader may already be gone while a descendant (e.g. an orphaned psql)
    // survives; group cleanup must not depend on the leader's exit. SIGKILL is
    // delivered asynchronously, so drain the group before returning.
    if (isGroupAlive()) {
      signalTree('SIGKILL');
      for (let waitedMs = 0; waitedMs < gracePeriodMs && isGroupAlive(); waitedMs += 25)
        await sleep(25);
    }
  };
  return { done, pid: child.pid, stop, isGroupAlive };
}

function startLocalSql(sql: string): LocalSqlCommand {
  return startLocalProcess('pnpm', [
    'exec',
    'supabase',
    'db',
    'query',
    '--local',
    '--output-format',
    'json',
    sql
  ]);
}

/**
 * Runs one local SQL command through a retained handle. If the command stalls
 * past the deadline, the deadline abandons the await AND the spawned process is
 * stopped through the handle — no SQL helper may leave a child running.
 */
async function runLocalSqlBounded(
  sql: string,
  deadlineMs = LOCAL_SQL_DEADLINE_MS
): Promise<LocalSqlResult> {
  const command = startLocalSql(sql);
  try {
    return await withDeadline(command.done, deadlineMs, 'local SQL command');
  } catch (error) {
    await command.stop();
    throw error;
  }
}

async function executeLocalSql(sql: string) {
  const result = await runLocalSqlBounded(sql);
  if (result.code !== 0)
    throw new Error(`Local SQL failed (${result.code}): ${result.stderr || result.stdout}`);
  return result.stdout;
}

type LocalSqlRow = Record<string, unknown>;

function isLocalSqlRow(value: unknown): value is LocalSqlRow {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function queryLocalSql(sql: string): Promise<LocalSqlRow[]> {
  const stdout = await executeLocalSql(sql);
  const start = stdout.indexOf('[');
  const end = stdout.lastIndexOf(']');
  if (start < 0 || end < start) throw new Error(`Local SQL returned no JSON rows: ${stdout}`);
  const parsed: unknown = JSON.parse(stdout.slice(start, end + 1));
  if (!Array.isArray(parsed)) throw new Error(`Local SQL returned invalid rows: ${stdout}`);
  const values: unknown[] = parsed;
  const rows = values.filter(isLocalSqlRow);
  if (rows.length !== values.length) throw new Error(`Local SQL returned invalid rows: ${stdout}`);
  return rows;
}

async function waitForLocalRows(
  sql: string,
  ready: (rows: LocalSqlRow[]) => boolean,
  description: string,
  timeoutMs = 20000,
  pollIntervalMs = 75
): Promise<LocalSqlRow[]> {
  const deadline = Date.now() + timeoutMs;
  let rows: LocalSqlRow[] = [];
  while (Date.now() < deadline) {
    rows = await queryLocalSql(sql);
    if (ready(rows)) return rows;
    await new Promise<void>((resolve) => setTimeout(resolve, pollIntervalMs));
  }
  throw new Error(`Timed out waiting for ${description}: ${JSON.stringify(rows)}`);
}

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

function markerBackendQuery(marker: string): string {
  return `select pid as value
    from pg_catalog.pg_stat_activity
    where query like '%${marker}%' and pid <> pg_catalog.pg_backend_pid()`;
}

type HolderTeardown = {
  marker: string;
  /** Overrides the marker sweep statement (used by the stalled-sweep test). */
  sweepSql?: string;
  holder?: LocalSqlCommand;
  rpcAbort?: AbortController;
  outstanding?: readonly Promise<unknown>[];
};

type HolderTeardownResult = {
  elapsedMs: number;
  sweep?: LocalSqlResult;
};

/**
 * Bounded, idempotent teardown for the queued-chronology holder, split into
 * four reserved slices of the overall deadline (sweep command, sweep-child
 * stop, holder-child stop, outstanding settle) so no single stage can starve
 * the others. The marker sweep spawns through a RETAINED handle: a stalled
 * sweep is abandoned by its slice and then killed through the handle. Never
 * throws; safe to call after a failed assertion and safe to call more than
 * once.
 */
async function releaseHolderAndSweep(
  teardown: HolderTeardown,
  deadlineMs = TEARDOWN_DEADLINE_MS
): Promise<HolderTeardownResult> {
  const startedAt = Date.now();
  const sliceMs = Math.floor((deadlineMs - TEARDOWN_MARGIN_MS) / 4);
  const sweepCommand = startLocalSql(
    teardown.sweepSql ??
      `select pg_catalog.pg_terminate_backend(pid) as value
        from pg_catalog.pg_stat_activity
        where query like '%${teardown.marker}%'
          and pid <> pg_catalog.pg_backend_pid()`
  );
  let sweep: LocalSqlResult | undefined;
  try {
    sweep = await withDeadline(sweepCommand.done, sliceMs, 'marker backend sweep');
  } catch {
    // Stalled or failed sweep: bound the stop inside its own slice, then
    // collect the killed child's result. The holder stop below is the backstop.
    await withDeadline(sweepCommand.stop(), sliceMs, 'stalled sweep child stop').catch(
      () => undefined
    );
    sweep = await Promise.race([sweepCommand.done, sleep(250).then(() => undefined)]);
  }
  teardown.rpcAbort?.abort();
  if (teardown.holder) {
    try {
      await withDeadline(teardown.holder.stop(), sliceMs, 'holder child stop');
    } catch {
      // Never let teardown mask the original failure with its own error.
    }
  }
  if (teardown.outstanding?.length)
    await Promise.race([Promise.allSettled([...teardown.outstanding]), sleep(sliceMs)]);
  return { elapsedMs: Date.now() - startedAt, sweep };
}

function timestampMicroseconds(value: string): bigint {
  const groups =
    /^(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})T(?<hour>\d{2}):(?<minute>\d{2}):(?<second>\d{2})(?:\.(?<fraction>\d+))?(?<zone>Z|[+-]\d{2}:\d{2})$/.exec(
      value
    )?.groups;
  const zone = groups?.zone;
  if (!groups || !zone) throw new Error(`Invalid PostgreSQL timestamp: ${value}`);
  const localSeconds = BigInt(
    Date.UTC(
      Number(groups.year),
      Number(groups.month) - 1,
      Number(groups.day),
      Number(groups.hour),
      Number(groups.minute),
      Number(groups.second)
    ) / 1000
  );
  const zoneOffsetMinutes =
    zone === 'Z'
      ? 0
      : (Number(zone.slice(1, 3)) * 60 + Number(zone.slice(4, 6))) * (zone[0] === '+' ? 1 : -1);
  const fraction = (groups.fraction ?? '').padEnd(6, '0').slice(0, 6);
  return (localSeconds - BigInt(zoneOffsetMinutes * 60)) * 1_000_000n + BigInt(fraction || '0');
}

function expectReactivationChronology(
  previous: { valid_until: string | null },
  replacement: { valid_from: string; activated_at: string | null }
) {
  if (!previous.valid_until || !replacement.activated_at)
    throw new Error('Expected closed prior interval and activated replacement interval');
  expect(
    timestampMicroseconds(replacement.valid_from) >= timestampMicroseconds(previous.valid_until)
  ).toBe(true);
  expect(
    timestampMicroseconds(replacement.activated_at) >= timestampMicroseconds(replacement.valid_from)
  ).toBe(true);
}

describe('community governance — CI backend guard', () => {
  it('fails closed without local backend in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });
});

describe('LocalSqlCommand process-group cleanup', () => {
  it('reaps descendants that outlive their process-group leader', async () => {
    // The shell exits immediately; the TERM-immune sleep survives as an orphan
    // in the same process group (SIG_IGN is inherited across fork/exec).
    const orphan = startLocalProcess('sh', [
      '-c',
      'trap "" TERM; sleep 60 >/dev/null 2>&1 & exit 0'
    ]);
    await orphan.done;
    expect(orphan.pid).not.toBeUndefined();
    expect(orphan.isGroupAlive()).toBe(true);
    await orphan.stop();
    // Group escalation must reap the orphan even though the leader already exited.
    expect(orphan.isGroupAlive()).toBe(false);
  }, 20000);

  it.skipIf(environment.env === null)(
    'stops a stalled cleanup command within its deadline slice',
    async () => {
      const { elapsedMs, sweep } = await releaseHolderAndSweep({
        marker: 'paf44-stalled-sweep-',
        sweepSql: 'select pg_catalog.pg_sleep(4) as value'
      });
      expect(elapsedMs).toBeLessThan(TEARDOWN_DEADLINE_MS);
      // The stalled sweep command was abandoned by its slice and then killed
      // through its retained handle (signaled, not exited).
      expect(sweep).toBeDefined();
      expect(sweep?.code).toBeNull();
    },
    30000
  );
});

describe.skipIf(environment.env === null)('community governance with real JWTs', () => {
  beforeAll(async () => {
    [admin, member, outsider, target, alternate] = await Promise.all([
      actor('Admin'),
      actor('Member'),
      actor('Outsider'),
      actor('Target'),
      actor('Alternate')
    ]);
  });
  const actions = [
    ['approve', approveCommunityMember, 'pending', 'member', 'active', 'member'],
    ['deny', denyCommunityMember, 'pending', 'member', 'inactive', 'member'],
    ['remove', removeCommunityMember, 'active', 'member', 'inactive', 'member'],
    ['reactivate', reactivateCommunityMember, 'inactive', 'member', 'active', 'member'],
    ['promote', promoteCommunityMember, 'active', 'member', 'active', 'admin'],
    ['demote', demoteCommunityMember, 'active', 'admin', 'active', 'member']
  ] as const;
  for (const [name, fn, initial, role, expectedStatus, expectedRole] of actions) {
    it(`${name}: role matrix, history and one audited transition`, async () => {
      const id = await community(admin);
      await membership(admin, id, member, 'active');
      const targetId = await membership(
        admin,
        id,
        target,
        initial === 'inactive' ? 'active' : initial,
        role
      );
      if (initial === 'inactive') {
        serverClient.current = admin.client;
        await removeCommunityMember({ data: { community_id: id, membership_id: targetId } });
      }
      const before = await audit(admin, id);
      const input = { community_id: id, membership_id: targetId };
      for (const unauthorized of [member, outsider]) {
        serverClient.current = unauthorized.client;
        await expect(fn({ data: input })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
        expect(await audit(admin, id)).toEqual(before);
      }
      serverClient.current = anon();
      await expect(fn({ data: input })).rejects.toThrow('UNAUTHENTICATED');
      const direct = await anon().rpc('govern_community_member', {
        p_community_id: id,
        p_membership_id: targetId,
        p_action: name
      });
      expect(direct.error?.code).toBe('42501');
      serverClient.current = admin.client;
      const originalBefore = await admin.client
        .from('community_members')
        .select('id,status,role,valid_from,valid_until,activated_at')
        .eq('id', targetId)
        .single();
      expect(originalBefore.error).toBeNull();
      const changed = await fn({ data: input });
      expect(changed).toMatchObject({ status: expectedStatus, role: expectedRole });
      const original = await admin.client
        .from('community_members')
        .select('id,status,role,valid_from,valid_until,activated_at')
        .eq('id', targetId)
        .single();
      expect(original.error).toBeNull();
      let current = original;
      if (name === 'reactivate') {
        current = await admin.client
          .from('community_members')
          .select('id,status,role,valid_from,valid_until,activated_at')
          .eq('id', changed.membership_id)
          .single();
      }
      if (!originalBefore.data || !original.data || !current.data)
        throw new Error('Persisted membership row missing');
      expect(current.error).toBeNull();
      expect(changed.membership_id === targetId).toBe(name !== 'reactivate');
      expect(original.data).toMatchObject(
        name === 'reactivate'
          ? originalBefore.data
          : {
              id: targetId,
              status: expectedStatus,
              role: expectedRole,
              valid_from: originalBefore.data.valid_from
            }
      );
      expect(current.data).toMatchObject({
        id: changed.membership_id,
        status: expectedStatus,
        role: expectedRole
      });
      expect(current.data?.valid_until === null).toBe(expectedStatus === 'active');
      expect(Boolean(current.data?.activated_at)).toBe(name !== 'deny');
      expect(Boolean(current.data?.valid_from)).toBe(true);
      if (name === 'reactivate') expectReactivationChronology(original.data, current.data);
      const after = await audit(admin, id);
      expect(after).toHaveLength(before.length + 1);
      expect(after.filter((row) => !before.some((previous) => previous.id === row.id))).toEqual([
        expect.objectContaining({
          actor_user_id: admin.id,
          entity: 'community_members',
          entity_id: changed.membership_id,
          action: name === 'reactivate' ? 'INSERT' : 'UPDATE',
          details: { role: expectedRole, status: expectedStatus }
        })
      ]);
    });
  }

  it('cross-community targets hide identity, invalid transitions leave no audit, last admin guard blocks direct writes', async () => {
    const id = await community(admin);
    const other = await community(outsider);
    const foreign = await membership(outsider, other, target, 'pending');
    const mine = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', id)
      .eq('user_id', admin.id)
      .single();
    const before = await audit(admin, id);
    serverClient.current = admin.client;
    await expect(
      approveCommunityMember({ data: { community_id: id, membership_id: foreign } })
    ).rejects.toThrow('COMMUNITY_MEMBER_NOT_FOUND');
    await expect(
      approveCommunityMember({ data: { community_id: id, membership_id: mine.data!.id } })
    ).rejects.toThrow('INVALID_MEMBERSHIP_TRANSITION');
    for (const fn of [demoteCommunityMember, removeCommunityMember])
      await expect(
        fn({ data: { community_id: id, membership_id: mine.data!.id } })
      ).rejects.toThrow('FINAL_COMMUNITY_ADMIN');
    const direct = await admin.client
      .from('community_members')
      .update({ role: 'member' })
      .eq('id', mine.data!.id);
    expect(direct.error?.code).toBe('23514');
    expect(await audit(admin, id)).toEqual(before);
  });

  it('last Admin and two concurrent independent Admin JWTs retain an active Admin', async () => {
    const id = await community(admin);
    const secondId = await membership(admin, id, alternate, 'active', 'admin');
    const first = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', id)
      .eq('user_id', admin.id)
      .single();
    const before = await audit(admin, id);
    expect(
      (
        await admin.client.rpc('govern_community_member', {
          p_community_id: id,
          p_membership_id: first.data!.id,
          p_action: 'remove'
        })
      ).error
    ).toBeNull();
    expect(
      (
        await alternate.client.rpc('govern_community_member', {
          p_community_id: id,
          p_membership_id: secondId,
          p_action: 'demote'
        })
      ).error?.code
    ).toBe('PG002');
    expect(await audit(alternate, id)).toHaveLength(before.length + 1);

    const id2 = await community(admin);
    const otherId = await membership(admin, id2, alternate, 'active', 'admin');
    const original = await admin.client
      .from('community_members')
      .select('id')
      .eq('community_id', id2)
      .eq('user_id', admin.id)
      .single();
    const outcome = await Promise.all([
      admin.client.rpc('govern_community_member', {
        p_community_id: id2,
        p_membership_id: otherId,
        p_action: 'demote'
      }),
      alternate.client.rpc('govern_community_member', {
        p_community_id: id2,
        p_membership_id: original.data!.id,
        p_action: 'remove'
      })
    ]);
    expect(outcome.filter((result) => result.error === null)).toHaveLength(1);
    expect(['PG001', 'PG002', '40P01', '40001']).toContain(
      outcome.find((result) => result.error)?.error?.code
    );
    const surviving = outcome[0].error ? alternate : admin;
    const rows = await surviving.client
      .from('community_members')
      .select('role,status')
      .eq('community_id', id2);
    expect(
      rows.data!.filter((row) => row.role === 'admin' && row.status === 'active')
    ).toHaveLength(1);
    expect(await audit(surviving, id2)).toHaveLength(4);
  });

  it('orders reactivation queued behind a removal at microsecond precision', async () => {
    const communityId = await community(admin);
    const previousId = await membership(admin, communityId, target, 'active');
    const previousResult = await admin.client
      .from('community_members')
      .select('id,status,role,valid_from,valid_until,activated_at')
      .eq('id', previousId)
      .single();
    expect(previousResult.error).toBeNull();
    if (!previousResult.data) throw new Error('Previous membership row missing');
    const auditCountBefore = (await audit(admin, communityId)).length;

    const suffix = crypto.randomUUID().replaceAll('-', '');
    const marker = `paf44-holder-${suffix}`;
    const rpcAbort = new AbortController();
    const outstanding: Promise<unknown>[] = [];
    const queueRpc = <T>(task: () => T): Promise<T> => {
      const tracked = Promise.resolve().then(task);
      outstanding.push(tracked);
      return tracked;
    };
    let holderPid: number | undefined;
    let holderCommand: LocalSqlCommand | undefined;

    try {
      holderCommand = startLocalSql(
        `/* ${marker} */ select pg_catalog.pg_sleep(900) from (select id from public.communities where id = '${communityId}'::uuid for update) locked;`
      );
      let holder: LocalSqlRow | undefined;
      try {
        [holder] = await waitForLocalRows(
          `select a.pid as value
          from pg_catalog.pg_stat_activity a
          where a.query like '%${marker}%'
            and a.state = 'active' and a.pid <> pg_catalog.pg_backend_pid()`,
          (rows) => rows.length === 1,
          'marked holder backend',
          10000,
          200
        );
      } catch (error) {
        const childResult = await Promise.race([
          holderCommand.done,
          new Promise<{ pending: true }>((resolve) =>
            setTimeout(() => resolve({ pending: true }), 1000)
          )
        ]);
        throw new Error(
          `Holder backend not observed; child output: ${JSON.stringify(childResult)}`,
          { cause: error }
        );
      }
      holderPid = Number(holder?.value);
      if (!Number.isInteger(holderPid)) throw new Error('Marked holder backend missing');

      const lockProbe = await runLocalSqlBounded(
        `select id from public.communities where id = '${communityId}'::uuid for update nowait;`,
        10000
      );
      const probeOutput = `${lockProbe.stdout}\n${lockProbe.stderr}`;
      if (lockProbe.code === 0 || !/55P03|could not obtain lock/i.test(probeOutput))
        throw new Error(
          `Holder did not prove the community row lock (code=${lockProbe.code}): ${probeOutput}`
        );

      const removalTask = queueRpc(() =>
        admin.client
          .rpc('govern_community_member', {
            p_community_id: communityId,
            p_membership_id: previousId,
            p_action: 'remove'
          })
          .abortSignal(rpcAbort.signal)
      );
      const [removalWait] = await waitForLocalRows(
        `select pid as value
          from pg_catalog.pg_stat_activity
          where wait_event_type = 'Lock'
            and ${holderPid} = any(pg_catalog.pg_blocking_pids(pid))`,
        (rows) => rows.length === 1,
        'removal to wait for the community row lock',
        QUEUE_PROBE_TIMEOUT_MS,
        QUEUE_PROBE_POLL_MS
      );
      const removalPid = Number(removalWait?.value);
      if (!Number.isInteger(removalPid)) throw new Error('Queued removal backend missing');

      const reactivationTask = queueRpc(() =>
        admin.client
          .rpc('govern_community_member', {
            p_community_id: communityId,
            p_membership_id: previousId,
            p_action: 'reactivate'
          })
          .abortSignal(rpcAbort.signal)
      );
      await waitForLocalRows(
        `select pid as value
          from pg_catalog.pg_stat_activity
          where wait_event_type = 'Lock'
            and ${removalPid} = any(pg_catalog.pg_blocking_pids(pid))`,
        (rows) => rows.length > 0,
        'reactivation to wait behind the locked removal',
        QUEUE_PROBE_TIMEOUT_MS,
        QUEUE_PROBE_POLL_MS
      );

      const [terminated] = await queryLocalSql(
        `select pg_catalog.pg_terminate_backend(${holderPid}) as value`
      );
      expect(terminated?.value).toBe(true);
      await withDeadline(
        holderCommand.done,
        TEARDOWN_DEADLINE_MS,
        'holder exit after explicit release'
      );

      const [removed, reactivated] = await Promise.all([removalTask, reactivationTask]);
      expect(removed.error).toBeNull();
      expect(reactivated.error).toBeNull();
      const replacementId = reactivated.data?.[0]?.membership_id;
      if (!replacementId) throw new Error('Replacement membership was not returned');

      const [previous, replacement] = await Promise.all([
        admin.client
          .from('community_members')
          .select('id,status,role,valid_from,valid_until,activated_at')
          .eq('id', previousId)
          .single(),
        admin.client
          .from('community_members')
          .select('id,status,role,valid_from,valid_until,activated_at')
          .eq('id', replacementId)
          .single()
      ]);
      expect(previous.error).toBeNull();
      expect(replacement.error).toBeNull();
      expect(previous.data?.status).toBe('inactive');
      expect(replacement.data).toMatchObject({
        id: replacementId,
        status: 'active',
        role: 'member',
        valid_until: null
      });
      if (!previous.data || !replacement.data) throw new Error('Persisted interval missing');
      expectReactivationChronology(previous.data, replacement.data);
      expect(await audit(admin, communityId)).toHaveLength(auditCountBefore + 2);
    } finally {
      // Bounded, idempotent teardown: aborts pending RPCs, sweeps tagged backends,
      // stops the retained child (SIGTERM → SIGKILL), then settles outstanding
      // promises within the deadline. Safe even after a failed assertion.
      await releaseHolderAndSweep({ marker, holder: holderCommand, rpcAbort, outstanding });
    }
  }, 90000);

  it('bounds teardown and leaves no tagged backend or child when holder release fails', async () => {
    const communityId = await community(admin);
    const suffix = crypto.randomUUID().replaceAll('-', '');
    const marker = `paf44-failed-release-${suffix}`;
    const rpcAbort = new AbortController();
    const outstanding: Promise<unknown>[] = [];
    const queueRpc = <T>(task: () => T): Promise<T> => {
      const tracked = Promise.resolve().then(task);
      outstanding.push(tracked);
      return tracked;
    };
    let holder: LocalSqlCommand | undefined;
    try {
      holder = startLocalSql(
        `/* ${marker} */ select pg_catalog.pg_sleep(900) from (select id from public.communities where id = '${communityId}'::uuid for update) locked;`
      );
      await waitForLocalRows(
        markerBackendQuery(marker),
        (rows) => rows.length === 1,
        'failure-path holder backend',
        10000,
        200
      );
      const [holderRow] = await queryLocalSql(markerBackendQuery(marker));
      const holderPid = Number(holderRow?.value);
      if (!Number.isInteger(holderPid)) throw new Error('Failure-path holder backend missing');

      // Make the explicit holder release fail: terminate a pid that cannot exist.
      const [failedRelease] = await queryLocalSql(
        'select pg_catalog.pg_terminate_backend(2147483647) as value'
      );
      expect(failedRelease?.value).toBe(false);
      expect(await queryLocalSql(markerBackendQuery(marker))).toHaveLength(1);

      // Queue an RPC behind the live lock so teardown must cancel a pending request.
      // Intentionally unawaited: it stays blocked until the teardown aborts it.
      void queueRpc(() =>
        admin.client
          .rpc('govern_community_member', {
            p_community_id: communityId,
            p_membership_id: crypto.randomUUID(),
            p_action: 'remove'
          })
          .abortSignal(rpcAbort.signal)
      );
      await waitForLocalRows(
        `select pid as value
          from pg_catalog.pg_stat_activity
          where wait_event_type = 'Lock'
            and ${holderPid} = any(pg_catalog.pg_blocking_pids(pid))`,
        (rows) => rows.length === 1,
        'failure-path removal to wait behind the lock',
        QUEUE_PROBE_TIMEOUT_MS,
        QUEUE_PROBE_POLL_MS
      );

      const { elapsedMs, sweep } = await releaseHolderAndSweep({
        marker,
        holder,
        rpcAbort,
        outstanding
      });
      expect(elapsedMs).toBeLessThan(TEARDOWN_DEADLINE_MS);
      // The sweep statement terminated the tagged holder backend.
      expect(sweep).toBeDefined();
      expect(await queryLocalSql(markerBackendQuery(marker))).toHaveLength(0);
      // The retained holder child is gone and its process group is empty.
      expect(holder?.isGroupAlive()).toBe(false);
      const probe = await runLocalSqlBounded(
        `select id from public.communities where id = '${communityId}'::uuid for update nowait;`,
        10000
      );
      if (probe.code !== 0)
        throw new Error(`Community row lock not released (code=${probe.code}): ${probe.stderr}`);

      // Second pass proves the teardown is idempotent and stays bounded.
      const { elapsedMs: secondPassMs } = await releaseHolderAndSweep({
        marker,
        holder,
        rpcAbort,
        outstanding
      });
      expect(secondPassMs).toBeLessThan(TEARDOWN_DEADLINE_MS);
      expect(await queryLocalSql(markerBackendQuery(marker))).toHaveLength(0);
    } finally {
      if (holder) await holder.stop();
      await releaseHolderAndSweep({ marker, holder, rpcAbort, outstanding });
    }
  }, 90000);

  it('orders sequential leave then reactivation at microsecond precision', async () => {
    const communityId = await community(admin);
    const previousId = await membership(admin, communityId, member, 'active');
    const before = await member.client
      .from('community_members')
      .select('id,status,role,valid_from,valid_until,activated_at')
      .eq('id', previousId)
      .single();
    expect(before.error).toBeNull();
    if (!before.data) throw new Error('Previous membership row missing');

    expect(
      (await member.client.rpc('leave_community', { p_community_id: communityId })).error
    ).toBeNull();
    const previous = await admin.client
      .from('community_members')
      .select('id,status,role,valid_from,valid_until,activated_at')
      .eq('id', previousId)
      .single();
    expect(previous.error).toBeNull();
    expect(previous.data).toMatchObject({
      id: previousId,
      status: 'inactive',
      valid_from: before.data.valid_from,
      activated_at: before.data.activated_at
    });
    if (!previous.data) throw new Error('Closed membership row missing');

    const reactivated = await admin.client.rpc('govern_community_member', {
      p_community_id: communityId,
      p_membership_id: previousId,
      p_action: 'reactivate'
    });
    expect(reactivated.error).toBeNull();
    const replacementId = reactivated.data?.[0]?.membership_id;
    if (!replacementId) throw new Error('Replacement membership was not returned');
    const replacement = await admin.client
      .from('community_members')
      .select('id,status,role,valid_from,valid_until,activated_at')
      .eq('id', replacementId)
      .single();
    expect(replacement.error).toBeNull();
    if (!replacement.data) throw new Error('Replacement interval missing');
    expectReactivationChronology(previous.data, replacement.data);
  });

  it('scoped search, audit and venues deny members/outsiders and reject malformed search', async () => {
    const id = await community(admin);
    await membership(admin, id, member, 'active');
    const other = await community(outsider);
    serverClient.current = admin.client;
    await vi.waitFor(
      async () =>
        expect(await listMyAdminCommunities()).toContainEqual(expect.objectContaining({ id })),
      { timeout: 5000, interval: 25 }
    );
    expect(await listMyAdminCommunities()).not.toContainEqual(
      expect.objectContaining({ id: other })
    );
    serverClient.current = member.client;
    expect(await listMyAdminCommunities()).not.toContainEqual(expect.objectContaining({ id }));
    const foreignMembershipId = await membership(outsider, other, target, 'active');
    const page = { community_id: id, offset: 0, limit: 20 };
    for (const fn of [listCommunityAudit, listCommunityVenues]) {
      for (const user of [member, outsider]) {
        serverClient.current = user.client;
        await expect(fn({ data: page })).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      }
      serverClient.current = anon();
      await expect(fn({ data: page })).rejects.toThrow('UNAUTHENTICATED');
      serverClient.current = admin.client;
      expect(await fn({ data: page })).toBeInstanceOf(Array);
    }
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        searchCommunityMembers({ data: { ...page, query: '', status: null } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = anon();
    await expect(searchCommunityMembers({ data: { ...page, query: '' } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect((await anon().rpc('search_community_members', { p_community_id: id })).error?.code).toBe(
      '42501'
    );
    expect(
      (await member.client.rpc('search_community_members', { p_community_id: id })).error?.code
    ).toBe('PG001');
    serverClient.current = admin.client;
    const rows = await searchCommunityMembers({
      data: { ...page, query: 'Mem%_\\', status: null }
    });
    expect(rows).toEqual([]);
    const found = await searchCommunityMembers({
      data: { ...page, query: 'mem', status: 'active' }
    });
    expect(found).toHaveLength(1);
    const direct = await getCommunityMemberById({
      data: { community_id: id, membership_id: found[0]!.membership_id }
    });
    expect(direct.membership_id).toBe(found[0]!.membership_id);
    await expect(
      getCommunityMemberById({ data: { community_id: id, membership_id: foreignMembershipId } })
    ).rejects.toThrow('COMMUNITY_MEMBER_NOT_FOUND');
    serverClient.current = member.client;
    await expect(
      getCommunityMemberById({ data: { community_id: id, membership_id: found[0]!.membership_id } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = anon();
    await expect(
      getCommunityMemberById({ data: { community_id: id, membership_id: found[0]!.membership_id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    serverClient.current = admin.client;
    expect((await searchCommunityMembers({ data: { ...page, status: 'pending' } })).length).toBe(0);
    expect(Object.keys(found[0]!).sort()).toEqual(
      [
        'activated_at',
        'display_level',
        'display_name',
        'membership_id',
        'reliability_percent',
        'role',
        'status',
        'user_id',
        'valid_from',
        'valid_until'
      ].sort()
    );
    await expect(
      searchCommunityMembers({ data: { ...page, community_id: other, query: '' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
  });

  it('venue mutations archive without DELETE and invitation token is bound to invitee', async () => {
    const id = await community(admin);
    await membership(admin, id, member, 'active');
    const before = await audit(admin, id);
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        addCommunityVenue({ data: { community_id: id, name: 'Court' } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      await expect(
        issueInvitation({ data: { community_id: id, invitee_user_id: target.id } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = anon();
    await expect(addCommunityVenue({ data: { community_id: id, name: 'Court' } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: target.id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect(await audit(admin, id)).toEqual(before);
    serverClient.current = admin.client;
    const venue = await addCommunityVenue({ data: { community_id: id, name: 'Court' } });
    const insertedAudit = (await audit(admin, id)).filter(
      (row) => row.entity === 'community_venues'
    );
    expect(insertedAudit.find((row) => row.action === 'INSERT')).toMatchObject({
      actor_user_id: admin.id,
      entity: 'community_venues',
      entity_id: venue.id,
      action: 'INSERT',
      details: { archived: false }
    });
    expect(insertedAudit.find((row) => row.action === 'INSERT')?.details).toEqual({
      archived: false
    });
    const other = await community(outsider);
    serverClient.current = outsider.client;
    await expect(
      editCommunityVenue({ data: { community_id: other, venue_id: venue.id, name: 'Other' } })
    ).rejects.toThrow('COMMUNITY_VENUE_NOT_FOUND');
    serverClient.current = admin.client;
    await editCommunityVenue({ data: { community_id: id, venue_id: venue.id, name: 'Court two' } });
    const editedAudit = (await audit(admin, id)).filter((row) => row.entity === 'community_venues');
    expect(editedAudit.find((row) => row.action === 'UPDATE')).toMatchObject({
      actor_user_id: admin.id,
      entity_id: venue.id,
      action: 'UPDATE',
      details: { archived: false }
    });
    const beforeDeniedArchive = await audit(admin, id);
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        editCommunityVenue({ data: { community_id: id, venue_id: venue.id, name: 'Other' } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
      await expect(
        archiveCommunityVenue({ data: { community_id: id, venue_id: venue.id } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    expect(await audit(admin, id)).toEqual(beforeDeniedArchive);
    serverClient.current = admin.client;
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: member.id } })
    ).rejects.toThrow('ALREADY_MEMBER_OR_PENDING');
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: crypto.randomUUID() } })
    ).rejects.toThrow('INVITEE_NOT_FOUND');
    const unarchivedVenue = await admin.client
      .from('community_venues')
      .select('archived_at')
      .eq('id', venue.id)
      .single();
    expect(unarchivedVenue.error).toBeNull();
    expect(unarchivedVenue.data?.archived_at).toBeNull();
    const archived = await archiveCommunityVenue({
      data: { community_id: id, venue_id: venue.id }
    });
    expect(archived.archived_at).toBeTruthy();
    const archivedAudit = (await audit(admin, id)).filter(
      (row) => row.entity === 'community_venues'
    );
    const archiveEvent = archivedAudit.find(
      (row) => row.details && 'archived' in row.details && row.details.archived === true
    );
    expect(archiveEvent).toMatchObject({
      actor_user_id: admin.id,
      entity_id: venue.id,
      action: 'UPDATE',
      details: { archived: true }
    });
    expect(archiveEvent?.details).toEqual({
      archived: true,
      changed_fields: ['archived_at'],
      transitions: { archived: { before: false, after: true } }
    });
    expect(archiveEvent?.details).not.toEqual(
      editedAudit.find((row) => row.action === 'UPDATE')?.details
    );
    const persistedVenue = await admin.client
      .from('community_venues')
      .select('archived_at')
      .eq('id', venue.id)
      .single();
    expect(persistedVenue.data?.archived_at).toBe(archived.archived_at);
    expect(await listCommunityVenues({ data: { community_id: id } })).toEqual([]);
    const issued = await issueInvitation({
      data: { community_id: id, invitee_user_id: target.id }
    });
    expect(issued.token).toMatch(/^[0-9a-f]{64}$/);
    await expect(
      issueInvitation({ data: { community_id: id, invitee_user_id: target.id } })
    ).rejects.toThrow('INVITATION_ALREADY_OPEN');
    const revocable = await issueInvitation({
      data: { community_id: id, invitee_user_id: alternate.id }
    });
    for (const user of [member, outsider]) {
      serverClient.current = user.client;
      await expect(
        revokeInvitation({ data: { community_id: id, invitation_id: revocable.invitation_id } })
      ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    }
    serverClient.current = anon();
    await expect(
      revokeInvitation({ data: { community_id: id, invitation_id: revocable.invitation_id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    serverClient.current = admin.client;
    expect(
      (
        await revokeInvitation({
          data: { community_id: id, invitation_id: revocable.invitation_id }
        })
      ).revoked_at
    ).toBeTruthy();
    expect(
      (await issueInvitation({ data: { community_id: id, invitee_user_id: alternate.id } })).token
    ).not.toBe(revocable.token);
    serverClient.current = outsider.client;
    await expect(acceptInvitation({ data: { token: issued.token } })).rejects.toThrow(
      'INVITATION_NOT_FOR_USER'
    );
    serverClient.current = target.client;
    expect(await acceptInvitation({ data: { token: issued.token } })).toMatchObject({
      community_id: id,
      status: 'active'
    });
    await expect(acceptInvitation({ data: { token: issued.token } })).rejects.toThrow(
      'INVITATION_USED'
    );
    const after = await audit(admin, id);
    expect(after.filter((row) => row.entity === 'community_venues')).toHaveLength(3);
    expect(after.filter((row) => row.entity === 'community_invitations')).toHaveLength(5);
    expect(after.filter((row) => row.entity === 'communities')).toHaveLength(1);
    expect(after.filter((row) => row.entity === 'community_members')).toHaveLength(3);
    expect(after.find((row) => row.entity === 'communities')?.details).toMatchObject({
      visibility: 'private'
    });
    expect(after.filter((row) => row.entity === 'community_members')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ details: { role: 'admin', status: 'active' } }),
        expect.objectContaining({ details: { role: 'member', status: 'active' } })
      ])
    );
    expect(after.filter((row) => row.entity === 'community_invitations')).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ details: { revoked: false } }),
        expect.objectContaining({ details: { revoked: true } })
      ])
    );
    expect(JSON.stringify(after)).not.toContain(issued.token);
    serverClient.current = admin.client;
    const events = await listCommunityAudit({ data: { community_id: id } });
    expect(events.length).toBeGreaterThan(0);
    expect(Object.keys(events[0]!).sort()).toEqual(
      ['id', 'actor_user_id', 'entity', 'entity_id', 'action', 'details', 'occurred_at'].sort()
    );
  });

  it('settings patch preserves unrelated keys under Admin-only RLS', async () => {
    const id = await community(admin);
    await membership(admin, id, member, 'active');
    serverClient.current = admin.client;
    await updateCommunitySettings({ data: { community_id: id, settings: { keep: 'yes' } } });
    serverClient.current = member.client;
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Denied' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = outsider.client;
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Denied' } })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    serverClient.current = anon();
    await expect(
      updateCommunitySettings({ data: { community_id: id, name: 'Denied' } })
    ).rejects.toThrow('UNAUTHENTICATED');
    serverClient.current = admin.client;
    const updated = await updateCommunitySettings({
      data: { community_id: id, join_policy: 'admin_approval' }
    });
    expect(updated.settings).toEqual({ keep: 'yes' });
  });

  it('blocks final-admin leave and serializes simultaneous admin departures', async () => {
    const soloCommunity = await community(admin);
    const soloAdmin = await admin.client
      .from('community_members')
      .select('id,status,role,valid_until')
      .eq('community_id', soloCommunity)
      .eq('user_id', admin.id)
      .single();
    expect(soloAdmin.error).toBeNull();
    const soloAudit = await audit(admin, soloCommunity);
    serverClient.current = admin.client;
    await expect(leaveCommunity({ data: { community_id: soloCommunity } })).rejects.toThrow(
      'FINAL_COMMUNITY_ADMIN'
    );
    expect(
      (await admin.client.rpc('leave_community', { p_community_id: soloCommunity })).error?.code
    ).toBe('PL002');
    const unchanged = await admin.client
      .from('community_members')
      .select('id,status,role,valid_until')
      .eq('id', soloAdmin.data!.id)
      .single();
    expect(unchanged.error).toBeNull();
    expect(unchanged.data).toEqual(soloAdmin.data);
    expect(await audit(admin, soloCommunity)).toEqual(soloAudit);

    const sharedCommunity = await community(admin);
    await membership(admin, sharedCommunity, alternate, 'active', 'admin');
    const before = await audit(admin, sharedCommunity);
    const [adminLeave, alternateLeave] = await Promise.all([
      admin.client.rpc('leave_community', { p_community_id: sharedCommunity }),
      alternate.client.rpc('leave_community', { p_community_id: sharedCommunity })
    ]);
    expect([adminLeave, alternateLeave].filter(({ error }) => !error)).toHaveLength(1);
    expect([adminLeave, alternateLeave].find(({ error }) => error)?.error?.code).toBe('PL002');
    const survivor = adminLeave.error ? admin : alternate;
    const persisted = await survivor.client
      .from('community_members')
      .select('user_id,role,status,valid_until')
      .eq('community_id', sharedCommunity);
    expect(persisted.error).toBeNull();
    expect(
      persisted.data?.filter(
        (row) => row.role === 'admin' && row.status === 'active' && row.valid_until === null
      )
    ).toHaveLength(1);
    expect(await audit(survivor, sharedCommunity)).toHaveLength(before.length + 1);
    serverClient.current = null;
  });
});
