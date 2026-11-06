import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Runs the integration suite as non-overlapping vitest invocations (see vitest.integration.config.ts):
// audited parallel-safe files first, then every other file serially. INTEGRATION_SERIAL=1 runs
// everything in one serial invocation. Extra args (file filters, reporters) go to every phase.
export const PHASES = ['parallel', 'serial'];

// Keep one JSON report per phase: `--outputFile.json=a.json` becomes `a.parallel.json` / `a.serial.json`.
export function phaseArgs(args, phase) {
  return args.map((arg) =>
    arg.startsWith('--outputFile.json=') ? arg.replace(/(\.json)?$/, `.${phase}$1`) : arg
  );
}

export function runIntegration({ args = [], env = process.env, run = spawnSync } = {}) {
  const serialRollback = env.INTEGRATION_SERIAL === '1';
  const phases = serialRollback ? [undefined] : PHASES;
  // With file filters a phase may legitimately match nothing; the other phase still runs them.
  const filtered = args.some((arg) => !arg.startsWith('-'));
  let status = 0;
  for (const phase of phases) {
    const phaseEnv = { ...env };
    if (phase) phaseEnv.INTEGRATION_PHASE = phase;
    else delete phaseEnv.INTEGRATION_PHASE;
    const vitestArgs = [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      ...(filtered && phases.length > 1 ? ['--passWithNoTests'] : []),
      ...(phase ? phaseArgs(args, phase) : args)
    ];
    const result = run('pnpm', vitestArgs, { stdio: 'inherit', env: phaseEnv });
    // Run both phases even after a failure so one report shows every failing file.
    if (status === 0) status = result.status ?? 1;
  }
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runIntegration({ args: process.argv.slice(2) }));
}
