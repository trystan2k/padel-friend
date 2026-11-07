import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, relative, resolve } from 'node:path';
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
