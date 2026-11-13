import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  main,
  runMigrations,
  type MigrationFS,
  type MigrationOptions
} from '../scripts/production-migrations.mjs';

import { guardRelease, type GuardExec } from '../scripts/production-release-guard.mjs';

vi.mock('node:child_process', () => ({
  spawnSync: vi.fn<() => never>(() => {
    throw new Error('Real executor forbidden');
  }),
  execFileSync: vi.fn<() => never>(() => {
    throw new Error('Real executor forbidden');
  })
}));

const PROJECT = 'nojecmdknaebczpfnfwa';
const ROOT = '/runner/production-migrations-fixture';
const SOURCE = '/checkout/supabase/migrations';
const COPY = ROOT + '/supabase/migrations';
const FIRST = '20261101090000_first.sql';
const SECOND = '20261102090000_second.sql';
const CANARIES = [
  'canary-access-token',
  'canary-db-password',
  'canary-cloudflare-token',
  'canary-github-token',
  'canary-release-body'
];
const RELEASE_URL = 'https://api.github.com/repos/owner/repo/releases/tags/v0.1.1';
const bytes = (value: string) => Buffer.from(value);
const sql = bytes('select 1;\r\n-- exact bytes\n');
const failure = CANARIES.join(' ') + ' postgres://private SQL';
const encoded = (value: object) => ({ status: 0, stdout: JSON.stringify(value), stderr: failure });

// Shapes verified against the v2.121.0 JSON output layer, db-push-core and list.format source.
function pushResult(names: string[], dryRun: boolean) {
  return {
    upToDate: names.length === 0,
    dryRun,
    migrations: names,
    seeds: [],
    roles: [],
    message: names.length ? 'Finished supabase db push.' : 'Remote database is up to date.'
  };
}
function history(applied: number, names: string[] = [FIRST, SECOND]) {
  return {
    message: 'Migrations listed',
    migrations: names.map((name, index) => ({
      local: name.slice(0, 14),
      remote: index < applied ? name.slice(0, 14) : '',
      time: '2026-11-01 09:00:00'
    }))
  };
}

type Entry = { type: 'file' | 'directory' | 'symlink' | 'other'; data: Uint8Array };
function fixture(initiallyApplied = 1) {
  const entries = new Map<string, Entry>();
  const put = (file: string, value: string | Uint8Array, type: Entry['type'] = 'file') =>
    entries.set(file, { type, data: typeof value === 'string' ? bytes(value) : value });
  const fs: MigrationFS = {
    type: async (file) => {
      const entry = entries.get(file);
      if (!entry) throw new Error(failure);
      return entry.type;
    },
    exists: async (file) => entries.has(file),
    list: async (dir) =>
      [...entries.keys()]
        .filter((file) => path.dirname(file) === dir)
        .map((file) => path.basename(file)),
    read: async (file) => {
      const entry = entries.get(file);
      if (!entry) throw new Error(failure);
      return entry.data;
    },
    write: async (file, value) => {
      put(file, value);
    },
    mkdir: async (dir) => {
      if (!entries.has(dir)) {
        put(dir, '', 'directory');
        await fs.mkdir(path.dirname(dir));
      }
    },
    mkdtemp: async () => {
      await fs.mkdir(ROOT);
      return ROOT;
    },
    remove: async (dir) => {
      for (const file of entries.keys())
        if (file === dir || file.startsWith(dir + '/')) entries.delete(file);
    }
  };
  put('/', '', 'directory');
  put('/checkout', '', 'directory');
  put('/checkout/supabase', '', 'directory');
  put(SOURCE, '', 'directory');
  put(SOURCE + '/' + FIRST, sql);
  put(SOURCE + '/' + SECOND, bytes('select 2;\n'));
  put('/checkout/supabase/config.toml', 'FORBIDDEN root OAuth/Vault config');
  put('/checkout/supabase/seed.sql', 'FORBIDDEN seed');
  put('/checkout/supabase/roles.sql', 'FORBIDDEN roles');
  put('/checkout/.env', 'FORBIDDEN env');
  const trace: string[] = [];
  const state = {
    applied: initiallyApplied,
    afterLink: () => {},
    failCommand: '',
    throwCommand: '',
    version: '2.121.0',
    project: PROJECT,
    linked: PROJECT,
    pooler: `postgresql://postgres.${PROJECT}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    names: [FIRST, SECOND],
    marker: undefined as string | undefined,
    release: undefined as unknown,
    releaseOk: true,
    badHistory: false,
    gapHistory: false,
    malformed: '',
    badPlan: false,
    noApply: false,
    afterDry: () => {},
    status: 0
  };
  const exec = vi.fn<MigrationOptions['exec']>((file, args) => {
    const command = args
      .slice(2, args.indexOf('--workdir') === -1 ? undefined : args.indexOf('--workdir'))
      .join(' ');
    trace.push(command);
    if (file !== 'pnpm' || args[0] !== 'exec' || args[1] !== 'supabase')
      throw new Error('Unexpected executor');
    const allowed = [
      '--version',
      `link --project-ref ${PROJECT}`,
      'migration list --linked',
      'db push --linked --skip-vault --dry-run',
      'db push --linked --skip-vault'
    ];
    const suffix = args.slice(args.indexOf('--workdir'));
    if (
      !allowed.includes(command) ||
      (command !== '--version' &&
        JSON.stringify(suffix) !==
          JSON.stringify(['--workdir', ROOT, '--output-format', 'json', '--yes']))
    )
      throw new Error('Unexpected CLI stage or flags');
    if (command === state.throwCommand) throw new Error(failure);
    if (command === state.failCommand) return { status: 17, stdout: failure, stderr: failure };
    if (command === '--version')
      return { status: 0, stdout: state.version + '\n', stderr: failure };
    if (command.startsWith('link ')) {
      put(ROOT + '/supabase/.temp', '', 'directory');
      put(ROOT + '/supabase/.temp/project-ref', state.linked);
      put(ROOT + '/supabase/.temp/linked-project.json', JSON.stringify({ ref: state.linked }));
      put(ROOT + '/supabase/.temp/pooler-url', state.pooler);
      state.afterLink();
      return encoded({ project_ref: state.linked, message: '' });
    }
    if (command === state.malformed) return { status: 0, stdout: failure, stderr: failure };
    if (command === 'migration list --linked') {
      const result = history(state.applied, state.names);
      if (state.badHistory)
        result.migrations.push({ local: '', remote: '20261103090000', time: '' });
      if (state.gapHistory) result.migrations.reverse();
      return encoded(result);
    }
    if (command.startsWith('db push ')) {
      const pending = state.names.slice(state.applied);
      const dryRun = command.includes('--dry-run');
      if (dryRun) state.afterDry();
      else if (!state.noApply) state.applied = state.names.length;
      return encoded(pushResult(state.badPlan ? ['20261103090000_unknown.sql'] : pending, dryRun));
    }
    throw new Error('Unexpected command');
  });
  const fetch = vi.fn<MigrationOptions['fetch']>(async (url) => {
    trace.push('GET ' + url);
    if (url === RELEASE_URL) {
      const marker =
        state.marker ??
        'Approved-pending: ' +
          (state.names
            .slice(state.applied)
            .map((name) => name.slice(0, 14))
            .join(',') || 'none');
      const release =
        state.release === undefined
          ? { tag_name: 'v0.1.1', draft: false, body: `Notes ${CANARIES[4]}\n${marker}\n` }
          : state.release;
      return { ok: state.releaseOk, json: async () => release };
    }
    return {
      ok: true,
      json: async () => ({
        ref: state.project,
        status: 'ACTIVE_HEALTHY',
        database: { host: `db.${PROJECT}.supabase.co` }
      })
    };
  });
  const out = { write: vi.fn<(value: string) => unknown>() };
  const options: MigrationOptions = {
    env: {
      PATH: '/fake/bin',
      SUPABASE_ACCESS_TOKEN: CANARIES[0],
      SUPABASE_DB_PASSWORD: CANARIES[1],
      CLOUDFLARE_ACCOUNT_ID: 'account',
      CLOUDFLARE_API_TOKEN: CANARIES[2],
      VITE_SUPABASE_URL: `https://${PROJECT}.supabase.co`,
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_fixture',
      SUPABASE_PROJECT_ID: 'foreign',
      PGHOST: 'foreign',
      RELEASE_PLEASE_TOKEN: 'private-release-pat',
      GITHUB_TOKEN: CANARIES[3],
      GITHUB_REPOSITORY: 'owner/repo',
      RELEASE_TAG: 'v0.1.1'
    },
    checkout: '/checkout',
    runnerTemp: '/runner',
    fs,
    exec,
    fetch,
    out
  };
  return { options, entries, put, state, trace, exec, fetch, out };
}

