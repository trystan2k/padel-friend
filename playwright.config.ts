import { defineConfig, devices } from '@playwright/test';
import { e2eBuildEnv } from './scripts/e2e-build-env.mjs';
import { ensureTestStackEnv } from './scripts/test-stack-env.mjs';

// Initialize the authoritative TEST tuple in the main process BEFORE workers are collected (workers
// and the preview webServer inherit process.env): a launcher-provided valid tuple is kept, anything
// else (including an inherited dev VITE_*/service key) is replaced as one unit by the pinned test
// workdir's status, and a missing test stack throws here. This covers direct gate lanes too.
// scripts/e2e-build-env.mjs is shared with the complete-check build stage so every build e2e
// previews carries the same tuple.
const testEnv = ensureTestStackEnv();

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  snapshotPathTemplate: '{testDir}/{testFileName}-snapshots/{arg}{ext}',
  retries: process.env.CI ? 2 : 0,
  // 2 workers everywhere: 4-worker contention caused rotating under-load stalls (hydration,
  // post-mutation refetch, publish navigation) across full-gate runs, all green standalone.
  // 2 workers trade ~5-8 min of runtime for stability.
  workers: 2,
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
    // Repo convergence budget (15s), matching the per-assertion fixes. Playwright's 5s default
    // kept expiring on authoritative async conditions (hydration, auth redirects, post-mutation
    // refetch UI flips, SW registration) when the full suite loads the shared stack. Per-test
    // timeouts are unchanged; explicit per-assertion timeouts still override this.
    timeout: 15_000,
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
    env: e2eBuildEnv(testEnv)
  }
});
