import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { e2eBuildEnv, resolveTestBuildEnv } from './e2e-build-env.mjs';
import { gateLanes } from './e2e-shards.mjs';
import { sourceFingerprint } from './source-fingerprint.mjs';
import { TEST_ENV_NAMES } from './test-stack-env.mjs';

// Mirrors the `test` package script (unit coverage, db:reset, integration) so the gate can own the
// reset before integration; test/complete-check.test.ts pins the two together. `db:reset` is the
// TEST stack reset (scripts/test-stack.mjs), so both gate resets wipe only the isolated test database.
const UNIT_COVERAGE = 'pnpm exec vitest run --config vitest.unit.config.ts --coverage';
// What `pnpm test:e2e` runs after its own reset, split like the CI lanes: the main sweep, then the
// serial specs on one worker (global repair claim, revision-sensitive and by-design race specs: see
// SERIAL_SPECS in scripts/e2e-shards.mjs). The port
// is freed once; each invocation starts and stops its own preview. The gate runs it only after its own
// e2e reset, and the first failing invocation fails the stage.
function e2eAfterReset() {
  const { main, serial } = gateLanes();
  return [
    'pnpm exec node scripts/free-port.mjs 4173',
    `pnpm exec playwright test ${main.join(' ')}`,
    `pnpm exec playwright test ${serial.join(' ')} --workers=1`
  ].join(' && ');
}

// Run the full quality gate by default; scoped runs retain the same reporting and
// continue-on-failure behavior for every selected stage. Each test phase starts from its own fresh
// reset (integration leaves residue e2e global-setup cannot prune). `needsReset` names the reset
// stage a stage depends on; it is BLOCKED when that reset failed, so stale database state never passes.
const stages = [
  { name: 'build', command: 'pnpm build' },
  { name: 'knip', command: 'pnpm knip' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'lint', command: 'pnpm lint' },
  { name: 'format:check', command: 'pnpm format:check' },
  { name: 'test:unit', command: UNIT_COVERAGE },
  { name: 'db:reset', command: 'pnpm db:reset' },
  // db:types:check requires the live latest schema, so it runs right after the gate's reset.
  { name: 'db:types:check', command: 'pnpm db:types:check', needsReset: 'db:reset' },
  { name: 'test:integration', command: 'pnpm test:integration', needsReset: 'db:reset' },
  { name: 'db:reset:e2e', command: 'pnpm db:reset' },
  { name: 'test:e2e', command: e2eAfterReset(), needsReset: 'db:reset:e2e' }
];

const stageGroups = {
  // db:types:check requires live local Supabase; exclude it from the service-free pre-commit
  // group while retaining it in the full gate and CI integration job.
  static: ['build', 'knip', 'typecheck', 'lint', 'format:check'],
  test: ['test:unit', 'db:reset', 'test:integration'],
  e2e: ['db:reset:e2e', 'test:e2e']
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

// The preview worker reads the service-role key from the build's baked .dev.vars; anything that
// rebuilds dist without it (a keyless `pnpm build` inside a test) leaves e2e unable to add players.
const DEV_VARS = 'dist/server/.dev.vars';
const distHasServiceRoleKey = () =>
  existsSync(DEV_VARS) && /^SUPABASE_SERVICE_ROLE_KEY=.+/m.test(readFileSync(DEV_VARS, 'utf8'));

const sha256 = (value) => createHash('sha256').update(value).digest('hex');
// A key merely being present is not proof it belongs to THIS test stack: compare digests of the baked
// server binding and the current test tuple's key (neither value is ever logged).
const distBindingDigest = () => {
  const key = /^SUPABASE_SERVICE_ROLE_KEY=(.+)$/m.exec(readFileSync(DEV_VARS, 'utf8'))?.[1];
  return key === undefined ? undefined : sha256(key.trim().replace(/^"(.*)"$/, '$1'));
};
const distMatchesTestStack = (tuple) =>
  distHasServiceRoleKey() && distBindingDigest() === sha256(tuple.SUPABASE_SERVICE_ROLE_KEY);

// Stages that need the test stack (db:reset* run through the pinned test-stack lifecycle themselves).
const TEST_STACK_STAGES = ['test:integration', 'test:e2e', 'db:types:check'];

const args = process.argv.slice(2);
let selectedStages;
try {
  selectedStages = selectStages(args);
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`\n[complete-check] ${message}\n`);
  process.exit(2);
}

