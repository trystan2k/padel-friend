import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { INTEGRATION_DB_URL_ENV, resolveLocalDatabaseUrl } from './integration-db-url.mjs';

// Runs the integration suite as non-overlapping vitest invocations (see vitest.integration.config.ts):
// audited parallel-safe files first, then every other file serially. INTEGRATION_SERIAL=1 runs
// everything in one serial invocation; INTEGRATION_PHASE=parallel|serial runs only that phase.
// Push outbox and notification channel-matrix suites use default serial partition (global claims/projections).
// Extra args (file filters, reporters) go to every phase.
export const PHASES = ['parallel', 'serial'];

// Vitest options whose value may be the next argument (`--reporter basic`); that value is not a file filter.
const VALUE_OPTIONS = new Set([
  '--reporter',
  '--outputFile',
  '--outputFile.json',
  '--outputFile.junit',
  '--outputFile.html',
  '--config',
  '-c',
  '--root',
  '-r',
  '--project',
  '--testNamePattern',
  '-t',
  '--shard',
  '--environment',
  '--pool',
  '--mode',
  '-m',
  '--dir',
  '--exclude',
  '--retry',
  '--bail',
  '--testTimeout',
  '--hookTimeout',
  '--maxWorkers',
  '--minWorkers'
]);

export function fileFilters(args) {
  const filters = [];
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg.startsWith('-')) {
      if (VALUE_OPTIONS.has(arg)) index += 1;
    } else {
      filters.push(arg);
    }
  }
  return filters;
}

// Keep one JSON report per phase: `--outputFile.json=a.json` (or the two-argument form) becomes
// `a.parallel.json` / `a.serial.json`.
export function phaseArgs(args, phase) {
  const suffix = (path) => path.replace(/(\.json)?$/, `.${phase}$1`);
  return args.map((arg, index) => {
    if (arg.startsWith('--outputFile.json=')) return `--outputFile.json=${suffix(arg.slice(18))}`;
    if (args[index - 1] === '--outputFile.json' && !arg.startsWith('-')) return suffix(arg);
    return arg;
  });
}

// `--exclude` options (both forms) narrow discovery, so the pre-run count must see them too.
export function excludeArgs(args) {
  const excludes = [];
  for (let index = 0; index < args.length; index += 1) {
    if (args[index].startsWith('--exclude=')) excludes.push(args[index]);
    else if (args[index] === '--exclude' && index + 1 < args.length) {
      excludes.push(args[index], args[index + 1]);
      index += 1;
    }
  }
  return excludes;
}

// Counts the test files a phase would run for this selection (file filters plus excludes);
// `vitest list` loads the same config.
export function countMatchingFiles(phaseEnv, selection, run = spawnSync) {
  const result = run(
    'pnpm',
    [
      'exec',
      'vitest',
      'list',
      '--config',
      'vitest.integration.config.ts',
      '--filesOnly',
      ...selection
    ],
    { encoding: 'utf8', env: phaseEnv }
  );
  if (result.status !== 0) return undefined;
  return result.stdout.split('\n').filter((line) => /\.test\.[cm]?[jt]sx?$/.test(line.trim()))
    .length;
}

export function runIntegration({
  args = [],
  env = process.env,
  run = spawnSync,
  countFiles = countMatchingFiles,
  resolveDatabaseUrl = resolveLocalDatabaseUrl
} = {}) {
  const serialRollback = env.INTEGRATION_SERIAL === '1';
  const requestedPhase = env.INTEGRATION_PHASE || undefined;
  if (!serialRollback && requestedPhase !== undefined && !PHASES.includes(requestedPhase)) {
    process.stderr.write(
      `[run-integration] INTEGRATION_PHASE must be one of ${PHASES.join(', ')}; got "${requestedPhase}"\n`
    );
    return 2;
  }
  // Resolve the local DB URL once so workers skip their own CLI discovery. A stale inherited value
  // is dropped; when the CLI cannot resolve one the children discover (and fail) exactly as before.
  // A URL that resolves but fails validation aborts the run: it must never reach the children.
  const baseEnv = { ...env };
  delete baseEnv[INTEGRATION_DB_URL_ENV];
  let databaseUrl;
  try {
    databaseUrl = resolveDatabaseUrl();
  } catch (error) {
    const reason = error instanceof Error ? error.message : 'invalid local database URL';
    process.stderr.write(`[run-integration] aborting: ${reason}\n`);
    return 2;
  }
  if (databaseUrl) baseEnv[INTEGRATION_DB_URL_ENV] = databaseUrl;
  const phases = serialRollback ? [undefined] : requestedPhase ? [requestedPhase] : PHASES;
  const filters = fileFilters(args);
  // With file filters one phase may legitimately match nothing while the other runs them, but a
  // filter set matching nothing in every phase must fail instead of passing vacuously.
  const tolerateEmptyPhase = filters.length > 0 && phases.length > 1;
  if (tolerateEmptyPhase) {
    const counts = phases.map((phase) =>
      countFiles({ ...baseEnv, INTEGRATION_PHASE: phase }, [...filters, ...excludeArgs(args)])
    );
    // An unreadable listing falls through to the real runs rather than hiding them.
    if (counts.every((count) => count === 0)) {
      process.stderr.write(
        `[run-integration] no integration test file matches: ${filters.join(' ')}\n`
      );
      return 1;
    }
  }
  let status = 0;
  for (const phase of phases) {
    const phaseEnv = { ...baseEnv };
    if (phase) phaseEnv.INTEGRATION_PHASE = phase;
    else delete phaseEnv.INTEGRATION_PHASE;
    const vitestArgs = [
      'exec',
      'vitest',
      'run',
      '--config',
      'vitest.integration.config.ts',
      ...(tolerateEmptyPhase ? ['--passWithNoTests'] : []),
      ...(phase ? phaseArgs(args, phase) : args)
    ];
    const result = run('pnpm', vitestArgs, { stdio: 'inherit', env: phaseEnv });
    // Run every phase even after a failure so one report shows every failing file.
    if (status === 0) status = result.status ?? 1;
  }
  return status;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  process.exit(runIntegration({ args: process.argv.slice(2) }));
}
