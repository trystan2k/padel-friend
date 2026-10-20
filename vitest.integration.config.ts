import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['test/**/*.integration.test.ts'],
    // Integration files share one Postgres instance and can deadlock when run concurrently.
    // Disable file parallelism so database setup remains serialized.
    fileParallelism: false
  }
});
