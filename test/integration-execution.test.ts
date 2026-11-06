import { describe, expect, it } from 'vitest';
import { readdirSync } from 'node:fs';
import { PARALLEL_INTEGRATION_FILES } from '../integration-partition';
import { phaseArgs, runIntegration } from '../scripts/run-integration.mjs';

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

describe('phaseArgs', () => {
  it('suffixes the JSON report path per phase and keeps other args', () => {
    expect(
      phaseArgs(['--outputFile.json=artifacts/r.json', '--reporter=json', 'a'], 'serial')
    ).toEqual(['--outputFile.json=artifacts/r.serial.json', '--reporter=json', 'a']);
  });
});

describe('runIntegration', () => {
  it('runs the parallel phase before the serial phase with phase env', () => {
    const { calls, run } = recorder();
    expect(runIntegration({ args: [], env: {}, run })).toBe(0);
    expect(calls.map((call) => call.env.INTEGRATION_PHASE)).toEqual(['parallel', 'serial']);
  });

  it('runs one phase-less invocation for the serial rollback', () => {
    const { calls, run } = recorder();
    runIntegration({
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
    runIntegration({ args: ['--reporter=default'], env: {}, run });
    expect(calls[0]?.args).not.toContain('--passWithNoTests');
  });

  it('runs both phases after a failure and returns the first failing status', () => {
    const { calls, run } = recorder([3, 1]);
    expect(runIntegration({ args: [], env: {}, run })).toBe(3);
    expect(calls).toHaveLength(2);
  });
});
