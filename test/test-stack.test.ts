import { lstat, readFile, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  TEST_CONFIG,
  TEST_PROJECT_ID,
  TEST_WORKDIR,
  TestStackError,
  VERBS,
  assertHealthyStatus,
  assertTestConfig,
  cliArgs,
  parseArgs,
  parseSimpleToml,
  readTestConfig,
  runTestStack,
  sanitize
} from '../scripts/test-stack.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const testSupabase = path.join(TEST_WORKDIR, 'supabase');
const STATUS = [
  'API_URL="http://127.0.0.1:55421"',
  'DB_URL="postgresql://postgres:secret-pw@127.0.0.1:55422/postgres"'
].join('\n');

type Call = { command: string; args: string[]; cwd: string };

function fakeRunner(
  responder: (call: Call) => {
    code: number | null;
    signal?: string | null;
    stdout?: string;
    stderr?: string;
  } = () => ({ code: 0 })
) {
  const calls: Call[] = [];
  const runProcess = async (command: string, args: string[], options: { cwd: string }) => {
    const call = { command, args, cwd: options.cwd };
    calls.push(call);
    const result = responder(call);
    const isStatus = args.includes('status');
    return {
      code: result.code,
      signal: result.signal ?? null,
      stdout: result.stdout ?? (isStatus ? STATUS : ''),
      stderr: result.stderr ?? ''
    };
  };
  return { calls, runProcess };
}

const options = (runner: ReturnType<typeof fakeRunner>) => ({
  env: {},
  runProcess: runner.runProcess,
  log: () => {}
});

describe('test stack lifecycle', () => {
  it('pins the absolute test workdir regardless of caller cwd', () => {
    expect(path.isAbsolute(TEST_WORKDIR)).toBe(true);
    expect(TEST_WORKDIR).toBe(path.join(root, 'test/stack'));
    expect(cliArgs('start')).toEqual(['exec', 'supabase', '--workdir', TEST_WORKDIR, 'start']);
  });

  it('up starts the test project then validates healthy status', async () => {
    const runner = fakeRunner();
    await runTestStack(['up'], options(runner));
    expect(runner.calls).toEqual([
      { command: 'pnpm', args: cliArgs('start'), cwd: root },
      { command: 'pnpm', args: cliArgs('status', '-o', 'env'), cwd: root }
    ]);
  });

  it('down only stops the test project without global or volume flags', async () => {
    const runner = fakeRunner();
    await runTestStack(['down'], options(runner));
    expect(runner.calls).toEqual([{ command: 'pnpm', args: cliArgs('stop'), cwd: root }]);
  });

  it('reset requires a running stack, then replays migrations and seed via the CLI only', async () => {
    const runner = fakeRunner();
    await runTestStack(['reset'], options(runner));
    expect(runner.calls.map((call) => call.args.slice(4).join(' '))).toEqual([
      'status -o env',
      'db reset --local',
      'status -o env'
    ]);
    expect(runner.calls.flatMap((call) => call.args)).not.toContain('gen');
  });

  it('reset fails with the up instruction when the stack is not running', async () => {
    const runner = fakeRunner(() => ({ code: 1, stderr: 'not running' }));
    await expect(runTestStack(['reset'], options(runner))).rejects.toThrow('pnpm test:stack:up');
    expect(runner.calls).toHaveLength(1);
  });

  it('accepts only the documented verbs', () => {
    expect(VERBS).toEqual(['up', 'down', 'reset']);
    for (const verb of VERBS) expect(parseArgs([verb], {})).toBe(verb);
  });

  it.each([[[]], [['start']], [['stop']], [['db', 'reset']], [['status']]])(
    'rejects unknown verb %j without spawning',
    async (argv) => {
      const runner = fakeRunner();
      await expect(runTestStack(argv, options(runner))).rejects.toThrow('Usage');
      expect(runner.calls).toHaveLength(0);
    }
  );

  it.each([
    ['--workdir'],
    ['--workdir=.'],
    ['--linked'],
    ['--db-url'],
    ['--project-id'],
    ['--project-ref'],
    ['--all'],
    ['--no-seed']
  ])('rejects target override %s without spawning', async (flag) => {
    const runner = fakeRunner();
    await expect(runTestStack(['reset', flag], options(runner))).rejects.toThrow(
      'Refusing extra arguments'
    );
    expect(runner.calls).toHaveLength(0);
  });

  it('refuses an ambient SUPABASE_WORKDIR', async () => {
    const runner = fakeRunner();
    await expect(
      runTestStack(['up'], { ...options(runner), env: { SUPABASE_WORKDIR: '/somewhere' } })
    ).rejects.toThrow('SUPABASE_WORKDIR');
    expect(runner.calls).toHaveLength(0);
  });

  it('refuses to run against drifted config before any CLI call', async () => {
    const runner = fakeRunner();
    const config = { ...(await readTestConfig()), project_id: 'padel-friend' };
    await expect(
      runTestStack(['down'], { ...options(runner), readConfig: async () => config })
    ).rejects.toThrow('project_id');
    expect(runner.calls).toHaveLength(0);
  });

  it('rejects a status that points at another stack', () => {
    expect(() => assertHealthyStatus(STATUS)).not.toThrow();
    expect(() => assertHealthyStatus(STATUS.replace('55421', '55321'))).toThrow('API endpoint');
    expect(() => assertHealthyStatus(STATUS.replace('55422', '55322'))).toThrow('database');
    expect(() => assertHealthyStatus('')).toThrow(TestStackError);
  });

  it('propagates CLI exit codes and signals', async () => {
    const failed = fakeRunner(() => ({ code: 3 }));
    await expect(runTestStack(['up'], options(failed))).rejects.toMatchObject({ exitCode: 3 });
    const signalled = fakeRunner(() => ({ code: null, signal: 'SIGTERM' }));
    await expect(runTestStack(['down'], options(signalled))).rejects.toMatchObject({
      exitCode: 143
    });
  });

  it('keeps secrets out of diagnostics', async () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZSJ9.c2lnbmF0dXJl';
    const runner = fakeRunner(() => ({
      code: 1,
      stderr: [
        'SERVICE_ROLE_KEY=' + jwt,
        'token ' + jwt,
        'postgresql://postgres:hunter2@127.0.0.1:55422/postgres',
        'sb_secret_abcDEF123',
        'container unhealthy'
      ].join('\n')
    }));
    const error = await runTestStack(['up'], options(runner)).catch((caught) => caught);
    expect(error.message).toContain('container unhealthy');
    for (const leaked of [jwt, 'hunter2', 'sb_secret_abcDEF123'])
      expect(error.message).not.toContain(leaked);
    expect(sanitize('a\n\n b')).toBe('a\n b');
  });
});

