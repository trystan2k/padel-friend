import { configDefaults, defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// The unit phase owns coverage collection; the integration phase runs without --coverage.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'test/**/*.integration.test.ts']
  }
});
