import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  retries: process.env.CI ? 2 : 0,
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
    command: 'pnpm build && pnpm preview --port 4173',
    url: 'http://127.0.0.1:4173',
    // Never reuse a running preview: a stale bundle silently fakes failures.
    // `pnpm test:e2e` frees port 4173 before Playwright starts.
    reuseExistingServer: false,
    timeout: 120000
  }
});
