import { EventEmitter } from 'node:events';
import { describe, expect, it, vi } from 'vitest';
import {
  DEV_PORTS,
  DUE_EVENT_COUNT,
  IsolationProofError,
  assertProjectIdentities,
  devEnvFromStatus,
  defaultLiveProbe,
  runIsolationProof,
  type ProofDb
} from '../scripts/verify-test-stack-isolation.mjs';
import { TEST_ENV_NAMES } from '../scripts/test-stack-env.mjs';
import { TEST_WORKDIR } from '../scripts/test-stack.mjs';
import { testStatusOutput } from './helpers/test-stack-status';
import { productWorld } from './helpers/isolation-product-world';

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
  product: ReturnType<typeof productWorld>;
  schemas: Map<string, { token: string; dueIds: number[]; beats: number }>;
  users: Map<string, string>;
  buckets: Map<string, string>;
  mail: string[];
  notifications: Map<string, string>;
  failBeats: boolean;
  /** Fails any SQL containing this text (simulates a mid-setup database failure). */
  failSql: string | undefined;
  /** Forces an HTTP status for "METHOD /path-prefix" requests. */
  reject: Map<string, number>;
  /** Users listed per page beyond the default fixture set (pagination tests). */
  filler: number;
};
const parse = (text: string): Record<string, string | undefined> => JSON.parse(text);
const newStack = (sid: string): Stack => ({
  sid,
  product: productWorld(),
  schemas: new Map(),
  users: new Map(),
  buckets: new Map(),
  mail: [],
  notifications: new Map(),
  failBeats: false,
  failSql: undefined,
  reject: new Map(),
  filler: 0
});

