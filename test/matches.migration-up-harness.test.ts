import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { databaseHost, runHarness } from '../scripts/test-populated-migration-up.mjs';
import { matchRegistrationFixtureHistory } from './helpers/match-registration-fixture-history';

const status = 'DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"\n';
const quiet = {
  log: vi.fn<(...args: unknown[]) => void>(),
  error: vi.fn<(...args: unknown[]) => void>()
};

function successfulRunner(calls: string[][]) {
  return (command: string, args: string[]) => {
    calls.push([command, ...args]);
    const stdout = args.includes('status') ? status : '';
    return { status: 0, stdout, stderr: '' };
  };
}

describe('populated migration-up harness safety and ordering', () => {
  it('finalizes only supplied legacy fixture histories without disabling integrity checks', () => {
    expect(() => matchRegistrationFixtureHistory(['not-an-id'])).toThrow(
      'Invalid fixture event ID'
    );
    const sql = matchRegistrationFixtureHistory(['11111111-1111-4111-8111-111111111111']);
    expect(sql).toContain('set constraints all immediate');
    expect(sql).toContain('public.reconcile_match_registration_participation(fixture_event)');
    expect(sql).not.toContain('disable trigger');
  });
  it('rehearses ownership anchors through the unit-2 predecessor and repeat-up assertions', () => {
    const calls: string[][] = [];
    runHarness({
      env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1', POPULATED_UPGRADE_SCENARIO: 'ownership' },
      run: successfulRunner(calls),
      log: quiet
    });
    expect(calls.some((call) => call.includes('20261021201100'))).toBe(true);
    expect(
      calls.filter((call) =>
        call.some((arg) => arg.endsWith('matches-ownership-upgrade-assertions.sql'))
      )
    ).toHaveLength(2);
  });
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

  it('never logs credential-bearing status output', () => {
    const log = { log: vi.fn<(...args: unknown[]) => void>() };
    runHarness({
      env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1', POPULATED_UPGRADE_SCENARIO: 'departures' },
      run: successfulRunner([]),
      log
    });
    expect(log.log.mock.calls.flat().join('\n')).not.toContain(status.trim());
    expect(log.log.mock.calls.flat().join('\n')).toContain('database host is loopback');
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

  it('checks the repeated snapshot inside the database without parsing CLI output', () => {
    const calls: string[][] = [];
    runHarness({
      env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1' },
      run: successfulRunner(calls),
      log: quiet
    });
    expect(
      calls.filter((call) => call.includes('select public.paf_upgrade_assert_snapshot()'))
    ).toHaveLength(1);
    expect(
      calls.some((call) => call.some((arg) => arg.includes('select public.paf_upgrade_snapshot')))
    ).toBe(false);
  });

  it('rehearses departures through the shared safety, history, repeat-up and restoration gates', () => {
    const calls: string[][] = [];
    runHarness({
      env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1', POPULATED_UPGRADE_SCENARIO: 'departures' },
      run: successfulRunner(calls),
      log: quiet
    });
    expect(calls[1]).toEqual([
      'pnpm',
      'exec',
      'supabase',
      'db',
      'reset',
      '--local',
      '--version',
      '20261021200000',
      '--no-seed'
    ]);
    const seed = calls.findIndex((call) =>
      call.some((arg) => arg.endsWith('matches-departures-predecessor.sql'))
    );
    const upgrades = calls.flatMap((call, index) => (call.includes('migration') ? [index] : []));
    const assertions = calls.flatMap((call, index) =>
      call.some((arg) => arg.endsWith('matches-departures-upgrade-assertions.sql')) ? [index] : []
    );
    expect(seed).toBeGreaterThan(1);
    expect(upgrades).toHaveLength(2);
    expect(assertions).toHaveLength(2);
    expect(seed).toBeLessThan(upgrades[0]!);
    expect(assertions[0]!).toBeGreaterThan(upgrades[0]!);
    expect(assertions[0]!).toBeLessThan(upgrades[1]!);
    expect(assertions[1]!).toBeGreaterThan(upgrades[1]!);
    expect(calls.at(-1)).toEqual([
      'pnpm',
      'exec',
      'supabase',
      'db',
      'reset',
      '--local',
      '--no-seed'
    ]);
  });

  it('rejects unknown scenarios before starting a subprocess', () => {
    const run = vi.fn<(...args: unknown[]) => never>();
    expect(() =>
      runHarness({
        env: { CI: 'true', POPULATED_UPGRADE_OPT_IN: '1', POPULATED_UPGRADE_SCENARIO: 'typo' },
        run,
        log: quiet
      })
    ).toThrow('Unknown populated migration scenario');
    expect(run).not.toHaveBeenCalled();
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
