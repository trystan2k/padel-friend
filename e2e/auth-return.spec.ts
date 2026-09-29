import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type LocaleCopy = {
  title: string;
  signOut: string;
  register: string;
  signIn: string;
  password: string;
  googleSignInError: string;
  auth: {
    emailAddress: string;
  };
  onboarding: {
    name: string;
    level: string;
    sideEither: string;
    sideRight: string;
    save: string;
  };
};

const en: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);

// Local coverage: deep-link preservation for email/password flows and callback error fallbacks.
// Real Google OAuth needs live credentials (commented out in supabase/config.toml) and stays a
// manual QA step; the callback's cookie forwarding and routing are unit tested in
// test/auth.callback.test.ts with a mocked exchangeCodeForSession instead of provider mocks.

const PASSWORD = 'Password123!';

function uniqueEmail(): string {
  return `e2e-return-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
}

/**
 * One deterministic retry for the transient "JWT issued at future" (PGRST303) window right
 * after sign-in: GoTrue's container clock can be minimally ahead of the Worker runtime, so the
 * first guarded SSR navigation may 500. Steady-state behavior is asserted after the retry.
 */
async function settleAfterAuth(page: Page): Promise<void> {
  await page.waitForURL(/\/(dashboard|onboarding)$/);
  const response = await page.goto('/dashboard');
  if (response && response.status() >= 500) await page.goto('/dashboard');
}

/**
 * Waits until React has hydrated the server-rendered form: after the load event the JS still
 * needs a couple of frames to attach listeners. Interacting earlier races hydration and the
 * controlled form silently resets.
 */
async function waitHydrated(page: Page): Promise<void> {
  await page.waitForLoadState('load');
  await page.evaluate(
    () => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))
  );
}

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await waitHydrated(page);
  await page.getByRole('button', { name: en.register }).click();
  await page.getByLabel(en.auth.emailAddress).fill(email);
  await page.getByLabel(en.password).fill(PASSWORD);
  await page.getByRole('button', { name: en.register }).click();
  await settleAfterAuth(page);
  await expect(page).toHaveURL(/\/onboarding$/);
  await waitHydrated(page);
}

async function signIn(page: Page, email: string): Promise<void> {
  await waitHydrated(page);
  await page.getByLabel(en.auth.emailAddress).fill(email);
  await page.getByLabel(en.password).fill(PASSWORD);
  await page.getByRole('button', { name: en.signIn }).click();
  await settleAfterAuth(page);
}

async function createOnboardedUser(page: Page, email: string, name: string): Promise<void> {
  await register(page, email);
  await page.getByLabel(en.onboarding.name).fill(name);
  await page.getByLabel(en.onboarding.level).fill('3.0');
  await page.getByRole('radio', { name: en.onboarding.sideEither }).check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await page.getByRole('button', { name: en.signOut }).click();
  await expect(page.getByRole('heading', { name: en.title })).toBeVisible();
}

test('a protected deep link survives sign-in and a newcomer is gated before reaching it', async ({
  page
}) => {
  const email = uniqueEmail();
  await page.goto('/dashboard?src=e2e#top');
  expect(new URL(page.url()).pathname).toBe('/login');
  // URL fragments never reach the server, so SSR beforeLoad cannot preserve '#top' without a
  // client-only handoff that risks hydration divergence or redirect loops. Query preservation is
  // the achievable contract here; hash restoration remains a product follow-up.
  expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard?src=e2e');

  // New account: the onboarding gate intercepts, then the save lands on /dashboard.
  await register(page, email);
  await page.getByLabel(en.onboarding.name).fill('Dee Link');
  await page.getByLabel(en.onboarding.level).fill('3.0');
  await page.getByRole('radio', { name: en.onboarding.sideRight }).check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Dee Link' })).toBeVisible();
});

test('an existing account signing in returns to the protected deep link', async ({ page }) => {
  const email = uniqueEmail();
  await createOnboardedUser(page, email, 'Rex Return');

  // The probe differs from the /dashboard fallback (`src` carries an encoded & that must
  // survive untouched), so a lost deep link can never be confused with the default return path.
  await page.goto('/dashboard?src=return%26check');
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard?src=return%26check');

  // Sign in WITHOUT the settling helper: its unconditional /dashboard goto would mask a dropped
  // deep link, so the landing URL is asserted before any helper navigation can run.
  await waitHydrated(page);
  await page.getByLabel(en.auth.emailAddress).fill(email);
  await page.getByLabel(en.password).fill(PASSWORD);
  await page.getByRole('button', { name: en.signIn }).click();
  await page.waitForURL(/\/dashboard\?/);
  const landed = new URL(page.url());
  expect(landed.pathname).toBe('/dashboard');
  expect(landed.search).toBe('?src=return%26check');
  expect(landed.searchParams.get('src')).toBe('return&check');

  // One deterministic retry for the transient "JWT issued at future" 500 (PGRST303) window:
  // the retry reloads the SAME deep-link URL — it must never fall back to /dashboard.
  const heading = page.getByRole('heading', { name: 'Rex Return' });
  if (!(await heading.isVisible())) await page.reload();
  await expect(heading).toBeVisible();
});

test('a hostile next parameter falls back to /dashboard', async ({ page }) => {
  const email = uniqueEmail();
  await createOnboardedUser(page, email, 'Mal Here');

  await page.goto('/login?next=//evil.com');
  expect(new URL(page.url()).pathname).toBe('/login');
  await signIn(page, email);
  await expect(page).toHaveURL(/\/dashboard$/);
  expect(page.url()).not.toContain('evil');
});

test('callback code errors fall back to /login?authError=1 without leaking provider detail', async ({
  request,
  page
}) => {
  for (const path of [
    '/auth/callback?error=access_denied',
    '/auth/callback?code=x&error=server_error&error_description=raw-provider-secret-detail',
    '/auth/callback',
    '/auth/callback?error=access_denied&next=%2Fdashboard'
  ]) {
    const response = await request.get(path, { maxRedirects: 0 });
    expect(response.status()).toBe(303);
    const location = response.headers()['location'];
    expect(location?.startsWith('http://127.0.0.1:4173/login?authError=1')).toBe(true);
    expect(location).not.toContain('raw-provider-secret-detail');
    expect(location).not.toContain('server_error');
    expect(location).not.toContain('access_denied');
  }

  // A safe non-default next is preserved through the failure fallback.
  const response = await request.get('/auth/callback?error=x&next=%2Fmatches', { maxRedirects: 0 });
  expect(response.headers()['location']).toBe(
    'http://127.0.0.1:4173/login?authError=1&next=%2Fmatches'
  );

  await page.goto('/login?authError=1');
  await expect(page.getByText(en.googleSignInError)).toBeVisible();
});
