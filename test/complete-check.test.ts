import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const UNIT = 'exec vitest run --config vitest.unit.config.ts --coverage';
const STATIC = ['build', 'knip', 'typecheck', 'lint', 'format:check'];
const E2E_AFTER_RESET = ['exec node scripts/free-port.mjs 4173', 'exec playwright test'];
const allCommands = [
  ...STATIC,
  UNIT,
  'db:reset',
  'db:types:check',
  'test:integration',
  ...E2E_AFTER_RESET
];
const allStageCount = 10;

function runCompleteCheck(
  args: string[],
  failingCommand?: string,
  options: { driftOn?: string; env?: Record<string, string> } = {}
) {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'complete-check-test-'));
  const binDirectory = path.join(tempDirectory, 'bin');
  const logPath = path.join(tempDirectory, 'commands.log');
  mkdirSync(binDirectory);
  // Untracked, non-ignored file the fake pnpm creates to simulate sources changing mid-gate.
  const driftFile = path.join(repoRoot, `.complete-check-drift-${path.basename(tempDirectory)}`);

  writeFileSync(
    path.join(binDirectory, 'pnpm'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$COMPLETE_CHECK_LOG"',
      'printf \'%s|%s\\n\' "$*" "${E2E_PREBUILT:-}" >> "$COMPLETE_CHECK_LOG.env"',
      'if [ -n "${COMPLETE_CHECK_DRIFT:-}" ] && [ "${COMPLETE_CHECK_DRIFT}" = "$*" ]; then touch "$COMPLETE_CHECK_DRIFT_FILE"; fi',
      'if [ "${COMPLETE_CHECK_FAIL:-}" = "$*" ]; then exit 1; fi',
      ''
    ].join('\n'),
    { mode: 0o755 }
  );

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/complete-check.mjs'), ...args],
      {
        cwd: repoRoot,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          COMPLETE_CHECK_LOG: logPath,
          COMPLETE_CHECK_FAIL: failingCommand ?? '',
          COMPLETE_CHECK_DRIFT: options.driftOn ?? '',
          COMPLETE_CHECK_DRIFT_FILE: driftFile,
          ...options.env
        }
      }
    );
    const commands = existsSync(logPath)
      ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    const envLog = `${logPath}.env`;
    const prebuilt = existsSync(envLog)
      ? readFileSync(envLog, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    return { result, commands, prebuilt };
  } finally {
    rmSync(driftFile, { force: true });
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

const selectionCases: Array<{
  label: string;
  args: string[];
  expected: string[];
  stageCount: number;
  successMessage: string;
}> = [
  {
    label: 'default selection',
    args: [],
    expected: allCommands,
    stageCount: allStageCount,
    successMessage: '[complete-check] all stages passed'
  },
  {
    label: 'static checks',
    args: ['--only=static'],
    expected: STATIC,
    stageCount: 5,
    successMessage: '[complete-check] all selected stages passed'
  },
  {
    label: 'tests only',
    args: ['--only=test'],
    expected: [UNIT, 'db:reset', 'test:integration'],
    stageCount: 3,
    successMessage: '[complete-check] all selected stages passed'
  },
  {
    label: 'comma-separated groups',
    args: ['--only=static,test'],
    expected: [...STATIC, UNIT, 'db:reset', 'test:integration'],
    stageCount: 8,
    successMessage: '[complete-check] all selected stages passed'
  },
  {
    label: 'E2E only',
    args: ['--only=e2e'],
    expected: ['test:e2e'],
    stageCount: 1,
    successMessage: '[complete-check] all selected stages passed'
  }
];

describe('complete-check stage selection', () => {
  it.each(selectionCases)(
    'runs $label in declared order',
    ({ args, expected, successMessage, stageCount }) => {
      const { result, commands } = runCompleteCheck(args);

      expect(result.status).toBe(0);
      expect(commands).toEqual(expected);
      expect(result.stdout).toContain('=== complete-check summary ===');
      expect(result.stdout).toContain(successMessage);
      expect(result.stdout.match(/^PASS  /gm)).toHaveLength(stageCount);
    }
  );

  it('keeps the gate unit stage identical to the standalone test script', () => {
    const pkg: { scripts: Record<string, string> } = JSON.parse(
      readFileSync(path.join(repoRoot, 'package.json'), 'utf8')
    );

    expect(pkg.scripts.test).toBe(
      'vitest run --config vitest.unit.config.ts --coverage && pnpm db:reset && pnpm test:integration'
    );
    expect(pkg.scripts['test:e2e']).toBe(
      'pnpm db:reset && node scripts/free-port.mjs 4173 && playwright test'
    );
    expect(UNIT).toBe('exec vitest run --config vitest.unit.config.ts --coverage');
  });

  it('resets once and builds once in the full gate, with e2e on the prebuilt bundle', () => {
    const { result, commands, prebuilt } = runCompleteCheck([]);

    expect(result.status).toBe(0);
    expect(commands.filter((command) => command === 'db:reset')).toHaveLength(1);
    expect(commands.filter((command) => command === 'build')).toHaveLength(1);
    expect(commands.indexOf('test:integration')).toBeLessThan(
      commands.indexOf('exec playwright test')
    );
    expect(commands.indexOf('db:reset')).toBeLessThan(commands.indexOf('db:types:check'));
    expect(commands).not.toContain('test:e2e');
    expect(prebuilt.filter((line) => line.endsWith('|1'))).toEqual(
      E2E_AFTER_RESET.map((command) => `${command}|1`)
    );
    expect(prebuilt.filter((line) => line.endsWith('|1'))).toHaveLength(2);
  });

  it('shares one reset between test and e2e without a build', () => {
    const { commands, prebuilt } = runCompleteCheck(['--only=test,e2e']);

    expect(commands).toEqual([UNIT, 'db:reset', 'test:integration', ...E2E_AFTER_RESET]);
    expect(prebuilt.some((line) => line.endsWith('|1'))).toBe(false);
  });

  it('reuses the build for a standalone e2e run that still resets itself', () => {
    const { commands, prebuilt } = runCompleteCheck(['--only=static,e2e']);

    expect(commands).toEqual([...STATIC, 'test:e2e']);
    expect(prebuilt.at(-1)).toBe('test:e2e|1');
  });

  it('ignores an inherited E2E_PREBUILT and fresh-builds without a gate build', () => {
    const { prebuilt } = runCompleteCheck(['--only=e2e'], undefined, {
      env: { E2E_PREBUILT: '1' }
    });

    expect(prebuilt).toEqual(['test:e2e|']);
  });

  it('does not enable prebuilt mode when the gate build failed', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], 'build');

    expect(result.status).toBe(1);
    expect(prebuilt.at(-1)).toBe('test:e2e|');
  });

  it('fails closed to a fresh build when sources change after the gate build', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      driftOn: 'lint'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('sources changed since the gate build');
    expect(prebuilt.at(-1)).toBe('test:e2e|');
  });

  it('blocks reset-dependent stages and e2e when the gate reset fails', () => {
    const { result, commands } = runCompleteCheck([], 'db:reset');

    expect(result.status).toBe(1);
    expect(commands).toEqual([...STATIC, UNIT, 'db:reset']);
    expect(result.stdout).toMatch(/^BLOCK +db:types:check/m);
    expect(result.stdout).toMatch(/^BLOCK +test:integration/m);
    expect(result.stdout).toMatch(/^BLOCK +test:e2e/m);
    expect(result.stderr).toContain(
      '4 stage(s) failed: db:reset, db:types:check, test:integration, test:e2e'
    );
  });

  it('still resets and runs e2e after an unrelated stage failure', () => {
    const { result, commands } = runCompleteCheck([], 'test:integration');

    expect(result.status).toBe(1);
    expect(commands).toEqual(allCommands);
  });

  it('continues remaining selected stages and summarizes failures', () => {
    const expected = [...STATIC, UNIT, 'db:reset', 'test:integration'];
    const { result, commands } = runCompleteCheck(['--only=static,test'], 'build');

    expect(result.status).toBe(1);
    expect(commands).toEqual(expected);
    expect(result.stdout).toContain('FAIL  build');
    expect(result.stdout.match(/^(PASS|FAIL)  /gm)).toHaveLength(expected.length);
    expect(result.stderr).toContain('[complete-check] 1 stage(s) failed: build');
  });

  it('rejects unknown selection groups without running stages', () => {
    const { result, commands } = runCompleteCheck(['--only=static,unknown']);

    expect(result.status).toBe(2);
    expect(commands).toEqual([]);
    expect(result.stderr).toContain('Invalid --only value');
  });

  it('runs staged lint before pre-commit static checks and keeps a unit-only pre-push gate', () => {
    const preCommit = readFileSync(path.join(repoRoot, '.husky/pre-commit'), 'utf8')
      .trim()
      .split(/\r?\n/);

    expect(preCommit).toEqual([
      'pnpm exec lint-staged',
      'node scripts/complete-check.mjs --only=static'
    ]);
    const prePush = readFileSync(path.join(repoRoot, '.husky/pre-push'), 'utf8').trim();

    expect(prePush).toBe('pnpm test:unit');
  });
});
