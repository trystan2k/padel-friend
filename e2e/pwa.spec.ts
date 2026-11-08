import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { expect, test, type Page } from '@playwright/test';
import { isAllowedPrecacheUrl } from '../scripts/pwa-build.mjs';
import { waitForHydratedPage } from './auth-helpers';
import en from '../src/locales/en/translation.json' with { type: 'json' };

// Real built service worker, real CacheStorage. Every test uses its own browser context so worker
// registrations and caches never leak between cases. The worker does not claim clients, so each case
// reloads once to be controlled by it (the same thing a second launch does for a real user).
const BASE_URL = 'http://127.0.0.1:4173';
const password = 'Password123!';
const config = localConfig();

test.use({ viewport: { width: 390, height: 844 }, serviceWorkers: 'allow' });
// Account signup + sign-in + worker install in one test needs more than the 30s default.
test.setTimeout(90_000);

type CacheEntry = { cache: string; path: string; contentType: string };

test('manifest, icons and apple-touch icon resolve with install metadata', async ({
  page,
  request
}) => {
  await page.goto('/login');
  await waitForHydratedPage(page);
  await expect(page.locator('link[rel="manifest"]')).toHaveAttribute(
    'href',
    '/manifest.webmanifest'
  );
  const touchIcon = await page.locator('link[rel="apple-touch-icon"]').getAttribute('href');
  expect(touchIcon).toBe('/icons/apple-touch-icon.png');

  const manifestResponse = await request.get('/manifest.webmanifest');
  expect(manifestResponse.status()).toBe(200);
  const manifest = await manifestResponse.json();
  expect(manifest).toMatchObject({ id: '/', scope: '/', start_url: '/', display: 'standalone' });

  const sources = [...manifest.icons.map((icon: { src: string }) => icon.src), touchIcon];
  for (const source of sources) {
    const response = await request.get(source);
    expect(response.status(), source).toBe(200);
    expect(response.headers()['content-type']).toMatch(/^image\/(png|svg\+xml)/);
  }
  expect((await request.get('/offline.html')).status()).toBe(200);
});

test('installs the worker without prompting or showing an update, and precaches only public assets', async ({
  browser
}) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.addInitScript(() => {
      const counter = { calls: 0 };
      Object.defineProperty(window, '__permissionRequests', { value: counter });
      if ('Notification' in window)
        Notification.requestPermission = () => {
          counter.calls += 1;
          return Promise.resolve('denied');
        };
    });
    await page.goto('/login');
    await waitForHydratedPage(page);
    await controlledByWorker(page);

    const entries = await cacheEntries(page);
    expectPublicCacheOnly(entries);
    expect(entries.some((entry) => entry.path === '/offline.html')).toBe(true);
    expect(entries.some((entry) => entry.path === '/manifest.webmanifest')).toBe(true);
    expect(entries.some((entry) => entry.path.startsWith('/icons/'))).toBe(true);

    expect(await page.evaluate(() => Reflect.get(window, '__permissionRequests').calls)).toBe(0);
    await expect(page.getByRole('status')).toHaveCount(0);
  } finally {
    await context.close();
  }
});

test('never stores authenticated navigations, SSR HTML, server functions or Supabase auth traffic', async ({
  browser
}) => {
  const actor = await createActor();
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    const authRequests: string[] = [];
    context.on('request', (request) => {
      if (request.url().includes('/auth/v1')) authRequests.push(request.url());
    });
    await signIn(page, actor);
    await controlledByWorker(page);
    await page.goto('/notifications/preferences');
    await waitForHydratedPage(page);
    await expect(
      page.getByRole('heading', { name: en.notificationPreferences.title })
    ).toBeVisible();
    await page.goto('/dashboard');
    await waitForHydratedPage(page);
    expect(authRequests.length).toBeGreaterThan(0);

    const entries = await cacheEntries(page);
    expectPublicCacheOnly(entries);
    for (const entry of entries) {
      expect(entry.path).not.toContain('/auth/v1');
      expect(entry.path).not.toContain('_serverFn');
      expect(entry.path).not.toMatch(/^\/(dashboard|notifications|matches|community)/);
    }
    const htmlEntries = entries.filter((entry) => entry.contentType.includes('text/html'));
    expect(htmlEntries.map((entry) => entry.path)).toEqual(['/offline.html']);

    // No cached text body may carry the signed-in account's private data.
    const leaked = await page.evaluate(
      async ({ email, name }) => {
        const found: string[] = [];
        for (const cacheName of await caches.keys()) {
          const cache = await caches.open(cacheName);
          for (const request of await cache.keys()) {
            const response = await cache.match(request);
            const type = response?.headers.get('content-type') ?? '';
            if (!response || !/text|json|javascript|css/.test(type)) continue;
            const body = await response.text();
            if (body.includes(email) || body.includes(name)) found.push(request.url);
          }
        }
        return found;
      },
      { email: actor.email, name: actor.name }
    );
    expect(leaked).toEqual([]);
  } finally {
    await context.close();
  }
});

