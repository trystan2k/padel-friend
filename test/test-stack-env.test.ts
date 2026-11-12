import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import {
  TEST_CLI_OPTIONS,
  TEST_DB_CONTAINER,
  TEST_ENV_NAMES,
  TestStackEnvError,
  ensureTestStackEnv,
  readDevVarsValue,
  requireTestEnv,
  resolveTestStackEnv,
  testCliArgs,
  testEnvFromStatus,
  testQueryArgs,
  validateTestEnv
} from '../scripts/test-stack-env.mjs';
import { TEST_WORKDIR } from '../scripts/test-stack.mjs';
import { FAKE_DB_URL, TEST_TUPLE, testStatusOutput } from './helpers/test-stack-status';

const SECRETS = ['fake-service-role-key', 'sb_publishable_fake', 'fake-db-pw'];

function failure(run: () => unknown): string {
  try {
    run();
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('expected a failure');
}

describe('test stack environment resolution', () => {
  it('maps every status key to the documented env names, all from one status', () => {
    expect(testEnvFromStatus(testStatusOutput())).toEqual(TEST_TUPLE);
    expect(TEST_ENV_NAMES.sort()).toEqual(Object.keys(TEST_TUPLE).sort());
  });

  it('runs the pinned test-workdir status from the repo root whatever the caller cwd is', () => {
    const exec = vi.fn<(...args: unknown[]) => string>(() => testStatusOutput());
    expect(resolveTestStackEnv(exec)).toEqual(TEST_TUPLE);
    expect(exec).toHaveBeenCalledWith(
      'pnpm',
      ['exec', 'supabase', '--workdir', TEST_WORKDIR, 'status', '-o', 'env'],
      expect.objectContaining({ cwd: TEST_CLI_OPTIONS.cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    );
    expect(path.isAbsolute(TEST_WORKDIR)).toBe(true);
    expect(TEST_CLI_OPTIONS.cwd).toBe(path.resolve(TEST_WORKDIR, '..', '..'));
  });

  it('builds CLI and query args from the same pinned workdir', () => {
    expect(testCliArgs('gen', 'types')).toEqual([
      'exec',
      'supabase',
      '--workdir',
      TEST_WORKDIR,
      'gen',
      'types'
    ]);
    expect(testQueryArgs('select 1')).toEqual([
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
    ]);
    expect(TEST_DB_CONTAINER).toBe('supabase_db_padel-friend-test');
  });

  it.each([
    ['dev API port', { API_URL: 'http://127.0.0.1:55321' }, 'VITE_SUPABASE_URL'],
    [
      'dev DB port',
      { DB_URL: 'postgresql://postgres:fake-db-pw@127.0.0.1:55322/postgres' },
      'DATABASE_URL'
    ],
    ['dev Mailpit port', { MAILPIT_URL: 'http://127.0.0.1:55324' }, 'MAILPIT_URL'],
    ['remote API', { API_URL: 'https://project.supabase.co:55421' }, 'VITE_SUPABASE_URL'],
    [
      'remote DB',
      { DB_URL: 'postgresql://postgres:fake-db-pw@db.example.com:55422/postgres' },
      'DATABASE_URL'
    ],
    [
      'other DB name',
      { DB_URL: 'postgresql://postgres:fake-db-pw@127.0.0.1:55422/other' },
      'DATABASE_URL'
    ],
    ['DB URL parameters', { DB_URL: FAKE_DB_URL + '?host=remote.example' }, 'DATABASE_URL'],
    ['API URL parameters', { API_URL: 'http://127.0.0.1:55421/?x=1' }, 'VITE_SUPABASE_URL'],
    ['non-PostgreSQL DB scheme', { DB_URL: 'http://127.0.0.1:55422/postgres' }, 'DATABASE_URL'],
    ['empty publishable key', { PUBLISHABLE_KEY: '' }, 'VITE_SUPABASE_PUBLISHABLE_KEY'],
    [
      'placeholder publishable key',
      { PUBLISHABLE_KEY: 'replace-with-key' },
      'VITE_SUPABASE_PUBLISHABLE_KEY'
    ],
    ['missing service key', { SERVICE_ROLE_KEY: null }, 'SUPABASE_SERVICE_ROLE_KEY'],
    ['missing Mailpit URL', { MAILPIT_URL: null }, 'MAILPIT_URL']
  ])(
    'rejects %s with a reason that names the variable and never a secret',
    (_label, patch, name) => {
      const message = failure(() => testEnvFromStatus(testStatusOutput(patch)));
      expect(message).toContain(name);
      for (const secret of SECRETS) expect(message).not.toContain(secret);
    }
  );

  it('rejects a DATABASE_URL and handoff that disagree', () => {
    expect(() =>
      validateTestEnv({
        ...TEST_TUPLE,
        INTEGRATION_SUPABASE_DB_URL: 'postgresql://postgres:other@127.0.0.1:55422/postgres'
      })
    ).toThrow(/disagree/);
  });

  it('fails closed with a start instruction and a sanitized reason when the test stack is down', () => {
    const exec = () => {
      throw Object.assign(new Error('exit 1'), {
        stderr:
          'supabase local development setup is not running\nSERVICE_ROLE_KEY=fake-service-role-key'
      });
    };
    const message = failure(() => resolveTestStackEnv(exec));
    expect(message).toContain('pnpm test:stack:up');
    expect(message).not.toContain('fake-service-role-key');
    expect(() => resolveTestStackEnv(() => testStatusOutput({ API_URL: 'x' }))).toThrow(
      TestStackEnvError
    );
  });

  it('replaces an inherited dev tuple as one unit and never merges it with the test status', () => {
    const exec = vi.fn<(...args: unknown[]) => string>(() => testStatusOutput());
    const env: Record<string, string | undefined> = {
      VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'dev-key',
      DATABASE_URL: 'postgresql://postgres:dev@127.0.0.1:55322/postgres',
      SUPABASE_SERVICE_ROLE_KEY: 'dev-service-key',
      UNRELATED: 'kept'
    };
    expect(ensureTestStackEnv(env, exec)).toEqual(TEST_TUPLE);
    expect(env).toMatchObject({ ...TEST_TUPLE, UNRELATED: 'kept' });
    expect(exec).toHaveBeenCalledOnce();
  });

  it('honors a launcher handoff only when it matches the live status exactly, with one CLI call', () => {
    const exec = vi.fn<(...args: unknown[]) => string>(() => testStatusOutput());
    const env: Record<string, string | undefined> = { ...TEST_TUPLE };
    expect(ensureTestStackEnv(env, exec)).toEqual(TEST_TUPLE);
    expect(exec).toHaveBeenCalledOnce();
    expect(env).toMatchObject(TEST_TUPLE);
  });

  it.each([
    ['service key', { SUPABASE_SERVICE_ROLE_KEY: 'stale-service-key' }],
    ['publishable key', { VITE_SUPABASE_PUBLISHABLE_KEY: 'stale-publishable-key' }]
  ])(
    'rejects a complete ambient tuple with a stale %s before anything is collected',
    (_l, stale) => {
      const exec = vi.fn<(...args: unknown[]) => string>(() => testStatusOutput());
      const env: Record<string, string | undefined> = { ...TEST_TUPLE, ...stale };
      const message = failure(() => ensureTestStackEnv(env, exec));
      expect(message).toContain('does not match the running test stack');
      for (const value of Object.values(stale)) expect(message).not.toContain(value);
      for (const secret of SECRETS) expect(message).not.toContain(secret);
      // The stale tuple is not silently replaced or merged.
      expect(env).toMatchObject(stale);
    }
  );

  it('fails closed when no test stack is running even with a complete ambient tuple', () => {
    const exec = () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'not running' });
    };
    const env: Record<string, string | undefined> = { ...TEST_TUPLE };
    expect(failure(() => ensureTestStackEnv(env, exec))).toContain('pnpm test:stack:up');
  });

  it('requireTestEnv refuses an absent or wrong-stack tuple without any dev fallback', () => {
    expect(requireTestEnv({ ...TEST_TUPLE })).toEqual(TEST_TUPLE);
    const message = failure(() => requireTestEnv({ VITE_SUPABASE_URL: 'http://127.0.0.1:55321' }));
    expect(message).toContain('test entrypoint');
    expect(() => requireTestEnv({})).toThrow(TestStackEnvError);
  });

  it('reads a baked .dev.vars value whatever quoting the Cloudflare plugin used', () => {
    const key = 'eyJ.fake.service-key';
    const read = (line: string) =>
      readDevVarsValue(
        `OTHER=x\n${line}\nSUPABASE_SERVICE_ROLE_KEY_X=y\n`,
        'SUPABASE_SERVICE_ROLE_KEY'
      );

    expect(read(`SUPABASE_SERVICE_ROLE_KEY='${key}'`)).toBe(key);
    expect(read(`SUPABASE_SERVICE_ROLE_KEY="${key}"`)).toBe(key);
    expect(read(`SUPABASE_SERVICE_ROLE_KEY=${key}`)).toBe(key);
    expect(readDevVarsValue('OTHER=x\n', 'SUPABASE_SERVICE_ROLE_KEY')).toBeUndefined();
  });
});
