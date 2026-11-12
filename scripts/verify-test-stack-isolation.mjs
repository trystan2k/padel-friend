import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import { TEST_ENV_NAMES, TEST_REPO_ROOT, resolveTestStackEnv } from './test-stack-env.mjs';
import { parseSimpleToml, sanitize } from './test-stack.mjs';

// Opt-in proof that the TEST stack is isolated from the developer stack:
//   node scripts/verify-test-stack-isolation.mjs pnpm complete-check
// It creates uniquely named marker fixtures in the DEV stack (a valid Auth user, a private proof schema
// holding 60 due-event rows plus representative proposal/notification rows, and one Storage object),
// snapshots their hashes, runs the supplied command serially, then proves the dev markers survived, the
// test stack never saw them, a concurrent dev write succeeded while the command ran, and test mail, Auth
// and SQL traffic stayed on the test endpoints. The helper alone addresses dev, only to create and remove
// the rows/objects it owns; it never resets, stops or reconfigures either stack. Evidence is
// credential-free: hashes, counts, ports and booleans only.
//
// The proof schema is used instead of product tables on purpose: product row lifecycles (cron sweeps,
// immutability triggers, auto-confirm) mutate live dev business rows, which would make the preservation
// oracle flaky. The marker/user/object identities are immutable, so they are the oracle.

export const DEV_PROJECT_ID = 'padel-friend';
export const DEV_PORTS = { api: '55321', db: '55322', mail: '55324' };
export const DUE_EVENT_COUNT = 60;
const PROOF_ID = /^[0-9a-f]{8}$/;
const HEARTBEAT_MS = 5000;

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export class IsolationProofError extends Error {
  constructor(message) {
    super(message);
    this.name = 'IsolationProofError';
  }
}

function endpoint(name, value, { protocols, port, database }) {
  let url;
  try {
    url = new URL(value ?? '');
  } catch {
    throw new IsolationProofError(name + ' is missing or invalid');
  }
  if (!protocols.includes(url.protocol) || !['127.0.0.1', 'localhost'].includes(url.hostname))
    throw new IsolationProofError(name + ' must be a loopback endpoint');
  if (url.port !== port) throw new IsolationProofError(name + ' must target port ' + port);
  if (database && url.pathname !== '/' + database)
    throw new IsolationProofError(name + ' must target the ' + database + ' database');
  return url;
}

/** Dev tuple from read-only `status` on the root project, validated against the dev identity. */
export function devEnvFromStatus(stdout) {
  const status = parseEnv(stdout);
  endpoint('dev API_URL', status.API_URL, { protocols: ['http:'], port: DEV_PORTS.api });
  endpoint('dev DB_URL', status.DB_URL, {
    protocols: ['postgres:', 'postgresql:'],
    port: DEV_PORTS.db,
    database: 'postgres'
  });
  endpoint('dev MAILPIT_URL', status.MAILPIT_URL, { protocols: ['http:'], port: DEV_PORTS.mail });
  if (!status.SERVICE_ROLE_KEY) throw new IsolationProofError('dev SERVICE_ROLE_KEY is missing');
  return {
    apiUrl: status.API_URL,
    dbUrl: status.DB_URL,
    mailUrl: status.MAILPIT_URL,
    serviceKey: status.SERVICE_ROLE_KEY
  };
}

/** Both expected local project identities must be configured as documented before anything is touched. */
export function assertProjectIdentities(devConfig, testConfig) {
  if (devConfig.project_id !== DEV_PROJECT_ID || devConfig['api.port'] !== Number(DEV_PORTS.api))
    throw new IsolationProofError('dev project identity is not the expected padel-friend stack');
  if (testConfig.project_id !== 'padel-friend-test' || testConfig['api.port'] !== 55421)
    throw new IsolationProofError(
      'test project identity is not the expected padel-friend-test stack'
    );
}

function resolveDev(exec) {
  let output;
  try {
    output = exec(
      'pnpm',
      ['exec', 'supabase', '--workdir', TEST_REPO_ROOT, 'status', '-o', 'env'],
      {
        cwd: TEST_REPO_ROOT,
        encoding: 'utf8',
        timeout: 20_000,
        maxBuffer: 1024 * 1024,
        stdio: ['ignore', 'pipe', 'pipe']
      }
    );
  } catch {
    throw new IsolationProofError('Dev stack is not running. Run pnpm db:start first.');
  }
  return devEnvFromStatus(output);
}