test('offline launches of a private URL show only the public document and recover on reconnect', async ({
  browser
}) => {
  const actor = await createActor();
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await signIn(page, actor);
    await controlledByWorker(page);
    const before = await cacheEntries(page);

    await context.setOffline(true);
    for (const path of ['/matches/my', '/dashboard']) {
      await page.goto(path);
      await expect(page.getByRole('heading', { name: en.pwa.offline.title })).toBeVisible();
      await expect(page.getByText(en.pwa.offline.body)).toBeVisible();
      await expect(page.getByRole('button', { name: en.pwa.offline.retry })).toBeVisible();
      const text = await page.locator('body').innerText();
      expect(text).not.toContain(actor.name);
      expect(text).not.toContain(actor.email);
      await expect(page.locator('html')).not.toHaveAttribute('data-app-hydrated', 'true');
    }
    expect(await cacheEntries(page)).toEqual(before);

    // Retrying while still offline stays honest: the same public document, never a fake app.
    const offlineUrl = page.url();
    await page.getByRole('button', { name: en.pwa.offline.retry }).click();
    await expect(page.getByRole('heading', { name: en.pwa.offline.title })).toBeVisible();
    expect(page.url()).toBe(offlineUrl);

    // Reconnecting reloads the requested page, which now renders from the network.
    await context.setOffline(false);
    await waitForHydratedPage(page);
    await expect(page.getByRole('heading', { name: en.pwa.offline.title })).toHaveCount(0);
    await expect(page).toHaveURL(offlineUrl);
  } finally {
    await context.close();
  }
});

test('offline auth callback fails honestly instead of showing success', async ({ browser }) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    await page.goto('/login');
    await waitForHydratedPage(page);
    await controlledByWorker(page);
    await context.setOffline(true);
    await page.goto('/auth/callback?code=offline-test-code');
    await expect(page.getByRole('heading', { name: en.pwa.offline.title })).toBeVisible();
    await expect(page).not.toHaveURL(/dashboard/);
    await expect(page.locator('html')).not.toHaveAttribute('data-app-hydrated', 'true');
  } finally {
    await context.close();
  }
});

test('activation removes the legacy generic runtime cache and leaves unrelated caches alone', async ({
  browser
}) => {
  const context = await browser.newContext({ serviceWorkers: 'allow' });
  try {
    const page = await context.newPage();
    // Seed the caches the previous worker left behind before any worker of this build exists.
    await page.route('**/sw.js', (route) => route.abort());
    await page.goto('/login');
    await waitForHydratedPage(page);
    await page.evaluate(async () => {
      for (const name of ['static-assets', 'unrelated-app'])
        await (await caches.open(name)).put('/legacy-entry', new Response('legacy'));
    });
    await page.unroute('**/sw.js');
    await page.reload();
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect.poll(() => page.evaluate(() => caches.keys())).not.toContain('static-assets');
    const names = await page.evaluate(() => caches.keys());
    expect(names).toContain('unrelated-app');
    expect(names.some((name) => name.startsWith('workbox-precache'))).toBe(true);
  } finally {
    await context.close();
  }
});

async function controlledByWorker(page: Page): Promise<void> {
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  await waitForHydratedPage(page);
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

async function cacheEntries(page: Page): Promise<CacheEntry[]> {
  const entries = await page.evaluate(async () => {
    const found: CacheEntry[] = [];
    for (const cache of await caches.keys()) {
      const opened = await caches.open(cache);
      for (const request of await opened.keys()) {
        const response = await opened.match(request);
        found.push({
          cache,
          path: new URL(request.url).pathname,
          contentType: response?.headers.get('content-type') ?? ''
        });
      }
    }
    return found;
  });
  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function expectPublicCacheOnly(entries: CacheEntry[]): void {
  expect(entries.length).toBeGreaterThan(0);
  for (const entry of entries) {
    expect(entry.cache).toMatch(/^workbox-precache/);
    expect(isAllowedPrecacheUrl(entry.path.slice(1)), entry.path).toBe(true);
  }
}

async function createActor(): Promise<{ email: string; name: string }> {
  const client = createClient(config.url, config.key, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
  const email = `pwa-${crypto.randomUUID()}@test.local`;
  const signup = await client.auth.signUp({ email, password });
  if (signup.error || !signup.data.session)
    throw new Error(`Could not create local E2E actor: ${signup.error?.message ?? 'no session'}`);
  const session = await client.auth.setSession(signup.data.session);
  if (session.error) throw session.error;
  const name = `Pwa ${crypto.randomUUID().slice(0, 8)}`;
  const onboarded = await client.rpc('onboard_player', {
    p_display_name: name,
    p_preferred_side: 'EITHER',
    p_initial_level: 3.2
  });
  if (onboarded.error) throw onboarded.error;
  return { email, name };
}

async function signIn(page: Page, actor: { email: string }): Promise<void> {
  await page.context().addCookies([
    { name: 'locale', value: 'en', url: BASE_URL },
    { name: 'theme', value: 'light', url: BASE_URL }
  ]);
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(actor.email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(password);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
}

function localConfig() {
  const variables = new Map(
    readFileSync(new URL('../.env', import.meta.url), 'utf8')
      .split('\n')
      .filter((line) => line.includes('=') && !line.trim().startsWith('#'))
      .map((line) => {
        const index = line.indexOf('=');
        return [
          line.slice(0, index).trim(),
          line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, '')
        ] as const;
      })
  );
  const url = process.env.VITE_SUPABASE_URL ?? variables.get('VITE_SUPABASE_URL') ?? '';
  const key =
    process.env.VITE_SUPABASE_PUBLISHABLE_KEY ??
    variables.get('VITE_SUPABASE_PUBLISHABLE_KEY') ??
    '';
  if (!url || !key || !['127.0.0.1', 'localhost'].includes(new URL(url).hostname))
    throw new Error('PWA E2E requires loopback Supabase');
  return { url, key };
}
