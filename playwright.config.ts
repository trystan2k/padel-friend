import { defineConfig, devices } from '@playwright/test';
import { e2eBuildEnv, localServiceRoleKey } from './scripts/e2e-build-env.mjs';

// The add-player server function needs the server-only service-role key. Resolve it
// once in the main process (workers inherit process.env) from CI's environment or the
// local stack, never from a committed file. scripts/e2e-build-env.mjs is shared with the
// complete-check build stage so every build e2e previews carries it.
const serviceRoleKey = localServiceRoleKey();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  retries: process.env.CI ? 2 : 0,
  // CI runners get 4 workers; locally Playwright picks its own default from the CPU count.
  workers: process.env.CI ? 4 : undefined,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    // Deterministic Chromium rasterization so macOS and Linux render the bundled
    // webfonts (Inter/Manrope) identically: no hinting, integral glyph positions,
    // grayscale antialiasing, sRGB color and no Skia CPU-dispatch drift. Baselines
    // stay platform-portable instead of absorbing a per-OS font-rasterization delta
    // (PR #21: macOS-captured baseline measured 0.03 on ubuntu-latest against a 0.02
    // budget). Structural probes remain the exact geometry gates; these flags only
    // stabilize pixel output.
    launchOptions: {
      args: [
        '--font-render-hinting=none',
        '--disable-font-subpixel-positioning',
        '--disable-lcd-text',
        '--force-color-profile=srgb',
        '--disable-skia-runtime-opts',
        '--hide-scrollbars'
      ]
    },
    deviceScaleFactor: 1,
    colorScheme: 'light'
  },
  expect: {
    toHaveScreenshot: {
      animations: 'disabled',
      caret: 'hide',
      scale: 'css'
    }
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    // E2E_GATE_PREBUILT is an internal contract: only complete-check (after matching its build
    // fingerprint) and CI (after verifying the same-run build artifact) set it. Shell users and
    // scripts/e2e-fast.mjs never do (the latter scrubs it), so a plain `pnpm test:e2e` always
    // builds fresh. The legacy E2E_PREBUILT name is ignored.
    command:
      process.env.E2E_GATE_PREBUILT === '1'
        ? 'pnpm preview --port 4173'
        : 'pnpm build && pnpm preview --port 4173',
    url: 'http://127.0.0.1:4173',
    // Never reuse a running preview: a stale bundle silently fakes failures.
    // `pnpm test:e2e` frees port 4173 before Playwright starts.
    reuseExistingServer: false,
    timeout: 120000,
    // Forward the process env so the Cloudflare preview exposes the binding to server code.
    env: e2eBuildEnv(serviceRoleKey)
  }
});
