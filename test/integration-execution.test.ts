import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, relative, resolve } from 'node:path';
import { PARALLEL_INTEGRATION_FILES } from '../integration-partition';
import {
  e2eBuildEnv,
  localServiceRoleKey,
  requireServiceRoleKey,
  resolveServiceRoleKey
} from '../scripts/e2e-build-env.mjs';
import {
  INTEGRATION_DB_URL_ENV,
  LOCAL_DB_NAME,
  LOCAL_DB_PORT,
  assertHandoffDatabaseUrl,
  handoffDatabaseUrl,
  resolveLocalDatabaseUrl
} from '../scripts/integration-db-url.mjs';
import {
  excludeArgs,
  fileFilters,
  phaseArgs,
  runIntegration
} from '../scripts/run-integration.mjs';

const noUrl = () => undefined;

type Call = { args: string[]; env: Record<string, string | undefined> };

function recorder(statuses: number[] = []) {
  const calls: Call[] = [];
  const run = (
    _command: string,
    args: string[],
    options: { env: Record<string, string | undefined> }
  ) => {
    calls.push({ args, env: options.env });
    return { status: statuses[calls.length - 1] ?? 0 };
  };
  return { calls, run };
}

const integrationFiles = [
  ...readdirSync('test')
    .filter((name) => name.endsWith('.integration.test.ts'))
    .map((name) => `test/${name}`),
  ...readdirSync('test/helpers')
    .filter((name) => name.endsWith('.integration.test.ts'))
    .map((name) => `test/helpers/${name}`)
];

describe('integration partition', () => {
  it('lists only existing, unique integration files', () => {
    expect(new Set(PARALLEL_INTEGRATION_FILES).size).toBe(PARALLEL_INTEGRATION_FILES.length);
    expect(integrationFiles).toEqual(expect.arrayContaining([...PARALLEL_INTEGRATION_FILES]));
  });

  it('never marks cron, port, rating-projection, statistics or race suites parallel-safe', () => {
    const unsafe = PARALLEL_INTEGRATION_FILES.filter((file) =>
      /cutoff|oauth|rating\.(races|backfill|projection)|statistics\.(races|projection|schema)|races/.test(
        file
      )
    );
    expect(unsafe).toEqual([]);
  });
});

