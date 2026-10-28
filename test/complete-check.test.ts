import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

const repoRoot = process.cwd();
const allStages = [
  'db:types:check',
  'build',
  'knip',
  'typecheck',
  'lint',
  'format:check',
  'test',
  'test:e2e'
];

function runCompleteCheck(args: string[], failingCommand?: string) {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'complete-check-test-'));
  const binDirectory = path.join(tempDirectory, 'bin');
  const logPath = path.join(tempDirectory, 'commands.log');
  mkdirSync(binDirectory);

  writeFileSync(
    path.join(binDirectory, 'pnpm'),
    [
      '#!/bin/sh',
      'printf \'%s\\n\' "$*" >> "$COMPLETE_CHECK_LOG"',
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
          COMPLETE_CHECK_FAIL: failingCommand ?? ''
        }
      }
    );
    const commands = existsSync(logPath)
      ? readFileSync(logPath, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    return { result, commands };
  } finally {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}

const selectionCases: Array<{
  label: string;
  args: string[];
  expected: string[];
  successMessage: string;
}> = [
  {
    label: 'default selection',
    args: [],
    expected: allStages,
    successMessage: '[complete-check] all stages passed'
  },
  {
    label: 'static checks',
    args: ['--only=static'],
    expected: allStages.slice(0, 6),
    successMessage: '[complete-check] all selected stages passed'
  },
  {
    label: 'tests only',
    args: ['--only=test'],
    expected: ['test'],
    successMessage: '[complete-check] all selected stages passed'
  },
  {
    label: 'comma-separated groups',
    args: ['--only=static,test'],
    expected: allStages.slice(0, 7),
    successMessage: '[complete-check] all selected stages passed'
  },
  {
    label: 'E2E only',
    args: ['--only=e2e'],
    expected: ['test:e2e'],
    successMessage: '[complete-check] all selected stages passed'
  }
];

describe('complete-check stage selection', () => {
  it.each(selectionCases)('runs $label in declared order', ({ args, expected, successMessage }) => {
    const { result, commands } = runCompleteCheck(args);

    expect(result.status).toBe(0);
    expect(commands).toEqual(expected);
    expect(result.stdout).toContain('=== complete-check summary ===');
    expect(result.stdout).toContain(successMessage);
    expect(result.stdout.match(/^PASS  /gm)).toHaveLength(expected.length);
  });

  it('continues remaining selected stages and summarizes failures', () => {
    const expected = allStages.slice(0, 7);
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

  it('runs staged lint before pre-commit static checks and limits pre-push to tests', () => {
    const preCommit = readFileSync(path.join(repoRoot, '.husky/pre-commit'), 'utf8')
      .trim()
      .split(/\r?\n/);
    const prePush = readFileSync(path.join(repoRoot, '.husky/pre-push'), 'utf8').trim();

    expect(preCommit).toEqual([
      'pnpm exec lint-staged',
      'node scripts/complete-check.mjs --only=static'
    ]);
    expect(prePush).toBe('node scripts/complete-check.mjs --only=test');
  });
});