type Fixture = ReturnType<typeof fixture>;
const RELEASE_SHA = 'a'.repeat(40);
const NEWER_SHA = 'b'.repeat(40);
const APPLY = 'db push --linked --skip-vault';
const DRY = APPLY + ' --dry-run';

function replaceResult(
  f: Fixture,
  command: string,
  change: (result: ReturnType<MigrationOptions['exec']>) => ReturnType<MigrationOptions['exec']>,
  occurrence = 1
) {
  const original = f.exec.getMockImplementation()!;
  let seen = 0;
  f.exec.mockImplementation((file, args, options) => {
    const result = original(file, args, options);
    const stage = args.slice(2, args.indexOf('--workdir')).join(' ');
    return stage === command && ++seen === occurrence ? change(result) : result;
  });
}

function releaseRefs() {
  return { head: RELEASE_SHA, tag: RELEASE_SHA, main: RELEASE_SHA };
}

function verifyRelease(refs: ReturnType<typeof releaseRefs>) {
  const exec: GuardExec = (_file, args) => {
    const command = args.join(' ');
    if (command === 'rev-parse --verify HEAD^{commit}') return refs.head;
    if (command === 'ls-remote --exit-code origin refs/tags/v0.1.1 refs/tags/v0.1.1^{}')
      return `${refs.tag}\trefs/tags/v0.1.1\n`;
    if (command === 'ls-remote --exit-code origin refs/heads/main')
      return `${refs.main}\trefs/heads/main\n`;
    throw new Error('Unexpected git command');
  };
  guardRelease(
    {
      repository: 'owner/repo',
      created: 'true',
      tag: 'v0.1.1',
      releaseSha: RELEASE_SHA,
      event: {
        repository: { full_name: 'owner/repo' },
        workflow_run: {
          event: 'push',
          conclusion: 'success',
          head_branch: 'main',
          head_sha: RELEASE_SHA,
          head_repository: { full_name: 'owner/repo' }
        }
      }
    },
    exec
  );
}

