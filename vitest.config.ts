import stylex from '@stylexjs/unplugin';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  plugins: [stylex.vite({ runtimeInjection: false, dev: false })],
  test: {
    include: ['test/**/*.test.ts'],
    // @tanstack/react-router keeps pool file handles open after the suite closes;
    // results are already flushed, so cap the close wait at 2s instead of 10s.
    teardownTimeout: 2000,
    coverage: {
      provider: 'v8',
      include: ['src/i18n/config.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 }
    }
  }
});
