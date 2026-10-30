import stylex from '@stylexjs/unplugin';
import { defineConfig } from 'vitest/config';

const stylexPlugin = stylex.vite({ runtimeInjection: false, dev: false });
// StyleX starts a CSS polling interval in configureServer and only clears it
// when the HTTP server emits close. Vitest does not need the dev-server hook;
// omitting it preserves transforms and lets both Vitest Vite servers close.
const stylexTestPlugin = { ...stylexPlugin, configureServer: undefined };

export default defineConfig({
  plugins: [stylexTestPlugin],
  test: {
    include: ['test/**/*.test.{ts,tsx}'],
    // @tanstack/react-router keeps pool file handles open after the suite closes;
    // results are flushed before teardown, so cap the worker close wait at 2s.
    teardownTimeout: 2000,
    coverage: {
      provider: 'v8',
      include: ['src/i18n/config.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 }
    }
  }
});
