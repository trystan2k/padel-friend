import { configDefaults, defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const parallelIntegrationEnabled = false;
const integrationInclude = 'test/**/*.integration.test.ts';
const parallelCandidate = 'test/matches.results.scoring.integration.test.ts';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [integrationInclude],
    // DB-bound integration RPCs average ~3s locally and slower on CI runners; 5s caused multi-file contention flakes.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Retries must not hide instability in the parallelization proof.
    retry: 0,
    repeats: 0,
    // Safe rollback baseline: switch parallelIntegrationEnabled to false to run
    // this config as one serial project, without moving files or changing scripts.
    fileParallelism: false,
    ...(parallelIntegrationEnabled
      ? {
          projects: [
            {
              extends: true,
              test: {
                name: 'integration-serial',
                include: [integrationInclude],
                exclude: [...configDefaults.exclude, parallelCandidate],
                fileParallelism: false,
                maxWorkers: 1,
                env: {
                  SQL_TRANSPORT_POOL_MAX: process.env.SQL_TRANSPORT_POOL_MAX ?? '10'
                },
                retry: 0,
                repeats: 0
              }
            },
            {
              extends: true,
              test: {
                name: 'integration-parallel',
                include: [parallelCandidate],
                fileParallelism: true,
                maxWorkers: 2,
                env: {
                  SQL_TRANSPORT_POOL_MAX: process.env.SQL_TRANSPORT_POOL_MAX ?? '2'
                },
                retry: 0,
                repeats: 0
              }
            }
          ]
        }
      : {})
  }
});
