import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';

// Mirrors the `test` package script (unit coverage, db:reset, integration) so the gate can own the
// single reset; test/complete-check.test.ts pins the two together.
const UNIT_COVERAGE = 'pnpm exec vitest run --config vitest.unit.config.ts --coverage';
// What `pnpm test:e2e` runs after its own reset; the gate uses it only after its own successful reset.
const E2E_AFTER_RESET = 'pnpm exec node scripts/free-port.mjs 4173 && pnpm exec playwright test';

// Run the full quality gate by default; scoped runs retain the same reporting and
// continue-on-failure behavior for every selected stage. `needsReset` stages are BLOCKED when
// the gate's db:reset failed, so stale database state never passes.
const stages = [
  { name: 'build', command: 'pnpm build' },
  { name: 'knip', command: 'pnpm knip' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'lint', command: 'pnpm lint' },
  { name: 'format:check', command: 'pnpm format:check' },
  { name: 'test:unit', command: UNIT_COVERAGE },
  { name: 'db:reset', command: 'pnpm db:reset' },
  // db:types:check requires the live latest schema, so it runs right after the gate's reset.
  { name: 'db:types:check', command: 'pnpm db:types:check', needsReset: true },
  { name: 'test:integration', command: 'pnpm test:integration', needsReset: true },
  { name: 'test:e2e', command: 'pnpm test:e2e' }
];

const stageGroups = {
  // db:types:check requires live local Supabase; exclude it from the service-free pre-commit
  // group while retaining it in the full gate and CI integration job.
  static: ['build', 'knip', 'typecheck', 'lint', 'format:check'],
  test: ['test:unit', 'db:reset', 'test:integration'],
  e2e: ['test:e2e']
};

function selectStages(args) {
  if (args.length === 0) return stages;

  if (args.length !== 1 || !args[0].startsWith('--only=')) {
    throw new Error('Usage: node scripts/complete-check.mjs [--only=static[,test][,e2e]]');
  }

  const groups = args[0].slice('--only='.length).split(',');
  if (groups.some((group) => group.length === 0 || !Object.hasOwn(stageGroups, group))) {
    throw new Error(
      `Invalid --only value. Choose comma-separated groups: ${Object.keys(stageGroups).join(', ')}.`
    );
  }

  const selectedNames = new Set(groups.flatMap((group) => stageGroups[group]));
  return stages.filter((stage) => selectedNames.has(stage.name));
}

// Content hash of every non-ignored file (tracked + untracked) plus HEAD. Build outputs are
// git-ignored, so this identifies the sources a build came from.
function sourceFingerprint() {
  try {
    const git = (args) => execFileSync('git', args, { encoding: 'utf8', maxBuffer: 1 << 28 });
    const files = git(['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
      .split('\0')
      .filter((file) => file && existsSync(file));
    const hashes = execFileSync('git', ['hash-object', '--stdin-paths'], {
      encoding: 'utf8',
      input: files.join('\n'),
      maxBuffer: 1 << 28
    });
    return createHash('sha256')
      .update(git(['rev-parse', 'HEAD']))
      .update(files.join('\n'))
      .update(hashes)
      .digest('hex');
  } catch {
    return undefined;
  }
}

const args = process.argv.slice(2);
let selectedStages;
try {
  selectedStages = selectStages(args);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[complete-check] ${message}\n`);
  process.exit(2);
}

const results = [];
let resetOk = false;
let resetFailed = false;
let builtFingerprint;
for (const stage of selectedStages) {
  if (stage.needsReset && resetFailed) {
    process.stderr.write(`\n[complete-check] ${stage.name} BLOCKED: db:reset failed\n`);
    results.push({ name: stage.name, ok: false, label: 'BLOCK', seconds: '0.0' });
    continue;
  }

  let command = stage.command;
  const env = { ...process.env };
  // Never inherit prebuilt/reset context from the caller's shell; only this run grants it.
  delete env.E2E_PREBUILT;
  if (stage.name === 'test:e2e') {
    if (resetFailed) {
      process.stderr.write(`\n[complete-check] test:e2e BLOCKED: db:reset failed\n`);
      results.push({ name: stage.name, ok: false, label: 'BLOCK', seconds: '0.0' });
      continue;
    }
    // Reuse the gate's build only when it succeeded and the sources are unchanged since; otherwise
    // the webServer rebuilds (fail closed).
    if (builtFingerprint) {
      if (sourceFingerprint() === builtFingerprint) {
        env.E2E_PREBUILT = '1';
      } else {
        process.stderr.write(
          '\n[complete-check] sources changed since the gate build; e2e rebuilds the bundle\n'
        );
      }
    }
    // One reset per gate: reuse the gate's own successful reset instead of `pnpm test:e2e`'s.
    if (resetOk) command = E2E_AFTER_RESET;
  }

  process.stdout.write(`\n=== ${stage.name}: ${command} ===\n`);
  const started = Date.now();
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  results.push({ name: stage.name, ok, label: ok ? 'PASS' : 'FAIL', seconds });
  if (stage.name === 'db:reset') {
    resetOk = ok;
    resetFailed = !ok;
  }
  if (stage.name === 'build' && ok) builtFingerprint = sourceFingerprint();
  if (!ok) {
    process.stderr.write(
      `\n[complete-check] ${stage.name} FAILED (exit ${String(result.status)}) after ${seconds}s\n`
    );
  }
}

process.stdout.write('\n=== complete-check summary ===\n');
for (const stage of results) {
  process.stdout.write(`${stage.label.padEnd(5)} ${stage.name.padEnd(17)} ${stage.seconds}s\n`);
}

const failed = results.filter((stage) => !stage.ok);
if (failed.length > 0) {
  process.stderr.write(
    `\n[complete-check] ${failed.length} stage(s) failed: ${failed.map((stage) => stage.name).join(', ')}\n`
  );
  process.exit(1);
}
process.stdout.write(
  `\n[complete-check] ${args.length === 0 ? 'all stages' : 'all selected stages'} passed\n`
);
