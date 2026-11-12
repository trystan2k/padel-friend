import { execFileSync, spawn } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { createServer } from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import pg from 'pg';
import {
  DUE_EVENT_COUNT,
  PHOTO_BUCKET,
  productOwnership,
  insertProductFixtures,
  productAbsent,
  removeProductFixtures,
  snapshotProduct
} from './isolation-proof-product-fixtures.mjs';
import {
  TEST_ENV_NAMES,
  TEST_REPO_ROOT,
  readDevVarsValue,
  resolveTestStackEnv
} from './test-stack-env.mjs';
import { parseSimpleToml, sanitize } from './test-stack.mjs';

// Opt-in proof that the TEST stack is isolated from the developer stack:
//   node scripts/verify-test-stack-isolation.mjs pnpm complete-check
// It creates uniquely named marker fixtures in the DEV stack (a valid Auth user, a private proof schema
// holding 60 due-event rows plus representative proposal rows, a proof-owned REAL product community with
// 60 due match events (each with its photo object), one pending result proposal and a product notification
// row, and one Storage object), snapshots their hashes, runs the supplied command serially, then proves
// the dev markers survived, the test stack never saw them, a concurrent dev write succeeded while the
// command ran, test mail, Auth and SQL traffic stayed on the test endpoints, and a live browser login
// plus an SSR-side Auth read through the built preview hit only the test API. The helper alone addresses
// dev, only to create and remove the rows/objects it owns; it never resets, stops or reconfigures either
// stack. Evidence is credential-free: hashes, counts, host:port pairs and booleans only.
//
// Real product rows (scripts/isolation-proof-product-fixtures.mjs) reproduce the scan pressure schedulers
// see. Their lifecycle (dev cron sweeps) may mutate business fields, so the oracle is their immutable
// identity (ids, ownership, photo keys) plus the private proof schema's markers and the Auth/Storage
// objects. Product match history is immutable by design, so its removal uses the scoped, single-
// transaction guard-trigger pattern documented in that module, verified afterwards.
// Cleanup trigger DDL takes ACCESS EXCLUSIVE (normally seconds); concurrent dev reads and writes stall.

export const DEV_PROJECT_ID = 'padel-friend';
export const DEV_PORTS = { api: '55321', db: '55322', mail: '55324' };
export { DUE_EVENT_COUNT };
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
const bucketName = (id, token) => 'isolation-proof-' + validateProofId(id) + '-' + token;
const PRODUCT_EVENT_KEY = (id) => 'isolation-proof-' + validateProofId(id);
const emailFor = (id, side, token) =>
  'isolation-proof-' + side + '-' + validateProofId(id) + '-' + token + '@isolation-proof.local';

async function connect(url, onError = () => undefined) {
  const client = new pg.Client({
    connectionString: url,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 20_000
  });
  // pg emits idle connection failures outside query promises (e.g. a destructive reset).
  // Install before connect, including failures during connection establishment.
  client.on('error', (error) => {
    onError(error);
    void client.end().catch(() => undefined);
  });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => undefined);
    throw error;
  }
}

const USERS_PER_PAGE = 200;

// A delete only counts when the server accepted it. 404 means the resource is already gone, which is
// the desired end state and is recorded with its reason; any other non-2xx response is a rejection.
function removal(label, response) {
  if (response.ok) return { removed: true };
  if (response.status === 404) return { removed: false, reason: label + ' already absent (404)' };
  throw new IsolationProofError(label + ' deletion rejected (' + response.status + ')');
}

