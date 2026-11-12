import { spawn } from 'node:child_process';
import { constants } from 'node:os';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

// Lifecycle for the isolated TEST Supabase stack (second CLI project, see test/stack/supabase).
// Every CLI call pins the absolute test workdir and runs without a shell; target overrides are
// refused so a lifecycle command can never address the dev stack (root supabase/ project).
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const TEST_WORKDIR = path.join(repoRoot, 'test/stack');
export const TEST_PROJECT_ID = 'padel-friend-test';
export const TEST_API_URL = 'http://127.0.0.1:55421';
// Config values the stack contract fixes. Auth/PostgREST/Storage route through the API port.
export const TEST_CONFIG = {
  project_id: TEST_PROJECT_ID,
  'api.port': 55421,
  'db.port': 55422,
  'db.shadow_port': 55420,
  'db.pooler.enabled': false,
  'db.pooler.port': 55429,
  'studio.port': 55423,
  'local_smtp.port': 55424,
  'analytics.port': 55427,
  'edge_runtime.inspector_port': 55483
};
export const VERBS = ['up', 'down', 'reset'];

const FORBIDDEN_ENV = ['SUPABASE_WORKDIR'];
const CLI_DIAGNOSTIC_LINES = 20;

export class TestStackError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'TestStackError';
    this.exitCode = exitCode;
  }
}

function parseValue(raw) {
  const value = raw.replace(/\s+#.*$/, '').trim();
  if (value.startsWith('[')) return [...value.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
  const quoted = /^"(.*)"$/.exec(value);
  if (quoted) return quoted[1];
  if (value === 'true') return true;
  if (value === 'false') return false;
  if (/^-?\d+$/.test(value)) return Number(value);
  return value;
}

// Narrow reader for this repo's simple Supabase config: flat "section.key" map, top-level keys
// bare. Handles scalars and (multi-line) string arrays only; it is not a general TOML parser.
export function parseSimpleToml(text) {
  const values = {};
  let section = '';
  let pending = null;
  for (const line of text.split(/\r?\n/)) {
    if (pending) {
      pending.raw += line;
      if (line.includes(']')) {
        values[pending.key] = parseValue(pending.raw);
        pending = null;
      }
      continue;
    }
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const header = /^\[([^\]]+)\]/.exec(trimmed);
    if (header) {
      section = header[1].trim();
      continue;
    }
    const entry = /^([A-Za-z0-9_.-]+)\s*=\s*(.*)$/.exec(trimmed);
    if (!entry) continue;
    const key = section ? section + '.' + entry[1] : entry[1];
    if (entry[2].startsWith('[') && !entry[2].includes(']')) pending = { key, raw: entry[2] };
    else values[key] = parseValue(entry[2]);
  }
  return values;
}

export async function readTestConfig(workdir = TEST_WORKDIR) {
  return parseSimpleToml(await readFile(path.join(workdir, 'supabase/config.toml'), 'utf8'));
}

export function assertTestConfig(config) {
  const drifted = Object.entries(TEST_CONFIG)
    .filter(([key, expected]) => config[key] !== expected)
    .map(([key]) => key);
  if (drifted.length)
    throw new TestStackError(
      'Test stack config drifted from the fixed contract (' +
        drifted.join(', ') +
        '). Restore test/stack/supabase/config.toml.'
    );
}

// Reason-only text: strips local keys, JWTs and credentialed URLs, keeps the last few lines.
export function sanitize(text) {
  return String(text)
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, '[redacted]')
    .replace(/sb_(?:publishable|secret)_[\w-]+/g, '[redacted]')
    .replace(/postgres(?:ql)?:\/\/\S+/g, 'postgresql://[redacted]')
    .replace(/^(\s*\w*(?:KEY|SECRET|PASSWORD|TOKEN)\w*\s*[=:]\s*)\S+/gim, '$1[redacted]')
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .slice(-CLI_DIAGNOSTIC_LINES)
    .join('\n');
}

export function cliArgs(...command) {
  return ['exec', 'supabase', '--workdir', TEST_WORKDIR, ...command];
}

export function parseArgs(argv, env = process.env) {
  const [verb, ...rest] = argv;
  if (!VERBS.includes(verb))
    throw new TestStackError('Usage: node scripts/test-stack.mjs <' + VERBS.join('|') + '>', 2);
  if (rest.length)
    throw new TestStackError(
      'Refusing extra arguments (' + rest.length + '): the test stack target and flags are fixed.',
      2
    );
  const ambient = FORBIDDEN_ENV.find((name) => env[name]);
  if (ambient)
    throw new TestStackError('Refusing ambient ' + ambient + ': the test workdir is fixed.', 2);
  return verb;
}