function validateProofId(id) {
  if (!PROOF_ID.test(id)) throw new IsolationProofError('invalid proof id');
  return id;
}

// Identifier safe by construction: PROOF_ID is 8 lowercase hex digits.
const schemaName = (id) => 'isolation_proof_' + validateProofId(id);
const bucketName = (id) => 'isolation-proof-' + validateProofId(id);
const emailFor = (id, side) =>
  'isolation-proof-' + side + '-' + validateProofId(id) + '@isolation-proof.local';

async function connect(url) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000
  });
  await client.connect();
  return client;
}

function api(base, serviceKey, fetchImpl) {
  const headers = { apikey: serviceKey, authorization: 'Bearer ' + serviceKey };
  const call = async (method, route, body, extra = {}) => {
    const response = await fetchImpl(base + route, {
      method,
      headers: {
        ...headers,
        ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...extra
      },
      body:
        body === undefined
          ? undefined
          : typeof body === 'string' || body instanceof Uint8Array
            ? body
            : JSON.stringify(body)
    });
    return response;
  };
  return {
    async createUser(email) {
      const response = await call('POST', '/auth/v1/admin/users', {
        email,
        password: randomBytes(18).toString('base64url'),
        email_confirm: true
      });
      if (!response.ok)
        throw new IsolationProofError('Auth user creation failed (' + response.status + ')');
      return (await response.json()).id;
    },
    async findUserId(email) {
      for (let page = 1; page <= 5; page += 1) {
        const response = await call('GET', '/auth/v1/admin/users?page=' + page + '&per_page=200');
        if (!response.ok)
          throw new IsolationProofError('Auth user listing failed (' + response.status + ')');
        const { users = [] } = await response.json();
        const found = users.find((user) => user.email === email);
        if (found) return found.id;
        if (users.length < 200) return undefined;
      }
      return undefined;
    },
    async userExists(email) {
      return (await this.findUserId(email)) !== undefined;
    },
    async deleteUser(id) {
      await call('DELETE', '/auth/v1/admin/users/' + encodeURIComponent(id));
    },
    async invite(email) {
      const response = await call('POST', '/auth/v1/invite', { email });
      if (!response.ok)
        throw new IsolationProofError('Auth invite failed (' + response.status + ')');
    },
    async createBucket(name) {
      const response = await call('POST', '/storage/v1/bucket', { id: name, name, public: false });
      if (!response.ok)
        throw new IsolationProofError('Storage bucket creation failed (' + response.status + ')');
    },
    async putObject(bucket, name, content) {
      const response = await call('POST', '/storage/v1/object/' + bucket + '/' + name, content, {
        'content-type': 'text/plain'
      });
      if (!response.ok)
        throw new IsolationProofError('Storage upload failed (' + response.status + ')');
    },
    async objectHash(bucket, name) {
      const response = await call('GET', '/storage/v1/object/' + bucket + '/' + name);
      return response.ok ? sha256(Buffer.from(await response.arrayBuffer())) : null;
    },
    async bucketExists(name) {
      const response = await call('GET', '/storage/v1/bucket/' + name);
      return response.ok;
    },
    async deleteObject(bucket, name) {
      await call('DELETE', '/storage/v1/object/' + bucket + '/' + name);
    },
    async deleteBucket(name) {
      await call('DELETE', '/storage/v1/bucket/' + name);
    }
  };
}

async function mailCount(mailUrl, email, fetchImpl) {
  const response = await fetchImpl(
    mailUrl + '/api/v1/search?query=' + encodeURIComponent('to:"' + email + '"')
  );
  if (!response.ok)
    throw new IsolationProofError('Mailpit search failed (' + response.status + ')');
  return Number((await response.json()).messages_count ?? 0);
}

