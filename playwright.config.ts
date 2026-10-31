import { execFileSync } from 'node:child_process';
import { defineConfig, devices } from '@playwright/test';

// The add-player server function needs the server-only service-role key. Resolve it
// once in the main process (workers inherit process.env) from CI's environment or the
// local stack, never from a committed file.
function localServiceRoleKey(): string | undefined {
  if (process.env.SUPABASE_SERVICE_ROLE_KEY) return process.env.SUPABASE_SERVICE_ROLE_KEY;
  try {
    const output = execFileSync('pnpm', ['exec', 'supabase', 'status', '-o', 'env'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore']
    });
    const key = /^SERVICE_ROLE_KEY="?([^"\n]+)"?$/m.exec(output)?.[1];
    if (key) process.env.SUPABASE_SERVICE_ROLE_KEY = key;
    return key;
  } catch {
    return undefined;
  }
}
const serviceRoleKey = localServiceRoleKey();

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
    timeout: 120000,
    // Forward the process env so the Cloudflare preview exposes the binding to server code.
    env: serviceRoleKey
      ? { CLOUDFLARE_INCLUDE_PROCESS_ENV: 'true', SUPABASE_SERVICE_ROLE_KEY: serviceRoleKey }
      : {}
  }
});
