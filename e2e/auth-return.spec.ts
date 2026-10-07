import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';

type LocaleCopy = {
  title: string;
  signOut: string;
  googleSignInError: string;
  auth: {
    loginEmailLabel: string;
    loginPasswordLabel: string;
    loginSubmit: string;
    signupSubmit: string;
    signupLink: string;
    signupPasswordLabel: string;
    emailAddress: string;
    welcomeTitle: string;
  };
  onboarding: {
    name: string;
    side: string;
    preciseLevel: string;
    sideEitherShort: string;
    sideRightShort: string;
    save: string;
  };
  communityOnboarding: { skip: string };
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

async function register(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await waitForHydratedPage(page);
  // Registration is reached ONLY through the real "Create account" link on the Welcome
  // screen: /login itself never renders a signup form.
  await page.getByRole('link', { name: en.auth.signupLink }).click();
  await expect(page).toHaveURL(/\/onboarding\/account/);
  await waitForHydratedPage(page);
  const signupEmail = page.locator('#signup-email');
  await expect(signupEmail).toBeEnabled();
  await signupEmail.fill(email);
  await page.getByLabel(en.auth.signupPasswordLabel).fill(PASSWORD);
  await submitAndWaitForAuthDestination(page, /\/onboarding$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await waitForHydratedPage(page);
}

async function signIn(page: Page, email: string): Promise<void> {
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(PASSWORD);
  await submitAndWaitForAuthDestination(page, /\/dashboard$/, () =>
    page.getByRole('button', { name: en.auth.loginSubmit }).click()
  );
}

async function createOnboardedUser(page: Page, email: string, name: string): Promise<void> {
  await register(page, email);
  await page.getByLabel(en.onboarding.name).fill(name);
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page.getByRole('radio', { name: en.onboarding.sideEitherShort }).check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/onboarding\/community$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityOnboarding.skip }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.signOut }).click();
  await expect(page.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();
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
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page
    .getByRole('group', { name: en.onboarding.side })
    .getByRole('radio', { name: en.onboarding.sideRightShort })
    .check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/onboarding\/community$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.communityOnboarding.skip }).click();
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

  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(PASSWORD);
  await submitAndWaitForAuthDestination(page, /\/dashboard\?src=return%26check$/, () =>
    page.getByRole('button', { name: en.auth.loginSubmit }).click()
  );
  const landed = new URL(page.url());
  expect(landed.pathname).toBe('/dashboard');
  expect(landed.search).toBe('?src=return%26check');
  expect(landed.searchParams.get('src')).toBe('return&check');
  await expect(page.getByRole('heading', { name: 'Rex Return' })).toBeVisible();
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
