import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// A leftover preview listening on the test port silently serves a stale bundle
// and fakes product failures. Free the port at config load, before Playwright
// inspects the webServer URL and refuses to start with reuseExistingServer:false.
function freeTestPort(port: number) {
  try {
    const out = execFileSync('lsof', ['-ti', `tcp:${port}`, '-sTCP:LISTEN'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    for (const pid of out
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)) {
      try {
        process.kill(Number(pid), 'SIGKILL');
      } catch {
        // already exited
      }
    }
  } catch {
    // port free, or lsof unavailable: nothing to do
  }
}

freeTestPort(4173);

export default defineConfig({
  testDir: './e2e',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'on-first-retry' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'pnpm build && pnpm preview --port 4173',
    url: 'http://127.0.0.1:4173',
    // Always start a fresh server; a reused one may serve a stale bundle.
    reuseExistingServer: false,
    timeout: 120000
  }
});
