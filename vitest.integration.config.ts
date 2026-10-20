import { defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const merged = mergeConfig(baseConfig, defineConfig({}));

export default defineConfig({
  ...merged,
  test: {
    ...merged.test,
    include: ['test/**/*.integration.test.ts'],
    // Integration files share one Postgres instance and can deadlock when run concurrently.
    // Disable file parallelism so database setup remains serialized.
    fileParallelism: false
  }
});
