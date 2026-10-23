import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['test/**/*.integration.test.ts'],
    // DB-bound integration RPCs average ~3s locally and slower on CI runners; 5s caused multi-file contention flakes.
    testTimeout: 15_000,
    hookTimeout: 15_000,
    // Integration files share one Postgres instance and can deadlock when run concurrently.
    // Disable file parallelism so database setup remains serialized.
    fileParallelism: false
  }
});
