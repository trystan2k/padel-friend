import { describe, expect, it, vi } from 'vitest';
import {
  assertDisposableDatabase,
  assertLocalContainer,
  createDocker,
  diffFingerprints,
  type Docker,
  type SpawnLike
} from '../scripts/release-rehearsal-lib.mjs';
import {
  parseArgs as parseRestore,
  runRestoreRehearsal
} from '../scripts/release-backup-restore.mjs';
import {
  migrationFiles,
  parseArgs as parseMigration,
  runMigrationRehearsal
} from '../scripts/release-migration-rehearsal.mjs';
import { parseArgs as parsePerf, percentile, summarize } from '../scripts/release-performance.mjs';

const guard = (name: string, over: { source?: string; confirmation?: string } = {}) =>
  assertDisposableDatabase({
    name,
    prefix: 'restore_rehearsal_',
    source: 'postgres',
    confirmation: name,
    ...over
  });

describe('destructive-target guards', () => {
  it('accepts only a prefixed, confirmed, non-production name', () => {
    expect(guard('restore_rehearsal_abc123_1')).toBe('restore_rehearsal_abc123_1');
    for (const bad of [
      'postgres',
      'restore_rehearsal_',
      'restore_rehearsal_PROD1',
      'restore_rehearsal_prod_db',
      'restore_rehearsal_live1',
      'migration_rehearsal_abcd',
      'restore_rehearsal_a;drop',
      'restore_rehearsal_x y1'
    ])
      expect(() => guard(bad)).toThrow(/Refusing destination/);
  });
  it('requires explicit confirmation of the exact name', () => {
    expect(() => guard('restore_rehearsal_abcd', { confirmation: undefined })).toThrow(
      /not confirmed/
    );
    expect(() =>
      guard('restore_rehearsal_abcd', { confirmation: 'restore_rehearsal_other' })
    ).toThrow(/not confirmed/);
  });
  it('only addresses a local supabase_db container', () => {
    expect(assertLocalContainer('supabase_db_padel-friend')).toBe('supabase_db_padel-friend');
    expect(() => assertLocalContainer('db.prod.example.com')).toThrow(
      /Refusing database container/
    );
    expect(() => createDocker({ container: 'postgres' })).toThrow(/Refusing database container/);
  });
  it('rejects remote-style CLI arguments and a missing confirmation', () => {
    expect(() => parseRestore(['--db-url', 'postgres://prod'])).toThrow(/Unknown argument/);
    expect(() => parseRestore([])).toThrow(/--confirm-disposable/);
    expect(() =>
      parseRestore(['--confirm-disposable', 'restore_rehearsal_abcd', '--runs', '1'])
    ).toThrow(/at least|>= 2/);
    expect(parseRestore(['--confirm-disposable', 'restore_rehearsal_abcd']).runs).toBe(2);
    expect(() => parseMigration(['--host', 'x'])).toThrow(/Unknown argument/);
    expect(parseMigration(['--confirm-disposable', 'migration_rehearsal_abcd']).source).toBe(
      'postgres'
    );
    expect(
      parseMigration(['--confirm-disposable', 'migration_rehearsal_abcd', '--check-types'])
        .checkTypes
    ).toBe(true);
  });
  it('touches no database when the destination is refused', () => {
    const docker = {
      sql: vi.fn<() => string>(),
      admin: vi.fn<() => string>(),
      dump: vi.fn<() => Buffer>(),
      exec: vi.fn<() => string>()
    };
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- call-recording double
    const double = docker as unknown as Docker;
    expect(() => runRestoreRehearsal({ docker: double, base: 'prod', confirm: 'prod' })).toThrow(
      /Refusing destination/
    );
    expect(() =>
      runRestoreRehearsal({ docker: double, base: 'restore_rehearsal_abcd', confirm: 'nope' })
    ).toThrow(/not confirmed/);
    expect(() =>
      runRestoreRehearsal({
        docker: double,
        base: 'restore_rehearsal_abcd',
        confirm: 'restore_rehearsal_abcd',
        runs: 1
      })
    ).toThrow(/twice/);
    expect(() =>
      runMigrationRehearsal({ docker: double, destination: 'postgres', confirm: 'postgres' })
    ).toThrow(/Refusing destination/);
    for (const call of Object.values(docker)) expect(call).not.toHaveBeenCalled();
  });
  it('never deletes an existing destination when creation fails', () => {
    const admin = vi.fn<(statement: string) => string>(() => {
      throw new Error('database already exists');
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- database test double
    const docker = { admin } as unknown as Docker;
    expect(() =>
      runMigrationRehearsal({
        docker,
        destination: 'migration_rehearsal_exists',
        confirm: 'migration_rehearsal_exists'
      })
    ).toThrow('database already exists');
    expect(admin).toHaveBeenCalledTimes(1);
    expect(admin.mock.calls[0]?.[0]).not.toMatch(/drop/i);
  });
  it('drops the disposable database when provisioning fails after creation (migration)', () => {
    const admin = vi.fn<(statement: string) => string>(() => '');
    const sql = vi.fn<() => string>(() => {
      throw new Error('extension setup failed');
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- database test double
    const docker = { admin, sql } as unknown as Docker;
    expect(() =>
      runMigrationRehearsal({
        docker,
        destination: 'migration_rehearsal_leak',
        confirm: 'migration_rehearsal_leak'
      })
    ).toThrow('extension setup failed');
    expect(admin.mock.calls.map(([statement]) => statement)).toEqual([
      'create database "migration_rehearsal_leak";',
      'drop database if exists "migration_rehearsal_leak" with (force);'
    ]);
  });
  it('drops the disposable database when provisioning fails after creation (restore)', () => {
    const representative = Object.fromEntries(
      [
        'public.statistics_group_facts',
        'public.player_rating_events',
        'public.notifications',
        'public.notification_push_jobs',
        'public.league_standings_snapshots',
        'public.result_repair_jobs'
      ].map((table) => [table, { rows: 5 }])
    );
    const admin = vi.fn<(statement: string) => string>(() => '');
    const sql = vi.fn<(database: string, statement: string) => string>((database, statement) => {
      if (database === 'restore_rehearsal_leak_1') throw new Error('extension setup failed');
      if (statement.includes('jsonb_object_agg')) return JSON.stringify(representative);
      if (statement.includes('pgcrypto')) return '';
      return statement.includes('jsonb_build_object') ? '{}' : '';
    });
    const dump = vi.fn<() => Buffer>(() => Buffer.from('dump'));
    const exec = vi.fn<() => string>(() => 'toc');
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- database test double
    const docker = { admin, sql, dump, exec } as unknown as Docker;
    expect(() =>
      runRestoreRehearsal({
        docker,
        base: 'restore_rehearsal_leak',
        confirm: 'restore_rehearsal_leak'
      })
    ).toThrow('extension setup failed');
    expect(admin.mock.calls.map(([statement]) => statement)).toEqual([
      'create database "restore_rehearsal_leak_1";',
      'drop database if exists "restore_rehearsal_leak_1" with (force);'
    ]);
  });
  it('refuses remote Docker contexts before any database operation', () => {
    const run = vi.fn<SpawnLike>(() => ({ status: 0, stdout: '"ssh://production"' }));
    expect(() => createDocker({ run })).toThrow('Refusing nonlocal Docker endpoint');
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]?.[1]).not.toContain('exec');
  });
  it('routes every command through docker exec into the named local container', () => {
    const run = vi
      .fn<SpawnLike>(() => ({ status: 0, stdout: 'ok' }))
      .mockReturnValueOnce({ status: 0, stdout: '"unix:///var/run/docker.sock"' });
    createDocker({ run }).sql('restore_rehearsal_abcd', 'select 1');
    expect(run.mock.calls[1]![0]).toBe('docker');
    expect(run.mock.calls[1]![1].slice(0, 5)).toEqual([
      '--host',
      'unix:///var/run/docker.sock',
      'exec',
      '-i',
      'supabase_db_padel-friend'
    ]);
  });
});

describe('restore rehearsal flow', () => {
  const base = 'restore_rehearsal_flow';
  const representative = Object.fromEntries(
    [
      'public.statistics_group_facts',
      'public.player_rating_events',
      'public.notifications',
      'public.notification_push_jobs',
      'public.league_standings_snapshots',
      'public.result_repair_jobs'
    ].map((table) => [table, { rows: 5, md5: 'same' }])
  );
  // Records every docker call in order; source and restored databases fingerprint identically.
  const rehearsalDouble = (overrides: Partial<Record<'dump' | 'restore', () => unknown>> = {}) => {
    const calls: string[] = [];
    const admin = vi.fn<(statement: string) => string>((statement) => {
      calls.push(statement.startsWith('create') ? 'create' : 'drop');
      return '';
    });
    const sql = vi.fn<(database: string, statement: string) => string>((_database, statement) => {
      if (statement.includes('pg_tables')) return '';
      if (statement.includes('jsonb_object_agg')) return JSON.stringify(representative);
      if (statement.includes('to_regclass')) return 't';
      if (statement.includes('notification_push_jobs set status')) return '0';
      if (statement.includes('recipient_user_id')) return '';
      return '{}';
    });
    const dump = vi.fn<() => Buffer>(() => {
      calls.push('dump');
      return overrides.dump ? Buffer.from(String(overrides.dump())) : Buffer.from('dump-bytes');
    });
    const exec = vi.fn<(args: string[], options?: { input?: string }) => string>((args) =>
      args[0] === 'pg_restore' ? 'keep\n;  DEFAULT ACL x\nkeep2' : ''
    );
    const restore = vi.fn<(database: string, data: Buffer, args?: string[]) => string>(() => {
      calls.push('restore');
      overrides.restore?.();
      return '';
    });
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- call-recording double
    const docker = { admin, sql, dump, exec, restore } as unknown as Docker;
    return { docker, calls, dump, restore, exec };
  };

  it('takes one dump and one filtered TOC, then restores both destinations from them', () => {
    const { docker, calls, dump, restore, exec } = rehearsalDouble();
    const report = runRestoreRehearsal({ docker, base, confirm: base });
    expect(dump).toHaveBeenCalledTimes(1);
    expect(calls).toEqual(['dump', 'create', 'restore', 'drop', 'create', 'restore', 'drop']);
    const tocWrites = exec.mock.calls.filter(([args]) => args[4]?.endsWith('.toc'));
    expect(tocWrites).toHaveLength(1);
    expect(restore).toHaveBeenCalledTimes(2);
    expect(restore.mock.calls.map(([database]) => database)).toEqual([`${base}_1`, `${base}_2`]);
    expect(report.runs).toHaveLength(2);
    expect(report.runs.every((run) => run.pass)).toBe(true);
    expect(report.sourceStable).toBe(true);
    expect(report.pass).toBe(true);
  });

  it('writes the TOC without platform DEFAULT ACL entries', () => {
    const { docker, exec } = rehearsalDouble();
    runRestoreRehearsal({ docker, base, confirm: base });
    const write = exec.mock.calls.find(([args]) => args[4]?.endsWith('.toc'));
    expect(write?.[1]).toEqual({ input: 'keep\nkeep2' });
  });

  // Container paths of the staged artifacts, read from the removal call.
  const removedPaths = (exec: ReturnType<typeof rehearsalDouble>['exec']) =>
    exec.mock.calls.filter(([args]) => args[0] === 'rm').flatMap(([args]) => args.slice(2));

  it('stages the dump and TOC at paths unique to each invocation', () => {
    const first = rehearsalDouble();
    const second = rehearsalDouble();
    runRestoreRehearsal({ docker: first.docker, base, confirm: base });
    runRestoreRehearsal({ docker: second.docker, base, confirm: base });
    const firstPaths = removedPaths(first.exec);
    const secondPaths = removedPaths(second.exec);
    expect(firstPaths).toHaveLength(2);
    expect(firstPaths.every((path) => /^\/tmp\/release-rehearsal-.+\.(dump|toc)$/.test(path))).toBe(
      true
    );
    expect(firstPaths.some((path) => secondPaths.includes(path))).toBe(false);
    expect(first.restore.mock.calls[0]?.[2]).toContain(`--use-list=${firstPaths[1]}`);
  });

  it('removes the staged dump and TOC after a successful run', () => {
    const { docker, exec } = rehearsalDouble();
    runRestoreRehearsal({ docker, base, confirm: base });
    const staged = exec.mock.calls.filter(([args]) => args[0] === 'sh').map(([args]) => args[4]);
    expect(new Set(removedPaths(exec))).toEqual(new Set(staged));
    expect(exec.mock.calls.at(-1)?.[0][0]).toBe('rm');
  });

  it('removes the staged dump and TOC when a restore fails', () => {
    const { docker, exec } = rehearsalDouble({
      restore: () => {
        throw new Error('pg_restore failed');
      }
    });
    expect(() => runRestoreRehearsal({ docker, base, confirm: base })).toThrow('pg_restore failed');
    expect(removedPaths(exec)).toHaveLength(2);
  });

  // Makes the staged-artifact removal fail while leaving every other docker exec call intact.
  const failCleanup = (exec: ReturnType<typeof rehearsalDouble>['exec']) => {
    const original = exec.getMockImplementation();
    exec.mockImplementation((args, options) => {
      if (args[0] === 'rm') throw new Error('rm exploded');
      return original ? original(args, options) : '';
    });
  };

  it('keeps the original restore error when artifact cleanup also fails', () => {
    const { docker, exec } = rehearsalDouble({
      restore: () => {
        throw new Error('pg_restore failed');
      }
    });
    failCleanup(exec);
    const log = vi.fn<(line: string) => void>();
    expect(() => runRestoreRehearsal({ docker, base, confirm: base, log })).toThrow(
      'pg_restore failed'
    );
    const warning = log.mock.calls.map(([line]) => line).find((line) => line.includes('[WARN]'));
    expect(warning).toContain('rm exploded');
    expect(warning).toContain('/tmp/release-rehearsal-');
  });

  it('keeps the successful outcome and logs a diagnostic when artifact cleanup fails', () => {
    const { docker, exec } = rehearsalDouble();
    failCleanup(exec);
    const log = vi.fn<(line: string) => void>();
    const report = runRestoreRehearsal({ docker, base, confirm: base, log });
    expect(report.pass).toBe(true);
    expect(
      log.mock.calls.some(([line]) => line.includes('[WARN]') && line.includes('rm exploded'))
    ).toBe(true);
  });

  it('writes the cleanup warning to stderr when no logger is supplied', () => {
    const { docker, exec } = rehearsalDouble();
    failCleanup(exec);
    const stderr = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const report = runRestoreRehearsal({ docker, base, confirm: base });
      expect(report.pass).toBe(true);
      expect(
        stderr.mock.calls.some(
          ([line]) =>
            typeof line === 'string' &&
            line.startsWith('[release-rehearsal] [WARN]') &&
            line.includes('rm exploded')
        )
      ).toBe(true);
    } finally {
      stderr.mockRestore();
    }
  });

  it('reports the same dump hash and size for every run', () => {
    const { docker } = rehearsalDouble();
    const { runs } = runRestoreRehearsal({ docker, base, confirm: base });
    expect(runs[0]!.dumpSha256).toBe(runs[1]!.dumpSha256);
    expect(runs[0]!.dumpBytes).toBe(Buffer.byteLength('dump-bytes'));
    expect(runs[1]!.dumpBytes).toBe(runs[0]!.dumpBytes);
  });

  it('reports dumpMs once and keeps it out of each run restoreMs', () => {
    const { docker } = rehearsalDouble();
    // now() order: startedAt, dump start, dump end, then start/end of each run.
    const ticks = [0, 1000, 1500, 2000, 2300, 3000, 3700];
    const now = vi.fn<() => number>(() => ticks.shift() ?? 9999);
    const report = runRestoreRehearsal({ docker, base, confirm: base, now });
    expect(report.dumpMs).toBe(500);
    expect(report.runs.map((run) => run.restoreMs)).toEqual([300, 700]);
  });

  it('starts no destination work when the shared dump fails', () => {
    const { docker, calls, restore } = rehearsalDouble({
      dump: () => {
        throw new Error('pg_dump failed');
      }
    });
    expect(() => runRestoreRehearsal({ docker, base, confirm: base })).toThrow('pg_dump failed');
    expect(calls).toEqual(['dump']);
    expect(restore).not.toHaveBeenCalled();
  });

  it('drops the destination and stops when a restore fails', () => {
    const { docker, calls } = rehearsalDouble({
      restore: () => {
        throw new Error('pg_restore failed');
      }
    });
    expect(() => runRestoreRehearsal({ docker, base, confirm: base })).toThrow('pg_restore failed');
    expect(calls).toEqual(['dump', 'create', 'restore', 'drop']);
  });
});

describe('rehearsal helpers', () => {
  it('lists every repository migration in order', () => {
    const versions = migrationFiles().map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort());
    expect(versions.at(-1)).toBe('20261111093000');
  });
  it('reports the categories whose fingerprints differ', () => {
    expect(diffFingerprints({ a: 1, b: 'x', c: 2 }, { a: 1, b: 'y', c: 2 })).toEqual(['b']);
  });
});

describe('performance summary', () => {
  it('computes nearest-rank percentiles and error rate over successes only', () => {
    const ms = Array.from({ length: 100 }, (_, index) => index + 1);
    expect(percentile(ms, 0.95)).toBe(95);
    expect(percentile([], 0.95)).toBeNull();
    const summary = summarize([
      ...ms.map((value) => ({ ok: true, ms: value })),
      { ok: false, ms: 9999 }
    ]);
    expect(summary).toMatchObject({ samples: 101, errors: 1, p50: 50, p95: 95, p99: 99, max: 100 });
    expect(summary.errorRate).toBeCloseTo(1 / 101);
  });
  it('rejects unknown arguments', () => {
    expect(() => parsePerf(['--url', 'x'])).toThrow(/Unknown argument/);
    expect(parsePerf(['--report', '/tmp/r.json']).report).toBe('/tmp/r.json');
  });
});