// Resolve the TEST tuple ONCE, before the first stage that touches Supabase, and hand the same tuple
// to every stage (build, type check, integration, both Playwright lanes). It comes only from the pinned
// test workdir's status: never the dev stack or root .env files, and an inherited dev tuple is replaced.
// --only=static needs none of it and never discovers Supabase. A missing test stack leaves the tuple
// unresolved: the e2e build fails closed with the reason and test stages fail on their own.
const needsTestStack = selectedStages.some((stage) => TEST_STACK_STAGES.includes(stage.name));
const e2eSelected = selectedStages.some((stage) => stage.name === 'test:e2e');
let testTuple;
let testTupleReason;
if (needsTestStack) ({ tuple: testTuple, reason: testTupleReason } = resolveTestBuildEnv({}));

const results = [];
const failedResets = new Set();
let builtFingerprint;
for (const stage of selectedStages) {
  if (stage.needsReset && failedResets.has(stage.needsReset)) {
    process.stderr.write(`\n[complete-check] ${stage.name} BLOCKED: ${stage.needsReset} failed\n`);
    results.push({ name: stage.name, ok: false, label: 'BLOCK', seconds: '0.0' });
    continue;
  }

  const command = stage.command;
  const env = { ...process.env };
  // Never inherit prebuilt/reset context from the caller's shell; only this run grants it.
  delete env.E2E_GATE_PREBUILT;
  if (needsTestStack) {
    // One tuple for every stage: drop any inherited (dev) values, then apply the resolved test set.
    for (const name of TEST_ENV_NAMES) delete env[name];
    if (testTuple) Object.assign(env, testTuple);
  }
  // The gate build is previewed by e2e, whose add-player server functions read the service-role key
  // from the preview worker's baked dist/server/.dev.vars. Give the build the same env Playwright's
  // own webServer build gets, or e2e on the reused build fails with SERVICE_ROLE_UNAVAILABLE. Only
  // resolved when e2e is selected, so service-free runs (pre-commit static) never touch Supabase.
  // Fail closed: an unresolvable test stack fails the build stage instead of silently building keyless
  // or against a developer .env.local pointing at the dev stack.
  if (stage.name === 'build' && e2eSelected) {
    if (!testTuple) {
      process.stderr.write(
        `\n[complete-check] build FAILED: the e2e build requires the test Supabase stack (${testTupleReason}). Start it with pnpm test:stack:up.\n`
      );
      results.push({ name: stage.name, ok: false, label: 'FAIL', seconds: '0.0' });
      continue;
    }
    Object.assign(env, e2eBuildEnv(testTuple));
  }
  if (stage.name === 'test:e2e') {
    // Reuse the gate's build only when it succeeded and the sources are unchanged since; otherwise
    // the webServer rebuilds (fail closed).
    if (builtFingerprint) {
      if (sourceFingerprint({ tuple: testTuple }) !== builtFingerprint) {
        process.stderr.write(
          '\n[complete-check] sources changed since the gate build; e2e rebuilds the bundle\n'
        );
      } else if (!distHasServiceRoleKey()) {
        process.stderr.write(
          '\n[complete-check] the gate build lost its service-role key (dist was rebuilt without it); e2e rebuilds the bundle\n'
        );
      } else if (!testTuple || !distMatchesTestStack(testTuple)) {
        process.stderr.write(
          '\n[complete-check] the gate build server binding does not match the current test stack; e2e rebuilds the bundle\n'
        );
      } else {
        env.E2E_GATE_PREBUILT = '1';
      }
    }
  }

  process.stdout.write(`\n=== ${stage.name}: ${command} ===\n`);
  const started = Date.now();
  const result = spawnSync(command, { stdio: 'inherit', shell: true, env });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  results.push({ name: stage.name, ok, label: ok ? 'PASS' : 'FAIL', seconds });
  if (stage.name.startsWith('db:reset') && !ok) failedResets.add(stage.name);
  if (stage.name === 'build' && ok) builtFingerprint = sourceFingerprint({ tuple: testTuple });
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
