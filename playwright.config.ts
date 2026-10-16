import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173',
    url: 'http://127.0.0.1:4173',
    // Never reuse a running preview: a stale bundle silently fakes failures.
    // `pnpm test:e2e` frees port 4173 before Playwright starts.
    reuseExistingServer: false,
    timeout: 120000
  }
});