const DDL_PATTERN =
  /disable\s+trigger|enable\s+trigger|session_replication_role|alter\s+table[^;'`]*trigger/i;
const DDL_HELPER_MODULES = [
  'provisional-player-fixtures',
  'match-management-fixtures',
  'match-add-player-fixtures',
  'match-registration-sql'
];

function resolveImport(from: string, specifier: string): string | undefined {
  const base = resolve(dirname(from), specifier);
  return [`${base}.ts`, base, `${base}/index.ts`].find(
    (candidate) => candidate.endsWith('.ts') && existsSync(candidate)
  );
}

function transitiveSources(entry: string): string[] {
  const seen = new Set<string>();
  const visit = (file: string) => {
    if (seen.has(file)) return;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(
      /from\s+['"](\.[^'"]+)['"]|import\(\s*['"](\.[^'"]+)['"]/g
    )) {
      const specifier = match[1] ?? match[2];
      const resolved = specifier ? resolveImport(file, specifier) : undefined;
      if (resolved) visit(resolved);
    }
  };
  visit(resolve(entry));
  return [...seen];
}

describe('parallel partition DDL-free contract', () => {
  it.each([...PARALLEL_INTEGRATION_FILES])(
    '%s has no trigger DDL in its transitive test imports',
    (file) => {
      const sources = transitiveSources(file);
      const ddlModules = sources.filter((source) => DDL_PATTERN.test(readFileSync(source, 'utf8')));
      const helperImports = sources.filter((source) =>
        DDL_HELPER_MODULES.some((helper) => source.endsWith(`/${helper}.ts`))
      );
      expect(ddlModules.map((source) => relative(process.cwd(), source))).toEqual([]);
      expect(helperImports.map((source) => relative(process.cwd(), source))).toEqual([]);
    }
  );
});

describe('phaseArgs', () => {
  it('suffixes the JSON report path per phase and keeps other args', () => {
    expect(
      phaseArgs(['--outputFile.json=artifacts/r.json', '--reporter=json', 'a'], 'serial')
    ).toEqual(['--outputFile.json=artifacts/r.serial.json', '--reporter=json', 'a']);
  });

  it('suffixes the two-argument report path form', () => {
    expect(phaseArgs(['--outputFile.json', 'r.json'], 'parallel')).toEqual([
      '--outputFile.json',
      'r.parallel.json'
    ]);
  });
});

describe('fileFilters', () => {
  it('skips the separate value of known options', () => {
    expect(fileFilters(['--reporter', 'basic', 'test/a.integration.test.ts', '-t', 'x'])).toEqual([
      'test/a.integration.test.ts'
    ]);
    expect(fileFilters(['--reporter', 'basic'])).toEqual([]);
    expect(fileFilters(['--reporter=basic', 'a'])).toEqual(['a']);
  });
});

// .github/workflows/ci.yml decides whether the populated-upgrade harness runs from
// `git diff --name-only --no-renames $BASE_SHA HEAD`; this pins the diff semantics it relies on.
describe('populated-upgrade path gate diff semantics', () => {
  it('lists both rename endpoints only with --no-renames', () => {
    const repo = mkdtempSync(resolve(tmpdir(), 'rename-gate-'));
    const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });
    try {
      git('init', '-q');
      git('config', 'user.email', 'test@example.com');
      git('config', 'user.name', 'Test');
      git('config', 'commit.gpgsign', 'false');
      mkdirSync(resolve(repo, 'supabase/migrations'), { recursive: true });
      writeFileSync(resolve(repo, 'supabase/migrations/001_init.sql'), 'select 1;\n'.repeat(20));
      git('add', '.');
      git('commit', '-q', '-m', 'base');
      const base = git('rev-parse', 'HEAD').trim();
      mkdirSync(resolve(repo, 'docs'));
      renameSync(
        resolve(repo, 'supabase/migrations/001_init.sql'),
        resolve(repo, 'docs/001_init.sql')
      );
      git('add', '-A');
      git('commit', '-q', '-m', 'move out of watched path');

      const lines = (...flags: string[]) =>
        git('diff', '--name-only', ...flags, base, 'HEAD')
          .trim()
          .split('\n');
      expect(lines()).toEqual(['docs/001_init.sql']);
      expect(lines('--no-renames')).toEqual([
        'docs/001_init.sql',
        'supabase/migrations/001_init.sql'
      ]);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  });

  it('keeps --no-renames in the workflow gate', () => {
    expect(readFileSync('.github/workflows/ci.yml', 'utf8')).toContain(
      'git diff --name-only --no-renames "$BASE_SHA" HEAD'
    );
  });
});