function api(base, serviceKey, fetchImpl, secrets) {
  const ownedUsers = new Set();
  const objectAbsenceReasons = new Set();
  const userAbsenceReasons = new Set();
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
    ownedUsers,
    objectAbsenceReasons,
    userAbsenceReasons,
    async registerUser(email) {
      secrets.add(email);
      if (await this.findUserId(email))
        throw new IsolationProofError('Proof Auth identity already exists; refusing ownership');
      // Token-qualified identity registered BEFORE HTTP: reconcile even a lost response.
      ownedUsers.add(email);
    },
    async createUser(email, password = randomBytes(18).toString('base64url')) {
      secrets.add(password);
      await this.registerUser(email);
      const response = await call('POST', '/auth/v1/admin/users', {
        email,
        password,
        email_confirm: true
      });
      if (!response.ok)
        throw new IsolationProofError('Auth user creation failed (' + response.status + ')');
      return (await response.json()).id;
    },
    // Walks every page until the listing is exhausted (arbitrary dev data must not truncate the check).
    async findUserId(email) {
      let previousFirstId;
      for (let page = 1; ; page += 1) {
        const response = await call(
          'GET',
          '/auth/v1/admin/users?page=' + page + '&per_page=' + USERS_PER_PAGE
        );
        if (!response.ok)
          throw new IsolationProofError('Auth user listing failed (' + response.status + ')');
        const { users = [] } = await response.json();
        const found = users.find((user) => user.email === email);
        if (found) return found.id;
        if (users.length < USERS_PER_PAGE) return undefined;
        if (users[0]?.id === previousFirstId)
          throw new IsolationProofError('Auth user listing did not advance between pages');
        previousFirstId = users[0]?.id;
      }
    },
    async userExists(email) {
      return (await this.findUserId(email)) !== undefined;
    },
    /** Presence by known id: one request, independent of how many other users exist. */
    async userExistsById(id) {
      const response = await call('GET', '/auth/v1/admin/users/' + encodeURIComponent(id));
      if (response.ok) return true;
      if (response.status === 404) {
        userAbsenceReasons.add('Auth user absent (404)');
        return false;
      }
      throw new IsolationProofError('Auth user lookup failed (' + response.status + ')');
    },
    async deleteUser(id) {
      return removal(
        'Auth user',
        await call('DELETE', '/auth/v1/admin/users/' + encodeURIComponent(id))
      );
    },
    /** Invite-type link for a new user on this stack: the one-time token only verifies here. */
    async generateInviteLink(email) {
      await this.registerUser(email);
      const response = await call('POST', '/auth/v1/admin/generate_link', {
        type: 'invite',
        email
      });
      if (!response.ok)
        throw new IsolationProofError('Auth link generation failed (' + response.status + ')');
      const { id, hashed_token: hashedToken } = await response.json();
      if (!id || !hashedToken) throw new IsolationProofError('Auth link generation was incomplete');
      return { id, hashedToken };
    },
    async invite(email) {
      await this.registerUser(email);
      const response = await call('POST', '/auth/v1/invite', { email });
      if (!response.ok)
        throw new IsolationProofError('Auth invite failed (' + response.status + ')');
    },
    async createBucket(name) {
      return call('POST', '/storage/v1/bucket', { id: name, name, public: false });
    },
    async putObject(bucket, name, content, contentType = 'text/plain') {
      const response = await call('POST', '/storage/v1/object/' + bucket + '/' + name, content, {
        'content-type': contentType
      });
      if (!response.ok)
        throw new IsolationProofError('Storage upload failed (' + response.status + ')');
    },
    async objectHash(bucket, name) {
      const response = await call('GET', '/storage/v1/object/' + bucket + '/' + name);
      if (response.ok) return sha256(Buffer.from(await response.arrayBuffer()));
      if (response.status === 404) {
        objectAbsenceReasons.add('Storage object absent (404)');
        return null;
      }
      if (response.status === 400) {
        // Storage versions return 400 with statusCode=404 for a missing object.
        const body = await response.json().catch(() => null);
        if (String(body?.statusCode) === '404') {
          objectAbsenceReasons.add('Storage object absent (400 with statusCode=404)');
          return null;
        }
      }
      throw new IsolationProofError('Storage read failed (' + response.status + ')');
    },
    async rowsAbsent(table, column, ids) {
      const response = await call(
        'GET',
        '/rest/v1/' +
          table +
          '?select=' +
          column +
          '&' +
          column +
          '=in.(' +
          ids.map(encodeURIComponent).join(',') +
          ')'
      );
      if (!response.ok)
        throw new IsolationProofError('Product API lookup failed (' + response.status + ')');
      return (await response.json()).length === 0;
    },
    async bucketExists(name) {
      const response = await call('GET', '/storage/v1/bucket/' + name);
      if (response.ok) return { present: true, name: (await response.json()).name };
      if (response.status === 404) return { present: false, reason: 'Storage bucket absent (404)' };
      if (response.status === 400) {
        const body = await response.json().catch(() => null);
        if (String(body?.statusCode) === '404')
          return { present: false, reason: 'Storage bucket absent (400 with statusCode=404)' };
      }
      throw new IsolationProofError('Storage bucket lookup failed (' + response.status + ')');
    },
    async deleteObject(bucket, name) {
      return removal(
        'Storage object',
        await call('DELETE', '/storage/v1/object/' + bucket, { prefixes: [name] })
      );
    },
    async deleteBucket(name) {
      return removal('Storage bucket', await call('DELETE', '/storage/v1/bucket/' + name));
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

/**
 * Creates the dev fixtures, registering each resource on `fixtures` the moment it exists (or, for remote
 * names that are unique by construction, just before the request that may create it), so the caller can
 * clean up exactly what was created whatever step fails.
 */
async function createDevFixtures({ db, devApi, id, token, fixtures }) {
  const schema = schemaName(id);
  const content = 'isolation-proof-' + id;
  const userId = await devApi.createUser(fixtures.email);
  fixtures.userId = userId;
  // Three more proof users complete the four-player teams of the pending result proposal.
  for (let player = 1; player <= 3; player += 1)
    fixtures.playerIds.push(await devApi.createUser(emailFor(id, 'dev-player' + player, token)));
  fixtures.product = productOwnership(id, [userId, ...fixtures.playerIds]);
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
    // Real product row owned by the proof user; it cascades away with the Auth user.
    await db.query(
      'insert into public.notifications (recipient_user_id, event_key, kind, category, target_type, target_id) values ($1::uuid, $2, $3, $4, $5, gen_random_uuid())',
      [userId, PRODUCT_EVENT_KEY(id), 'proposal_review', 'results', 'match_event']
    );
    const photo = readFileSync(
      new URL('../test/helpers/fixtures/venue-court.jpg', import.meta.url)
    );
    await insertProductFixtures(db, fixtures.product, (name) =>
      devApi.putObject(PHOTO_BUCKET, name, photo, 'image/jpeg')
    );
    fixtures.commitAmbiguous = true;
    await db.query('commit');
    fixtures.commitAmbiguous = false;
    fixtures.schema = schema;
    fixtures.product.committed = true;
  } catch (error) {
    await db.query('rollback').catch(() => undefined);
    throw error;
  }
  const bucket = bucketName(id, token);
  if ((await devApi.bucketExists(bucket)).present)
    throw new IsolationProofError('Proof Storage identity already exists; refusing ownership');
  fixtures.bucketCandidate = bucket;
  const created = await devApi.createBucket(bucket);
  if (!created.ok) {
    // Definitive rejection cannot grant ownership. Network/5xx/timeout outcomes remain ambiguous.
    if (created.status >= 400 && created.status < 500 && created.status !== 408)
      fixtures.bucketCandidate = undefined;
    throw new IsolationProofError('Storage bucket creation failed (' + created.status + ')');
  }
  fixtures.bucket = bucket;
  fixtures.objectName = 'marker.txt';
  await devApi.putObject(fixtures.bucket, fixtures.objectName, content);
}

async function productNotificationCount(db, proofKey) {
  const result = await db.query(
    'select count(*)::int as n from public.notifications where event_key = $1',
    [proofKey]
  );
  return Number(result.rows[0].n);
}

/** Immutable-identity snapshot: hashes and counts only, never row values. */
async function snapshotDev({ db, devApi, fixtures, token, proofKey }) {
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
    productNotificationPresent: (await productNotificationCount(db, proofKey)) === 1,
    product: await snapshotProduct(db, fixtures.product),
    photoHashes: await Promise.all(
      fixtures.product.photoPaths.map((name) => devApi.objectHash(PHOTO_BUCKET, name))
    ),
    userPresent: (
      await Promise.all(
        [fixtures.userId, ...fixtures.playerIds].map((id) => devApi.userExistsById(id))
      )
    ).every(Boolean),
    objectHash: await devApi.objectHash(fixtures.bucket, fixtures.objectName)
  };
}

