import { describe, expect, it, vi } from 'vitest';
import {
  DEV_PORTS,
  DUE_EVENT_COUNT,
  IsolationProofError,
  assertProjectIdentities,
  devEnvFromStatus,
  runIsolationProof,
  type ProofDb
} from '../scripts/verify-test-stack-isolation.mjs';
import { TEST_ENV_NAMES } from '../scripts/test-stack-env.mjs';
import { TEST_WORKDIR } from '../scripts/test-stack.mjs';
import { testStatusOutput } from './helpers/test-stack-status';

const DEV_KEY = 'fake-dev-service-key';
const DEV_PW = 'fake-dev-db-pw';
const devStatus = [
  'API_URL="http://127.0.0.1:55321"',
  'DB_URL="postgresql://postgres:' + DEV_PW + '@127.0.0.1:55322/postgres"',
  'MAILPIT_URL="http://127.0.0.1:55324"',
  'SERVICE_ROLE_KEY="' + DEV_KEY + '"'
].join('\n');
const devConfig = { project_id: 'padel-friend', 'api.port': 55321 };
const testConfig = { project_id: 'padel-friend-test', 'api.port': 55421 };

type Stack = {
  sid: string;
  schemas: Map<string, { token: string; dueIds: number[]; beats: number }>;
  users: Map<string, string>;
  buckets: Map<string, string>;
  mail: string[];
  failBeats: boolean;
};
const parse = (text: string): Record<string, string | undefined> => JSON.parse(text);
const newStack = (sid: string): Stack => ({
  sid,
  schemas: new Map(),
  users: new Map(),
  buckets: new Map(),
  mail: [],
  failBeats: false
});

function world() {
  const dev = newStack('111');
  const test = newStack('222');
  const sqlLog: string[] = [];
  const execCalls: string[][] = [];
  const stackOf = (url: string) => (url.includes(':55322') ? dev : test);
  const connectDb = vi.fn<(url: string) => Promise<ProofDb>>(async (url) => {
    const stack = stackOf(url);
    const schemaOf = (sql: string) => /"(isolation_proof_[0-9a-f]{8})"/.exec(sql)?.[1] ?? '';
    return {
      async query(sql: string, params: unknown[] = []) {
        sqlLog.push(sql);
        const schema = schemaOf(sql);
        if (sql.includes('pg_control_system'))
          return { rows: [{ sid: stack.sid, db: 'postgres', port: 5432 }] };
        if (sql.startsWith('create schema'))
          stack.schemas.set(schema, { token: '', dueIds: [], beats: 0 });
        else if (sql.includes('.owner values'))
          stack.schemas.get(schema)!.token = String(params[0]);
        else if (sql.includes('generate_series'))
          stack.schemas.get(schema)!.dueIds = Array.from(
            { length: Number(params[0]) },
            (_, i) => i + 1
          );
        else if (sql.includes('.heartbeat default values')) {
          if (stack.failBeats) throw new Error('write failed');
          stack.schemas.get(schema)!.beats += 1;
        } else if (sql.includes('from "') && sql.includes('.due_events'))
          return {
            rows: (stack.schemas.get(schema)?.dueIds ?? []).map((id) => ({
              id,
              label: 'due-' + id
            }))
          };
        else if (sql.includes('.proposals') && sql.startsWith('select'))
          return { rows: [{ id: 1, status: 'pending' }] };
        else if (sql.includes('.notifications') && sql.startsWith('select'))
          return { rows: [{ id: 1, kind: 'proposal_review' }] };
        else if (sql.includes('.owner') && sql.startsWith('select'))
          return {
            rows: stack.schemas.has(schema) ? [{ token: stack.schemas.get(schema)!.token }] : []
          };
        else if (sql.includes('to_regnamespace'))
          return { rows: [{ present: stack.schemas.has(String(params[0])) }] };
        else if (sql.startsWith('drop schema')) stack.schemas.delete(schema);
        return { rows: [] };
      },
      async end() {}
    };
  });
  const fetchImpl = vi.fn<typeof fetch>(async (input, init) => {
    const url = new URL(
      typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    );
    const stack = url.port === '55321' || url.port === '55324' ? dev : test;
    const method = init?.method ?? 'GET';
    const json = (body: unknown, status = 200) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' }
      });
    const body = typeof init?.body === 'string' ? init.body : '';
    if (url.pathname === '/api/v1/search') {
      const email = /to:"(.*)"/.exec(url.searchParams.get('query') ?? '')?.[1] ?? '';
      return json({ messages_count: stack.mail.filter((m) => m === email).length });
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'POST') {
      const { email } = parse(body);
      const id = '00000000-0000-4000-8000-' + String(stack.users.size).padStart(12, '0');
      stack.users.set(id, email ?? '');
      return json({ id });
    }
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET')
      return json({ users: [...stack.users].map(([id, email]) => ({ id, email })) });
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      stack.users.delete(decodeURIComponent(url.pathname.split('/').at(-1)!));
      return json({});
    }
    if (url.pathname === '/auth/v1/invite') {
      const email = parse(body).email!;
      stack.users.set(
        '11111111-1111-4111-8111-' + String(stack.users.size).padStart(12, '0'),
        email
      );
      stack.mail.push(email);
      return json({});
    }
    if (url.pathname === '/storage/v1/bucket' && method === 'POST') {
      stack.buckets.set(parse(body).id!, '');
      return json({});
    }
    const bucketRoute = /^\/storage\/v1\/bucket\/(.+)$/.exec(url.pathname);
    if (bucketRoute && method === 'GET')
      return json({}, stack.buckets.has(bucketRoute[1]!) ? 200 : 404);
    if (bucketRoute && method === 'DELETE') {
      stack.buckets.delete(bucketRoute[1]!);
      return json({});
    }
    const objectRoute = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (objectRoute && method === 'POST') {
      stack.buckets.set(objectRoute[1]!, body);
      return json({});
    }
    if (objectRoute && method === 'GET')
      return stack.buckets.has(objectRoute[1]!)
        ? new Response(stack.buckets.get(objectRoute[1]!))
        : json({}, 404);
    if (objectRoute && method === 'DELETE') return json({});
    return json({}, 404);
  });
  const exec = vi.fn<(command: string, args: string[], options: Record<string, unknown>) => string>(
    (_command, args) => {
      execCalls.push(args);
      return args.includes(TEST_WORKDIR) ? testStatusOutput() : devStatus;
    }
  );
  return { dev, test, sqlLog, execCalls, connectDb, fetchImpl, exec };
}

