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
const CANARIES = ['canary-access-token', 'canary-db-password', 'canary-cloudflare-token'];
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
function history(applied: number) {
  return {
    message: 'Migrations listed',
    migrations: [FIRST, SECOND].map((name, index) => ({
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
  let applied = initiallyApplied;
  const trace: string[] = [];
  const state = {
    failCommand: '',
    throwCommand: '',
    version: '2.121.0',
    project: PROJECT,
    linked: PROJECT,
    pooler: `postgresql://postgres.${PROJECT}@aws-0-us-east-1.pooler.supabase.com:5432/postgres`,
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
    if (file !== 'pnpm') throw new Error('Unexpected executor');
    if (command === state.throwCommand) throw new Error(failure);
    if (command === state.failCommand) return { status: 17, stdout: failure, stderr: failure };
    if (command === '--version')
      return { status: 0, stdout: state.version + '\n', stderr: failure };
    if (command.startsWith('link ')) {
      put(ROOT + '/supabase/.temp', '', 'directory');
      put(ROOT + '/supabase/.temp/project-ref', state.linked);
      put(ROOT + '/supabase/.temp/linked-project.json', JSON.stringify({ ref: state.linked }));
      put(ROOT + '/supabase/.temp/pooler-url', state.pooler);
      return encoded({ project_ref: state.linked, message: '' });
    }
    if (command === state.malformed) return { status: 0, stdout: failure, stderr: failure };
    if (command === 'migration list --linked') {
      const result = history(applied);
      if (state.badHistory)
        result.migrations.push({ local: '', remote: '20261103090000', time: '' });
      if (state.gapHistory) result.migrations.reverse();
      return encoded(result);
    }
    if (command.startsWith('db push ')) {
      const pending = [FIRST, SECOND].slice(applied);
      const dryRun = command.includes('--dry-run');
      if (dryRun) state.afterDry();
      else if (!state.noApply) applied = 2;
      return encoded(pushResult(state.badPlan ? ['20261103090000_unknown.sql'] : pending, dryRun));
    }
    throw new Error('Unexpected command');
  });
  const fetch = vi.fn<MigrationOptions['fetch']>(async (url) => {
    trace.push('GET ' + url);
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
      RELEASE_PLEASE_TOKEN: 'private-release-pat'
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
    'VITE_SUPABASE_PUBLISHABLE_KEY'
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
          !Object.keys(env).some((name) => /CLOUDFLARE|PGHOST|PROJECT_ID|RELEASE_PLEASE/.test(name))
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
