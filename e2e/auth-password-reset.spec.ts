import { expect, test, type Page, type APIRequestContext } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';

type LocaleCopy = {
  signOut: string;
  auth: {
    forgotLink: string;
    forgotTitle: string;
    forgotSubmit: string;
    backToSignIn: string;
    inboxNoticeTitle: string;
    emailAddress: string;
    signupLink: string;
    signupSubmit: string;
    signupPasswordLabel: string;
    resetNewPasswordLabel: string;
    resetConfirmPasswordLabel: string;
    resetSubmit: string;
    loginEmailLabel: string;
    loginPasswordLabel: string;
    loginSubmit: string;
    welcomeTitle: string;
  };
  onboarding: {
    name: string;
    preciseLevel: string;
    side: string;
    sideLeftShort: string;
    save: string;
  };
};

const en: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const MAILPIT_URL = 'http://127.0.0.1:55324';
const ORIGINAL_PASSWORD = 'Password123!';
const RESET_PASSWORD = 'FreshPassword456!';

function uniqueEmail(): string {
  return `e2e-recovery-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
}

async function createOnboardedUser(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await waitForHydratedPage(page);
  await page.getByRole('link', { name: en.auth.signupLink }).click();
  await expect(page).toHaveURL(/\/onboarding\/account/);
  await waitForHydratedPage(page);
  const signupEmail = page.locator('#signup-email');
  await expect(signupEmail).toBeEnabled();
  await signupEmail.fill(email);
  await page.getByLabel(en.auth.signupPasswordLabel).fill(ORIGINAL_PASSWORD);
  await submitAndWaitForAuthDestination(page, /\/onboarding$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await waitForHydratedPage(page);
  await page.getByLabel(en.onboarding.name).fill('Recovery Player');
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page
    .getByRole('group', { name: en.onboarding.side })
    .getByRole('radio', { name: en.onboarding.sideLeftShort })
    .check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await waitForHydratedPage(page);
  await page.getByRole('button', { name: en.signOut }).click();
  await expect(page.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();
}

async function mailpitRecoveryLink(
  request: APIRequestContext,
  email: string
): Promise<string | null> {
  const listResponse = await request.get(`${MAILPIT_URL}/api/v1/messages`);
  if (!listResponse.ok()) return null;
  const payload: unknown = await listResponse.json();
  if (typeof payload !== 'object' || payload === null || !('messages' in payload)) return null;
  const messages = payload.messages;
  if (!Array.isArray(messages)) return null;
  const message = messages.find((candidate: unknown) => {
    if (typeof candidate !== 'object' || candidate === null || !('To' in candidate)) return false;
    const recipients = candidate.To;
    return (
      Array.isArray(recipients) &&
      recipients.some(
        (recipient: unknown) =>
          typeof recipient === 'object' &&
          recipient !== null &&
          'Address' in recipient &&
          typeof recipient.Address === 'string' &&
          recipient.Address.toLowerCase() === email.toLowerCase()
      )
    );
  });
  if (typeof message !== 'object' || message === null || !('ID' in message)) return null;
  const id = message.ID;
  if (typeof id !== 'string') return null;
  const detailResponse = await request.get(
    `${MAILPIT_URL}/api/v1/message/${encodeURIComponent(id)}`
  );
  if (!detailResponse.ok()) return null;
  const detail: unknown = await detailResponse.json();
  if (typeof detail !== 'object' || detail === null) return null;
  const body = ['HTML', 'Text']
    .map((key) => {
      const content: unknown = Reflect.get(detail, key);
      return typeof content === 'string' ? content : '';
    })
    .join('\n')
    .replaceAll('&amp;', '&');
  const href = body.match(/href=["']([^"']+)["']/i)?.[1];
  const candidate = href ?? body.match(/https?:\/\/[^\s<>"']+/)?.[0];
  if (!candidate) return null;
  const link = candidate.replaceAll('&amp;', '&').replaceAll('&#x3D;', '=');
  return link.includes('type=recovery') ? link : null;
}

test('login exposes the Forgot link and opens the reset request screen', async ({ page }) => {
  await page.goto('/login?next=%2Fmatches');
  await waitForHydratedPage(page);
  await page.getByRole('link', { name: en.auth.forgotLink }).click();
  await expect(page).toHaveURL(/\/forgot-password\?next=%2Fmatches$/);
  await expect(page.getByRole('heading', { name: en.auth.forgotTitle })).toBeVisible();
  await expect(page.getByLabel(en.auth.emailAddress)).toBeVisible();
  await expect(page.locator('#forgot-email')).toBeVisible();
  await expect(page.getByRole('link', { name: en.auth.backToSignIn })).toBeVisible();
});

test('submitting a reset request returns an enumeration-safe inbox notice', async ({ page }) => {
  await page.route('**/auth/v1/recover', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.goto('/forgot-password');
  await waitForHydratedPage(page);
  const email = page.getByLabel(en.auth.emailAddress);
  await expect(email).toBeEnabled();
  await email.fill('any-email@example.test');
  await page.getByRole('button', { name: en.auth.forgotSubmit }).click();
  await expect(page).toHaveURL(/\/login\?reset=sent$/);
  await expect(page.getByRole('status')).toContainText(en.auth.inboxNoticeTitle);
});

test('unauthenticated visitors cannot reach the create-password screen', async ({ page }) => {
  await page.goto('/reset-password');
  await expect(page).toHaveURL(/\/forgot-password$/);
  await expect(page.getByRole('heading', { name: en.auth.forgotTitle })).toBeVisible();
});

test('local Mailpit recovery updates a real password and preserves the authenticated session', async ({
  page,
  request
}) => {
  let available = false;
  try {
    available = (await request.get(`${MAILPIT_URL}/api/v1/messages`, { timeout: 1500 })).ok();
  } catch {
    available = false;
  }
  test.skip(!available, 'Local Mailpit is unavailable');

  const email = uniqueEmail();
  await createOnboardedUser(page, email);
  await page.getByRole('link', { name: en.auth.forgotLink }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
  await waitForHydratedPage(page);
  await expect(page.locator('#forgot-email')).toBeVisible();
  const recoveryEmail = page.locator('#forgot-email');
  await expect(recoveryEmail).toBeEnabled();
  await recoveryEmail.fill(email);
  await page.getByRole('button', { name: en.auth.forgotSubmit }).click();
  await expect(page).toHaveURL(/\/login\?reset=sent/);

  let recoveryLink: string | null = null;
  await expect
    .poll(
      async () => {
        recoveryLink = await mailpitRecoveryLink(request, email);
        return recoveryLink;
      },
      { timeout: 15000, message: 'Mailpit should receive the password recovery email' }
    )
    .not.toBeNull();
  if (!recoveryLink) throw new Error('Expected a recovery link from Mailpit');

  await page.goto(recoveryLink);
  await expect(page).toHaveURL(/\/reset-password$/);
  await waitForHydratedPage(page);
  await page.locator('#reset-password').fill(RESET_PASSWORD);
  await page.locator('#reset-password-confirmation').fill(RESET_PASSWORD);
  await page.getByRole('button', { name: en.auth.resetSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Recovery Player' })).toBeVisible();

  await page.getByRole('button', { name: en.signOut }).click();
  await expect(page.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();
  await waitForHydratedPage(page);
  await page.getByLabel(en.auth.loginEmailLabel).fill(email);
  await page.getByLabel(en.auth.loginPasswordLabel).fill(RESET_PASSWORD);
  await page.getByRole('button', { name: en.auth.loginSubmit }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Recovery Player' })).toBeVisible();
});
