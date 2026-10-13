import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm e2e:serve',
    url: 'http://127.0.0.1:4173',
    // Never reuse a running preview: a leftover server silently serves a stale
    // bundle and fakes E2E failures. `e2e:serve` frees the port and rebuilds.
    reuseExistingServer: false,
    timeout: 120000
  }
});
