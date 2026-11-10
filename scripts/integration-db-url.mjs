import { execFileSync } from 'node:child_process';

// Launcher-scoped handoff of the local Supabase DB URL to vitest workers. The launcher resolves the
// URL once per run (`supabase status -o env`), validates it, and passes it to its vitest children
// through this private env var; workers consume the validated value instead of running their own
// discovery. Standalone runs (variable absent) keep the workers' own discovery. The value carries
// the database password: it must never be logged, echoed in an error, written to disk, or given a VITE_ prefix.
// Every error below names the failure reason only, never the value.
export const INTEGRATION_DB_URL_ENV = 'INTEGRATION_SUPABASE_DB_URL';

// Must equal `[db] port` in supabase/config.toml (asserted by a unit test).
export const LOCAL_DB_PORT = '55322';
export const LOCAL_DB_NAME = 'postgres';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Fails closed unless the value is a PostgreSQL URL for this repo's local Supabase database. */
export function assertHandoffDatabaseUrl(value) {
  if (value === '') throw new Error(`${INTEGRATION_DB_URL_ENV} is empty`);
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${INTEGRATION_DB_URL_ENV} is invalid`);
  }
  if (!['postgres:', 'postgresql:'].includes(url.protocol))
    throw new Error(`${INTEGRATION_DB_URL_ENV} must be a PostgreSQL URL`);
  if (!LOOPBACK_HOSTS.has(url.hostname.toLowerCase()))
    throw new Error(`${INTEGRATION_DB_URL_ENV} must target a loopback host`);
  if (url.port !== LOCAL_DB_PORT)
    throw new Error(`${INTEGRATION_DB_URL_ENV} must target the local Supabase database port`);
  if (url.pathname !== `/${LOCAL_DB_NAME}`)
    throw new Error(`${INTEGRATION_DB_URL_ENV} must target the ${LOCAL_DB_NAME} database`);
  if (url.search !== '')
    throw new Error(`${INTEGRATION_DB_URL_ENV} must not carry connection parameters`);
  return value;
}

/** The validated handoff URL; undefined only when the variable is absent (standalone runs). */
export function handoffDatabaseUrl(env = process.env) {
  const value = env[INTEGRATION_DB_URL_ENV];
  return value === undefined ? undefined : assertHandoffDatabaseUrl(value);
}

/**
 * Launcher side: the validated local DB URL. Returns undefined when the CLI cannot produce one
 * (status fails, no DB_URL); the children then run their own discovery and fail with the existing
 * error. A URL that resolves but fails validation throws a reason-only error (never the value) so
 * the launcher can abort instead of starting children on weaker discovery.
 */
export function resolveLocalDatabaseUrl(exec = execFileSync) {
  let output;
  try {
    output = exec('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      timeout: 10_000,
      maxBuffer: 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch {
    return undefined;
  }
  const raw = /^DB_URL=(.*)$/m
    .exec(output)?.[1]
    ?.trim()
    .replace(/^(?:"(.*)"|'(.*)')$/, '$1$2');
  // Absent DB_URL = CLI could not produce one; present-but-empty fails closed like any invalid value.
  return raw === undefined ? undefined : assertHandoffDatabaseUrl(raw);
}
