import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { INTEGRATION_DB_URL_ENV } from '../scripts/integration-db-url.mjs';
import { TEST_CLI_OPTIONS } from '../scripts/test-stack-env.mjs';
import { TEST_WORKDIR } from '../scripts/test-stack.mjs';
import { testStatusOutput } from './helpers/test-stack-status';

const execFileSync = vi.hoisted(() => vi.fn<(...args: unknown[]) => string>());
const spawn = vi.hoisted(() => vi.fn<(...args: unknown[]) => unknown>());
vi.mock('node:child_process', async (importOriginal) => ({
  ...(await importOriginal<typeof import('node:child_process')>()),
  execFileSync,
  spawn
}));

const CLI_URL = 'postgresql://postgres:cli-pw@127.0.0.1:55422/postgres';
const HANDOFF_URL = 'postgresql://postgres:handoff-pw@127.0.0.1:55422/postgres';

// localDatabaseUrl memoizes per module instance, so each case loads a fresh one.
async function freshLocalDatabaseUrl() {
  vi.resetModules();
  return (await import('./helpers/sql-transport')).localDatabaseUrl;
}

describe('sql-transport local database URL discovery', () => {
  beforeEach(() => {
    execFileSync.mockReset();
    execFileSync.mockReturnValue(testStatusOutput({ DB_URL: CLI_URL }));
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

  it('falls back to TEST-workdir CLI discovery when the variable is absent', async () => {
    await expect((await freshLocalDatabaseUrl())()).resolves.toBe(CLI_URL);
    expect(execFileSync).toHaveBeenCalledOnce();
    expect(execFileSync.mock.calls[0]?.[1]).toEqual([
      'exec',
      'supabase',
      '--workdir',
      TEST_WORKDIR,
      'status',
      '-o',
      'env'
    ]);
  });

  it('hard-fails instead of discovering a dev or missing stack', async () => {
    execFileSync.mockImplementation(() => {
      throw new Error('stack down');
    });
    await expect((await freshLocalDatabaseUrl())()).rejects.toThrow(/test:stack:up/);
    execFileSync.mockReturnValue(
      testStatusOutput({ DB_URL: 'postgresql://postgres:cli-pw@127.0.0.1:55322/postgres' })
    );
    const failure = await (
      await freshLocalDatabaseUrl()
    )().then(
      () => undefined,
      (error: unknown) => error
    );
    expect(failure instanceof Error ? failure.message : '').toContain('test database port');
    expect(failure instanceof Error ? failure.message : '').not.toContain('cli-pw');
  });

  it('runs the retained CLI query path against the test workdir from the repo root', async () => {
    vi.resetModules();
    const { startCliSql } = await import('./helpers/sql-transport');
    const child = {
      stdout: { setEncoding: vi.fn<() => void>(), on: vi.fn<() => void>() },
      stderr: { setEncoding: vi.fn<() => void>(), on: vi.fn<() => void>() },
      once: vi.fn<() => void>(),
      exitCode: null,
      signalCode: null
    };
    spawn.mockReturnValue(child);
    startCliSql('select 1');
    expect(spawn).toHaveBeenCalledWith(
      'pnpm',
      [
        'exec',
        'supabase',
        '--workdir',
        TEST_WORKDIR,
        'db',
        'query',
        '--local',
        '--output-format',
        'json',
        'select 1'
      ],
      expect.objectContaining({ cwd: TEST_CLI_OPTIONS.cwd })
    );
  });

  it.each([
    ['empty', ''],
    ['malformed', 'handoff-pw not a url'],
    ['non-loopback', 'postgresql://postgres:handoff-pw@db.example.com:55422/postgres'],
    ['wrong port', 'postgresql://postgres:handoff-pw@127.0.0.1:5432/postgres'],
    ['dev port', 'postgresql://postgres:handoff-pw@127.0.0.1:55322/postgres'],
    ['wrong database', 'postgresql://postgres:handoff-pw@127.0.0.1:55422/other'],
    [
      'remote host override',
      'postgresql://postgres:handoff-pw@127.0.0.1:55422/postgres?host=remote.example'
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
