import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { VISUAL_GREP } from './e2e-shards.mjs';

// Opt-in local iteration lane: the ordinary fresh E2E run (reset, free port, fresh build+preview)
// minus every visual test. The full gate and `pnpm test:e2e` stay unfiltered.
const SELECTION_FLAGS = ['--grep', '-g', '--grep-invert'];

export function fastArgs(args) {
  const conflict = args.find((arg) =>
    SELECTION_FLAGS.some((flag) => arg === flag || arg.startsWith(`${flag}=`))
  );
  if (conflict) {
    throw new Error(
      `test:e2e:fast owns test selection; remove "${conflict}" or use pnpm test:e2e.`
    );
  }
  return [...args, '--grep-invert', VISUAL_GREP];
}

export function runFast({ args = [], env = process.env, run = spawnSync } = {}) {
  const playwrightArgs = fastArgs(args);
  // Always a fresh build: never inherit the gate-only prebuilt flag from the caller's shell.
  const { E2E_GATE_PREBUILT: _ignored, ...freshEnv } = env;
  // Same order as `pnpm test:e2e`: reset, free the preview port, then Playwright.
  for (const [command, commandArgs] of [
    ['pnpm', ['db:reset']],
    ['node', ['scripts/free-port.mjs', '4173']],
    ['pnpm', ['exec', 'playwright', 'test', ...playwrightArgs]]
  ]) {
    const result = run(command, commandArgs, { stdio: 'inherit', env: freshEnv });
    if (result.status !== 0) return result.status ?? 1;
  }
  return 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    process.exit(runFast({ args: process.argv.slice(2) }));
  } catch (error) {
    process.stderr.write(
      `\n[e2e-fast] ${error instanceof Error ? error.message : String(error)}\n`
    );
    process.exit(2);
  }
}