describe('e2e build env contract', () => {
  it('derives the webServer env from the shared module the gate build also uses', () => {
    const config = readFileSync('playwright.config.ts', 'utf8');
    const gate = readFileSync('scripts/complete-check.mjs', 'utf8');
    expect(config).toMatch(/from '\.\/scripts\/e2e-build-env\.mjs'/);
    expect(config).toContain('localServiceRoleKey(');
    // The gate must fail closed (require), never fall back to a keyless build.
    expect(gate).toMatch(/from '\.\/e2e-build-env\.mjs'/);
    expect(gate).toContain('requireServiceRoleKey(');
    expect(gate).not.toContain('localServiceRoleKey(');
    for (const source of [config, gate]) expect(source).toContain('e2eBuildEnv(');
    expect(config).not.toContain('CLOUDFLARE_INCLUDE_PROCESS_ENV');
    expect(gate).not.toContain('CLOUDFLARE_INCLUDE_PROCESS_ENV');
  });

  it('adds the process-env bake flag and key only when a key exists', () => {
    expect(e2eBuildEnv('k')).toEqual({
      CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true',
      SUPABASE_SERVICE_ROLE_KEY: 'k',
      WEB_PUSH_ENABLED: 'true',
      WEB_PUSH_VAPID_PUBLIC_KEY: expect.stringMatching(/^[A-Za-z0-9_-]{87}$/),
      WEB_PUSH_VAPID_KEY_ID: 'e2e-test'
    });
    expect(e2eBuildEnv(undefined)).toEqual({});
  });

  it('resolves the key from the env first, then the local stack, and exports a found key', () => {
    const exec = vi.fn<() => string>(() => 'SERVICE_ROLE_KEY="from-stack"\n');
    expect(localServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: 'from-env' }, exec)).toBe('from-env');
    expect(exec).not.toHaveBeenCalled();
    const env: Record<string, string | undefined> = {};
    expect(localServiceRoleKey(env, exec)).toBe('from-stack');
    expect(env.SUPABASE_SERVICE_ROLE_KEY).toBe('from-stack');
    expect(
      localServiceRoleKey({}, () => {
        throw new Error('no stack');
      })
    ).toBeUndefined();
  });

  it('parses the key out of realistic supabase status output', () => {
    const output =
      'API_URL="http://127.0.0.1:55321"\nANON_KEY="a.b.c"\nSERVICE_ROLE_KEY="x.y.z"\nSTUDIO_URL="http://127.0.0.1:55323"\n';
    expect(resolveServiceRoleKey({}, () => output)).toEqual({ key: 'x.y.z' });
  });

  it('propagates the exec failure instead of swallowing it, and requireServiceRoleKey throws it', () => {
    const failing = () => {
      throw Object.assign(new Error('exit 1'), { stderr: 'docker daemon not running\n' });
    };
    expect(resolveServiceRoleKey({}, failing).reason).toContain('docker daemon not running');
    expect(() => requireServiceRoleKey({}, failing)).toThrow(/docker daemon not running/);
    expect(() => requireServiceRoleKey({}, failing)).toThrow(/SUPABASE_SERVICE_ROLE_KEY/);
    expect(() => requireServiceRoleKey({}, () => 'API_URL="u"\n')).toThrow(/no SERVICE_ROLE_KEY/);
    expect(requireServiceRoleKey({ SUPABASE_SERVICE_ROLE_KEY: 'k' }, failing)).toBe('k');
  });
});

describe('excludeArgs', () => {
  it('collects both --exclude forms and nothing else', () => {
    expect(
      excludeArgs(['a.test.ts', '--exclude=b', '--exclude', 'c', '--reporter', 'basic'])
    ).toEqual(['--exclude=b', '--exclude', 'c']);
  });
});

