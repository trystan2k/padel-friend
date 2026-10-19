import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { databaseHost, runHarness } from '../scripts/test-populated-migration-up.mjs';

const status = 'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\n';
const quiet = {
  log: vi.fn<(...args: unknown[]) => void>(),
  error: vi.fn<(...args: unknown[]) => void>()
};

function successfulRunner(calls: string[][], snapshotShape: 'rows' | 'array' = 'rows') {
  return (command: string, args: string[]) => {
    calls.push([command, ...args]);
    const stdout = args.includes('status')
      ? status
      : args.some((arg) => arg.includes('select public.paf_upgrade_snapshot'))
        ? snapshotShape === 'rows'
          ? 'NOTICE: advisory metadata\n{"rows":[{"paf_upgrade_snapshot":"stable"}]}\ncomplete'
          : 'NOTICE: advisory metadata\n[{"paf_upgrade_snapshot":"stable"}]\ncomplete'
        : '';
    return { status: 0, stdout, stderr: '' };
  };
}

describe('populated migration-up harness safety and ordering', () => {
  it('refuses without explicit opt-in before starting any subprocess', () => {
    const run = vi.fn<(...args: unknown[]) => never>();
    expect(() => runHarness({ env: { CI: 'true' }, run, log: quiet })).toThrow(
      'POPULATED_UPGRADE_OPT_IN=1'
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses outside CI before starting any subprocess', () => {
    const run = vi.fn<(...args: unknown[]) => never>();
    expect(() => runHarness({ env: { POPULATED_UPGRADE_OPT_IN: '1' }, run, log: quiet })).toThrow(
      'outside CI'
    );
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses non-loopback CLI status without running reset', () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      return {
        status: 0,
        stdout: 'DB_URL="postgresql://postgres:secret@database.example:5432/postgres"',
        stderr: ''
      };
    };
    expect(() =>
      runHarness({ env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1' }, run, log: quiet })
    ).toThrow('non-loopback');
    expect(calls).toHaveLength(1);
    expect(calls[0]).toContain('status');
  });

  it('accepts only loopback hosts', () => {
    expect(databaseHost(status)).toBe('127.0.0.1');
    expect(() => databaseHost('DB_URL=postgresql://postgres:pw@db.example/postgres')).toThrow(
      'non-loopback'
    );
  });

  it('uses exact predecessor reset; fixture precedes up and assertions follow it', () => {
    const calls: string[][] = [];
    runHarness({
      env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1' },
      run: successfulRunner(calls),
      log: quiet
    });
    expect(calls).toContainEqual([
      'pnpm',
      'exec',
      'supabase',
      'db',
      'reset',
      '--local',
      '--version',
      '20261016120300',
      '--no-seed'
    ]);
    const seedIndex = calls.findIndex((call) =>
      call.some((arg) => arg.endsWith('matches-predecessor-upgrade.sql'))
    );
    const upIndex = calls.findIndex((call) => call.includes('migration') && call.includes('up'));
    const assertionIndex = calls.findIndex((call) =>
      call.some((arg) => arg.endsWith('matches-upgrade-assertions.sql'))
    );
    expect(seedIndex).toBeGreaterThan(-1);
    expect(seedIndex).toBeLessThan(upIndex);
    expect(assertionIndex).toBeGreaterThan(upIndex);
  });

  it('parses bare-array snapshot payload with surrounding CLI noise', () => {
    const calls: string[][] = [];
    runHarness({
      env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1' },
      run: successfulRunner(calls, 'array'),
      log: quiet
    });
    expect(
      calls.filter((call) => call.some((arg) => arg.includes('select public.paf_upgrade_snapshot')))
    ).toHaveLength(2);
  });

  it('preserves migration failure while restoring latest schema', () => {
    const calls: string[][] = [];
    const run = (command: string, args: string[]) => {
      calls.push([command, ...args]);
      if (args.includes('status')) return { status: 0, stdout: status, stderr: '' };
      if (args.includes('migration'))
        return { status: 1, stdout: 'intentional failure', stderr: '' };
      return { status: 0, stdout: '', stderr: '' };
    };
    expect(() =>
      runHarness({ env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1' }, run, log: quiet })
    ).toThrow('migration up --local failed (1)');
    expect(calls.at(-1)).toEqual(['pnpm', 'exec', 'supabase', 'db', 'reset', '--local']);
  });

  it('does not write or alter migration source files', () => {
    const source = readFileSync('scripts/test-populated-migration-up.mjs', 'utf8');
    expect(source).not.toMatch(/writeFile|copyFile|truncate|migration.*repair/i);
  });
});
