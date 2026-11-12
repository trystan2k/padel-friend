import { execFileSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { SERIAL_SPECS, gateLanes } from '../scripts/e2e-shards.mjs';

const repoRoot = process.cwd();
const UNIT = 'exec vitest run --config vitest.unit.config.ts --coverage';
const STATIC = ['build', 'knip', 'typecheck', 'lint', 'format:check'];
const lanes = gateLanes();
// Free the port once, then the main sweep and the serial specs as separate Playwright invocations.
const E2E_AFTER_RESET = [
  'exec node scripts/free-port.mjs 4173',
  `exec playwright test ${lanes.main.join(' ')}`,
  `exec playwright test ${lanes.serial.join(' ')} --workers=1`
];
const allCommands = [
  ...STATIC,
  UNIT,
  'db:reset',
  'db:types:check',
  'test:integration',
  'db:reset',
  ...E2E_AFTER_RESET
];
const allStageCount = 11;
const PLAYWRIGHT = E2E_AFTER_RESET[2];

function runCompleteCheck(
  args: string[],
  failingCommand?: string,
  options: {
    driftOn?: string;
    driftFile?: string;
    clobberOn?: string;
    failNth?: number;
    rekeyOn?: string;
    symlink?: boolean;
    env?: Record<string, string>;
  } = {}
) {
  const tempDirectory = mkdtempSync(path.join(os.tmpdir(), 'complete-check-test-'));
  const binDirectory = path.join(tempDirectory, 'bin');
  const logPath = path.join(tempDirectory, 'commands.log');
  mkdirSync(binDirectory);
  // The gate runs inside a throwaway git repository so simulated drift (an untracked source file or a
  // Vite env file) never touches the real worktree, whatever the test outcome; the temp directory is
  // always removed in `finally`.
  const projectDirectory = path.join(tempDirectory, 'project');
  mkdirSync(projectDirectory);
  writeFileSync(path.join(projectDirectory, 'package.json'), '{}\n');
  // Like the real repo, build output is ignored: the fingerprint must not see dist changes.
  writeFileSync(path.join(projectDirectory, '.gitignore'), 'dist/\n');
  if (options.symlink) {
    // Like test/stack/supabase/migrations: a tracked directory symlink git hash-object cannot hash.
    mkdirSync(path.join(projectDirectory, 'real-dir'));
    writeFileSync(path.join(projectDirectory, 'real-dir/file.sql'), 'select 1;\n');
    symlinkSync('real-dir', path.join(projectDirectory, 'linked-dir'));
  }
  for (const gitArgs of [
    ['init', '-q'],
    ['add', '.'],
    ['-c', 'user.name=t', '-c', 'user.email=t@example.com', 'commit', '-q', '-m', 'init']
  ]) {
    execFileSync('git', gitArgs, { cwd: projectDirectory });
  }
  // File the fake pnpm appends to, to simulate inputs changing mid-gate (default: an untracked source file).
  const driftFile = path.join(projectDirectory, options.driftFile ?? '.complete-check-drift');

  writeFileSync(
    path.join(binDirectory, 'pnpm'),
    [
      '#!/bin/sh',
      // The tuple lookup is the shared test-stack resolver's, not a gate stage: answer it unlogged. Only
      // the pinned TEST workdir is answered; a root-CLI status call (no --workdir) is a hard failure.
      'case "$*" in',
      '  "exec supabase --workdir "*" status -o env")',
      '    printf \'%s\\n\' "$*" >> "$COMPLETE_CHECK_LOG.status"',
      '    if [ -n "${COMPLETE_CHECK_STACK_FAIL:-}" ]; then echo "supabase local stack is not running" >&2; exit 1; fi',
      // Realistic test-stack status shape: quoted KEY="value" lines.
      '    printf \'API_URL="http://127.0.0.1:55421"\\nDB_URL="postgresql://postgres:fake-db-pw@127.0.0.1:55422/postgres"\\nMAILPIT_URL="http://127.0.0.1:55424"\\nPUBLISHABLE_KEY="sb_publishable_fake"\\nSERVICE_ROLE_KEY="%s"\\n\' "${COMPLETE_CHECK_STACK_KEY:-}"; exit 0 ;;',
      '  "exec supabase status -o env") echo "root dev stack status must never be used" >&2; exit 1 ;;',
      'esac',
      'printf \'%s\\n\' "$*" >> "$COMPLETE_CHECK_LOG"',
      'if [ "$*" = "build" ]; then',
      '  printf \'%s|%s|%s|%s\\n\' "${CLOUDFLARE_INCLUDE_PROCESS_ENV:-}" "${SUPABASE_SERVICE_ROLE_KEY:-}" "${VITE_SUPABASE_URL:-}" "${DATABASE_URL:-}" >> "$COMPLETE_CHECK_LOG.build"',
      // Like the real build, bake the key into dist/server/.dev.vars only when the build env has it.
      '  mkdir -p dist/server; : > dist/server/.dev.vars',
      '  if [ -n "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then printf \'SUPABASE_SERVICE_ROLE_KEY=%s\\n\' "$SUPABASE_SERVICE_ROLE_KEY" > dist/server/.dev.vars; fi',
      'fi',
      // Simulates a later rebuild (e.g. a keyless build inside a test) wiping the baked key.
      'if [ -n "${COMPLETE_CHECK_CLOBBER:-}" ] && [ "$COMPLETE_CHECK_CLOBBER" = "$*" ]; then : > dist/server/.dev.vars; fi',
      'printf \'%s|%s\\n\' "$*" "${E2E_GATE_PREBUILT:-}" >> "$COMPLETE_CHECK_LOG.env"',
      'printf \'%s|%s|%s|%s|%s\\n\' "$*" "${VITE_SUPABASE_URL:-}" "${VITE_SUPABASE_PUBLISHABLE_KEY:-}" "${DATABASE_URL:-}" "${SUPABASE_SERVICE_ROLE_KEY:-}" >> "$COMPLETE_CHECK_LOG.tuple"',
      // Simulates a rebuild that baked a different (stale/dev) key into the server binding.
      'if [ -n "${COMPLETE_CHECK_REKEY:-}" ] && [ "$COMPLETE_CHECK_REKEY" = "$*" ]; then printf \'SUPABASE_SERVICE_ROLE_KEY=other-key\\n\' > dist/server/.dev.vars; fi',
      'if [ -n "${COMPLETE_CHECK_DRIFT:-}" ] && [ "${COMPLETE_CHECK_DRIFT}" = "$*" ]; then printf drift >> "$COMPLETE_CHECK_DRIFT_FILE"; fi',
      // COMPLETE_CHECK_FAIL_NTH limits the failure to that (1-based) occurrence of the command.
      'if [ "${COMPLETE_CHECK_FAIL:-}" = "$*" ]; then',
      '  if [ -z "${COMPLETE_CHECK_FAIL_NTH:-}" ] || [ "$(grep -cxF -- "$*" "$COMPLETE_CHECK_LOG")" = "$COMPLETE_CHECK_FAIL_NTH" ]; then exit 1; fi',
      'fi',
      ''
    ].join('\n'),
    { mode: 0o755 }
  );

  try {
    const result = spawnSync(
      process.execPath,
      [path.join(repoRoot, 'scripts/complete-check.mjs'), ...args],
      {
        cwd: projectDirectory,
        encoding: 'utf8',
        env: {
          ...process.env,
          PATH: `${binDirectory}${path.delimiter}${process.env.PATH ?? ''}`,
          COMPLETE_CHECK_LOG: logPath,
          COMPLETE_CHECK_FAIL: failingCommand ?? '',
          COMPLETE_CHECK_FAIL_NTH: options.failNth?.toString() ?? '',
          COMPLETE_CHECK_DRIFT: options.driftOn ?? '',
          COMPLETE_CHECK_CLOBBER: options.clobberOn ?? '',
          COMPLETE_CHECK_REKEY: options.rekeyOn ?? '',
          COMPLETE_CHECK_STACK_KEY: 'stack-key',
          SUPABASE_SERVICE_ROLE_KEY: '',
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
    const buildLog = `${logPath}.build`;
    const buildEnv = existsSync(buildLog)
      ? readFileSync(buildLog, 'utf8').trim().split('\n').filter(Boolean)
      : [];
    const readLog = (suffix: string) =>
      existsSync(`${logPath}.${suffix}`)
        ? readFileSync(`${logPath}.${suffix}`, 'utf8').trim().split('\n').filter(Boolean)
        : [];
    return {
      result,
      commands,
      prebuilt,
      buildEnv,
      tuples: readLog('tuple'),
      statusCalls: readLog('status')
    };
  } finally {
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
    expected: ['db:reset', ...E2E_AFTER_RESET],
    stageCount: 2,
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
      'pnpm db:reset && node scripts/free-port.mjs 4173 && node scripts/with-test-stack.mjs pnpm exec playwright test'
    );
    // Bare reset is the TEST stack reset; the dev wipe is the explicit, rooted db:reset:dev.
    expect(pkg.scripts['db:reset']).toBe('pnpm test:stack:reset');
    expect(pkg.scripts['db:reset:dev']).toBe('supabase --workdir . db reset --local');
    expect(UNIT).toBe('exec vitest run --config vitest.unit.config.ts --coverage');
  });

  it('gives each test phase a fresh reset and builds once, with e2e on the prebuilt bundle', () => {
    const { result, commands, prebuilt } = runCompleteCheck([]);

    expect(result.status).toBe(0);
    expect(commands.filter((command) => command === 'db:reset')).toHaveLength(2);
    expect(commands.filter((command) => command === 'build')).toHaveLength(1);
    // reset -> db:types:check -> integration, then a second reset immediately before e2e
    expect(commands.slice(commands.indexOf(UNIT))).toEqual([
      UNIT,
      'db:reset',
      'db:types:check',
      'test:integration',
      'db:reset',
      ...E2E_AFTER_RESET
    ]);
    expect(commands).not.toContain('test:e2e');
    expect(prebuilt.filter((line) => line.endsWith('|1'))).toEqual(
      E2E_AFTER_RESET.map((command) => `${command}|1`)
    );
    expect(prebuilt.filter((line) => line.endsWith('|1'))).toHaveLength(E2E_AFTER_RESET.length);
  });

  it('resets again between test and e2e without a build', () => {
    const { commands, prebuilt } = runCompleteCheck(['--only=test,e2e']);

    expect(commands).toEqual([
      UNIT,
      'db:reset',
      'test:integration',
      'db:reset',
      ...E2E_AFTER_RESET
    ]);
    expect(prebuilt.some((line) => line.endsWith('|1'))).toBe(false);
  });

  it('reuses the build for an e2e run that resets itself first', () => {
    const { commands, prebuilt } = runCompleteCheck(['--only=static,e2e']);

    expect(commands).toEqual([...STATIC, 'db:reset', ...E2E_AFTER_RESET]);
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|1`);
  });

  it('runs the e2e stage as the main sweep without the serial specs, then the serial specs', () => {
    const { commands } = runCompleteCheck(['--only=e2e']);
    const playwright = commands.filter((command) => command.startsWith('exec playwright test'));

    expect(
      commands.filter((command) => command === 'exec node scripts/free-port.mjs 4173')
    ).toHaveLength(1);
    expect(playwright).toHaveLength(2);
    const [main = [], serial = []] = playwright.map((command) => command.split(' ').slice(3));
    expect(main).toContain('e2e/home.spec.ts');
    for (const spec of SERIAL_SPECS) expect(main).not.toContain(spec);
    // The serial invocation is the 11 serial files on a single worker.
    expect(serial).toEqual([
      'e2e/level-reviews-admin.spec.ts',
      'e2e/level-reviews-player.spec.ts',
      'e2e/level-reviews.spec.ts',
      'e2e/notifications.spec.ts',
      'e2e/push-deep-links.spec.ts',
      'e2e/push-preferences.spec.ts',
      'e2e/pwa.spec.ts',
      'e2e/result-amendments-chronology.spec.ts',
      'e2e/result-corrections-visual.spec.ts',
      'e2e/result-repairs.spec.ts',
      'e2e/statistics.spec.ts',
      '--workers=1'
    ]);
    expect(serial.slice(0, -1)).toEqual(SERIAL_SPECS);
    expect(main).not.toContain('--workers=1');
    expect(main).toContain('e2e/level-reviews-visual.spec.ts');
  });

  it('fails the e2e stage at the first failing Playwright invocation', () => {
    const { result, commands } = runCompleteCheck(['--only=e2e'], E2E_AFTER_RESET[1]);

    expect(result.status).toBe(1);
    expect(commands).toEqual(['db:reset', E2E_AFTER_RESET[0], E2E_AFTER_RESET[1]]);
    expect(result.stderr).toContain('test:e2e FAILED');
  });

  it('builds with the shared e2e build env so the preview worker has the service-role key', () => {
    const { buildEnv } = runCompleteCheck(['--only=static,e2e'], undefined, {
      env: { COMPLETE_CHECK_STACK_KEY: 'stack-key', SUPABASE_SERVICE_ROLE_KEY: '' }
    });

    // Public pair and service key both come from the TEST status; DATABASE_URL is blanked for the bundle.
    expect(buildEnv).toEqual(['true|stack-key|http://127.0.0.1:55421|']);
  });

  it('fails the build stage closed, with the reason, when e2e is selected and no key resolves', () => {
    const { result, commands, buildEnv } = runCompleteCheck(['--only=static,e2e'], undefined, {
      env: { COMPLETE_CHECK_STACK_FAIL: '1' }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('build FAILED');
    expect(result.stderr).toContain('e2e build requires the test Supabase stack');
    expect(result.stderr).toContain('pnpm test:stack:up');
    expect(result.stderr).not.toContain('root dev stack status');
    expect(result.stdout).toMatch(/^FAIL +build/m);
    expect(commands).not.toContain('build');
    expect(buildEnv).toEqual([]);
  });

  it('fails closed when the stack answers without a service-role key', () => {
    const { result, commands } = runCompleteCheck(['--only=static,e2e'], undefined, {
      env: { COMPLETE_CHECK_STACK_KEY: '' }
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('SUPABASE_SERVICE_ROLE_KEY is missing');
    expect(commands).not.toContain('build');
  });

  it('never looks the key up for static-only runs, even without a stack', () => {
    const { result, commands } = runCompleteCheck(['--only=static'], undefined, {
      env: { COMPLETE_CHECK_STACK_FAIL: '1' }
    });

    expect(result.status).toBe(0);
    expect(commands).toEqual(STATIC);
  });

  it('rebuilds in e2e when the gate build lost its key after later stages rebuilt dist', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      clobberOn: 'lint'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('lost its service-role key');
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|`);
  });

  it('replaces an inherited service key and dev tuple with the test status-derived one', () => {
    const { buildEnv, result } = runCompleteCheck(['--only=static,e2e'], undefined, {
      env: {
        COMPLETE_CHECK_STACK_KEY: 'stack-key',
        SUPABASE_SERVICE_ROLE_KEY: 'shell-key',
        VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
        DATABASE_URL: 'postgresql://postgres:dev@127.0.0.1:55322/postgres'
      }
    });

    expect(buildEnv).toEqual(['true|stack-key|http://127.0.0.1:55421|']);
    expect(result.stdout + result.stderr).not.toContain('shell-key');
  });

  it('hands the same test tuple to every stage of a full run and discovers it exactly once', () => {
    const { tuples, statusCalls, result } = runCompleteCheck([], undefined, {
      env: {
        VITE_SUPABASE_URL: 'http://127.0.0.1:55321',
        VITE_SUPABASE_PUBLISHABLE_KEY: 'dev-publishable',
        DATABASE_URL: 'postgresql://postgres:dev@127.0.0.1:55322/postgres'
      }
    });

    expect(result.status).toBe(0);
    expect(statusCalls).toHaveLength(1);
    expect(statusCalls[0]).toMatch(/^exec supabase --workdir .*test\/stack status -o env$/);
    const wanted = (name: string) => tuples.find((line) => line.startsWith(name + '|'));
    for (const stage of [
      'typecheck',
      'test:integration',
      E2E_AFTER_RESET[1]!,
      E2E_AFTER_RESET[2]!
    ]) {
      const line = wanted(stage);
      expect(line).toBeDefined();
      const [, url, key, database, service] = line!.split('|');
      expect(url).toBe('http://127.0.0.1:55421');
      expect(key).toBe('sb_publishable_fake');
      expect(database).toContain(':55422/');
      expect(service).toBe('stack-key');
    }
    expect(result.stdout + result.stderr).not.toContain('fake-db-pw');
  });

  it('stays service-free for static-only runs: no discovery, inherited env untouched', () => {
    const { tuples, statusCalls } = runCompleteCheck(['--only=static'], undefined, {
      env: { VITE_SUPABASE_URL: 'https://static.example.test' }
    });

    expect(statusCalls).toEqual([]);
    for (const line of tuples) expect(line.split('|')[1]).toBe('https://static.example.test');
  });

  it('keeps prebuilt reuse when a directory symlink is tracked (git hash-object cannot hash it)', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      symlink: true
    });

    expect(result.status).toBe(0);
    expect(result.stderr).not.toContain('fatal');
    expect(result.stderr).not.toContain('sources changed');
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|1`);
  });

  it('rebuilds when the baked server binding is a key from a different stack, without logging it', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      rekeyOn: 'lint'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('server binding does not match the current test stack');
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|`);
    expect(result.stdout + result.stderr).not.toContain('other-key');
    expect(result.stdout + result.stderr).not.toContain('stack-key');
  });

  it('is unaffected by a conflicting dev VITE_SUPABASE_URL: the test tuple is explicit process env', () => {
    const { buildEnv } = runCompleteCheck(['--only=static,e2e'], undefined, {
      env: { VITE_SUPABASE_URL: 'http://127.0.0.1:55321' }
    });

    expect(buildEnv[0]).toContain('|http://127.0.0.1:55421|');
  });

  it('leaves the build env untouched when e2e is not selected (service-free runs)', () => {
    const { commands, buildEnv } = runCompleteCheck(['--only=static'], undefined, {
      env: {
        COMPLETE_CHECK_STACK_KEY: 'stack-key',
        SUPABASE_SERVICE_ROLE_KEY: '',
        VITE_SUPABASE_URL: '',
        DATABASE_URL: ''
      }
    });

    expect(commands).toEqual(STATIC);
    expect(buildEnv).toEqual(['|||']);
  });

  it('ignores an inherited E2E_GATE_PREBUILT and fresh-builds without a gate build', () => {
    const { prebuilt } = runCompleteCheck(['--only=e2e'], undefined, {
      env: { E2E_GATE_PREBUILT: '1' }
    });

    expect(prebuilt).toEqual(['db:reset|', ...E2E_AFTER_RESET.map((command) => `${command}|`)]);
  });

  it('does not enable prebuilt mode when the gate build failed', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], 'build');

    expect(result.status).toBe(1);
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|`);
  });

  it('fails closed to a fresh build when sources change after the gate build', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      driftOn: 'lint'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('sources changed since the gate build');
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|`);
  });

  it('fails closed to a fresh build when a Vite env file changes after the gate build', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      driftOn: 'lint',
      driftFile: '.env.local'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('sources changed since the gate build');
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|`);
  });

  it('fails closed to a fresh build when .env.production.local changes after the gate build', () => {
    const { result, prebuilt } = runCompleteCheck(['--only=static,e2e'], undefined, {
      driftOn: 'lint',
      driftFile: '.env.production.local'
    });

    expect(result.status).toBe(0);
    expect(result.stderr).toContain('sources changed since the gate build');
    expect(prebuilt.at(-1)).toBe(`${PLAYWRIGHT}|`);
  });

  it('blocks integration stages when the integration reset fails, still resetting for e2e', () => {
    const { result, commands } = runCompleteCheck([], 'db:reset', { failNth: 1 });

    expect(result.status).toBe(1);
    expect(commands).toEqual([...STATIC, UNIT, 'db:reset', 'db:reset', ...E2E_AFTER_RESET]);
    expect(result.stdout).toMatch(/^BLOCK +db:types:check/m);
    expect(result.stdout).toMatch(/^BLOCK +test:integration/m);
    expect(result.stdout).toMatch(/^PASS +test:e2e/m);
    expect(result.stderr).toContain(
      '3 stage(s) failed: db:reset, db:types:check, test:integration'
    );
  });

  it('blocks e2e when the e2e reset fails, after integration ran', () => {
    const { result, commands } = runCompleteCheck([], 'db:reset', { failNth: 2 });

    expect(result.status).toBe(1);
    expect(commands).toEqual([
      ...STATIC,
      UNIT,
      'db:reset',
      'db:types:check',
      'test:integration',
      'db:reset'
    ]);
    expect(result.stdout).toMatch(/^BLOCK +test:e2e/m);
    expect(result.stderr).toContain('2 stage(s) failed: db:reset:e2e, test:e2e');
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