// Real helper composition, not a GitHub scheduler/approval emulator. Workflow tests
// independently prove these commands are success-chained in one protected job.
async function approvedAttempt(
  f: Fixture,
  refs: ReturnType<typeof releaseRefs>,
  worker: () => Promise<void>
) {
  verifyRelease(refs);
  const result = await runMigrations(f.options);
  verifyRelease(refs);
  await worker();
  return result;
}

beforeEach(() => {
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real fetch forbidden'));
});
afterEach(() => {
  if (
    vi.mocked(spawnSync).mock.calls.length > 0 ||
    vi.mocked(execFileSync).mock.calls.length > 0 ||
    vi.mocked(globalThis.fetch).mock.calls.length > 0
  )
    throw new Error('Default IO reached; injectable boundary violated');
  vi.restoreAllMocks();
});

describe('production migration operation', () => {
  it('copies exact bytes/hash and applies only verified pending SQL, then checks no pending/history', async () => {
    const f = fixture();
    let copied: Uint8Array | undefined;
    let config = '';
    f.state.afterDry = () => {
      copied = f.entries.get(COPY + '/' + FIRST)?.data;
      config = Buffer.from(f.entries.get(ROOT + '/supabase/config.toml')!.data).toString();
    };
    await expect(runMigrations(f.options)).resolves.toEqual({ applied: 1, total: 2 });
    expect(copied).toEqual(sql);
    expect(config).toContain('[db.seed]\nenabled = false\nsql_paths = []');
    expect(config).not.toMatch(/OAuth|vault|roles|FORBIDDEN/);
    expect(f.trace).toEqual([
      '--version',
      `GET https://api.supabase.com/v1/projects/${PROJECT}`,
      `link --project-ref ${PROJECT}`,
      'migration list --linked',
      'db push --linked --skip-vault --dry-run',
      `GET ${RELEASE_URL}`,
      'db push --linked --skip-vault',
      'db push --linked --skip-vault --dry-run',
      'migration list --linked'
    ]);
    expect(
      f.exec.mock.calls.slice(1).map(([, args]) => args.slice(args.indexOf('--workdir')))
    ).toEqual(
      Array.from({ length: 6 }, () => ['--workdir', ROOT, '--output-format', 'json', '--yes'])
    );
    expect(f.out.write).toHaveBeenCalledWith(
      `Migration manifest: ${FIRST.slice(0, 14)} ${createHash('sha256').update(sql).digest('hex')}\n`
    );
    expect(f.out.write).toHaveBeenLastCalledWith(
      'Production migrations verified: applied=1 total=2\n'
    );
    expect([...f.entries.keys()].filter((file) => file.startsWith(ROOT))).toEqual([]);
  });

  it('still links, dry-runs, pushes and verifies an approved no-op release', async () => {
    const f = fixture(2);
    await expect(runMigrations(f.options)).resolves.toEqual({ applied: 0, total: 2 });
    expect(f.trace.filter((command) => command.startsWith('db push'))).toHaveLength(3);
    expect(f.out.write).toHaveBeenLastCalledWith(
      'Production migrations verified: applied=0 total=2\n'
    );
  });

  it.each([
    'SUPABASE_ACCESS_TOKEN',
    'SUPABASE_DB_PASSWORD',
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'VITE_SUPABASE_URL',
    'VITE_SUPABASE_PUBLISHABLE_KEY',
    'GITHUB_TOKEN',
    'GITHUB_REPOSITORY',
    'RELEASE_TAG'
  ])('rejects missing %s before remote calls', async (name) => {
    const f = fixture();
    delete f.options.env[name];
    await expect(runMigrations(f.options)).rejects.toThrow(/^preflight:/);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.exec).not.toHaveBeenCalled();
  });

  it.each([
    ['VITE_SUPABASE_URL', `https://${PROJECT}.supabase.co/`],
    ['VITE_SUPABASE_URL', 'https://foreign.supabase.co'],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', 'eyJ.private.jwt'],
    ['VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_secret_private']
  ])('rejects malformed public input %s', async (name, value) => {
    const f = fixture();
    f.options.env[name] = value;
    await expect(runMigrations(f.options)).rejects.toThrow(/^preflight:/);
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it('rejects a different CLI before linking', async () => {
    const f = fixture();
    f.state.version = '3.1.0';
    await expect(runMigrations(f.options)).rejects.toThrow('CLI version mismatch');
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.trace).toEqual(['--version']);
  });

  it.each(['project', 'linked', 'pooler'] as const)(
    'rejects wrong %s identity before push',
    async (field) => {
      const f = fixture();
      f.state[field] = 'foreign';
      await expect(runMigrations(f.options)).rejects.toThrow(/project:|link:/);
      expect(f.trace.some((command) => command.startsWith('db push'))).toBe(false);
      expect(f.entries.has(ROOT)).toBe(false);
    }
  );

  it('fails closed on unavailable or malformed project responses', async () => {
    const f = fixture();
    f.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: failure }) });
    await expect(runMigrations(f.options)).rejects.toThrow(/^project: project lookup failed$/);
    expect(f.trace).toEqual(['--version']);
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it.each(['badHistory', 'gapHistory'] as const)(
    'rejects remote-ahead/out-of-order history: %s',
    async (field) => {
      const f = fixture();
      f.state[field] = true;
      await expect(runMigrations(f.options)).rejects.toThrow(/history: migration history/);
      expect(f.trace.some((command) => command.startsWith('db push'))).toBe(false);
    }
  );

  it.each(['db push --linked --skip-vault --dry-run', 'db push --linked --skip-vault'])(
    'stops on %s failure; sanitizes status and cleans up',
    async (command) => {
      const f = fixture();
      f.state.failCommand = command;
      const attempt = runMigrations(f.options);
      await expect(attempt).rejects.toThrow(/^(dry-run|apply): CLI exit 17$/);
      expect(f.trace.at(-1)).toBe(command);
      expect(f.entries.has(ROOT)).toBe(false);
      expect(JSON.stringify(f.out.write.mock.calls)).not.toContain('canary');
    }
  );

  it.each(['malformed', 'badPlan', 'noApply'] as const)(
    'fails closed on invalid CLI result/post-check: %s',
    async (field) => {
      const f = fixture();
      if (field === 'malformed') f.state.malformed = 'db push --linked --skip-vault --dry-run';
      else f.state[field] = true;
      await expect(runMigrations(f.options)).rejects.toThrow(
        /malformed CLI result|unexpected migration plan/
      );
      expect(f.entries.has(ROOT)).toBe(false);
    }
  );

  it.each(['symlink', 'directory', 'other'] as const)(
    'rejects non-regular migration: %s',
    async (kind) => {
      const f = fixture();
      f.put(SOURCE + '/' + SECOND, 'external', kind);
      await expect(runMigrations(f.options)).rejects.toThrow('migration must be regular file');
      expect(f.fetch).not.toHaveBeenCalled();
    }
  );

  it.each(['20261102090000_duplicate.sql', 'seed.sql', '../escape.sql', '2026_bad.sql'])(
    'rejects duplicate/malformed/traversal input: %s',
    async (name) => {
      const f = fixture();
      f.put(SOURCE + '/' + name, 'select 3;');
      const originalList = f.options.fs.list.bind(f.options.fs);
      f.options.fs.list = async (dir) =>
        dir === SOURCE ? [...(await originalList(dir)), name] : originalList(dir);
      await expect(runMigrations(f.options)).rejects.toThrow(
        /migration filename invalid|duplicate migration version/
      );
      expect(f.fetch).not.toHaveBeenCalled();
    }
  );

  it('rejects symlinked source directory', async () => {
    const f = fixture();
    f.put(SOURCE, 'external', 'symlink');
    await expect(runMigrations(f.options)).rejects.toThrow('migration directory invalid');
    expect(f.fetch).not.toHaveBeenCalled();
  });

  it.each(['bytes', 'config', 'seed'] as const)(
    'rejects changed workspace before apply: %s',
    async (change) => {
      const f = fixture();
      f.state.afterDry = () => {
        if (change === 'bytes') f.put(COPY + '/' + FIRST, 'changed bytes');
        else if (change === 'config') f.put(ROOT + '/supabase/config.toml', 'injected Vault');
        else f.put(ROOT + '/supabase/seed.sql', 'injected seed');
      };
      await expect(runMigrations(f.options)).rejects.toThrow(/^verify-manifest:/);
      expect(f.trace).not.toContain('db push --linked --skip-vault');
      expect(f.entries.has(ROOT)).toBe(false);
    }
  );

  it('keeps secrets out of argv, output and errors; strips ambient routing/Cloudflare env', async () => {
    const f = fixture();
    f.state.throwCommand = 'db push --linked --skip-vault';
    let message = '';
    try {
      await runMigrations(f.options);
    } catch (error) {
      message = String(error);
    }
    expect(message).toContain('apply: CLI execution failed');
    const publicEvidence = JSON.stringify({
      message,
      out: f.out.write.mock.calls,
      commands: f.exec.mock.calls.map(([file, args]) => ({ file, args }))
    });
    for (const canary of CANARIES) expect(publicEvidence).not.toContain(canary);
    const childEnvs = f.exec.mock.calls.map(([, , options]) => options.env);
    expect(
      childEnvs.every(
        (env) =>
          !Object.keys(env).some((name) =>
            /CLOUDFLARE|PGHOST|PROJECT_ID|RELEASE_PLEASE|GITHUB|RELEASE_TAG/.test(name)
          )
      )
    ).toBe(true);
    expect(childEnvs[1]).toMatchObject({
      HOME: ROOT + '/home',
      SUPABASE_ACCESS_TOKEN: CANARIES[0],
      SUPABASE_DB_PASSWORD: CANARIES[1]
    });
    expect(f.trace.join(' ')).not.toMatch(/--include-|--debug|reset|repair|pull|config push/);
  });

  it('rejects a gap in applied history even when all versions exist locally', async () => {
    const f = fixture();
    const original = f.exec.getMockImplementation()!;
    f.exec.mockImplementation((file, args, options) => {
      if (args.join(' ').includes('migration list')) {
        const result = history(2);
        result.migrations[0]!.remote = '';
        return encoded(result);
      }
      return original(file, args, options);
    });
    await expect(runMigrations(f.options)).rejects.toThrow(
      'history: migration history out of order'
    );
    expect(f.trace.some((command) => command.startsWith('db push'))).toBe(false);
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it('sanitizes filesystem failures after workspace creation and still cleans up', async () => {
    const f = fixture();
    f.options.fs.write = async () => {
      throw new Error(failure);
    };
    await expect(runMigrations(f.options)).rejects.toThrow(/^workspace: operation failed$/);
    expect(f.fetch).not.toHaveBeenCalled();
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it('reports verified migrations before Worker failure; same-SHA retry becomes no-op and older retry stops', async () => {
    const f = fixture();
    const refs = releaseRefs();
    const worker = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('Worker deployment failed'))
      .mockResolvedValue(undefined);
    await expect(approvedAttempt(f, refs, worker)).rejects.toThrow('Worker deployment failed');
    expect(f.out.write).toHaveBeenLastCalledWith(
      'Production migrations verified: applied=1 total=2\n'
    );
    expect(f.state.applied).toBe(2);
    await expect(approvedAttempt(f, refs, worker)).resolves.toEqual({ applied: 0, total: 2 });
    expect(worker).toHaveBeenCalledTimes(2);
    refs.main = NEWER_SHA;
    const calls = f.exec.mock.calls.length;
    await expect(approvedAttempt(f, refs, worker)).rejects.toThrow('stale release');
    expect(f.exec).toHaveBeenCalledTimes(calls);
    expect(worker).toHaveBeenCalledTimes(2);
  });

  it('permits duplicate current-SHA attempts with idempotent checked no-op', async () => {
    const f = fixture();
    const worker = vi.fn<() => Promise<void>>(async () => {});
    await expect(approvedAttempt(f, releaseRefs(), worker)).resolves.toEqual({
      applied: 1,
      total: 2
    });
    await expect(approvedAttempt(f, releaseRefs(), worker)).resolves.toEqual({
      applied: 0,
      total: 2
    });
    expect(worker).toHaveBeenCalledTimes(2);
    expect(f.trace.filter((command) => command === APPLY)).toHaveLength(2);
  });

  it('blocks Worker when main advances during migration even though SQL completed', async () => {
    const f = fixture();
    const refs = releaseRefs();
    replaceResult(f, APPLY, (result) => {
      refs.main = NEWER_SHA;
      return result;
    });
    const worker = vi.fn<() => Promise<void>>(async () => {});
    await expect(approvedAttempt(f, refs, worker)).rejects.toThrow('stale release');
    expect(f.state.applied).toBe(2);
    expect(worker).not.toHaveBeenCalled();
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it('blocks Worker on partial multi-file apply failure; retry applies only the remaining suffix', async () => {
    const f = fixture(0);
    const original = f.exec.getMockImplementation()!;
    let partial = true;
    f.exec.mockImplementation((file, args, options) => {
      if (partial && args.join(' ').includes(APPLY) && !args.includes('--dry-run')) {
        partial = false;
        f.state.applied = 1;
        f.trace.push(APPLY);
        return { status: 17, stdout: failure, stderr: failure };
      }
      return original(file, args, options);
    });
    const worker = vi.fn<() => Promise<void>>(async () => {});
    await expect(approvedAttempt(f, releaseRefs(), worker)).rejects.toThrow('apply: CLI exit 17');
    expect(worker).not.toHaveBeenCalled();
    expect(f.state.applied).toBe(1);
    expect(f.entries.has(ROOT)).toBe(false);
    await expect(approvedAttempt(f, releaseRefs(), worker)).resolves.toEqual({
      applied: 1,
      total: 2
    });
    expect(worker).toHaveBeenCalledTimes(1);
    expect(f.trace.join(' ')).not.toMatch(/repair|reset|--include-/);
  });

  it.each([
    ['link', `link --project-ref ${PROJECT}`, 1],
    ['history', 'migration list --linked', 1],
    ['dry-run', DRY, 1],
    ['apply', APPLY, 1],
    ['post-check', DRY, 2],
    ['post-check', 'migration list --linked', 2]
  ] as const)('blocks downstream Worker on %s CLI failure', async (stage, command, occurrence) => {
    const f = fixture();
    replaceResult(f, command, () => ({ status: 17, stdout: failure, stderr: failure }), occurrence);
    const worker = vi.fn<() => Promise<void>>(async () => {});
    await expect(approvedAttempt(f, releaseRefs(), worker)).rejects.toThrow(
      stage + ': CLI exit 17'
    );
    expect(worker).not.toHaveBeenCalled();
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it('fails closed on process timeout with bounded capture and no Worker or secret cause', async () => {
    const f = fixture();
    replaceResult(f, APPLY, () => ({ status: null, stdout: failure, stderr: failure }));
    const worker = vi.fn<() => Promise<void>>(async () => {});
    const error = await approvedAttempt(f, releaseRefs(), worker).catch((cause: unknown) => cause);
    expect(error).toMatchObject({ message: 'apply: CLI exit unavailable' });
    expect(error).not.toHaveProperty('cause');
    expect(worker).not.toHaveBeenCalled();
    expect(f.entries.has(ROOT)).toBe(false);
    expect(
      f.exec.mock.calls.every(
        ([, , options]) =>
          options.timeout > 0 &&
          options.maxBuffer === 4 * 1024 * 1024 &&
          options.stdio.join(' ') === 'ignore pipe pipe'
      )
    ).toBe(true);
    expect(
      f.exec.mock.calls.find(
        ([, args]) => args.includes('push') && !args.includes('--dry-run')
      )?.[2].timeout
    ).toBe(1_800_000);
  });

  it.each([
    'null',
    '[]',
    '{}',
    '{',
    JSON.stringify({ _tag: 'Error', error: failure }),
    JSON.stringify({ migrations: [null, null] })
  ])('rejects malformed history output without apply: %s', async (stdout) => {
    const f = fixture();
    replaceResult(f, 'migration list --linked', () => ({ status: 0, stdout, stderr: failure }));
    await expect(runMigrations(f.options)).rejects.toThrow(/^history:/);
    expect(f.trace).not.toContain(APPLY);
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it.each([
    { seeds: ['seed.sql'] },
    { roles: ['roles.sql'] },
    { dryRun: false },
    { upToDate: true },
    { migrations: [SECOND, FIRST] },
    { migrations: [SECOND, SECOND] },
    { migrations: null }
  ])('rejects unsupported or malformed dry-run plan: %j', async (override) => {
    const f = fixture();
    replaceResult(f, DRY, () => encoded({ ...pushResult([SECOND], true), ...override }));
    await expect(runMigrations(f.options)).rejects.toThrow(/^dry-run: unexpected/);
    expect(f.trace).not.toContain(APPLY);
  });

  it('rejects inconsistent post-apply history even when post-dry-run claims no pending', async () => {
    const f = fixture();
    replaceResult(f, 'migration list --linked', () => encoded(history(1)), 2);
    const worker = vi.fn<() => Promise<void>>(async () => {});
    await expect(approvedAttempt(f, releaseRefs(), worker)).rejects.toThrow(
      'post-check: post-apply history inconsistent'
    );
    expect(worker).not.toHaveBeenCalled();
    expect(f.entries.has(ROOT)).toBe(false);
  });

  it.each([
    null,
    [],
    {},
    { ref: PROJECT, status: 'INACTIVE' },
    { ref: PROJECT, status: 'ACTIVE_HEALTHY', database: { host: 'db.foreign.supabase.co' } }
  ])('rejects malformed/unhealthy project identity: %j', async (project) => {
    const f = fixture();
    f.fetch.mockResolvedValue({ ok: true, json: async () => project });
    await expect(runMigrations(f.options)).rejects.toThrow('project: project identity mismatch');
    expect(f.trace).not.toContain(APPLY);
    expect(f.trace).not.toContain(`link --project-ref ${PROJECT}`);
  });

  it.each(['project-ref', 'linked-project.json'] as const)(
    'rejects missing/symlinked linked metadata %s',
    async (name) => {
      const f = fixture();
      f.state.afterLink = () => {
        f.put(ROOT + '/supabase/.temp/' + name, failure, 'symlink');
      };
      await expect(runMigrations(f.options)).rejects.toThrow('link: linked metadata invalid');
      expect(f.trace).not.toContain(DRY);
    }
  );

  it('independently rejects mismatched cached project metadata and missing ref', async () => {
    const f = fixture();
    f.state.afterLink = () => {
      f.put(ROOT + '/supabase/.temp/linked-project.json', JSON.stringify({ ref: 'foreign' }));
    };
    await expect(runMigrations(f.options)).rejects.toThrow('linked project mismatch');
    f.state.afterLink = () => {
      f.entries.delete(ROOT + '/supabase/.temp/project-ref');
    };
    await expect(runMigrations(f.options)).rejects.toThrow(/^link:/);
    expect(f.trace).not.toContain(DRY);
  });

  it.each([
    `postgresql://postgres.foreign@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${PROJECT}@foreign.example:5432/postgres`,
    `postgresql://postgres.${PROJECT}:password@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
    `postgresql://postgres.${PROJECT}@aws-0-us-east-1.pooler.supabase.com:5432/postgres?host=foreign`
  ])('rejects tampered pooler routing before history/push: %s', async (pooler) => {
    const f = fixture();
    f.state.pooler = pooler;
    await expect(runMigrations(f.options)).rejects.toThrow('linked routing invalid');
    expect(f.trace).not.toContain('migration list --linked');
  });

  it.each(['roles.sql', '.env', 'templates'] as const)(
    'rejects extra deployment input %s before apply',
    async (name) => {
      const f = fixture();
      f.state.afterDry = () => {
        f.put(ROOT + '/supabase/' + name, failure, name === 'templates' ? 'directory' : 'file');
      };
      await expect(runMigrations(f.options)).rejects.toThrow('unexpected deployment input');
      expect(f.trace).not.toContain(APPLY);
      expect(f.entries.has(ROOT)).toBe(false);
    }
  );

  it('does not copy or read root config, seed, roles, env or pre-existing link state', async () => {
    const f = fixture();
    f.put('/checkout/supabase/.temp/project-ref', 'foreign');
    const original = f.options.fs.read.bind(f.options.fs);
    const reads: string[] = [];
    f.options.fs.read = async (file) => {
      reads.push(file);
      return original(file);
    };
    await runMigrations(f.options);
    expect(
      reads
        .filter((file) => file.startsWith('/checkout/'))
        .every((file) => file === SOURCE + '/' + FIRST || file === SOURCE + '/' + SECOND)
    ).toBe(true);
    expect(f.fetch.mock.calls[0]?.[0]).toBe(`https://api.supabase.com/v1/projects/${PROJECT}`);
    expect(f.fetch.mock.calls[0]?.[1].redirect).toBe('error');
  });

  it.each(['stdout', 'exception', 'http-json', 'http-error'] as const)(
    'keeps canaries out of evidence on %s path',
    async (channel) => {
      const f = fixture();
      if (channel === 'stdout')
        replaceResult(f, DRY, () => ({ status: 0, stdout: failure, stderr: failure }));
      else if (channel === 'exception') f.state.throwCommand = APPLY;
      else if (channel === 'http-json')
        f.fetch.mockResolvedValue({
          ok: true,
          json: async () => {
            throw new Error(failure, { cause: failure });
          }
        });
      else f.fetch.mockResolvedValue({ ok: false, json: async () => ({ error: failure }) });
      const error = await runMigrations(f.options).catch((cause: unknown) => cause);
      expect(error).toBeInstanceOf(Error);
      expect(error).not.toHaveProperty('cause');
      const evidence = JSON.stringify({
        error: String(error),
        out: f.out.write.mock.calls,
        argv: f.exec.mock.calls.map(([file, args]) => [file, args])
      });
      for (const canary of CANARIES) expect(evidence).not.toContain(canary);
      expect(evidence).not.toContain('postgres://');
      expect(f.entries.has(ROOT)).toBe(false);
    }
  );

  it('ignores raw successful CLI messages/stderr and emits only allowlisted manifest/count summaries', async () => {
    const f = fixture();
    replaceResult(f, DRY, () => encoded({ ...pushResult([SECOND], true), message: failure }));
    await runMigrations(f.options);
    const lines = f.out.write.mock.calls.map(([line]) => line);
    expect(
      lines.every((line) =>
        /^Migration manifest: \d{14} [a-f0-9]{64}\n$|^Migration pending: \d{14}\n$|^Production migrations verified: applied=\d+ total=\d+\n$/.test(
          line
        )
      )
    ).toBe(true);
    for (const canary of CANARIES) expect(lines.join('')).not.toContain(canary);
  });

  describe('reviewer-approved pending set binding', () => {
    const V1 = FIRST.slice(0, 14);
    const V2 = SECOND.slice(0, 14);

    it('proceeds when the marker matches the derived pending set (order-insensitive)', async () => {
      const f = fixture(0);
      f.state.marker = `Approved-pending:  ${V2}, ${V1} `;
      await expect(runMigrations(f.options)).resolves.toEqual({ applied: 2, total: 2 });
      expect(f.fetch.mock.calls.map(([url]) => url)).toContain(RELEASE_URL);
      const release = f.fetch.mock.calls.find(([url]) => url === RELEASE_URL)!;
      expect(release[1]).toMatchObject({ redirect: 'error' });
      expect(release[1].headers.Authorization).toBe('Bearer ' + CANARIES[3]);
    });

    it('treats `none` with empty pending as a checked no-op', async () => {
      const f = fixture(2);
      f.state.marker = 'Approved-pending: none';
      await expect(runMigrations(f.options)).resolves.toEqual({ applied: 0, total: 2 });
    });

    it.each([
      ['missing marker', 'Release notes only', 'approved pending marker missing'],
      [
        'ambiguous markers',
        `Approved-pending: none\nApproved-pending: none`,
        'approved pending marker ambiguous'
      ],
      ['malformed version', 'Approved-pending: 2026', 'approved pending marker invalid'],
      ['empty value', 'Approved-pending:', 'approved pending marker invalid'],
      [
        'version outside manifest',
        'Approved-pending: 20261201000000',
        'approved pending marker invalid'
      ],
      [
        'duplicate version',
        'Approved-pending: 20261102090000,20261102090000',
        'approved pending marker invalid'
      ],
      [
        'none mixed with versions',
        'Approved-pending: none,20261102090000',
        'approved pending marker invalid'
      ]
    ])('fails closed before apply: %s', async (_name, marker, reason) => {
      const f = fixture(1);
      f.state.marker = marker;
      await expect(runMigrations(f.options)).rejects.toThrow(`approval: ${reason}`);
      expect(f.trace).not.toContain(APPLY);
      expect(f.state.applied).toBe(1);
      expect(f.entries.has(ROOT)).toBe(false);
    });

    it.each([
      ['extra reviewed version', 'Approved-pending: ' + V1 + ',' + V2, 1, 'reviewed=2 derived=1'],
      ['missing reviewed version', 'Approved-pending: none', 1, 'reviewed=0 derived=1'],
      ['different reviewed version', 'Approved-pending: ' + V1, 1, 'reviewed=1 derived=1'],
      ['history drifted after review', 'Approved-pending: ' + V2, 0, 'reviewed=1 derived=2']
    ])('fails closed before apply on mismatch: %s', async (_name, marker, applied, shape) => {
      const f = fixture(applied);
      f.state.marker = marker;
      await expect(runMigrations(f.options)).rejects.toThrow(
        `approval: approved pending set mismatch (${shape})`
      );
      expect(f.trace).not.toContain(APPLY);
      expect(f.state.applied).toBe(applied);
    });

    it.each([
      [
        'http failure',
        (f: Fixture) => {
          f.state.releaseOk = false;
        },
        'release lookup failed'
      ],
      [
        'network failure',
        (f: Fixture) => {
          f.fetch.mockImplementation(async (url) => {
            if (url === RELEASE_URL) throw new Error(failure);
            return {
              ok: true,
              json: async () => ({
                ref: PROJECT,
                status: 'ACTIVE_HEALTHY',
                database: { host: `db.${PROJECT}.supabase.co` }
              })
            };
          });
        },
        'release lookup failed'
      ],
      [
        'non-JSON body',
        (f: Fixture) => {
          f.fetch.mockImplementation(async (url) => ({
            ok: true,
            json: async () => {
              if (url === RELEASE_URL) throw new Error(failure);
              return {
                ref: PROJECT,
                status: 'ACTIVE_HEALTHY',
                database: { host: `db.${PROJECT}.supabase.co` }
              };
            }
          }));
        },
        'release lookup failed'
      ],
      [
        'empty list for tag',
        (f: Fixture) => {
          f.state.release = [];
        },
        'release identity mismatch'
      ],
      [
        'null response',
        (f: Fixture) => {
          f.state.release = null;
        },
        'release identity mismatch'
      ],
      [
        'other tag',
        (f: Fixture) => {
          f.state.release = { tag_name: 'v9.9.9', draft: false, body: 'Approved-pending: none' };
        },
        'release identity mismatch'
      ],
      [
        'draft release',
        (f: Fixture) => {
          f.state.release = { tag_name: 'v0.1.1', draft: true, body: 'Approved-pending: ' + V2 };
        },
        'release identity mismatch'
      ],
      [
        'null body',
        (f: Fixture) => {
          f.state.release = { tag_name: 'v0.1.1', draft: false, body: null };
        },
        'approved pending marker missing'
      ]
    ])('fails closed before apply on release API %s', async (_name, arrange, reason) => {
      const f = fixture(1);
      arrange(f);
      await expect(runMigrations(f.options)).rejects.toThrow(`approval: ${reason}`);
      expect(f.trace).not.toContain(APPLY);
      expect(f.entries.has(ROOT)).toBe(false);
    });

    it.each(['http', 'mismatch', 'marker'] as const)(
      'never leaks the token or release body on %s failure paths',
      async (kind) => {
        const f = fixture(1);
        if (kind === 'http') f.state.releaseOk = false;
        if (kind === 'mismatch') f.state.marker = 'Approved-pending: none';
        if (kind === 'marker') f.state.marker = 'no marker';
        const error = await runMigrations(f.options).catch((cause: unknown) => cause);
        expect(error).not.toHaveProperty('cause');
        const evidence = JSON.stringify({
          error: String(error),
          out: f.out.write.mock.calls,
          argv: f.exec.mock.calls.map(([file, args]) => [file, args]),
          childEnv: f.exec.mock.calls.map(([, , options]) => options.env)
        });
        for (const canary of [CANARIES[3], CANARIES[4]]) expect(evidence).not.toContain(canary);
        expect(f.trace).not.toContain(APPLY);
      }
    );
  });

  describe('remote history behind the previously deployed release', () => {
    const OLDER = '20261030090000_older_release.sql';
    const OLDEST = '20261029090000_oldest_release.sql';
    // Release tag contains OLDEST, OLDER (shipped by an earlier release) plus FIRST, SECOND.
    function behind(applied: number) {
      const f = fixture(applied);
      f.put(SOURCE + '/' + OLDER, 'select 0;\n');
      f.put(SOURCE + '/' + OLDEST, 'select -1;\n');
      f.state.names = [OLDEST, OLDER, FIRST, SECOND];
      return f;
    }

    it('applies exactly the remote-pending suffix, including older-release files absent from the tag diff', async () => {
      const f = behind(1);
      await expect(runMigrations(f.options)).resolves.toEqual({ applied: 3, total: 4 });
      expect(f.state.applied).toBe(4);
      const versions = f.out.write.mock.calls
        .map(([line]) => line)
        .filter((line) => line.startsWith('Migration manifest:'));
      expect(versions).toHaveLength(4);
      const pendingLines = f.out.write.mock.calls
        .map(([line]) => line)
        .filter((line) => line.startsWith('Migration pending:'));
      expect(pendingLines).toEqual(
        [OLDER, FIRST, SECOND].map((name) => `Migration pending: ${name.slice(0, 14)}\n`)
      );
      expect(f.out.write).toHaveBeenLastCalledWith(
        'Production migrations verified: applied=3 total=4\n'
      );
      expect(f.trace.filter((command) => command === APPLY)).toHaveLength(1);
    });

    it('fails closed before apply when the dry-run plan differs from the remote-pending set', async () => {
      for (const plan of [
        [FIRST, SECOND], // silently skips older pending files
        [OLDER, FIRST, SECOND, '20261103090000_extra.sql'], // file outside remote-pending set
        [SECOND, FIRST, OLDER] // reordered
      ]) {
        const f = behind(1);
        replaceResult(f, DRY, () => encoded({ ...pushResult(plan, true) }));
        await expect(runMigrations(f.options)).rejects.toThrow(
          /^dry-run: unexpected migration plan$/
        );
        expect(f.trace).not.toContain(APPLY);
        expect(f.state.applied).toBe(1);
        expect(f.entries.has(ROOT)).toBe(false);
      }
    });

    it('fails closed when an older file is missing remotely but later versions are applied', async () => {
      const f = behind(0);
      const original = f.exec.getMockImplementation()!;
      f.exec.mockImplementation((file, args, options) => {
        if (args.join(' ').includes('migration list')) {
          const result = history(4, f.state.names);
          result.migrations[1]!.remote = '';
          return encoded(result);
        }
        return original(file, args, options);
      });
      await expect(runMigrations(f.options)).rejects.toThrow(
        'history: migration history out of order'
      );
      expect(f.trace).not.toContain(APPLY);
    });

    it('is a checked no-op once history has caught up', async () => {
      const f = behind(4);
      await expect(runMigrations(f.options)).resolves.toEqual({ applied: 0, total: 4 });
    });
  });

  it('sanitizes HTTP and cleanup errors; rejects unknown CLI arguments', async () => {
    const f = fixture();
    f.fetch.mockRejectedValue(new Error(failure));
    await expect(runMigrations(f.options)).rejects.toThrow(/^project: operation failed$/);
    expect(f.entries.has(ROOT)).toBe(false);
    f.options.fs.remove = async () => {
      throw new Error(failure);
    };
    await expect(runMigrations(f.options)).rejects.toThrow(/^cleanup: operation failed$/);
    await expect(main(['unexpected'], f.options)).rejects.toThrow(
      /^preflight: unexpected arguments$/
    );
  });
});
