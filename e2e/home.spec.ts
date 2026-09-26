import { expect, test } from '@playwright/test';

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