describe('runIntegration', () => {
  it('runs the parallel phase before the serial phase with phase env', () => {
    const { calls, run } = recorder();
    expect(runIntegration({ resolveDatabaseUrl: noUrl, args: [], env: {}, run })).toBe(0);
    expect(calls.map((call) => call.env.INTEGRATION_PHASE)).toEqual(['parallel', 'serial']);
  });

  it('runs one phase-less invocation for the serial rollback', () => {
    const { calls, run } = recorder();
    runIntegration({
      resolveDatabaseUrl: noUrl,
      args: [],
      env: { INTEGRATION_SERIAL: '1', INTEGRATION_PHASE: 'parallel' },
      run
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.env.INTEGRATION_PHASE).toBeUndefined();
  });

  it('forwards filters, tolerates empty phases for filters and keeps per-phase reports', () => {
    const { calls, run } = recorder();
    runIntegration({
      resolveDatabaseUrl: noUrl,
      args: ['test/a.integration.test.ts', '--outputFile.json=o.json'],
      env: {},
      run
    });
    expect(calls[0]?.args).toEqual(
      expect.arrayContaining([
        '--passWithNoTests',
        'test/a.integration.test.ts',
        '--outputFile.json=o.parallel.json'
      ])
    );
    expect(calls[1]?.args).toContain('--outputFile.json=o.serial.json');
  });

  it('does not tolerate empty runs without filters', () => {
    const { calls, run } = recorder();
    runIntegration({ resolveDatabaseUrl: noUrl, args: ['--reporter=default'], env: {}, run });
    expect(calls[0]?.args).not.toContain('--passWithNoTests');
  });

  it('treats a separate option value as no filter', () => {
    const { calls, run } = recorder();
    const countFiles = vi.fn<() => number>(() => 0);
    expect(
      runIntegration({
        resolveDatabaseUrl: noUrl,
        args: ['--reporter', 'basic'],
        env: {},
        run,
        countFiles
      })
    ).toBe(0);
    expect(countFiles).not.toHaveBeenCalled();
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).not.toContain('--passWithNoTests');
  });

  it('fails without running vitest when the filters match no file in any phase', () => {
    const { calls, run } = recorder();
    const countFiles = vi.fn<() => number>(() => 0);
    expect(
      runIntegration({
        resolveDatabaseUrl: noUrl,
        args: ['test/nope.test.ts'],
        env: {},
        run,
        countFiles
      })
    ).toBe(1);
    expect(countFiles).toHaveBeenCalledTimes(2);
    expect(calls).toEqual([]);
  });

  it.each([
    ['equals form', ['--exclude=test/a.test.ts']],
    ['separate form', ['--exclude', 'test/a.test.ts']]
  ])('counts matches with the excludes the real runs receive (%s)', (_label, exclude) => {
    const { calls, run } = recorder();
    const countFiles = vi.fn<
      (env: Record<string, string | undefined>, selection: string[]) => number
    >((_env, selection) => (selection.some((arg) => arg.includes('--exclude')) ? 0 : 1));
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(
        runIntegration({
          resolveDatabaseUrl: noUrl,
          args: ['test/a.test.ts', ...exclude],
          env: {},
          run,
          countFiles
        })
      ).toBe(1);
      expect(String(write.mock.calls[0]?.[0])).toContain('no integration test file matches');
    } finally {
      write.mockRestore();
    }
    expect(countFiles.mock.calls[0]?.[1]).toEqual(['test/a.test.ts', ...exclude]);
    expect(calls).toEqual([]);
  });

  it('passes when only one phase matches the filters', () => {
    const { calls, run } = recorder();
    const countFiles = (env: Record<string, string | undefined>) =>
      env.INTEGRATION_PHASE === 'serial' ? 1 : 0;
    expect(
      runIntegration({
        resolveDatabaseUrl: noUrl,
        args: ['test/a.test.ts'],
        env: {},
        run,
        countFiles
      })
    ).toBe(0);
    expect(calls).toHaveLength(2);
    expect(calls[0]?.args).toContain('--passWithNoTests');
  });

  it('still runs when the match listing is unavailable', () => {
    const { calls, run } = recorder();
    expect(
      runIntegration({
        resolveDatabaseUrl: noUrl,
        args: ['test/a.test.ts'],
        env: {},
        run,
        countFiles: () => undefined
      })
    ).toBe(0);
    expect(calls).toHaveLength(2);
  });

  it.each(['parallel', 'serial'])(
    'runs only the %s phase when INTEGRATION_PHASE selects it',
    (phase) => {
      const { calls, run } = recorder();
      expect(
        runIntegration({
          resolveDatabaseUrl: noUrl,
          args: [],
          env: { INTEGRATION_PHASE: phase },
          run
        })
      ).toBe(0);
      expect(calls.map((call) => call.env.INTEGRATION_PHASE)).toEqual([phase]);
    }
  );

  it('rejects an invalid INTEGRATION_PHASE listing the valid values', () => {
    const { calls, run } = recorder();
    const write = vi.spyOn(process.stderr, 'write').mockReturnValue(true);
    try {
      expect(
        runIntegration({
          resolveDatabaseUrl: noUrl,
          args: [],
          env: { INTEGRATION_PHASE: 'bogus' },
          run
        })
      ).toBe(2);
      expect(String(write.mock.calls[0]?.[0])).toContain('parallel, serial');
    } finally {
      write.mockRestore();
    }
    expect(calls).toEqual([]);
  });

  it('runs both phases after a failure and returns the first failing status', () => {
    const { calls, run } = recorder([3, 1]);
    expect(runIntegration({ resolveDatabaseUrl: noUrl, args: [], env: {}, run })).toBe(3);
    expect(calls).toHaveLength(2);
  });
});

const LOCAL_URL = `postgresql://postgres:s3cr3t-pw@127.0.0.1:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`;

