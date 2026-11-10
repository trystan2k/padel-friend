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
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- database test double
    const docker = { admin, sql, dump } as unknown as Docker;
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

describe('rehearsal helpers', () => {
  it('lists every repository migration in order', () => {
    const versions = migrationFiles().map((entry) => entry.version);
    expect(versions).toEqual([...versions].sort());
    expect(versions.at(-1)).toBe('20261110100000');
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
