import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { waitForHydratedPage } from './auth-helpers';

const BASE_URL = 'http://127.0.0.1:4173';

function localeCopy(locale: string): {
  auth: { welcomeTitle: string; loginSubmit: string; or: string; accountPrompt: string };
} {
  return JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
  );
}

test('anonymous root redirects server-side to localized login, without public demo content', async ({
  request,
  page
}) => {
  const response = await request.get('/', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(response.status());
  expect(new URL(response.headers()['location']!, BASE_URL).pathname).toBe('/login');
  expect(response.headers()['cache-control']).toBe('private, no-store');

  for (const locale of ['en', 'pt-BR', 'es']) {
    const copy = localeCopy(locale);
    await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
    const login = await page.goto('/');
    expect(new URL(page.url()).pathname).toBe('/login');
    expect(await login?.text()).toContain(copy.auth.welcomeTitle);
    await expect(page.getByRole('heading', { name: copy.auth.welcomeTitle })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await expect(page.getByText(copy.auth.or, { exact: true })).toBeVisible();
    await expect(page.getByText(copy.auth.accountPrompt)).toBeVisible();
  }
});

test('login controls retain design typography across themes', async ({ page }) => {
  for (const theme of ['light', 'dark'] as const) {
    await page.context().addCookies([{ name: 'theme', value: theme, url: BASE_URL }]);
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
    const submit = page.locator('form button[type="submit"]');
    await expect(submit).toBeVisible();
    expect(await submit.evaluate((element) => getComputedStyle(element).fontSize)).toBe('13px');
  }
});

test('OAuth callback rejects missing or denied codes without redirecting off-site', async ({
  request,
  page
}) => {
  for (const path of ['/auth/callback', '/auth/callback?error=access_denied']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe(`${BASE_URL}/login?authError=1`);
    expect(response.headers()['cache-control']).toBe('no-store');
  }

  await page.goto('/login?authError=1');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Google sign-in was not completed. Please try again.')).toBeVisible();
});

test.describe('Google sign-in OAuth failure handling', () => {
  test.use({ serviceWorkers: 'block' });

  test('OAuth start targets Google PKCE authorization and stays disabled while navigation is held', async ({
    page
  }) => {
    let authorizeAttempts = 0;
    let release: () => void = () => {};
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    await page.route('**/auth/v1/authorize**', async (route) => {
      authorizeAttempts += 1;
      await held;
      await route.abort();
    });
    const samples: boolean[] = [];
    let sampling = false;
    page.on('console', (message) => {
      if (sampling && message.text().startsWith('pf-google-disabled:'))
        samples.push(message.text() === 'pf-google-disabled:true');
    });
    await page.addInitScript(() => {
      window.setInterval(() => {
        const google = [...document.querySelectorAll('main button')].find(
          (button): button is HTMLButtonElement =>
            button instanceof HTMLButtonElement &&
            button.querySelector('span[aria-hidden="true"]')?.textContent === 'G'
        );
        if (google) console.log(`pf-google-disabled:${String(google.disabled)}`);
      }, 50);
    });
    await page.goto('/login');
    await waitForHydratedPage(page);
    const request = page.waitForRequest('**/auth/v1/authorize**');
    const click = page.getByRole('button', { name: 'Continue with Google' }).click();
    const authorize = new URL((await request).url());
    expect(authorize.pathname).toBe('/auth/v1/authorize');
    expect(authorize.searchParams.get('provider')).toBe('google');
    expect(authorize.searchParams.get('code_challenge_method')).toBe('s256');
    expect(authorize.searchParams.get('code_challenge')).toBeTruthy();
    const callback = new URL(authorize.searchParams.get('redirect_to')!);
    expect(callback.origin).toBe(BASE_URL);
    expect(callback.pathname).toBe('/auth/callback');
    sampling = true;
    await expect.poll(() => samples.length).toBeGreaterThanOrEqual(10);
    expect(samples.every(Boolean)).toBe(true);
    expect(authorizeAttempts).toBe(1);
    release();
    await click;
  });

  test('failed OAuth initialization displays translated error and allows retry', async ({
    page
  }) => {
    await page.addInitScript(() => {
      const descriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie');
      if (!descriptor?.get || !descriptor.set) return;
      const get = descriptor.get.bind(document);
      const set = descriptor.set.bind(document);
      Object.defineProperty(document, 'cookie', {
        get: () => get(),
        set(value: string) {
          if (value.includes('-code-verifier=')) throw new TypeError('cookie storage unavailable');
          set(value);
        }
      });
    });
    await page.goto('/login');
    await waitForHydratedPage(page);
    const google = page.getByRole('button', { name: 'Continue with Google' });
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await google.click();
      await expect(
        page.getByText('Google sign-in was not completed. Please try again.')
      ).toBeVisible();
      await expect(google).toBeEnabled();
      expect(new URL(page.url()).pathname).toBe('/login');
    }
  });
});