describe('integration DB URL handoff', () => {
  it('keeps the expected port equal to the [db] port in supabase/config.toml', () => {
    const config = readFileSync(resolve(__dirname, '../supabase/config.toml'), 'utf8');
    expect(/^\[db\]\s*\nport = (\d+)/m.exec(config)?.[1]).toBe(LOCAL_DB_PORT);
  });

  it('uses a private name that cannot reach browser bundles', () => {
    expect(INTEGRATION_DB_URL_ENV).not.toMatch(/^VITE_/);
  });

  it.each([
    LOCAL_URL,
    `postgres://u:p@localhost:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`,
    `postgresql://u:p@[::1]:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`
  ])('accepts the local Supabase URL %#', (value) => {
    expect(assertHandoffDatabaseUrl(value)).toBe(value);
  });

  it.each([
    ['malformed', 'not a url with s3cr3t-pw'],
    ['empty', ''],
    ['non-PostgreSQL', `http://u:s3cr3t-pw@127.0.0.1:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`],
    ['non-loopback', `postgresql://u:s3cr3t-pw@db.example.com:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}`],
    ['wrong port', `postgresql://u:s3cr3t-pw@127.0.0.1:5432/${LOCAL_DB_NAME}`],
    ['missing port', `postgresql://u:s3cr3t-pw@127.0.0.1/${LOCAL_DB_NAME}`],
    [
      'connection parameter override',
      `postgresql://u:s3cr3t-pw@127.0.0.1:${LOCAL_DB_PORT}/${LOCAL_DB_NAME}?host=remote.example`
    ],
    ['wrong database', `postgresql://u:s3cr3t-pw@127.0.0.1:${LOCAL_DB_PORT}/other`]
  ])('fails closed on a %s value without echoing it', (_label, value) => {
    let message = '';
    try {
      assertHandoffDatabaseUrl(value);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain(INTEGRATION_DB_URL_ENV);
    expect(message).not.toContain('s3cr3t-pw');
    expect(message).not.toContain(value || '\0');
  });

  it('reads the variable, treats absence as standalone and an empty value as invalid', () => {
    expect(handoffDatabaseUrl({ [INTEGRATION_DB_URL_ENV]: LOCAL_URL })).toBe(LOCAL_URL);
    expect(handoffDatabaseUrl({})).toBeUndefined();
    expect(() => handoffDatabaseUrl({ [INTEGRATION_DB_URL_ENV]: '' })).toThrow(/is invalid/);
  });

  it('resolves the launcher URL from supabase status output', () => {
    const exec = vi.fn<() => string>(
      () => `API_URL="http://127.0.0.1:55321"\nDB_URL="${LOCAL_URL}"\n`
    );
    expect(resolveLocalDatabaseUrl(exec)).toBe(LOCAL_URL);
    expect(exec).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'status fails',
      () => {
        throw new Error('status failed');
      }
    ],
    ['no DB_URL', () => 'API_URL="http://127.0.0.1:55321"'],
    ['non-loopback DB_URL', () => 'DB_URL="postgresql://u:p@db.example.com:55322/postgres"']
  ])('leaves the launcher URL unresolved when %s', (_label, exec) => {
    expect(resolveLocalDatabaseUrl(exec)).toBeUndefined();
  });

  it('hands the resolved URL to every phase and the file count, replacing a stale inherited value', () => {
    const { calls, run } = recorder();
    const countFiles = vi.fn<(env: Record<string, string | undefined>) => number>(() => 1);
    runIntegration({
      args: ['test/a.test.ts'],
      env: { [INTEGRATION_DB_URL_ENV]: 'stale' },
      run,
      countFiles,
      resolveDatabaseUrl: () => LOCAL_URL
    });
    expect(calls.map((call) => call.env[INTEGRATION_DB_URL_ENV])).toEqual([LOCAL_URL, LOCAL_URL]);
    expect(countFiles.mock.calls[0]?.[0][INTEGRATION_DB_URL_ENV]).toBe(LOCAL_URL);
  });

  it('resolves once per run and never passes the URL as an argument', () => {
    const { calls, run } = recorder();
    const resolveDatabaseUrl = vi.fn<() => string>(() => LOCAL_URL);
    runIntegration({ args: [], env: {}, run, resolveDatabaseUrl });
    expect(resolveDatabaseUrl).toHaveBeenCalledOnce();
    expect(JSON.stringify(calls.map((call) => call.args))).not.toContain('s3cr3t-pw');
  });

  it('drops an inherited value when the launcher cannot resolve, so children discover as before', () => {
    const { calls, run } = recorder();
    runIntegration({
      args: [],
      env: { [INTEGRATION_DB_URL_ENV]: LOCAL_URL },
      run,
      resolveDatabaseUrl: noUrl
    });
    expect(calls.every((call) => !(INTEGRATION_DB_URL_ENV in call.env))).toBe(true);
  });
});
