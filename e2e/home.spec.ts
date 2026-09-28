import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

const BASE_URL = 'http://127.0.0.1:4173';

type LocaleCopy = {
  title: string;
  description: string;
  signInWithGoogle: string;
  auth: {
    or: string;
    accountPrompt: string;
    emailAddress: string;
    emailPlaceholder: string;
  };
};

function localeCopy(locale: string): LocaleCopy {
  return JSON.parse(
    readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
  );
}

test('server-renders the home page and exposes localized UI', async ({ page }) => {
  const enDescription = 'Padel Friend, built with TanStack Start, Cloudflare Workers and Supabase.';
  const esDescription = 'Padel Friend, creado con TanStack Start, Cloudflare Workers y Supabase.';
  const response = await page.goto('/');
  expect(await response?.text()).toContain('Padel Friend');
  await expect(page.getByRole('heading', { name: 'Padel Friend' })).toBeVisible();
  await expect(page.locator('section p')).toHaveText(enDescription);
  await page.getByLabel('Language').selectOption('es');
  await expect(page.locator('section p')).toHaveText(esDescription);
  await page.waitForFunction(() => document.cookie.includes('locale=es'));
  await page.reload();
  await expect(page.locator('section p')).toHaveText(esDescription);
  await page.getByLabel('Tema').selectOption('dark');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.waitForFunction(() => document.cookie.includes('theme=dark'));
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
});

test('server-renders and hydrates every supported locale without a copy flash', async ({
  page
}) => {
  for (const locale of ['en', 'pt-BR', 'es']) {
    const copy = localeCopy(locale);
    await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
    const response = await page.goto('/');
    // SSR payload already carries the locale copy.
    expect(await response?.text()).toContain(copy.description);
    // After hydration the copy is unchanged (no localized-content flash).
    await expect(page.locator('section p')).toHaveText(copy.description);
    await expect(page.getByRole('heading', { name: copy.title })).toBeVisible();
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    await page.reload();
    await expect(page.locator('section p')).toHaveText(copy.description);
  }
});

test('the protected redirect happens server-side without a public flash', async ({
  request,
  page
}) => {
  // First hop for an anonymous request is already the login redirect: no protected HTML is
  // ever rendered before the client app boots.
  const redirect = await request.get('/dashboard', { maxRedirects: 0 });
  expect([302, 303, 307, 308]).toContain(redirect.status());
  const locationHeader = redirect.headers()['location'];
  expect(locationHeader, 'protected redirect must include a location header').toBeTruthy();
  const location = new URL(locationHeader!, BASE_URL);
  expect(location.pathname).toBe('/login');
  expect(location.searchParams.get('next')).toBe('/dashboard');
  expect(redirect.headers()['cache-control']).toBe('private, no-store');

  await page.goto('/dashboard');
  expect(new URL(page.url()).pathname).toBe('/login');
  await expect(page.getByRole('button', { name: 'Sign in' })).toBeVisible();
});

test('the login screen localizes the OR divider, provider mark and account prompt', async ({
  page
}) => {
  for (const locale of ['en', 'pt-BR', 'es']) {
    const copy = localeCopy(locale);
    await page.context().addCookies([{ name: 'locale', value: locale, url: BASE_URL }]);
    const response = await page.goto('/login');
    // SSR already carries the localized login copy.
    expect(await response?.text()).toContain(copy.auth.or);
    await expect(page.getByText(copy.auth.or, { exact: true })).toBeVisible();
    const google = page.getByRole('button', { name: copy.signInWithGoogle });
    await expect(google).toBeVisible();
    await expect(google.locator('span[aria-hidden="true"]')).toHaveText('G');
    await expect(page.getByText(copy.auth.accountPrompt)).toBeVisible();
    // EMAIL ADDRESS-style label with a localized placeholder example and a decorative icon.
    const emailField = page.getByLabel(copy.auth.emailAddress);
    await expect(emailField).toHaveAttribute('placeholder', copy.auth.emailPlaceholder);
    await expect(emailField.locator('..').locator('svg[aria-hidden="true"]')).toHaveCount(1);
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
  }
});

test('OAuth callback rejects missing or denied codes without redirecting off-site', async ({
  request,
  page
}) => {
  for (const path of ['/auth/callback', '/auth/callback?error=access_denied']) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    expect(response.headers()['location']).toBe('http://127.0.0.1:4173/login?authError=1');
    expect(response.headers()['cache-control']).toBe('no-store');
  }

  await page.goto('/login?authError=1');
  await expect(page.getByRole('button', { name: 'Continue with Google' })).toBeVisible();
  await expect(page.getByText('Google sign-in was not completed. Please try again.')).toBeVisible();
});