async function createDevFixtures({ db, devApi, id, token }) {
  const schema = schemaName(id);
  const email = emailFor(id, 'dev');
  const bucket = bucketName(id);
  const objectName = 'marker.txt';
  const content = 'isolation-proof-' + id;
  const userId = await devApi.createUser(email);
  await db.query('begin');
  try {
    await db.query('create schema "' + schema + '"');
    await db.query('create table "' + schema + '".owner (token text primary key)');
    await db.query(
      'create table "' +
        schema +
        '".due_events (id int primary key, due_at timestamptz not null, label text not null)'
    );
    await db.query(
      'create table "' +
        schema +
        '".proposals (id int primary key, status text not null, event_id int not null)'
    );
    await db.query(
      'create table "' +
        schema +
        '".notifications (id int primary key, recipient uuid not null, kind text not null)'
    );
    await db.query(
      'create table "' +
        schema +
        '".heartbeat (n serial primary key, at timestamptz not null default now())'
    );
    await db.query('insert into "' + schema + '".owner values ($1)', [token]);
    await db.query(
      'insert into "' +
        schema +
        "\".due_events select g, now() - interval '1 hour', 'due-' || g from generate_series(1, $1::int) g",
      [DUE_EVENT_COUNT]
    );
    await db.query('insert into "' + schema + "\".proposals values (1, 'pending', 1)");
    await db.query(
      'insert into "' + schema + "\".notifications values (1, $1::uuid, 'proposal_review')",
      [userId]
    );
    await db.query('commit');
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    await devApi.deleteUser(userId).catch(() => undefined);
    throw error;
  }
  await devApi.createBucket(bucket);
  await devApi.putObject(bucket, objectName, content);
  return { schema, email, userId, bucket, objectName };
}

/** Immutable-identity snapshot: hashes and counts only, never row values. */
async function snapshotDev({ db, devApi, fixtures, token }) {
  const { schema } = fixtures;
  const rows = async (table, order) =>
    (await db.query('select * from "' + schema + '".' + table + ' order by ' + order)).rows;
  const due = await rows('due_events', 'id');
  const proposals = await rows('proposals', 'id');
  const notifications = await rows('notifications', 'id');
  const owner = await rows('owner', 'token');
  return {
    dueCount: due.length,
    dueHash: sha256(JSON.stringify(due)),
    proposalHash: sha256(JSON.stringify(proposals)),
    notificationHash: sha256(JSON.stringify(notifications)),
    ownerIntact: owner.length === 1 && owner[0].token === token,
    userPresent: await devApi.userExists(fixtures.email),
    objectHash: await devApi.objectHash(fixtures.bucket, fixtures.objectName)
  };
}

async function absentFromTest({ testDb, testApi, fixtures }) {
  const namespace = await testDb.query('select to_regnamespace($1) is not null as present', [
    fixtures.schema
  ]);
  return {
    schemaAbsent: !namespace.rows[0].present,
    userAbsent: !(await testApi.userExists(fixtures.email)),
    bucketAbsent: !(await testApi.bucketExists(fixtures.bucket))
  };
}

function artifactEvidence({
  testApiUrl,
  devApiUrl,
  testKey,
  dist = 'dist',
  fs = { existsSync, readFileSync, readdirSync }
}) {
  const clientDir = path.join(dist, 'client');
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const next = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(next);
      else if (/\.(js|html)$/.test(entry.name)) files.push(next);
    }
  };
  if (!fs.existsSync(clientDir)) return { present: false };
  walk(clientDir);
  const hostOf = (url) => new URL(url).host;
  let testHits = 0;
  let devHits = 0;
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    if (text.includes(hostOf(testApiUrl))) testHits += 1;
    if (text.includes(hostOf(devApiUrl))) devHits += 1;
  }
  const devVars = path.join(dist, 'server/.dev.vars');
  const key = fs.existsSync(devVars)
    ? /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m
        .exec(fs.readFileSync(devVars, 'utf8'))?.[1]
        ?.trim()
        .replace(/^"(.*)"$/, '$1')
    : undefined;
  return {
    present: true,
    clientFilesWithTestApi: testHits,
    clientFilesWithDevApi: devHits,
    serverBindingMatchesTestKey: key !== undefined && sha256(key) === sha256(testKey)
  };
}

const defaultSpawn = (argv, env) =>
  new Promise((resolve) => {
    const [command, ...args] = argv;
    const child = spawn(command, args, { stdio: 'inherit', env });
    child.once('error', () => resolve({ code: 127, signal: null }));
    child.once('close', (code, signal) => resolve({ code, signal }));
  });

/**
 * Runs the proof around argv. Resolves to a credential-free report and the process exit code:
 * 3 when isolation failed (takes priority), otherwise the command's own exit code. The command exit
 * and the isolation verdict are always recorded separately.
 */
