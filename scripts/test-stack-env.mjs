import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { TEST_CONFIG, cliArgs, sanitize } from './test-stack.mjs';

// Single resolver for the authoritative TEST backend tuple. Resolves the test stack's own
// `supabase status -o env` through the pinned test workdir (captured stdout, no shell eval),
// validates it against the fixed test ports and exposes it as in-memory env. It never reads root
// .env* files or the dev stack, and never falls back to either: missing or invalid input throws a
// reason-only error (no key, password or URL value is ever echoed).
export const TEST_REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const TEST_API_PORT = String(TEST_CONFIG['api.port']);
export const TEST_DB_PORT = String(TEST_CONFIG['db.port']);
export const TEST_MAIL_PORT = String(TEST_CONFIG['local_smtp.port']);
export const TEST_DB_NAME = 'postgres';
export const TEST_DB_CONTAINER = 'supabase_db_' + TEST_CONFIG.project_id;

// Status key -> env name. DB_URL feeds two names (app/SQL tuple and the private launcher handoff).
export const TEST_ENV_MAP = {
  API_URL: ['VITE_SUPABASE_URL'],
  PUBLISHABLE_KEY: ['VITE_SUPABASE_PUBLISHABLE_KEY'],
  DB_URL: ['DATABASE_URL', 'INTEGRATION_SUPABASE_DB_URL'],
  SERVICE_ROLE_KEY: ['SUPABASE_SERVICE_ROLE_KEY'],
  MAILPIT_URL: ['MAILPIT_URL']
};
export const TEST_ENV_NAMES = Object.values(TEST_ENV_MAP).flat();

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]']);

export class TestStackEnvError extends Error {
  constructor(message) {
    super(message);
    this.name = 'TestStackEnvError';
  }
}

const isPlaceholder = (value) => /^(replace-with|your[-_])/i.test(value);

function parseUrl(name, value, protocols) {
  if (!value) throw new TestStackEnvError(name + ' is missing');
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new TestStackEnvError(name + ' is invalid');
  }
  if (!protocols.includes(url.protocol))
    throw new TestStackEnvError(name + ' has an unsupported scheme');
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase()))
    throw new TestStackEnvError(name + ' must target a loopback host');
  if (url.search !== '' || url.hash !== '')
    throw new TestStackEnvError(name + ' must not carry parameters');
  return url;
}

function assertPort(name, url, port, label) {
  if (url.port !== port)
    throw new TestStackEnvError(name + ' must target the test ' + label + ' port');
}

function assertKey(name, value) {
  if (!value || isPlaceholder(value)) throw new TestStackEnvError(name + ' is missing');
}

/**
 * Validates a complete test tuple (all six names, used together). Returns the normalized tuple or
 * throws a reason-only TestStackEnvError naming the offending variable, never its value.
 */
export function validateTestEnv(env) {
  const api = parseUrl('VITE_SUPABASE_URL', env.VITE_SUPABASE_URL, ['http:', 'https:']);
  assertPort('VITE_SUPABASE_URL', api, TEST_API_PORT, 'API');
  const mail = parseUrl('MAILPIT_URL', env.MAILPIT_URL, ['http:']);
  assertPort('MAILPIT_URL', mail, TEST_MAIL_PORT, 'Mailpit');
  for (const name of ['DATABASE_URL', 'INTEGRATION_SUPABASE_DB_URL']) {
    const db = parseUrl(name, env[name], ['postgres:', 'postgresql:']);
    assertPort(name, db, TEST_DB_PORT, 'database');
    if (db.pathname !== '/' + TEST_DB_NAME)
      throw new TestStackEnvError(name + ' must target the ' + TEST_DB_NAME + ' database');
  }
  if (env.DATABASE_URL !== env.INTEGRATION_SUPABASE_DB_URL)
    throw new TestStackEnvError('DATABASE_URL and INTEGRATION_SUPABASE_DB_URL disagree');
  assertKey('VITE_SUPABASE_PUBLISHABLE_KEY', env.VITE_SUPABASE_PUBLISHABLE_KEY);
  assertKey('SUPABASE_SERVICE_ROLE_KEY', env.SUPABASE_SERVICE_ROLE_KEY);
  return Object.fromEntries(TEST_ENV_NAMES.map((name) => [name, env[name]]));
}

/** Maps captured status stdout to the validated test tuple (every value from the same status). */
export function testEnvFromStatus(stdout) {
  const status = parseEnv(stdout);
  const mapped = {};
  for (const [statusKey, names] of Object.entries(TEST_ENV_MAP))
    for (const name of names) mapped[name] = (status[statusKey] ?? '').trim();
  return validateTestEnv(mapped);
}

/** Args (after `pnpm`) of a CLI call pinned to the absolute test workdir. */
export function testCliArgs(...command) {
  return cliArgs(...command);
}

/** Args (after `pnpm`) of a one-shot local SQL query on the test stack's database. */
export function testQueryArgs(sql) {
  return cliArgs('db', 'query', '--local', '--output-format', 'json', sql);
}

/** Options every test CLI call shares: cwd is the repo root whatever the caller's cwd is. */
export const TEST_CLI_OPTIONS = { cwd: TEST_REPO_ROOT };

/**
 * Runs the pinned test `status -o env` and returns the validated tuple. Fails closed with a
 * reason-only error when the test stack is not running or reports anything unexpected.
 */
export function resolveTestStackEnv(exec = execFileSync) {
  let output;
  try {
    output = exec('pnpm', testCliArgs('status', '-o', 'env'), {
      ...TEST_CLI_OPTIONS,
      encoding: 'utf8',
      timeout: 20_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (error) {
    const detail = sanitize(typeof error?.stderr === 'string' ? error.stderr : '');
    throw new TestStackEnvError(
      'Test Supabase stack is unavailable. Run pnpm test:stack:up first.' +
        (detail ? '\n' + detail : '')
    );
  }
  return testEnvFromStatus(output);
}

/**
 * Installs the authoritative test tuple into env, overriding inherited dev VITE_*, DATABASE_URL,
 * handoff and service key. An already-complete valid tuple (e.g. from the launcher) is kept; an
 * incomplete or invalid one is replaced by the status-derived tuple, never merged with it.
 */
export function ensureTestStackEnv(env = process.env, exec = execFileSync) {
  let tuple;
  try {
    tuple = validateTestEnv(env);
  } catch {
    tuple = resolveTestStackEnv(exec);
  }
  Object.assign(env, tuple);
  return tuple;
}

/** The validated tuple already present in env (no CLI call). Throws when absent or wrong stack. */
export function requireTestEnv(env = process.env) {
  try {
    return validateTestEnv(env);
  } catch (error) {
    throw new TestStackEnvError(
      (error instanceof Error ? error.message : 'Test stack environment is invalid') +
        ' (run through a test entrypoint such as pnpm test:integration or pnpm test:e2e)'
    );
  }
}
