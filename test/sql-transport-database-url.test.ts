import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_DB_URL_ENV } from '../scripts/integration-db-url.mjs';

const execFileSync = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync
}));

const CLI_URL = 'postgresql://postgres:cli-pw@127.0.0.1:55322/postgres';
const HANDOFF_URL = 'postgresql://postgres:handoff-pw@127.0.0.1:55322/postgres';

// localDatabaseUrl memoizes per module instance, so each case loads a fresh one.
async function freshLocalDatabaseUrl() {
  vi.resetModules();
  return (await import('./helpers/sql-transport')).localDatabaseUrl;
}

describe('sql-transport local database URL discovery', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    execFileSync.mockReturnValue(`DB_URL="${CLI_URL}"`);
    vi.stubEnv(INTEGRATION_DB_URL_ENV, undefined);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('uses the launcher-provided URL without calling the Supabase CLI', async () => {
    vi.stubEnv(INTEGRATION_DB_URL_ENV, HANDOFF_URL);
    await expect((await freshLocalDatabaseUrl())()).resolves.toBe(HANDOFF_URL);
    expect(execFileSync).not.toHaveBeenCalled();
  });

  it('falls back to CLI discovery when the variable is absent', async () => {
    await expect((await freshLocalDatabaseUrl())()).resolves.toBe(CLI_URL);
    expect(execFileSync).toHaveBeenCalledOnce();
  });

  it.each([
    ['empty', ''],
    ['malformed', 'handoff-pw not a url'],
    ['non-loopback', 'postgresql://postgres:handoff-pw@db.example.com:55322/postgres'],
    ['wrong port', 'postgresql://postgres:handoff-pw@127.0.0.1:5432/postgres'],
    ['wrong database', 'postgresql://postgres:handoff-pw@127.0.0.1:55322/other'],
    [
      'remote host override',
      'postgresql://postgres:handoff-pw@127.0.0.1:55322/postgres?host=remote.example'
    ]
  ])('fails closed on a %s value without CLI fallback or leaking it', async (_label, value) => {
    vi.stubEnv(INTEGRATION_DB_URL_ENV, value);
    const failure = await (
      await freshLocalDatabaseUrl()
    )().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(failure).toBeInstanceOf(Error);
    expect(failure instanceof Error ? failure.message : '').not.toContain('handoff-pw');
    expect(execFileSync).not.toHaveBeenCalled();
  });
});