describe('test stack project files', () => {
  it('matches the fixed config contract with distinct ports', async () => {
    const config = await readTestConfig();
    expect(() => assertTestConfig(config)).not.toThrow();
    expect(config.project_id).toBe(TEST_PROJECT_ID);
    expect(() => assertTestConfig({ ...config, 'api.port': 55321 })).toThrow('api.port');
    const ports = Object.entries(TEST_CONFIG)
      .filter(([key]) => key.endsWith('port'))
      .map(([, port]) => port);
    expect(new Set(ports).size).toBe(ports.length);
  });

  it('shares non-port settings with the dev config and never overlaps its identity or ports', async () => {
    const dev = parseSimpleToml(await readFile(path.join(root, 'supabase/config.toml'), 'utf8'));
    const test = await readTestConfig();
    const shared = [
      'auth.site_url',
      'auth.additional_redirect_urls',
      'auth.email.enable_confirmations',
      'auth.email.template.invite.subject',
      'auth.email.template.invite.content_path',
      'auth.external.keycloak.enabled',
      'auth.external.keycloak.client_id',
      'auth.external.keycloak.secret',
      'auth.external.keycloak.skip_nonce_check'
    ];
    for (const key of shared) {
      expect(dev[key]).toBeDefined();
      expect(test[key]).toEqual(dev[key]);
    }
    expect(test['auth.additional_redirect_urls']).toEqual(
      expect.arrayContaining(['http://127.0.0.1:3000/**', 'http://127.0.0.1:4173/**'])
    );
    expect(test.project_id).not.toBe(dev.project_id);
    const devPorts = Object.entries(dev)
      .filter(([key]) => key.endsWith('port'))
      .map(([, port]) => port);
    const testPorts = Object.entries(test)
      .filter(([key]) => key.endsWith('port'))
      .map(([, port]) => port);
    expect(testPorts.filter((port) => devPorts.includes(port))).toEqual([]);
    expect(test['auth.external.keycloak.url']).toBe(
      'http://host.docker.internal:55499/realms/controlled'
    );
    expect(test['auth.external.keycloak.redirect_uri']).toBe(
      'http://127.0.0.1:55421/auth/v1/callback'
    );
  });

  it.each([
    ['migrations', '../../../supabase/migrations', 'supabase/migrations'],
    ['seed.sql', '../../../supabase/seed.sql', 'supabase/seed.sql']
  ])('links %s to the canonical file', async (name, target, canonical) => {
    const link = path.join(testSupabase, name);
    expect((await lstat(link)).isSymbolicLink()).toBe(true);
    expect(await readlink(link)).toBe(target);
    expect(await realpath(link)).toBe(await realpath(path.join(root, canonical)));
  });

  it('keeps the invite template identical to the canonical one', async () => {
    const copy = path.join(testSupabase, 'templates/invite.html');
    expect((await lstat(copy)).isFile()).toBe(true);
    expect(await readFile(copy)).toEqual(
      await readFile(path.join(root, 'supabase/templates/invite.html'))
    );
  });

  it('ignores nested CLI artifacts and exposes the lifecycle scripts', async () => {
    const ignore = await readFile(path.join(root, '.gitignore'), 'utf8');
    for (const entry of ['test/stack/supabase/.temp/', 'test/stack/supabase/.branches/'])
      expect(ignore.split('\n')).toContain(entry);
    const scripts = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')).scripts;
    expect(scripts['test:stack:up']).toBe('node scripts/test-stack.mjs up');
    expect(scripts['test:stack:down']).toBe('node scripts/test-stack.mjs down');
    expect(scripts['test:stack:reset']).toBe('node scripts/test-stack.mjs reset');
  });
});
