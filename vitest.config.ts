import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/i18n/config.ts'],
      reporter: ['text', 'html'],
      thresholds: { lines: 80, functions: 80, statements: 80, branches: 80 }
    }
  }
});