function world() {
  const dev = newStack('111');
  const test = newStack('222');
  const sqlLog: string[] = [];
  const clients: Array<EventEmitter & ProofDb & { closed: boolean }> = [];
  const execCalls: string[][] = [];
  const stackOf = (url: string) => (url.includes(':55322') ? dev : test);
  const connectDb = vi.fn<(url: string) => Promise<ProofDb>>(async (url) => {
    const stack = stackOf(url);
    const schemaOf = (sql: string) => /"(isolation_proof_[0-9a-f]{8})"/.exec(sql)?.[1] ?? '';
    let txSchemas: string[] = [];
    const client = Object.assign(new EventEmitter(), {
      closed: false,
      async query(sql: string, params: unknown[] = []) {
        sqlLog.push(sql);
        const schema = schemaOf(sql);
        if (sql.startsWith('select proposal_id::text'))
          return {
            rows: stack.product.state.versions.filter(
              (row) => Array.isArray(params[0]) && params[0].includes(row.proposal_id)
            )
          };
        const product = stack.product.query(sql, params);
        if (product && sql.startsWith('select (select count(*) from public.communities'))
          product.rows[0]!.versions = stack.product.state.versions.filter(
            (row) => Array.isArray(params[5]) && params[5].includes(row.proposal_id)
          ).length;
        if (product) return product;
        if (stack.failSql && sql.includes(stack.failSql)) throw new Error('injected sql failure');
        if (sql.includes('pg_control_system'))
          return { rows: [{ sid: stack.sid, db: 'postgres', port: 5432 }] };
        if (sql === 'begin') txSchemas = [];
        else if (sql === 'commit') txSchemas = [];
        else if (sql === 'rollback') {
          for (const name of txSchemas) stack.schemas.delete(name);
          txSchemas = [];
        } else if (sql.startsWith('insert into public.notifications'))
          stack.notifications.set(String(params[1]), String(params[0]));
        else if (sql.includes('from public.notifications'))
          return { rows: [{ n: stack.notifications.has(String(params[0])) ? 1 : 0 }] };
        else if (sql.startsWith('create schema')) {
          stack.schemas.set(schema, { token: '', dueIds: [], beats: 0 });
          txSchemas.push(schema);
        } else if (sql.includes('.owner values'))
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
        else if (sql.includes('to_regnamespace')) {
          const present = stack.schemas.has(String(params[0]));
          return { rows: [{ present, gone: !present }] };
        } else if (sql.startsWith('drop schema')) stack.schemas.delete(schema);
        return { rows: [] };
      },
      async end() {
        client.closed = true;
      }
    });
    clients.push(client);
    return client;
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
    for (const [rule, status] of stack.reject) {
      const [ruleMethod, rulePath] = rule.split(' ');
      if (method === ruleMethod && url.pathname.startsWith(rulePath!)) return json({}, status);
    }
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
    if (url.pathname === '/auth/v1/admin/users' && method === 'GET') {
      const page = Number(url.searchParams.get('page') ?? '1');
      const perPage = Number(url.searchParams.get('per_page') ?? '50');
      const all = [
        ...Array.from({ length: stack.filler }, (_, i) => ({
          id: 'filler-' + i,
          email: 'filler-' + i + '@example.com'
        })),
        ...[...stack.users].map(([id, email]) => ({ id, email }))
      ];
      return json({ users: all.slice((page - 1) * perPage, page * perPage) });
    }
    if (url.pathname === '/auth/v1/admin/generate_link' && method === 'POST') {
      const { email } = parse(body);
      const id = '22222222-2222-4222-8222-' + String(stack.users.size).padStart(12, '0');
      stack.users.set(id, email ?? '');
      return json({ id, hashed_token: 'fake-hashed-token' });
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'GET') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      return stack.users.has(id) ? json({ id }) : json({}, 404);
    }
    if (url.pathname.startsWith('/auth/v1/admin/users/') && method === 'DELETE') {
      const id = decodeURIComponent(url.pathname.split('/').at(-1)!);
      if (!stack.users.delete(id)) return json({}, 404);
      for (const [key, owner] of stack.notifications)
        if (owner === id) stack.notifications.delete(key);
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
      return json({ name: bucketRoute[1] }, stack.buckets.has(bucketRoute[1]!) ? 200 : 404);
    if (bucketRoute && method === 'DELETE') {
      stack.buckets.delete(bucketRoute[1]!);
      return json({});
    }
    const deletePhotos = /^\/storage\/v1\/object\/([^/]+)$/.exec(url.pathname);
    if (deletePhotos && method === 'DELETE') {
      const payload: { prefixes: string[] } = JSON.parse(body);
      if (deletePhotos[1] === 'match-event-photos')
        for (const name of payload.prefixes) stack.product.state.photos.delete(name);
      return json({});
    }
    const objectRoute = /^\/storage\/v1\/object\/([^/]+)\/(.+)$/.exec(url.pathname);
    if (objectRoute && method === 'POST' && objectRoute[1] === 'match-event-photos') {
      stack.product.state.photos.set(objectRoute[2]!, 'photo-bytes');
      return json({});
    }
    if (objectRoute && objectRoute[1] === 'match-event-photos' && method === 'GET')
      return stack.product.state.photos.has(objectRoute[2]!)
        ? new Response('photo-bytes')
        : json({}, 404);
    if (objectRoute && objectRoute[1] === 'match-event-photos' && method === 'DELETE') {
      stack.product.state.photos.delete(objectRoute[2]!);
      return json({});
    }
    if (url.pathname.startsWith('/rest/v1/')) return json([]);
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
  return { dev, test, sqlLog, execCalls, connectDb, fetchImpl, exec, clients };
}

const goodLive = () => ({
  browser: { requestHosts: ['127.0.0.1:55421'], loginSucceeded: true },
  ssr: { tokenAccepted: true, sessionCookieSet: true }
});

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
    liveProbe: vi.fn<(...args: unknown[]) => Promise<ReturnType<typeof goodLive>>>(async () =>
      goodLive()
    ),
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
  it('closes test SQL before wrapped reset; idle pg errors cannot bypass finally', async () => {
    const w = world();
    const result = await runIsolationProof(
      options(w, {
        spawnCommand: async () => {
          expect(w.clients[1]!.closed).toBe(true);
          expect(w.clients[0]!.closed).toBe(false);
          // Simulate a late socket error while the command bounces its database.
          expect(() =>
            w.clients[1]!.emit('error', new Error('57P01 postmaster exit'))
          ).not.toThrow();
          return { code: 0, signal: null };
        }
      })
    );
    expect(w.connectDb).toHaveBeenCalledTimes(3);
    expect(result.report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
    expect(w.dev.users.size).toBe(0);
    expect(w.dev.schemas.size).toBe(0);
  });

  it('continues cleanup after pg error and partial deletion failure, reporting scoped residue', async () => {
    const w = world();
    const { report, exitCode } = await runIsolationProof(
      options(w, {
        spawnCommand: async () => {
          w.clients[0]!.emit('error', new Error('dev idle disconnect'));
          w.dev.reject.set('DELETE /storage/v1/bucket/', 503);
          return { code: 1, signal: null };
        }
      })
    );
    expect(exitCode).toBe(3);
    expect(report.commandExit).toBe(1);
    expect(w.dev.users.size).toBe(0);
    expect(w.dev.schemas.size).toBe(0);
    const cleanup = report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')!;
    expect(cleanup.ok).toBe(false);
    expect(cleanup.evidence['connectionErrors']).toEqual(
      expect.arrayContaining([{ side: 'dev', reason: 'dev idle disconnect' }])
    );
    expect(cleanup.evidence['recovery']).toMatchObject({
      proofId: 'abcdef01',
      token: expect.stringMatching(/^[0-9a-f]{24}$/),
      remainingResources: expect.arrayContaining([
        { kind: 'dev bucket', id: [...w.dev.buckets.keys()][0], status: 'present' },
        {
          kind: 'dev object',
          id: [...w.dev.buckets.keys()][0] + '/marker.txt',
          status: 'present'
        }
      ])
    });
  });

  it('preserves the actual token-qualified foreign bucket on create conflict', async () => {
    const w = world();
    const original = w.fetchImpl.getMockImplementation()!;
    let candidate = '';
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = input instanceof Request ? input.url : String(input);
      if (init?.method === 'POST' && url.endsWith('/storage/v1/bucket')) {
        candidate = JSON.parse(typeof init.body === 'string' ? init.body : '').name;
        w.dev.buckets.set(candidate, 'foreign bytes');
        return new Response(null, { status: 409 });
      }
      return original(input, init);
    };
    const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
    expect(exitCode).toBe(3);
    expect(report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toBe(
      'Storage bucket creation failed (409)'
    );
    expect(candidate).toMatch(/^isolation-proof-abcdef01-[0-9a-f]{24}$/);
    expect(w.dev.buckets.get(candidate)).toBe('foreign bytes');
    expect(report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
  });

  it.each(['dev', 'test'] as const)(
    'records Auth 404 absence reasons in %s evidence',
    async (side) => {
      const w = world();
      w[side].reject.set('GET /auth/v1/admin/users/', 404);
      const { report } = await runIsolationProof(options(w));
      const check = side === 'dev' ? 'dev-fixtures-valid' : 'dev-fixtures-absent-from-test-before';
      expect(report.checks.find((c) => c.name === check)?.evidence['userAbsenceReasons']).toEqual([
        'Auth user absent (404)'
      ]);
      expect(report.isolationOk).toBe(side === 'test');
      expect(report.checks.find((c) => c.name === check)?.ok).toBe(side === 'test');
    }
  );

  it.each(['dev', 'test'] as const)('rejects Auth 500 lookups on %s', async (side) => {
    const w = world();
    w[side].reject.set('GET /auth/v1/admin/users/', 500);
    const { report, exitCode } = await runIsolationProof(options(w));
    expect(exitCode).toBe(3);
    expect(report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toBe(
      'Auth user lookup failed (500)'
    );
  });
  it('preserves a pre-existing bucket when creation collides', async () => {
    const w = world();
    w.dev.buckets.set('isolation-proof-abcdef01', 'pre-existing bytes');
    w.dev.reject.set('POST /storage/v1/bucket', 409);
    const { report, exitCode } = await runIsolationProof(options(w));
    expect(exitCode).toBe(3);
    expect(w.dev.buckets.get('isolation-proof-abcdef01')).toBe('pre-existing bytes');
    expect(report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
  });

  it('reconciles a lost bucket creation response using its exact token-qualified name', async () => {
    const w = world();
    w.dev.buckets.set('isolation-proof-abcdef01', 'foreign bytes');
    const original = w.fetchImpl.getMockImplementation()!;
    let created = '';
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await original(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (init?.method === 'POST' && url.endsWith('/storage/v1/bucket')) {
        created = JSON.parse(typeof init.body === 'string' ? init.body : '').name;
        throw new Error('lost bucket response');
      }
      return response;
    };
    const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
    expect(exitCode).toBe(3);
    expect(created).toMatch(/^isolation-proof-abcdef01-[0-9a-f]{24}$/);
    expect(w.dev.buckets.has(created)).toBe(false);
    expect(w.dev.buckets.get('isolation-proof-abcdef01')).toBe('foreign bytes');
    expect(report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
  });

  it('refuses ambiguous bucket cleanup when lookup returns a different name', async () => {
    const w = world();
    const original = w.fetchImpl.getMockImplementation()!;
    let created = '';
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await original(input, init);
      if (
        init?.method === 'POST' &&
        (input instanceof Request ? input.url : String(input)).endsWith('/storage/v1/bucket')
      ) {
        created = JSON.parse(typeof init.body === 'string' ? init.body : '').name;
        throw new Error('lost bucket response');
      }
      if (
        created &&
        (input instanceof Request ? input.url : String(input)).endsWith(
          '/storage/v1/bucket/' + created
        )
      )
        return new Response(JSON.stringify({ name: 'foreign-name' }));
      return response;
    };
    const { report } = await runIsolationProof(options(w, { fetchImpl }));
    expect(w.dev.buckets.has(created)).toBe(true);
    expect(
      report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.evidence['errors']
    ).toContain('dev bucket ownership: Storage bucket ownership mismatch');
  });

  it.each(['', 'not JSON'])(
    'accepts object 404 body %j and records absence reason',
    async (body) => {
      const w = world();
      const original = w.fetchImpl.getMockImplementation()!;
      const fetchImpl: typeof fetch = async (input, init) => {
        const response = await original(input, init);
        if (
          (input instanceof Request ? input.url : String(input)).includes('/storage/v1/object/') &&
          response.status === 404
        )
          return new Response(body, { status: 404 });
        return response;
      };
      const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
      expect(exitCode).toBe(0);
      expect(
        report.checks.find((c) => c.name === 'dev-fixtures-absent-from-test-before')?.evidence[
          'photoAbsenceReasons'
        ]
      ).toEqual(['Storage object absent (404)']);
      expect(
        report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.evidence['tolerated']
      ).toContain('Storage object absent (404)');
    }
  );

  it('rejects object read 500 instead of accepting absence', async () => {
    const w = world();
    w.test.reject.set('GET /storage/v1/object/', 500);
    const { report, exitCode } = await runIsolationProof(options(w));
    expect(exitCode).toBe(3);
    expect(report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toBe(
      'Storage read failed (500)'
    );
  });

  it.each(['dev', 'player', 'login', 'invite', 'ssr'])(
    'reconciles a lost %s Auth creation response by proof-owned email',
    async (kind) => {
      const w = world();
      const original = w.fetchImpl.getMockImplementation()!;
      let creates = 0;
      const fetchImpl: typeof fetch = async (input, init) => {
        const response = await original(input, init);
        const url = input instanceof Request ? input.url : String(input);
        if (init?.method === 'POST' && url.includes('/auth/v1/')) {
          const dev = url.includes(':55321');
          if (dev) creates += 1;
          if (
            (kind === 'dev' && dev && creates === 1) ||
            (kind === 'player' && dev && creates === 3) ||
            (kind === 'login' && !dev && url.endsWith('/admin/users')) ||
            (kind === 'invite' && !dev && url.endsWith('/invite')) ||
            (kind === 'ssr' && !dev && url.endsWith('/generate_link'))
          )
            throw new Error('lost creation response');
        }
        return response;
      };
      const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
      expect(exitCode).toBe(3);
      expect(w.dev.users.size).toBe(0);
      expect(w.test.users.size).toBe(0);
      expect(report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
    }
  );

  it('reconciles a lost COMMIT acknowledgement before relational and photo cleanup', async () => {
    const w = world();
    let lost = false;
    const connectDb = async (url: string) => {
      const db = await w.connectDb(url);
      return {
        ...db,
        query: async (sql: string, params?: unknown[]) => {
          const result = await db.query(sql, params);
          if (url.includes(':55322') && sql === 'commit' && !lost) {
            lost = true;
            throw new Error('lost commit acknowledgement');
          }
          return result;
        }
      };
    };
    const { report, exitCode } = await runIsolationProof(options(w, { connectDb }));
    expect(exitCode).toBe(3);
    expect(w.dev.product.state.communities).toHaveLength(0);
    expect(w.dev.product.state.events).toHaveLength(0);
    expect(w.dev.product.state.versions).toHaveLength(0);
    expect(w.dev.product.state.photos.size).toBe(0);
    expect(w.dev.schemas.size).toBe(0);
    expect(report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
  });

  it('inventories an ambiguous committed schema when dev reconnection fails', async () => {
    const w = world();
    let lost = false;
    const connectDb = async (url: string) => {
      if (url.includes(':55322') && lost) throw new Error('dev reconnection unavailable');
      const db = await w.connectDb(url);
      return {
        ...db,
        query: async (sql: string, params?: unknown[]) => {
          if (url.includes(':55322') && lost) throw new Error('dev connection unavailable');
          const result = await db.query(sql, params);
          if (url.includes(':55322') && sql === 'commit') {
            lost = true;
            throw new Error('lost commit acknowledgement');
          }
          return result;
        }
      };
    };
    const { report, exitCode } = await runIsolationProof(options(w, { connectDb }));
    expect(exitCode).toBe(3);
    expect(w.dev.schemas.has('isolation_proof_abcdef01')).toBe(true);
    const cleanup = report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')!;
    expect(cleanup.ok).toBe(false);
    expect(cleanup.evidence['errors']).toContain(
      'dev transaction outcome: dev reconnection unavailable'
    );
    expect(cleanup.evidence['recovery']).toMatchObject({
      proofId: 'abcdef01',
      remainingResources: [
        ...[...w.dev.users.values()].map((id) => ({ kind: 'dev user', id, status: 'present' })),
        { kind: 'dev schema', id: 'isolation_proof_abcdef01', status: 'unverified' },
        ...(
          [
            ['community', w.dev.product.state.communities, 'id'],
            ['event', w.dev.product.state.events, 'id'],
            ['proposal', w.dev.product.state.proposals, 'id'],
            ['version', w.dev.product.state.versions, 'proposal_id']
          ] as const
        ).flatMap(([kind, rows, column]) =>
          rows.map((row) => ({
            kind: 'dev ' + kind,
            id: row[column],
            status: 'unverified'
          }))
        ),
        ...[...w.dev.product.state.photos.keys()].map((name) => ({
          kind: 'dev photo',
          id: 'match-event-photos/' + name,
          status: 'present'
        })),
        { kind: 'dev notification', id: 'isolation-proof-abcdef01', status: 'unverified' }
      ]
    });
    expect(w.test.users.size).toBe(0);
    expect(w.dev.buckets.size).toBe(0);
  });

  it.each([401, 403, 500])(
    'rejects bucket lookup %s instead of accepting absence',
    async (status) => {
      const w = world();
      w.test.reject.set('GET /storage/v1/bucket/', status);
      const { report, exitCode } = await runIsolationProof(options(w));
      expect(exitCode).toBe(3);
      expect(report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toContain(
        String(status)
      );
    }
  );

  it('uses API-only cleanup when a failed COMMIT did not persist rows', async () => {
    const w = world();
    let failed = false;
    const connectDb = async (url: string) => {
      const db = await w.connectDb(url);
      return {
        ...db,
        query: async (sql: string, params?: unknown[]) => {
          if (!failed && url.includes(':55322') && sql === 'commit') {
            failed = true;
            throw new Error('commit rejected before persistence');
          }
          return db.query(sql, params);
        }
      };
    };
    const result = await runIsolationProof(options(w, { connectDb }));
    expect(result.exitCode).toBe(3);
    expect(w.dev.product.state.events).toHaveLength(0);
    expect(w.dev.product.state.photos.size).toBe(0);
    expect(w.dev.users.size).toBe(0);
    expect(w.sqlLog.some((sql) => sql.includes('disable trigger'))).toBe(false);
    expect(result.report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
  });

  it('redacts the whole proof username as well as the password in recorded errors', async () => {
    const w = world();
    const liveProbe = async ({ login }: { login: { email: string; password: string } }) => {
      throw new Error('fill(' + login.email + ', ' + login.password + ') failed');
    };
    const result = await runIsolationProof(options(w, { liveProbe }));
    expect(result.report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toBe(
      'fill([redacted], [redacted]) failed'
    );
  });

  it('accepts Storage 400/statusCode 404 bucket absence with a reason', async () => {
    const w = world();
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const response = await w.fetchImpl(input, init);
      const url = input instanceof Request ? input.url : String(input);
      if (init?.method === 'GET' && url.includes('/storage/v1/bucket/') && response.status === 404)
        return Response.json(
          { statusCode: '404', error: 'Bucket not found', code: 'NoSuchBucket' },
          { status: 400 }
        );
      return response;
    };
    const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
    expect(exitCode).toBe(0);
    expect(
      report.checks.find((c) => c.name === 'dev-fixtures-absent-from-test-before')?.evidence[
        'bucketAbsenceReason'
      ]
    ).toBe('Storage bucket absent (400 with statusCode=404)');
  });

  it('rejects Storage 400/statusCode 403 bucket lookup', async () => {
    const w = world();
    const fetchImpl = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = input instanceof Request ? input.url : String(input);
      if (init?.method === 'GET' && url.includes('/storage/v1/bucket/'))
        return Response.json(
          { statusCode: '403', error: 'Unauthorized', code: 'AccessDenied' },
          { status: 400 }
        );
      return w.fetchImpl(input, init);
    };
    const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
    expect(exitCode).toBe(3);
    expect(report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toContain(
      'Storage bucket lookup failed (400)'
    );
  });

  it('records the justified 404 bucket-absence reason', async () => {
    const { report, exitCode } = await runIsolationProof(options(world()));
    expect(exitCode).toBe(0);
    expect(
      report.checks.find((c) => c.name === 'dev-fixtures-absent-from-test-before')?.evidence[
        'bucketAbsenceReason'
      ]
    ).toContain('404');
  });

  it('runs fixture cleanup after a handled preview spawn error', async () => {
    const w = world();
    const child = Object.assign(new EventEmitter(), { kill: vi.fn<() => void>() });
    const result = await runIsolationProof(
      options(w, {
        liveProbe: (probe: { login: { email: string; password: string }; inviteHash: string }) =>
          defaultLiveProbe({
            ...probe,
            checkPort: async () => undefined,
            spawnImpl: () => {
              queueMicrotask(() => {
                child.emit('error', new Error('spawn failed'));
                child.emit('close', 127, null);
              });
              return child;
            },
            fetchImpl: async () => new Response('ok')
          })
      })
    );
    expect(result.exitCode).toBe(3);
    expect(result.report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toBe(
      'preview launch failed'
    );
    expect(result.report.checks.find((c) => c.name === 'cleanup-of-owned-fixtures')?.ok).toBe(true);
    expect(w.dev.users.size).toBe(0);
    expect(w.test.users.size).toBe(0);
    expect(w.dev.product.state.communities).toHaveLength(0);
  });

  it('redacts generated probe credentials even from injected error logs', async () => {
    const w = world();
    let password = '';
    const liveProbe = async ({ login }: { login: { password: string } }) => {
      password = login.password;
      throw new Error('fill(' + password + ') failed');
    };
    const { report, exitCode } = await runIsolationProof(options(w, { liveProbe }));
    expect(exitCode).toBe(3);
    expect(JSON.stringify(report)).not.toContain(password);
    expect(w.dev.users.size).toBe(0);
  });

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
    // Real product fixtures (not private-schema rows) reproduce scan pressure.
    expect(DUE_EVENT_COUNT).toBeGreaterThan(50);
    const photoUploads = w.fetchImpl.mock.calls.filter(
      ([input, init]) =>
        init?.method === 'POST' &&
        (input instanceof Request ? input.url : String(input)).includes(
          '/storage/v1/object/match-event-photos/'
        )
    );
    expect(photoUploads).toHaveLength(60);
    for (const [, init] of photoUploads) {
      expect(new Headers(init?.headers).get('content-type')).toBe('image/jpeg');
      expect(init?.body).toBeInstanceOf(Uint8Array);
    }
    expect(w.dev.product.state.communities).toHaveLength(0);
    expect(w.dev.product.state.events).toHaveLength(0);
    expect(w.dev.product.state.proposals).toHaveLength(0);
    expect(w.dev.product.state.photos.size).toBe(0);
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
    expect(
      dangerous.filter(
        (sql) => !/^delete from public\.\w+ where \w+ = any\(\$1::uuid\[\]\)$/.test(sql)
      )
    ).toEqual([]);
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

  it('looks the dev proof user up by id and pages through every user to exhaustion', async () => {
    const w = world();
    // Far beyond the old 5 x 200 window: the proof user and the test invite sit past user 1000.
    w.dev.filler = 1100;
    w.test.filler = 1100;
    const { report } = await runIsolationProof(options(w));

    expect(report.checks.filter((check) => !check.ok)).toEqual([]);
    const urls = w.fetchImpl.mock.calls.map(([input]) =>
      input instanceof Request ? input.url : String(input)
    );
    const pages = urls
      .filter((url) => url.includes('/auth/v1/admin/users?'))
      .map((url) => Number(new URL(url).searchParams.get('page')));
    expect(Math.max(...pages)).toBeGreaterThan(5);
    expect(urls.some((url) => /\/auth\/v1\/admin\/users\/[0-9a-f-]{36}$/.test(url))).toBe(true);
    // The invite user beyond page 5 was found, so it was deleted too.
    expect(w.test.users.size).toBe(0);
    expect(w.dev.users.size).toBe(0);
  });

  it('fails the isolation verdict when a delete is rejected, instead of reporting a clean cleanup', async () => {
    const w = world();
    w.dev.reject.set('DELETE /auth/v1/admin/users/', 500);
    const { report, exitCode } = await runIsolationProof(options(w));

    const cleanup = report.checks.find((check) => check.name === 'cleanup-of-owned-fixtures');
    expect(cleanup?.ok).toBe(false);
    expect(String(cleanup?.evidence['errors'])).toContain('dev user');
    expect(exitCode).toBe(3);

    const storage = world();
    storage.dev.reject.set('DELETE /storage/v1/bucket/', 409);
    const rejected = await runIsolationProof(options(storage));
    expect(
      rejected.report.checks.find((check) => check.name === 'cleanup-of-owned-fixtures')?.ok
    ).toBe(false);
  });

  it('treats a 404 delete as already-absent success and records why', async () => {
    const w = world();
    w.dev.reject.set('DELETE /storage/v1/object/isolation-proof-', 404);
    const { report, exitCode } = await runIsolationProof(options(w));

    const cleanup = report.checks.find((check) => check.name === 'cleanup-of-owned-fixtures');
    expect(cleanup?.ok).toBe(true);
    expect(cleanup?.evidence['tolerated']).toEqual(
      expect.arrayContaining(['Storage object already absent (404)'])
    );
    expect(exitCode).toBe(0);
  });

  it.each([
    [
      'bucket creation',
      (w: ReturnType<typeof world>) => w.dev.reject.set('POST /storage/v1/bucket', 500)
    ],
    [
      'object upload',
      (w: ReturnType<typeof world>) => w.dev.reject.set('POST /storage/v1/object', 500)
    ],
    [
      'product notification insert',
      (w: ReturnType<typeof world>) => {
        w.dev.failSql = 'insert into public.notifications';
      }
    ],
    [
      'community insert',
      (w: ReturnType<typeof world>) => {
        w.dev.product.state.failSql = 'insert into public.communities';
      }
    ],
    [
      'event insert after photo upload',
      (w: ReturnType<typeof world>) => {
        w.dev.product.state.failSql = 'insert into public.match_events';
      }
    ],
    [
      'proposal version insert',
      (w: ReturnType<typeof world>) => {
        w.dev.product.state.failSql = 'insert into public.match_event_result_proposal_versions';
      }
    ]
  ])('removes everything already created when setup fails at %s', async (_step, inject) => {
    const w = world();
    inject(w);
    const opts = options(w);
    const { report, exitCode } = await runIsolationProof(opts);

    expect(exitCode).toBe(3);
    expect(report.checks.find((check) => check.name === 'proof-execution')?.ok).toBe(false);
    expect(report.checks.find((check) => check.name === 'cleanup-of-owned-fixtures')?.ok).toBe(
      true
    );
    expect(opts.spawnCommand).not.toHaveBeenCalled();
    expect(w.dev.schemas.size).toBe(0);
    expect(w.dev.users.size).toBe(0);
    expect(w.dev.buckets.size).toBe(0);
    expect(w.dev.notifications.size).toBe(0);
    expect(w.dev.product.state.communities).toHaveLength(0);
    expect(w.dev.product.state.events).toHaveLength(0);
    expect(w.dev.product.state.photos.size).toBe(0);
  });

  it.each(['events', 'photos', 'proposals', 'versions'] as const)(
    'fails survival when real product %s disappear despite intact private markers',
    async (kind) => {
      const w = world();
      const { report, exitCode } = await runIsolationProof(
        options(w, {
          spawnCommand: async () => {
            if (kind === 'photos') w.dev.product.state.photos.clear();
            else w.dev.product.state[kind].pop();
            return { code: 0, signal: null };
          }
        })
      );
      expect(exitCode).toBe(3);
      expect(report.checks.find((check) => check.name === 'dev-markers-survived')?.ok).toBe(false);
    }
  );

  it('surfaces a cleanup transaction error and restores all guards', async () => {
    const w = world();
    const { report, exitCode } = await runIsolationProof(
      options(w, {
        spawnCommand: async () => {
          w.dev.product.state.failSql = 'delete from public.match_event_result_proposals';
          return { code: 0, signal: null };
        }
      })
    );
    expect(exitCode).toBe(3);
    expect(report.checks.find((check) => check.name === 'cleanup-of-owned-fixtures')?.ok).toBe(
      false
    );
    expect([...w.dev.product.state.guards.values()].every((state) => state === 'O')).toBe(true);
  });

  it('cleans registered photos after an ambiguous partial upload failure', async () => {
    const w = world();
    const original = w.fetchImpl.getMockImplementation()!;
    let uploaded = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const response = await original(input, init);
      if (
        init?.method === 'POST' &&
        (input instanceof Request ? input.url : String(input)).includes(
          '/storage/v1/object/match-event-photos/'
        ) &&
        ++uploaded === 3
      )
        throw new Error('ambiguous upload failure');
      return response;
    };
    const { report, exitCode } = await runIsolationProof(options(w, { fetchImpl }));
    expect(exitCode).toBe(3);
    expect(w.dev.product.state.photos.size).toBe(0);
    expect(w.dev.product.state.events).toHaveLength(0);
    expect(w.dev.product.state.communities).toHaveLength(0);
    expect(w.dev.users.size).toBe(0);
    expect(report.checks.find((check) => check.name === 'cleanup-of-owned-fixtures')?.ok).toBe(
      true
    );
  });

  it('writes a real product notification for the proof user, absent from test and removed afterwards', async () => {
    const w = world();
    const seen: number[] = [];
    const opts = options(w, {
      spawnCommand: async () => {
        seen.push(w.dev.notifications.size);
        return { code: 0, signal: null };
      }
    });
    const { report } = await runIsolationProof(opts);

    expect(seen).toEqual([1]);
    expect(w.sqlLog.some((sql) => sql.startsWith('insert into public.notifications'))).toBe(true);
    expect(w.test.notifications.size).toBe(0);
    expect(w.dev.notifications.size).toBe(0);
    expect(report.isolationOk).toBe(true);
  });

  describe('live browser and SSR evidence', () => {
    const verdict = async (live: unknown) => {
      const w = world();
      const liveProbe = vi.fn<(...args: unknown[]) => Promise<unknown>>(async () => live);
      const run = await runIsolationProof(options(w, { liveProbe }));
      return { w, liveProbe, ...run };
    };
    const check = (report: Awaited<ReturnType<typeof runIsolationProof>>['report']) =>
      report.checks.find((c) => c.name === 'browser-and-ssr-target-test-api');

    it('passes only when the browser hit the test API alone and the SSR token verified there', async () => {
      const { report, liveProbe } = await verdict(goodLive());
      expect(check(report)?.ok).toBe(true);
      expect(check(report)?.evidence).toMatchObject({
        browserRequestHosts: ['127.0.0.1:55421'],
        browserLoginSucceeded: true,
        ssrTestTokenAccepted: true,
        ssrSessionCookieSet: true
      });
      expect(liveProbe).toHaveBeenCalledTimes(1);
    });

    it.each([
      [
        'a dev-API browser request',
        {
          ...goodLive(),
          browser: { requestHosts: ['127.0.0.1:55421', '127.0.0.1:55321'], loginSucceeded: true }
        }
      ],
      [
        'no browser request',
        { ...goodLive(), browser: { requestHosts: [], loginSucceeded: true } }
      ],
      [
        'a failed browser login',
        { ...goodLive(), browser: { requestHosts: ['127.0.0.1:55421'], loginSucceeded: false } }
      ],
      [
        'a rejected SSR token',
        { ...goodLive(), ssr: { tokenAccepted: false, sessionCookieSet: false } }
      ],
      [
        'a missing SSR session cookie',
        { ...goodLive(), ssr: { tokenAccepted: true, sessionCookieSet: false } }
      ]
    ])('fails on %s', async (_label, live) => {
      const { report, exitCode } = await verdict(live);
      expect(check(report)?.ok).toBe(false);
      expect(exitCode).toBe(3);
    });

    it('records a probe crash as a reason-only failure and still cleans up', async () => {
      const w = world();
      const { report, exitCode } = await runIsolationProof(
        options(w, {
          liveProbe: async () => {
            throw new Error('preview did not become reachable');
          }
        })
      );
      expect(exitCode).toBe(3);
      expect(report.checks.find((c) => c.name === 'proof-execution')?.evidence['reason']).toContain(
        'preview did not become reachable'
      );
      expect(w.test.users.size).toBe(0);
      expect(w.dev.users.size).toBe(0);
    });

    it('hands the probe proof-owned credentials but never prints them', async () => {
      const w = world();
      const liveProbe = vi.fn<
        (probe: {
          login: { email: string; password: string };
          inviteHash: string;
        }) => Promise<ReturnType<typeof goodLive>>
      >(async () => goodLive());
      const lines: string[] = [];
      const { report } = await runIsolationProof(
        options(w, { liveProbe, log: (line: string) => lines.push(line) })
      );
      const args = liveProbe.mock.calls[0]![0];
      expect(args.login.password.length).toBeGreaterThan(10);
      expect(args.inviteHash).toBe('fake-hashed-token');
      const output = lines.join('\n') + JSON.stringify(report);
      expect(output).not.toContain(args.login.password);
      expect(output).not.toContain(args.inviteHash);
    });
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