function run(command, args, { cwd }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk) => (stderr += chunk));
    const forward = (signal) => child.kill(signal);
    const signals = ['SIGINT', 'SIGTERM'];
    for (const signal of signals) process.on(signal, forward);
    const cleanup = () => signals.forEach((signal) => process.off(signal, forward));
    child.once('error', (error) => {
      cleanup();
      reject(error);
    });
    child.once('close', (code, signal) => {
      cleanup();
      resolve({ code, signal, stdout, stderr });
    });
  });
}

function exitCodeOf(result) {
  return result.signal ? 128 + (constants.signals[result.signal] ?? 1) : (result.code ?? 1);
}

async function cli(runProcess, command) {
  return runProcess('pnpm', cliArgs(...command), { cwd: repoRoot });
}

function assertSucceeded(result, action) {
  if (result.signal || result.code !== 0) {
    const detail = sanitize(result.stderr || result.stdout);
    throw new TestStackError(
      'Test stack ' +
        action +
        ' failed (' +
        (result.signal ? 'signal ' + result.signal : 'exit ' + result.code) +
        ').' +
        (detail ? '\n' + detail : ''),
      exitCodeOf(result)
    );
  }
}

// Healthy = CLI status succeeds and reports the fixed test API/DB endpoints. Reason-only errors.
export function assertHealthyStatus(stdout) {
  const status = parseEnv(stdout);
  let dbUrl;
  try {
    dbUrl = new URL(status.DB_URL ?? '');
  } catch {
    dbUrl = null;
  }
  if (status.API_URL !== TEST_API_URL)
    throw new TestStackError('Test stack status reports an unexpected API endpoint.');
  if (
    !dbUrl ||
    dbUrl.hostname !== '127.0.0.1' ||
    dbUrl.port !== String(TEST_CONFIG['db.port']) ||
    dbUrl.pathname !== '/postgres'
  )
    throw new TestStackError('Test stack status reports an unexpected database endpoint.');
}

async function readStatus(runProcess) {
  return cli(runProcess, ['status', '-o', 'env']);
}

async function validateHealthy(runProcess, sleep, attempts = 15) {
  for (let attempt = 1; ; attempt += 1) {
    const result = await readStatus(runProcess);
    if (!result.signal && result.code === 0) {
      // Endpoint drift is not a startup race: fail closed immediately.
      assertHealthyStatus(result.stdout);
      return;
    }
    if (result.signal || attempt >= attempts) assertSucceeded(result, 'status check');
    await sleep(1000);
  }
}

export async function runTestStack(
  argv,
  {
    env = process.env,
    runProcess = run,
    log = console.log,
    readConfig = readTestConfig,
    sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
  } = {}
) {
  const verb = parseArgs(argv, env);
  assertTestConfig(await readConfig());
  if (verb === 'up') {
    const started = await cli(runProcess, ['start']);
    if (!started.signal && started.code !== 0) {
      // A killed reset can leave a partial project (missing DB, live gateway/realtime).
      // CLI start cannot always reconcile those containers. Stop THIS project only,
      // retaining its volumes, then give the normal start path one recovery attempt.
      log('Test stack start incomplete; recovering test project only (volumes kept).');
      assertSucceeded(await cli(runProcess, ['stop']), 'recovery stop');
      assertSucceeded(await cli(runProcess, ['start']), 'recovery start');
    } else assertSucceeded(started, 'start');
    await validateHealthy(runProcess, sleep);
    log('Test stack up (' + TEST_PROJECT_ID + ', API ' + TEST_API_URL + ').');
  } else if (verb === 'down') {
    assertSucceeded(await cli(runProcess, ['stop']), 'stop');
    log('Test stack stopped (' + TEST_PROJECT_ID + '); data volumes kept.');
  } else {
    const status = await readStatus(runProcess);
    if (status.signal || status.code !== 0)
      throw new TestStackError('Test stack is not running. Run pnpm test:stack:up first.');
    assertSucceeded(await cli(runProcess, ['db', 'reset', '--local']), 'reset');
    await validateHealthy(runProcess, sleep);
    log('Test stack reset (' + TEST_PROJECT_ID + '): migrations and seed applied.');
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTestStack(process.argv.slice(2)).catch((error) => {
    console.error(
      error instanceof TestStackError
        ? error.message
        : 'Test stack failed: ' + sanitize(error.message)
    );
    process.exitCode = error.exitCode ?? 1;
  });
}
