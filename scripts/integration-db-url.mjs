import { execFileSync } from 'node:child_process';
import { TEST_DB_NAME, TEST_DB_PORT, resolveTestStackEnv } from './test-stack-env.mjs';

// Launcher-scoped handoff of the TEST stack's Supabase DB URL to vitest workers. The launcher
// resolves the tuple once per run (the pinned test workdir's `supabase status -o env`), validates
// it, and passes it to its vitest children through this private env var; workers consume the
// validated value instead of running their own discovery. Standalone runs (variable absent) keep
// the workers' own test-workdir discovery. The value carries the database password: it must never
// be logged, echoed in an error, written to disk, or given a VITE_ prefix.
// Every error below names the failure reason only, never the value.
export const INTEGRATION_DB_URL_ENV = 'INTEGRATION_SUPABASE_DB_URL';

// Derived from the fixed test stack contract (scripts/test-stack.mjs, asserted against the test
// config by a unit test); never the developer stack's database port.
export const LOCAL_DB_PORT = TEST_DB_PORT;
export const LOCAL_DB_NAME = TEST_DB_NAME;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Fails closed unless the value is a PostgreSQL URL for this repo's TEST Supabase database. */
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
    throw new Error(`${INTEGRATION_DB_URL_ENV} must target the test Supabase database port`);
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
 * Worker/setup side: the launcher handoff when present (validated, trusted), otherwise the TEST
 * stack's own status via the pinned workdir. Never root-CLI discovery, never the dev stack.
 */
export function discoverTestDatabaseUrl(env = process.env, exec = execFileSync) {
  return handoffDatabaseUrl(env) ?? resolveLocalDatabaseUrl(exec);
}

/**
 * Launcher side: the validated TEST DB URL from the pinned test workdir. Throws a reason-only error
 * (never the value) when the test stack is unavailable or reports anything but the fixed test
 * endpoint, so the launcher aborts instead of starting children on weaker discovery.
 */
export function resolveLocalDatabaseUrl(exec = execFileSync) {
  return assertHandoffDatabaseUrl(resolveTestStackEnv(exec).DATABASE_URL);
}
