import { configDefaults, defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// The unit phase owns coverage collection; the integration phase runs without --coverage.
// 15s test timeout mirrors the integration config: heavy jsdom mounts exceed the 5s
// default under load (CI runners, parallel local work) without any assertion weakening.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'test/**/*.integration.test.ts'],
    testTimeout: 15_000,
    hookTimeout: 15_000
  }
});