async function absentFromTest({ testDb, testApi, fixtures, proofKey }) {
  const namespace = await testDb.query('select to_regnamespace($1) is not null as present', [
    fixtures.schema
  ]);
  const bucket = await testApi.bucketExists(fixtures.bucket);
  return {
    bucketAbsenceReason: bucket.reason,
    schemaAbsent: !namespace.rows[0].present,
    userAbsent: (
      await Promise.all(
        [fixtures.userId, ...fixtures.playerIds].map((id) => testApi.userExistsById(id))
      )
    ).every((present) => !present),
    userAbsenceReasons: [...testApi.userAbsenceReasons],
    bucketAbsent: !bucket.present,
    notificationAbsent: (await productNotificationCount(testDb, proofKey)) === 0,
    ...(await productAbsent(testDb, fixtures.product)),
    communityApiAbsent: await testApi.rowsAbsent('communities', 'id', [
      fixtures.product.communityId
    ]),
    eventsApiAbsent: await testApi.rowsAbsent('match_events', 'id', fixtures.product.eventIds),
    proposalsApiAbsent: await testApi.rowsAbsent(
      'match_event_result_proposals',
      'id',
      fixtures.product.proposalIds
    ),
    photosApiAbsent: (
      await Promise.all(
        fixtures.product.photoPaths.map((name) => testApi.objectHash(PHOTO_BUCKET, name))
      )
    ).every((hash) => hash === null),
    photoAbsenceReasons: [...testApi.objectAbsenceReasons]
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
    ? readDevVarsValue(fs.readFileSync(devVars, 'utf8'), 'SUPABASE_SERVICE_ROLE_KEY')
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

// pnpm -> Vite -> Wrangler may own the socket: require every listener to descend from our child.
// Missing process inspection tools fail closed, never treating an arbitrary HTTP response as ownership.
export function previewListenerOwned(port, childPid, exec = execFileSync) {
  if (!Number.isInteger(childPid) || childPid <= 1) return false;
  try {
    const options = { encoding: 'utf8', timeout: 2000, stdio: ['ignore', 'pipe', 'pipe'] };
    const listeners = exec('lsof', ['-nP', '-t', '-iTCP:' + port, '-sTCP:LISTEN'], options)
      .trim()
      .split(/\s+/)
      .map(Number);
    return (
      listeners.length > 0 &&
      listeners.every((pid) => {
        const seen = new Set();
        while (Number.isInteger(pid) && pid > 1 && !seen.has(pid)) {
          if (pid === childPid) return true;
          seen.add(pid);
          pid = Number(exec('ps', ['-o', 'ppid=', '-p', String(pid)], options).trim());
        }
        return false;
      })
    );
  } catch {
    return false;
  }
}

const PREVIEW_PORT = 4183;
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bind, not HTTP: any listener (including a non-HTTP socket) must refuse this port. */
export function assertPreviewPortAvailable(port, createServerImpl = createServer) {
  return new Promise((resolve, reject) => {
    const server = createServerImpl();
    server.once('error', () =>
      reject(
        new IsolationProofError(
          'probe port ' + port + ' is already in use or cannot bind; refusing to reuse it'
        )
      )
    );
    server.listen({ host: '127.0.0.1', port, exclusive: true }, () => {
      server.close((error) =>
        error ? reject(new IsolationProofError('probe port bind check could not close')) : resolve()
      );
    });
  });
}

/**
 * Live browser + SSR evidence against the built preview (run after the gate command, which leaves the
 * build in dist/). Starts its own preview on a dedicated port, drives a headless Chromium login with a
 * proof-owned test user and records the host:port of every Auth/PostgREST request the browser issued;
 * then presents a one-time invite token minted by the TEST API to the preview's server-side
 * /auth/callback, which only verifies when the server reads the test backend. Stops what it starts and
 * reports hosts and booleans only; credentials and tokens never leave this function.
 */
export async function defaultLiveProbe({
  login,
  inviteHash,
  fetchImpl = fetch,
  spawnImpl = spawn,
  loadPlaywright = () => import('@playwright/test'),
  checkPort = assertPreviewPortAvailable,
  checkOwner = previewListenerOwned,
  port = PREVIEW_PORT
}) {
  const base = 'http://127.0.0.1:' + port;
  const reachable = async () => {
    try {
      await fetchImpl(base + '/login', { redirect: 'manual', signal: AbortSignal.timeout(2000) });
      return true;
    } catch {
      return false;
    }
  };
  await checkPort(port);
  const preview = spawnImpl('pnpm', ['preview', '--port', String(port), '--host', '127.0.0.1'], {
    cwd: TEST_REPO_ROOT,
    stdio: 'ignore',
    detached: true
  });
  let failure;
  let closed = false;
  let fail;
  const failed = new Promise((resolve) => {
    fail = resolve;
  });
  const terminate = (reason) => {
    failure ??= reason;
    fail(failure);
  };
  let ready = false;
  const exitReason = () =>
    ready ? 'preview exited during probe' : 'preview exited before readiness';
  preview.once('error', () => terminate('preview launch failed'));
  preview.once('exit', () => terminate(exitReason()));
  const stopped = new Promise((resolve) =>
    preview.once('close', () => {
      closed = true;
      terminate(exitReason());
      resolve();
    })
  );
  const whileRunning = async (task) => {
    const result = await Promise.race([task, failed]);
    if (failure) throw new IsolationProofError(failure);
    return result;
  };
  try {
    let up = false;
    for (let attempt = 0; attempt < 120 && !up; attempt += 1) {
      up = await whileRunning(reachable());
      if (!up) await whileRunning(wait(500));
    }
    if (!up) throw new IsolationProofError('preview did not become reachable');
    if (!(await whileRunning(checkOwner(port, preview.pid))))
      throw new IsolationProofError('preview listener ownership mismatch');
    ready = true;

    const { chromium } = await whileRunning(loadPlaywright());
    let browser;
    let launchAbandoned = false;
    const launching = chromium.launch({ headless: true }).then(async (launched) => {
      if (launchAbandoned) {
        await launched.close();
        return undefined;
      }
      browser = launched;
      return launched;
    });
    try {
      await whileRunning(launching);
    } catch (error) {
      // The launch cannot be cancelled: close an already resolved browser or dispose it when late.
      launchAbandoned = true;
      if (browser) await browser.close();
      throw error;
    }
    const requestHosts = new Set();
    let loginSucceeded = false;
    try {
      const context = await whileRunning(browser.newContext());
      const page = await whileRunning(context.newPage());
      page.on('request', (request) => {
        const url = new URL(request.url());
        if (/^\/(auth|rest)\/v1\//.test(url.pathname)) requestHosts.add(url.host);
      });
      await whileRunning(page.goto(base + '/login'));
      await whileRunning(page.fill('input[name="email"]', login.email));
      await whileRunning(page.fill('input[name="password"]', login.password));
      const [response] = await whileRunning(
        Promise.all([
          page.waitForResponse((r) => r.url().includes('/auth/v1/token'), { timeout: 30_000 }),
          page.click('button[type="submit"]')
        ])
      );
      loginSucceeded = response.ok();
    } catch {
      // Playwright call logs echo fill arguments. Never propagate these raw errors.
      throw new IsolationProofError(failure ?? 'browser login probe failed');
    } finally {
      await browser.close();
    }

    const callback = await whileRunning(
      fetchImpl(base + '/auth/callback?type=invite&token_hash=' + encodeURIComponent(inviteHash), {
        redirect: 'manual'
      })
    );
    const location = new URL(callback.headers.get('location') ?? '/login', base);
    return {
      browser: { requestHosts: [...requestHosts], loginSucceeded },
      ssr: {
        tokenAccepted: callback.status === 303 && location.pathname !== '/login',
        sessionCookieSet: callback.headers
          .getSetCookie()
          .some((cookie) => /^sb-[^=]*-auth-token/.test(cookie))
      }
    };
  } catch (error) {
    if (error instanceof IsolationProofError) throw error;
    throw new IsolationProofError('live probe failed');
  } finally {
    const signal = (name) => {
      try {
        if (preview.pid) process.kill(-preview.pid, name);
        else preview.kill(name);
      } catch {
        preview.kill(name);
      }
    };
    const awaitClose = async () => {
      let timer;
      try {
        await Promise.race([
          stopped,
          new Promise((resolve) => {
            timer = setTimeout(resolve, 5000);
          })
        ]);
      } finally {
        clearTimeout(timer);
      }
    };
    if (!closed) {
      signal('SIGTERM');
      await awaitClose();
      if (!closed) {
        signal('SIGKILL');
        await awaitClose();
      }
      if (!closed)
        await Promise.reject(new IsolationProofError('preview termination was not confirmed'));
    }
    await stopped;
  }
}

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
  liveProbe = defaultLiveProbe,
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
  const secrets = new Set([dev.serviceKey, test.SUPABASE_SERVICE_ROLE_KEY, token]);
  const safeReason = (error) => {
    let text = error instanceof Error ? error.message : String(error);
    for (const secret of [...secrets].sort((a, b) => b.length - a.length))
      text = text.split(secret).join('[redacted]');
    return sanitize(text);
  };
  const devApi = api(dev.apiUrl, dev.serviceKey, fetchImpl, secrets);
  const testApi = api(test.VITE_SUPABASE_URL, test.SUPABASE_SERVICE_ROLE_KEY, fetchImpl, secrets);
  const proofKey = PRODUCT_EVENT_KEY(proofId);
  let devDb;
  let testDb;
  const failedConnections = new WeakSet();
  const connectionErrors = [];
  const openDb = async (url, side) => {
    let client;
    const onError = (error) => {
      if (client) failedConnections.add(client);
      connectionErrors.push({ side, reason: safeReason(error) });
    };
    client = await connectDb(url, onError);
    if (connectDb !== connect)
      client.on?.('error', (error) => {
        onError(error);
        void client.end().catch(() => undefined);
      });
    return client;
  };
  // Filled in as each resource is created, so cleanup covers a partially completed setup too.
  const fixtures = {
    email: emailFor(proofId, 'dev', token),
    userId: undefined,
    playerIds: [],
    product: undefined,
    schema: undefined,
    bucket: undefined,
    objectName: undefined
  };
  let before;
  let commandResult = { code: null, signal: null };
  let testUser;
  const cleanupErrors = [];
  const cleanupNotes = [];
  const remainingResources = [];
  try {
    devDb = await openDb(dev.dbUrl, 'dev');
    testDb = await openDb(test.DATABASE_URL, 'test');
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
    await createDevFixtures({ db: devDb, devApi, id: proofId, token, fixtures });
    before = await snapshotDev({ db: devDb, devApi, fixtures, token, proofKey });
    record(
      'dev-fixtures-valid',
      before.dueCount === DUE_EVENT_COUNT &&
        before.userPresent &&
        before.productNotificationPresent &&
        before.product.communityPresent &&
        before.product.eventCount === DUE_EVENT_COUNT &&
        before.product.photoCount === DUE_EVENT_COUNT &&
        before.product.proposalCount === 1 &&
        before.product.versionCount === 1 &&
        before.photoHashes.every((hash) => hash !== null) &&
        before.objectHash !== null &&
        before.ownerIntact,
      {
        dueCount: before.product.eventCount,
        photoCount: before.product.photoCount,
        proposalCount: before.product.proposalCount,
        userAbsenceReasons: [...devApi.userAbsenceReasons]
      }
    );
    const presentBefore = await absentFromTest({ testDb, testApi, fixtures, proofKey });
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
    // The wrapped command legitimately recreates the test DB. Never retain a socket across it.
    await testDb.end();
    testDb = undefined;
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

    const after = await snapshotDev({ db: devDb, devApi, fixtures, token, proofKey });
    record(
      'dev-markers-survived',
      after.dueCount === before.dueCount &&
        after.dueHash === before.dueHash &&
        after.proposalHash === before.proposalHash &&
        after.notificationHash === before.notificationHash &&
        after.ownerIntact &&
        after.productNotificationPresent === before.productNotificationPresent &&
        after.userPresent &&
        JSON.stringify(after.product) === JSON.stringify(before.product) &&
        JSON.stringify(after.photoHashes) === JSON.stringify(before.photoHashes) &&
        after.objectHash === before.objectHash,
      {
        dueCount: after.dueCount,
        objectHashEqual: after.objectHash === before.objectHash,
        userPresent: after.userPresent,
        userAbsenceReasons: [...devApi.userAbsenceReasons]
      }
    );
    testDb = await openDb(test.DATABASE_URL, 'test');
    const presentAfter = await absentFromTest({ testDb, testApi, fixtures, proofKey });
    record(
      'dev-fixtures-absent-from-test-after',
      Object.values(presentAfter).every(Boolean),
      presentAfter
    );

    // An invite creates the test user AND sends mail through the test stack's SMTP (Mailpit).
    const testEmail = emailFor(proofId, 'test', token);
    await testApi.invite(testEmail);
    testUser = { email: testEmail, id: await testApi.findUserId(testEmail) };
    // Two more proof-owned test users feed the live probes: one signs in through the browser, the other
    // supplies a one-time invite token that only the test backend can verify.
    const loginEmail = emailFor(proofId, 'login', token);
    const login = { email: loginEmail, password: randomBytes(18).toString('base64url') };
    await testApi.createUser(login.email, login.password);
    const inviteEmail = emailFor(proofId, 'ssr', token);
    const invite = await testApi.generateInviteLink(inviteEmail);
    secrets.add(invite.hashedToken);
    const absentFromDev = [];
    for (const email of [testEmail, loginEmail, inviteEmail])
      absentFromDev.push(!(await devApi.userExists(email)));
    record('test-user-absent-from-dev', absentFromDev.every(Boolean), {});
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
    const testApiHost = new URL(test.VITE_SUPABASE_URL).host;
    const devApiHost = new URL(dev.apiUrl).host;
    const live = await liveProbe({ login, inviteHash: invite.hashedToken });
    const browserHosts = live.browser.requestHosts;
    record(
      'browser-and-ssr-target-test-api',
      evidence.present &&
        evidence.clientFilesWithTestApi > 0 &&
        evidence.clientFilesWithDevApi === 0 &&
        evidence.serverBindingMatchesTestKey &&
        browserHosts.length > 0 &&
        browserHosts.every((host) => host === testApiHost) &&
        !browserHosts.includes(devApiHost) &&
        live.browser.loginSucceeded &&
        live.ssr.tokenAccepted &&
        live.ssr.sessionCookieSet,
      {
        ...evidence,
        browserRequestHosts: browserHosts,
        browserLoginSucceeded: live.browser.loginSucceeded,
        ssrTestTokenAccepted: live.ssr.tokenAccepted,
        ssrSessionCookieSet: live.ssr.sessionCookieSet
      }
    );
  } catch (error) {
    record('proof-execution', false, {
      reason: safeReason(error)
    });
  } finally {
    // Remove only what this run owns; every step is attempted and its failure recorded.
    const attempt = async (label, task) => {
      try {
        const outcome = await task();
        if (outcome?.reason) cleanupNotes.push(outcome.reason);
      } catch (error) {
        cleanupErrors.push(label + ': ' + safeReason(error));
      }
    };
    const verify = (label, task) =>
      attempt(label, async () => {
        if (!(await task())) throw new IsolationProofError('still present after cleanup');
      });
    const removeUsers = async (label, client) => {
      for (const email of client.ownedUsers) {
        await attempt(label, async () => {
          const id = await client.findUserId(email);
          if (id) return client.deleteUser(id);
          return undefined;
        });
        await verify(label + ' removed', async () => !(await client.userExists(email)));
      }
    };
    await attempt('test users cleanup', () => removeUsers('test user', testApi));
    if (devDb && failedConnections.has(devDb))
      await attempt('dev reconnect for cleanup', async () => {
        await devDb.end().catch(() => undefined);
        devDb = await openDb(dev.dbUrl, 'dev');
      });
    if (fixtures.commitAmbiguous)
      await attempt('dev transaction outcome', async () => {
        // Lost COMMIT acknowledgements can leave this connection unusable. Reconcile on a fresh one.
        await devDb.end().catch(() => undefined);
        devDb = await openDb(dev.dbUrl, 'dev');
        const namespace = await devDb.query('select to_regnamespace($1) is not null as present', [
          schemaName(proofId)
        ]);
        if (namespace.rows[0].present) {
          const owner = await devDb.query('select token from "' + schemaName(proofId) + '".owner');
          if (owner.rows[0]?.token !== token)
            throw new IsolationProofError('ambiguous commit ownership mismatch');
          fixtures.schema = schemaName(proofId);
        }
        const product = await devDb.query(
          'select id::text as id from public.communities where id = $1::uuid',
          [fixtures.product.communityId]
        );
        fixtures.product.committed = product.rows.length > 0;
        fixtures.commitAmbiguous = false;
      });
    if (fixtures.bucketCandidate && !fixtures.bucket)
      await attempt('dev bucket ownership', async () => {
        const bucket = await devApi.bucketExists(fixtures.bucketCandidate);
        if (!bucket.present) return bucket;
        if (bucket.name !== fixtures.bucketCandidate)
          throw new IsolationProofError('Storage bucket ownership mismatch');
        fixtures.bucket = fixtures.bucketCandidate;
        return undefined;
      });
    if (fixtures.objectName)
      await attempt('dev object', () => devApi.deleteObject(fixtures.bucket, fixtures.objectName));
    if (fixtures.bucket) await attempt('dev bucket', () => devApi.deleteBucket(fixtures.bucket));
    let productRemoved = !fixtures.commitAmbiguous && !fixtures.product?.committed;
    if (!fixtures.commitAmbiguous && fixtures.product?.committed)
      await attempt('dev product rows', async () => {
        await removeProductFixtures(devDb, fixtures.product);
        productRemoved = true;
      });
    if (fixtures.product && productRemoved) {
      for (const name of fixtures.product.uploadedPhotos)
        await attempt('dev photo', () => devApi.deleteObject(PHOTO_BUCKET, name));
      await verify('dev product/photos removed', async () =>
        Object.values(await productAbsent(devDb, fixtures.product)).every(Boolean)
      );
      for (const name of fixtures.product.uploadedPhotos)
        await verify(
          'dev photo bytes removed',
          async () => (await devApi.objectHash(PHOTO_BUCKET, name)) === null
        );
    }
    // Preserve users/bytes if relational cleanup could not be confirmed.
    if (productRemoved) await attempt('dev users cleanup', () => removeUsers('dev user', devApi));
    if (fixtures.schema)
      await attempt('dev proof schema', async () => {
        const owner = await devDb.query('select token from "' + fixtures.schema + '".owner');
        if (owner.rows[0]?.token === token)
          await devDb.query('drop schema "' + fixtures.schema + '" cascade');
      });
    // Deletion requests can succeed vacuously (404); confirm the owned resources are really gone.

    if (fixtures.userId && productRemoved && devDb)
      await verify(
        'dev product notification removed',
        async () => (await productNotificationCount(devDb, proofKey)) === 0
      );
    if (fixtures.bucket)
      await verify('dev bucket removed', async () => {
        const bucket = await devApi.bucketExists(fixtures.bucket);
        if (bucket.reason) cleanupNotes.push(bucket.reason);
        return !bucket.present;
      });
    if (fixtures.schema && devDb)
      await verify('dev proof schema removed', async () => {
        const gone = await devDb.query('select to_regnamespace($1) is null as gone', [
          fixtures.schema
        ]);
        return gone.rows[0].gone;
      });
    if (cleanupErrors.length) {
      // Inventory each resource independently; distinguish confirmed residue from unavailable checks.
      const inspect = async (kind, id, present) => {
        try {
          if (await present()) remainingResources.push({ kind, id, status: 'present' });
        } catch {
          remainingResources.push({ kind, id, status: 'unverified' });
        }
      };
      for (const [side, client] of Object.entries({ dev: devApi, test: testApi }))
        for (const email of client.ownedUsers)
          await inspect(side + ' user', email, () => client.userExists(email));
      const bucket = fixtures.bucket ?? fixtures.bucketCandidate;
      if (bucket)
        await inspect(
          'dev bucket',
          bucket,
          async () => (await devApi.bucketExists(bucket)).present
        );
      if (bucket && fixtures.objectName)
        await inspect(
          'dev object',
          bucket + '/' + fixtures.objectName,
          async () => (await devApi.objectHash(bucket, fixtures.objectName)) !== null
        );
      const schema =
        fixtures.schema ?? (fixtures.commitAmbiguous ? schemaName(proofId) : undefined);
      if (schema)
        await inspect(
          'dev schema',
          schema,
          async () =>
            (await devDb.query('select to_regnamespace($1) is not null as present', [schema]))
              .rows[0].present
        );
      if (fixtures.product) {
        for (const [kind, table, column, ids] of [
          ['community', 'communities', 'id', [fixtures.product.communityId]],
          ['event', 'match_events', 'id', fixtures.product.eventIds],
          ['proposal', 'match_event_result_proposals', 'id', fixtures.product.proposalIds],
          [
            'version',
            'match_event_result_proposal_versions',
            'proposal_id',
            fixtures.product.proposalIds
          ]
        ])
          for (const id of ids)
            await inspect(
              'dev ' + kind,
              id,
              async () =>
                (
                  await devDb.query(
                    'select 1 from public.' + table + ' where ' + column + ' = $1::uuid',
                    [id]
                  )
                ).rows.length > 0
            );
        for (const name of fixtures.product.uploadedPhotos)
          await inspect(
            'dev photo',
            PHOTO_BUCKET + '/' + name,
            async () => (await devApi.objectHash(PHOTO_BUCKET, name)) !== null
          );
      }
      await inspect(
        'dev notification',
        proofKey,
        async () => (await productNotificationCount(devDb, proofKey)) > 0
      );
    }
    if (devDb) await attempt('dev connection', () => devDb.end());
    if (testDb) await attempt('test connection', () => testDb.end());
  }
  record('cleanup-of-owned-fixtures', cleanupErrors.length === 0, {
    errors: cleanupErrors,
    tolerated: [...cleanupNotes, ...devApi.objectAbsenceReasons],
    connectionErrors,
    // Recovery token is an ownership marker, never an API credential.
    ...(cleanupErrors.length
      ? {
          recovery: {
            proofId,
            token,
            remainingResources
          }
        }
      : {})
  });
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