export async function runIsolationProof({
  argv,
  env = process.env,
  exec = execFileSync,
  fetchImpl = fetch,
  connectDb = connect,
  spawnCommand = defaultSpawn,
  readConfigs = () => ({
    dev: parseSimpleToml(readFileSync(path.join(TEST_REPO_ROOT, 'supabase/config.toml'), 'utf8')),
    test: parseSimpleToml(
      readFileSync(path.join(TEST_REPO_ROOT, 'test/stack/supabase/config.toml'), 'utf8')
    )
  }),
  artifacts = artifactEvidence,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  heartbeatMs = HEARTBEAT_MS,
  proofId = randomBytes(4).toString('hex'),
  log = (line) => process.stdout.write(line + '\n')
}) {
  if (argv.length === 0)
    throw new IsolationProofError(
      'Usage: node scripts/verify-test-stack-isolation.mjs <command> [args...]'
    );
  validateProofId(proofId);
  const configs = readConfigs();
  assertProjectIdentities(configs.dev, configs.test);
  const dev = resolveDev(exec);
  const test = resolveTestStackEnv(exec);
  const token = randomBytes(12).toString('hex');
  const checks = [];
  const record = (name, ok, evidence = {}) => checks.push({ name, ok, evidence });
  const devApi = api(dev.apiUrl, dev.serviceKey, fetchImpl);
  const testApi = api(test.VITE_SUPABASE_URL, test.SUPABASE_SERVICE_ROLE_KEY, fetchImpl);
  let devDb;
  let testDb;
  let fixtures;
  let before;
  let commandResult = { code: null, signal: null };
  let testUser;
  const cleanupErrors = [];
  try {
    devDb = await connectDb(dev.dbUrl);
    testDb = await connectDb(test.DATABASE_URL);
    const identity = async (db) =>
      (
        await db.query(
          'select (select system_identifier::text from pg_control_system()) as sid, current_database() as db, inet_server_port() as port'
        )
      ).rows[0];
    const [devIdentity, testIdentity] = [await identity(devDb), await identity(testDb)];
    record(
      'distinct-database-clusters',
      devIdentity.sid !== testIdentity.sid && testIdentity.db === 'postgres',
      {
        devEndpoint: '127.0.0.1:' + DEV_PORTS.db,
        testEndpoint: '127.0.0.1:' + new URL(test.DATABASE_URL).port,
        testServerPort: testIdentity.port
      }
    );
    fixtures = await createDevFixtures({ db: devDb, devApi, id: proofId, token });
    before = await snapshotDev({ db: devDb, devApi, fixtures, token });
    record(
      'dev-fixtures-valid',
      before.dueCount === DUE_EVENT_COUNT &&
        before.userPresent &&
        before.objectHash !== null &&
        before.ownerIntact,
      {
        dueCount: before.dueCount
      }
    );
    const presentBefore = await absentFromTest({ testDb, testApi, fixtures });
    record(
      'dev-fixtures-absent-from-test-before',
      Object.values(presentBefore).every(Boolean),
      presentBefore
    );

    log('[isolation] running: ' + argv[0] + ' (' + (argv.length - 1) + ' args)');
    const childEnv = { ...env };
    for (const name of TEST_ENV_NAMES) delete childEnv[name];
    let beats = 0;
    let beatFailures = 0;
    const beat = async () => {
      try {
        await devDb.query('insert into "' + fixtures.schema + '".heartbeat default values');
        beats += 1;
      } catch {
        beatFailures += 1;
      }
    };
    const running = spawnCommand(argv, childEnv);
    const state = { settled: false };
    const finished = running.then((result) => {
      state.settled = true;
      return result;
    });
    await beat();
    while (!state.settled) {
      await Promise.race([finished, sleep(heartbeatMs)]);
      if (!state.settled) await beat();
    }
    commandResult = await finished;
    record('concurrent-dev-write', beats >= 1 && beatFailures === 0, {
      successfulWrites: beats,
      failedWrites: beatFailures
    });

    const after = await snapshotDev({ db: devDb, devApi, fixtures, token });
    record(
      'dev-markers-survived',
      after.dueCount === before.dueCount &&
        after.dueHash === before.dueHash &&
        after.proposalHash === before.proposalHash &&
        after.notificationHash === before.notificationHash &&
        after.ownerIntact &&
        after.userPresent &&
        after.objectHash === before.objectHash,
      {
        dueCount: after.dueCount,
        objectHashEqual: after.objectHash === before.objectHash,
        userPresent: after.userPresent
      }
    );
    const presentAfter = await absentFromTest({ testDb, testApi, fixtures });
    record(
      'dev-fixtures-absent-from-test-after',
      Object.values(presentAfter).every(Boolean),
      presentAfter
    );

    // An invite creates the test user AND sends mail through the test stack's SMTP (Mailpit).
    const testEmail = emailFor(proofId, 'test');
    await testApi.invite(testEmail);
    testUser = { email: testEmail, id: await testApi.findUserId(testEmail) };
    record('test-user-absent-from-dev', !(await devApi.userExists(testEmail)), {});
    let inTestMail = 0;
    for (let attempt = 0; attempt < 10 && inTestMail === 0; attempt += 1) {
      inTestMail = await mailCount(test.MAILPIT_URL, testUser.email, fetchImpl);
      if (inTestMail === 0) await sleep(500);
    }
    const inDevMail = await mailCount(dev.mailUrl, testUser.email, fetchImpl);
    record('test-mail-isolated', inTestMail > 0 && inDevMail === 0, {
      testMailpit: '127.0.0.1:' + new URL(test.MAILPIT_URL).port,
      messagesInTest: inTestMail,
      messagesInDev: inDevMail
    });
    const evidence = artifacts({
      testApiUrl: test.VITE_SUPABASE_URL,
      devApiUrl: dev.apiUrl,
      testKey: test.SUPABASE_SERVICE_ROLE_KEY
    });
    record(
      'browser-and-ssr-target-test-api',
      evidence.present &&
        evidence.clientFilesWithTestApi > 0 &&
        evidence.clientFilesWithDevApi === 0 &&
        evidence.serverBindingMatchesTestKey,
      evidence
    );
  } catch (error) {
    record('proof-execution', false, {
      reason: sanitize(error instanceof Error ? error.message : String(error))
    });
  } finally {
    // Remove only what this run owns; every step is attempted and its failure recorded.
    const attempt = async (label, task) => {
      try {
        await task();
      } catch (error) {
        cleanupErrors.push(
          label + ': ' + sanitize(error instanceof Error ? error.message : String(error))
        );
      }
    };
    if (testUser?.id) await attempt('test user', () => testApi.deleteUser(testUser.id));
    if (fixtures) {
      await attempt('dev object', () => devApi.deleteObject(fixtures.bucket, fixtures.objectName));
      await attempt('dev bucket', () => devApi.deleteBucket(fixtures.bucket));
      await attempt('dev user', () => devApi.deleteUser(fixtures.userId));
      await attempt('dev proof schema', async () => {
        const owner = await devDb.query('select token from "' + fixtures.schema + '".owner');
        if (owner.rows[0]?.token === token)
          await devDb.query('drop schema "' + fixtures.schema + '" cascade');
      });
    }
    if (devDb) await attempt('dev connection', () => devDb.end());
    if (testDb) await attempt('test connection', () => testDb.end());
  }
  record('cleanup-of-owned-fixtures', cleanupErrors.length === 0, { errors: cleanupErrors });
  const isolationOk = checks.every((check) => check.ok);
  const commandExit =
    commandResult.code === null && commandResult.signal === null ? null : (commandResult.code ?? 1);
  const report = {
    commandExit,
    isolationOk,
    targets: {
      testApi: new URL(test.VITE_SUPABASE_URL).host,
      testDatabase: new URL(test.DATABASE_URL).host,
      testMailpit: new URL(test.MAILPIT_URL).host
    },
    checks
  };
  log(JSON.stringify(report, null, 2));
  return { report, exitCode: isolationOk ? (commandExit ?? 1) : 3 };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runIsolationProof({ argv: process.argv.slice(2) }).then(
    ({ exitCode }) => {
      process.exitCode = exitCode;
    },
    (error) => {
      console.error(
        error instanceof IsolationProofError
          ? error.message
          : 'Isolation proof failed: ' + sanitize(error.message)
      );
      process.exitCode = 2;
    }
  );
}
