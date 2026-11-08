import { configDefaults, defineConfig } from 'vitest/config';
import { INTEGRATION_INCLUDE, PARALLEL_INTEGRATION_FILES } from './integration-partition';
import baseConfig from './vitest.config';

// Integration files share one local database, so concurrency is opt-in per audited file
// (see integration-partition.ts) and phases never overlap: scripts/run-integration.mjs runs
// INTEGRATION_PHASE=parallel first, then INTEGRATION_PHASE=serial, as separate vitest invocations.
//
//   INTEGRATION_PHASE=parallel  audited files only, 2 file workers, reduced SQL pool each
//   INTEGRATION_PHASE=serial    every other file, 1 worker, full SQL pool
//   (unset)                     all files in one serial run: the original semantics
//
// Serial rollback: INTEGRATION_SERIAL=1 forces the unset behavior whatever the phase, so
// `INTEGRATION_SERIAL=1 pnpm test:integration` restores the pre-parallel execution immediately.
const phase = process.env.INTEGRATION_SERIAL === '1' ? undefined : process.env.INTEGRATION_PHASE;
if (phase !== undefined && phase !== 'parallel' && phase !== 'serial') {
  throw new Error(`INTEGRATION_PHASE must be "parallel" or "serial", got "${phase}"`);
}

const phaseTest =
  phase === 'parallel'
    ? {
        include: [...PARALLEL_INTEGRATION_FILES],
        fileParallelism: true,
        maxWorkers: 2,
        // 2 workers x 5 pooled sessions stays within the SQL transport ceiling of 10 per process pair.
        env: { SQL_TRANSPORT_POOL_MAX: process.env.SQL_TRANSPORT_POOL_MAX ?? '5' }
      }
    : phase === 'serial'
      ? {
          include: [INTEGRATION_INCLUDE],
          exclude: [...configDefaults.exclude, ...PARALLEL_INTEGRATION_FILES],
          fileParallelism: false,
          maxWorkers: 1
        }
      : { include: [INTEGRATION_INCLUDE], fileParallelism: false };

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    globalSetup: ['./test/helpers/result-repair-scheduler-setup.ts'],
    // DB-bound integration RPCs average ~3s locally and slower on CI runners; 5s caused multi-file contention flakes.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Retries must not hide instability in the parallelization proof.
    retry: 0,
    repeats: 0,
    ...phaseTest
  }
});
