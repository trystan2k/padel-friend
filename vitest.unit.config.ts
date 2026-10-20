import { configDefaults, defineConfig, mergeConfig } from 'vitest/config';
import baseConfig from './vitest.config';

const merged = mergeConfig(baseConfig, defineConfig({}));

export default defineConfig({
  ...merged,
  test: {
    ...merged.test,
    include: ['test/**/*.test.{ts,tsx}'],
    exclude: [...configDefaults.exclude, 'test/**/*.integration.test.ts']
  }
});
