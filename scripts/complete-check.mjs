import { spawnSync } from 'node:child_process';

// Run every quality-gate stage and report all failures in one pass, matching CI
// where each stage runs separately. A cheap failing stage (e.g. format:check)
// must never hide test or E2E results.
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

const results = [];
for (const stage of stages) {
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
process.stdout.write('\n[complete-check] all stages passed\n');