const goodArtifacts = () => ({
  present: true,
  clientFilesWithTestApi: 2,
  clientFilesWithDevApi: 0,
  serverBindingMatchesTestKey: true
});

function options(w: ReturnType<typeof world>, overrides: Record<string, unknown> = {}) {
  return {
    argv: ['pnpm', 'complete-check'],
    env: { KEEP: 'yes', VITE_SUPABASE_URL: 'http://127.0.0.1:55321' },
    exec: w.exec,
    fetchImpl: w.fetchImpl,
    connectDb: w.connectDb,
    spawnCommand: vi.fn<
      (
        argv: string[],
        env: Record<string, string | undefined>
      ) => Promise<{ code: number; signal: null }>
    >(async () => ({ code: 0, signal: null })),
    readConfigs: () => ({ dev: devConfig, test: testConfig }),
    artifacts: goodArtifacts,
    sleep: async () => undefined,
    heartbeatMs: 1,
    proofId: 'abcdef01',
    log: () => undefined,
    ...overrides
  };
}

describe('dev status validation', () => {
  it('accepts only the dev ports and reports no extra fields', () => {
    expect(devEnvFromStatus(devStatus)).toEqual({
      apiUrl: 'http://127.0.0.1:55321',
      dbUrl: 'postgresql://postgres:' + DEV_PW + '@127.0.0.1:55322/postgres',
      mailUrl: 'http://127.0.0.1:55324',
      serviceKey: DEV_KEY
    });
    expect(DEV_PORTS).toEqual({ api: '55321', db: '55322', mail: '55324' });
  });

  it.each([
    ['test API port', devStatus.replace('55321', '55421')],
    ['remote API', devStatus.replace('127.0.0.1:55321', 'api.example.com:55321')],
    ['test DB port', devStatus.replace('55322', '55422')],
    ['test Mailpit port', devStatus.replace('55324', '55424')],
    ['missing key', devStatus.replace(/SERVICE_ROLE_KEY=.*/, '')]
  ])('rejects %s without echoing credentials', (_label, status) => {
    let message = '';
    try {
      devEnvFromStatus(status);
    } catch (error) {
      message = error instanceof Error ? error.message : '';
    }
    expect(message).not.toBe('');
    expect(message).not.toContain(DEV_PW);
    expect(message).not.toContain(DEV_KEY);
  });

  it('requires both expected project identities', () => {
    expect(() => assertProjectIdentities(devConfig, testConfig)).not.toThrow();
    expect(() =>
      assertProjectIdentities({ ...devConfig, project_id: 'other' }, testConfig)
    ).toThrow(/dev project/);
    expect(() => assertProjectIdentities(devConfig, { ...testConfig, 'api.port': 55321 })).toThrow(
      /test project/
    );
  });
});

