import { spawnSync } from 'node:child_process';

// Run the full quality gate by default; scoped runs retain the same reporting and
// continue-on-failure behavior for every selected stage.
const stages = [
  { name: 'db:types:check', command: 'pnpm db:types:check' },
  { name: 'build', command: 'pnpm build' },
  { name: 'knip', command: 'pnpm knip' },
  { name: 'typecheck', command: 'pnpm typecheck' },
  { name: 'lint', command: 'pnpm lint' },
  { name: 'format:check', command: 'pnpm format:check' },
  { name: 'test', command: 'pnpm test' },
  { name: 'test:e2e', command: 'pnpm test:e2e' }
];

const stageGroups = {
  // db:types:check requires live local Supabase; exclude it from the service-free pre-commit
  // group while retaining it in the full gate and CI integration job.
  static: ['build', 'knip', 'typecheck', 'lint', 'format:check'],
  test: ['test'],
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
for (const stage of selectedStages) {
  process.stdout.write(`\n=== ${stage.name}: ${stage.command} ===\n`);
  const started = Date.now();
  const result = spawnSync(stage.command, { stdio: 'inherit', shell: true });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  const ok = result.status === 0;
  results.push({ name: stage.name, ok, seconds });
  if (!ok) {
    process.stderr.write(
      `\n[complete-check] ${stage.name} FAILED (exit ${String(result.status)}) after ${seconds}s\n`
    );
  }
}

process.stdout.write('\n=== complete-check summary ===\n');
for (const stage of results) {
  process.stdout.write(
    `${stage.ok ? 'PASS' : 'FAIL'}  ${stage.name.padEnd(13)} ${stage.seconds}s\n`
  );
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
