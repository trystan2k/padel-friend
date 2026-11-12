import { spawn, type ChildProcessByStdio } from 'node:child_process';
import type { Readable } from 'node:stream';
import { TEST_CLI_OPTIONS, requireTestEnv, testQueryArgs } from '../scripts/test-stack-env.mjs';

// The one E2E source of backend coordinates: the validated TEST tuple that playwright.config.ts
// installs in the main process before workers start (workers inherit it). It never reads a root
// .env and never accepts a dev or remote tuple; a missing or wrong stack throws.
export function testSupabaseConfig(): { url: string; key: string } {
  const tuple = requireTestEnv();
  return { url: tuple.VITE_SUPABASE_URL, key: tuple.VITE_SUPABASE_PUBLISHABLE_KEY };
}

/** Test Mailpit web/API origin (fixed test port), resolved from the same tuple. */
export function testMailpitUrl(): string {
  return requireTestEnv().MAILPIT_URL;
}

/** Test-database connection string from the same tuple (loopback, fixed test port). */
export function testDatabaseUrl(): string {
  return requireTestEnv().DATABASE_URL;
}

/**
 * Single E2E entry for one-shot trusted SQL through the CLI: pinned to the absolute test workdir and
 * the repo-root cwd, so no fixture can address the root (dev) CLI project. Validates the test tuple
 * first, so a missing or wrong stack fails before any statement is sent.
 */
export function spawnTestSql(sql: string): ChildProcessByStdio<null, Readable, Readable> {
  requireTestEnv();
  return spawn('pnpm', testQueryArgs(sql), {
    cwd: TEST_CLI_OPTIONS.cwd,
    stdio: ['ignore', 'pipe', 'pipe']
  });
}