describe('isolation proof', () => {
  it('passes, records the command exit separately and removes only what it owns', async () => {
    const w = world();
    const opts = options(w);
    const { report, exitCode } = await runIsolationProof(opts);

    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    expect(report).toMatchObject({ commandExit: 0, isolationOk: true });
    expect(exitCode).toBe(0);
    expect(report.targets).toEqual({
      testApi: '127.0.0.1:55421',
      testDatabase: '127.0.0.1:55422',
      testMailpit: '127.0.0.1:55424'
    });
    const names = report.checks.map((check) => check.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'distinct-database-clusters',
        'dev-fixtures-valid',
        'dev-fixtures-absent-from-test-before',
        'concurrent-dev-write',
        'dev-markers-survived',
        'dev-fixtures-absent-from-test-after',
        'test-user-absent-from-dev',
        'test-mail-isolated',
        'browser-and-ssr-target-test-api',
        'cleanup-of-owned-fixtures'
      ])
    );
    // 60 due events reproduce the batch-limit-50 scan pressure.
    expect(DUE_EVENT_COUNT).toBeGreaterThan(50);
    // Cleanup removed every dev and test object this run created.
    expect(w.dev.schemas.size).toBe(0);
    expect(w.dev.users.size).toBe(0);
    expect(w.dev.buckets.size).toBe(0);
    expect(w.test.users.size).toBe(0);
  });

  it('keeps a failing command distinct from the isolation verdict', async () => {
    const w = world();
    const { report, exitCode } = await runIsolationProof(
      options(w, { spawnCommand: async () => ({ code: 7, signal: null }) })
    );

    expect(report).toMatchObject({ commandExit: 7, isolationOk: true });
    expect(exitCode).toBe(7);
  });

  it('fails isolation (exit 3) when the command wipes dev markers, and still cleans up', async () => {
    const w = world();
    const { report, exitCode } = await runIsolationProof(
      options(w, {
        spawnCommand: async () => {
          for (const schema of w.dev.schemas.values()) schema.dueIds = [];
          return { code: 0, signal: null };
        }
      })
    );

    expect(exitCode).toBe(3);
    expect(report.isolationOk).toBe(false);
    expect(report.checks.find((check) => check.name === 'dev-markers-survived')?.ok).toBe(false);
    expect(w.dev.schemas.size).toBe(0);
    expect(w.dev.users.size).toBe(0);
  });

  it('fails when the test stack can see dev fixtures (shared backend)', async () => {
    const w = world();
    w.test.schemas = w.dev.schemas;
    w.test.users = w.dev.users;
    const { report, exitCode } = await runIsolationProof(options(w));

    expect(exitCode).toBe(3);
    expect(
      report.checks.find((check) => check.name === 'dev-fixtures-absent-from-test-before')?.ok
    ).toBe(false);
  });

  it('fails when both stacks report the same database cluster', async () => {
    const w = world();
    w.test.sid = w.dev.sid;
    const { report } = await runIsolationProof(options(w));

    expect(report.checks.find((check) => check.name === 'distinct-database-clusters')?.ok).toBe(
      false
    );
  });

  it('proves simultaneous dev access with a write during execution, and fails when it cannot write', async () => {
    const w = world();
    const sleep = vi.fn<(ms: number) => Promise<void>>(async () => undefined);
    let release = () => undefined as void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const { report } = await runIsolationProof(
      options(w, {
        sleep,
        spawnCommand: async () => {
          await Promise.resolve();
          release();
          await gate;
          return { code: 0, signal: null };
        }
      })
    );
    const write = report.checks.find((check) => check.name === 'concurrent-dev-write');
    expect(write?.ok).toBe(true);
    expect(Number(write?.evidence['successfulWrites'])).toBeGreaterThanOrEqual(1);

    const blocked = world();
    blocked.dev.failBeats = true;
    const failed = await runIsolationProof(options(blocked));
    expect(failed.report.checks.find((check) => check.name === 'concurrent-dev-write')?.ok).toBe(
      false
    );
    expect(failed.exitCode).toBe(3);
  });

  it('requires build artifact evidence for the test API and the matching server binding', async () => {
    const w = world();
    const missing = await runIsolationProof(options(w, { artifacts: () => ({ present: false }) }));
    expect(
      missing.report.checks.find((check) => check.name === 'browser-and-ssr-target-test-api')?.ok
    ).toBe(false);
    const leaking = await runIsolationProof(
      options(world(), { artifacts: () => ({ ...goodArtifacts(), clientFilesWithDevApi: 1 }) })
    );
    expect(leaking.exitCode).toBe(3);
  });

  it('never drops a proof schema whose owner token it does not hold', async () => {
    const w = world();
    const { report } = await runIsolationProof(
      options(w, {
        spawnCommand: async () => {
          for (const schema of w.dev.schemas.values()) schema.token = 'someone-else';
          return { code: 0, signal: null };
        }
      })
    );

    expect(w.dev.schemas.size).toBe(1);
    expect(report.isolationOk).toBe(false);
  });

  it('runs serially, hides the test launcher controls from the command and never resets or stops a stack', async () => {
    const w = world();
    const opts = options(w, {
      env: {
        KEEP: 'yes',
        VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
        DATABASE_URL: 'postgresql://x',
        SUPABASE_SERVICE_ROLE_KEY: 'k'
      }
    });
    await runIsolationProof(opts);

    const spawnCommand = opts.spawnCommand;
    expect(spawnCommand).toHaveBeenCalledTimes(1);
    const childEnv = spawnCommand.mock.calls[0]![1];
    for (const name of TEST_ENV_NAMES) expect(childEnv).not.toHaveProperty(name);
    expect(childEnv['KEEP']).toBe('yes');
    for (const args of w.execCalls) {
      expect(args).toEqual(expect.arrayContaining(['status', '-o', 'env']));
      expect(args).not.toEqual(expect.arrayContaining(['reset']));
      expect(args).not.toEqual(expect.arrayContaining(['stop']));
    }
    const dangerous = w.sqlLog.filter((sql) =>
      /truncate|drop (database|table)|delete from/i.test(sql)
    );
    expect(dangerous).toEqual([]);
    const drops = w.sqlLog.filter((sql) => sql.startsWith('drop schema'));
    expect(drops).toEqual(['drop schema "isolation_proof_abcdef01" cascade']);
  });

  it('aborts before any connection or fixture when a stack or identity is missing', async () => {
    const down = world();
    down.exec.mockImplementation((_command, args) => {
      if (!args.includes(TEST_WORKDIR)) throw new Error('not running');
      return testStatusOutput();
    });
    await expect(runIsolationProof(options(down))).rejects.toThrow(/pnpm db:start/);
    expect(down.connectDb).not.toHaveBeenCalled();

    const testDown = world();
    testDown.exec.mockImplementation((_command, args) => {
      if (args.includes(TEST_WORKDIR)) throw new Error('not running');
      return devStatus;
    });
    await expect(runIsolationProof(options(testDown))).rejects.toThrow(/test:stack:up/);
    expect(testDown.connectDb).not.toHaveBeenCalled();

    const drifted = world();
    await expect(
      runIsolationProof(
        options(drifted, { readConfigs: () => ({ dev: devConfig, test: devConfig }) })
      )
    ).rejects.toThrow(IsolationProofError);
    expect(drifted.connectDb).not.toHaveBeenCalled();
    await expect(runIsolationProof(options(world(), { argv: [] }))).rejects.toThrow(/Usage/);
    await expect(runIsolationProof(options(world(), { proofId: 'x; drop' }))).rejects.toThrow(
      /invalid proof id/
    );
  });

  it('keeps all evidence credential-free', async () => {
    const w = world();
    const lines: string[] = [];
    const { report } = await runIsolationProof(
      options(w, { log: (line: string) => lines.push(line) })
    );
    const output = lines.join('\n') + JSON.stringify(report);

    for (const secret of [
      DEV_KEY,
      DEV_PW,
      'fake-service-role-key',
      'fake-db-pw',
      'sb_publishable_fake'
    ])
      expect(output).not.toContain(secret);
  });
});
