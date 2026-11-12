import { spawnSync } from 'node:child_process';
import { constants } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_ENV_NAMES, resolveTestStackEnv } from './test-stack-env.mjs';

// Runs a command with the TEST Supabase tuple as its environment:
//   node scripts/with-test-stack.mjs pnpm exec playwright test
// The tuple is resolved from the pinned test workdir's status (any caller cwd), validated against the
// fixed test ports and REPLACES inherited dev VITE_*, DATABASE_URL, handoff and service-key values as
// one unit. A missing or invalid test stack aborts before the command starts, with a reason-only
// message. Exit codes and signals propagate.
export function runWithTestStack({
  argv,
  env = process.env,
  resolveEnv = resolveTestStackEnv,
  run = spawnSync
}) {
  const [command, ...args] = argv;
  if (!command) {
    process.stderr.write('Usage: node scripts/with-test-stack.mjs <command> [args...]\n');
    return 2;
  }
  let tuple;
  try {
    tuple = resolveEnv();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid test stack';
    process.stderr.write('[with-test-stack] ' + reason + '\n');
    return 2;
  }
  const childEnv = { ...env };
  for (const name of TEST_ENV_NAMES) delete childEnv[name];
  const result = run(command, args, { stdio: 'inherit', env: { ...childEnv, ...tuple } });
  if (result.error) {
    process.stderr.write('[with-test-stack] could not start ' + command + '\n');
    return 127;
  }
  return result.signal ? 128 + (constants.signals[result.signal] ?? 1) : (result.status ?? 1);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(runWithTestStack({ argv: process.argv.slice(2) }));
}
