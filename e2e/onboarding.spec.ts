import { expect, test, type Page } from '@playwright/test';
import { readFileSync } from 'node:fs';

type LocaleCopy = {
  title: string;
  signOut: string;
  register: string;
  signIn: string;
  email: string;
  password: string;
  language: string;
  signInWithGoogle: string;
  auth: {
    or: string;
    accountPrompt: string;
    returnPrompt: string;
    emailAddress: string;
    emailPlaceholder: string;
  };
  onboarding: {
    title: string;
    name: string;
    level: string;
    levelChoice: string;
    levelScale: string;
    beginner: string;
    advanced: string;
    scaleDescription: string;
    reliabilityHelp: string;
    sideLeft: string;
    save: string;
    saving: string;
    failed: string;
    validationName: string;
    validationSide: string;
    validationLevel: string;
  };
  profile: {
    title: string;
    edit: string;
    save: string;
    bio: string;
    avatar: string;
    avatarUploadAction: string;
    avatarAlt: string;
    avatarInvalid: string;
    globalLevel: string;
    levelScale: string;
    reliability: string;
    confirmedGroups: string;
    saveFailed: string;
    signOutFailed: string;
  };
};

const en: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);
const es: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/es/translation.json', import.meta.url), 'utf8')
);

// Local coverage: full email/password signup → onboarding gate → save → dashboard → edit →
// avatar upload → logout. Google OAuth is NOT covered here: it requires live Google credentials
// (commented out in supabase/config.toml) and must be verified manually per the plan.

const PASSWORD = 'Password123!';
const BASE_URL = 'http://127.0.0.1:4173';

function uniqueEmail(): string {
  return `e2e-onboard-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
}

function avatarAlt(name: string): string {
  return en.profile.avatarAlt.replace('{{name}}', name);
}

/**
 * A just-issued local JWT can verify as "issued at future" for a moment (PGRST303, GoTrue
 * container clock skew vs. the Worker runtime): the first guarded SSR navigation after
 * sign-up/sign-in may render the router error page with a 500. One deterministic retry keeps
 * the suite stable; the steady-state behavior is asserted after the retry.
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
  // First "Create account" button switches the form into registration mode.
  await waitHydrated(page);
  await page.getByRole('button', { name: en.register }).click();
  await page.getByLabel(en.auth.emailAddress).fill(email);
  await page.getByLabel(en.password).fill(PASSWORD);
  // In registration mode the submit button is the only remaining "Create account" button.
  await page.getByRole('button', { name: en.register }).click();
  await settleAfterAuth(page);
  // Newcomers are blocked behind onboarding before they can see any protected content.
  await expect(page).toHaveURL(/\/onboarding$/);
  await waitHydrated(page);
}

async function completeOnboarding(page: Page, name: string, level: string): Promise<void> {
  await page.getByLabel(en.onboarding.name).fill(name);
  await page.getByLabel(en.onboarding.level).fill(level);
  const radio = page.getByRole('radio', { name: en.onboarding.sideLeft });
  await radio.check();
  // The form is hydrated once a controlled re-render keeps the radio checked.
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
}

test('a new signup is blocked by onboarding, rejects invalid input, then lands on the dashboard', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);
  await expect(page.getByRole('heading', { name: en.onboarding.title })).toBeVisible();

  // The gate holds while the profile is incomplete.
  await page.goto('/dashboard');
  await expect(page).toHaveURL(/\/onboarding$/);
  await waitHydrated(page);

  // Invalid submit: empty name, missing side.
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page.getByText(en.onboarding.validationName)).toBeVisible();
  await expect(page.getByText(en.onboarding.validationSide)).toBeVisible();

  // Invalid level (not a tenth) shows the level error.
  await page.getByLabel(en.onboarding.name).fill('   ');
  await page.getByLabel(en.onboarding.level).fill('3.05');
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page.getByText(en.onboarding.validationName)).toBeVisible();
  await expect(page.getByText(en.onboarding.validationLevel)).toBeVisible();

  // The hero paragraph and the reliability helper are two DISTINCT localized strings: both
  // must render on the same screen, never one shared sentence (round-2 copy split).
  expect(en.onboarding.scaleDescription).not.toBe(en.onboarding.reliabilityHelp);
  expect(es.onboarding.scaleDescription).not.toBe(es.onboarding.reliabilityHelp);
  await expect(page.getByText(en.onboarding.scaleDescription)).toBeVisible();
  await expect(page.getByText(en.onboarding.reliabilityHelp)).toBeVisible();

  // Level control fidelity (design vARtQ): numeric input bounded to 0–7 with exact 0.1 steps
  // alongside a six-chip flex scale with BEGINNER/ADVANCED captions (no ± steppers).
  await page.getByLabel(en.onboarding.level).fill('3.0');
  const levelInput = page.getByLabel(en.onboarding.level);
  await expect(levelInput).toHaveAttribute('min', '0');
  await expect(levelInput).toHaveAttribute('max', '7');
  await expect(levelInput).toHaveAttribute('step', '0.1');
  await expect(page.getByText(en.onboarding.beginner, { exact: true })).toBeVisible();
  await expect(page.getByText(en.onboarding.advanced, { exact: true })).toBeVisible();

  // Six chips (0.0 / 2.0 / 3.0 / 4.0 / 5.0 / 7.0) fill the card row: at a 390px phone viewport
  // the chip row must not overflow, and the pressed chip mirrors the numeric input's level.
  await page.setViewportSize({ width: 390, height: 844 });
  const scale = page.getByRole('group', { name: en.onboarding.levelScale });
  await expect(scale.getByRole('button')).toHaveCount(6);
  const overflow = await scale
    .locator('div')
    .first()
    .evaluate((element) => ({
      scrollWidth: element.scrollWidth,
      clientWidth: element.clientWidth
    }));
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);
  const chip = (level: string) =>
    page.getByRole('button', { name: en.onboarding.levelChoice.replace('{{level}}', level) });
  await expect(chip('3.00')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('0.00')).toHaveAttribute('aria-pressed', 'false');
  await expect(chip('7.00')).toHaveAttribute('aria-pressed', 'false');
  // Chip clicks drive the shared level state across the full 0.0–7.0 range (floor and ceiling).
  await chip('0.00').click();
  await expect(page.locator('output')).toHaveText('0.00');
  await expect(chip('0.00')).toHaveAttribute('aria-pressed', 'true');
  await expect(chip('3.00')).toHaveAttribute('aria-pressed', 'false');
  await chip('7.00').click();
  await expect(page.locator('output')).toHaveText('7.00');
  await expect(chip('7.00')).toHaveAttribute('aria-pressed', 'true');
  // The numeric input remains the exact 0.1-step control.
  await levelInput.fill('6.4');
  await expect(page.locator('output')).toHaveText('6.40');
  await page.setViewportSize({ width: 1280, height: 720 });

  // Valid save: level 3.0 must render with two decimals and the documented initial state.
  await page.getByLabel(en.onboarding.name).fill('Taka Onboard');
  await page.getByLabel(en.onboarding.level).fill('3.0');
  const sideRadio = page.getByRole('radio', { name: en.onboarding.sideLeft });
  await sideRadio.check();
  // The form is hydrated once a controlled re-render keeps the radio checked.
  await expect(sideRadio).toBeChecked();
  await expect(page.locator('output')).toHaveText('3.00');
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: en.profile.title })).toBeVisible();

  // The profile header action is a 44×44 icon-only button carrying its own accessible name
  // (round-2 header): no visible text label to target.
  const headerAction = page.getByRole('button', { name: en.profile.edit });
  await expect(headerAction).toHaveAccessibleName(en.profile.edit);
  const actionBox = await headerAction.boundingBox();
  expect(actionBox?.width).toBe(44);
  expect(actionBox?.height).toBe(44);

  // The level card is labelled GLOBAL LEVEL (design vARtQ/aWm9C/CKgMi): the label+metric
  // stack and the reliability badge are SIBLINGS in the level row, above the 0.0 /
  // LEVEL SCALE / 7.0 progress track (14px tall).
  await expect(page.getByText(en.profile.globalLevel)).toBeVisible();
  // Label/metric stack: the GLOBAL LEVEL caption with the two-decimal metric beside it.
  const levelHeader = page.getByText(en.profile.globalLevel).locator('..');
  await expect(levelHeader).toContainText('3.00');
  // Enclosing level row: the reliability badge rides beside the header stack.
  const levelRow = levelHeader.locator('..');
  await expect(levelRow).toContainText(en.profile.reliability);
  await expect(levelRow).toContainText('10%');
  const levelCard = page.locator('section').filter({ has: page.getByText(en.profile.globalLevel) });
  await expect(levelCard.getByText('0.00', { exact: true })).toBeVisible();
  await expect(levelCard.getByText(en.profile.levelScale)).toBeVisible();
  await expect(levelCard.getByText('7.00', { exact: true })).toBeVisible();
  const progress = page.getByRole('progressbar', { name: en.profile.levelScale });
  await expect(progress).toHaveAttribute('max', '7');
  const track = levelCard.locator('[aria-hidden="true"]');
  await expect(track).toHaveCount(1);
  expect(await track.evaluate((element) => getComputedStyle(element).height)).toBe('14px');
  await expect(page.getByText(en.profile.confirmedGroups).locator('..')).toContainText('0');
  // Initials fallback before any avatar upload (identity card and avatar widget both show it).
  await expect(page.getByText('TO', { exact: true }).first()).toBeVisible();
  // The sporting dashboard never exposes the login email (AC4).
  expect(await page.locator('main').textContent()).not.toContain(email);
});

test('a fresh browser context keeps the onboarding state', async ({ browser, page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Vera Fresh', '3.5');

  const state = await page.context().storageState();
  const secondContext = await browser.newContext({ storageState: state });
  const secondPage = await secondContext.newPage();
  await secondPage.goto('/dashboard');
  await expect(secondPage.getByRole('heading', { name: en.profile.title })).toBeVisible();
  await expect(secondPage.getByRole('heading', { name: 'Vera Fresh' })).toBeVisible();
  await expect(secondPage.locator('main')).toContainText('3.50');
  await secondContext.close();
});

test('the dashboard allows profile edits but exposes no level control, and avatar uploads enforce MIME and size', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Mila Edit', '3.0');

  // No level control anywhere on the dashboard: the rating is immutable from the UI.
  await expect(page.getByLabel(en.onboarding.level)).toHaveCount(0);

  await page.getByRole('button', { name: en.profile.edit }).click();
  await page.getByLabel(en.onboarding.name).fill('Mila Edited');
  await page.getByLabel(en.profile.bio).fill('Right side player.');
  await page.getByRole('button', { name: en.profile.save }).click();
  await expect(page.getByRole('heading', { name: 'Mila Edited' })).toBeVisible();

  // Invalid MIME type is rejected with the localized error before any upload.
  const fileInput = page.getByLabel(en.profile.avatar);
  await fileInput.setInputFiles({
    name: 'note.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from('nope')
  });
  await expect(page.getByText(en.profile.avatarInvalid)).toBeVisible();

  // Oversized PNG (>2 MiB) is rejected with the same localized error.
  await fileInput.setInputFiles({
    name: 'big.png',
    mimeType: 'image/png',
    buffer: Buffer.alloc(2 * 1024 * 1024 + 1, 1)
  });
  await expect(page.getByText(en.profile.avatarInvalid)).toBeVisible();

  // Valid PNG upload swaps the initials fallback for a signed private URL.
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64'
  );
  await fileInput.setInputFiles({ name: 'ok.png', mimeType: 'image/png', buffer: png });
  // The upload action is a distinct localized key, separate from the file input's label
  // (round-2 avatar widget): the input keeps "Profile photo", the button reads "Upload photo".
  expect(en.profile.avatarUploadAction).not.toBe(en.profile.avatar);
  await page.getByRole('button', { name: en.profile.avatarUploadAction }).click();
  // After the upload both the identity card and the upload widget render the signed avatar.
  const avatar = page.getByAltText(avatarAlt('Mila Edited')).first();
  await expect(avatar).toBeVisible();
  await expect(avatar).toHaveAttribute('src', /\/object\/sign\//);
});

test('a whitespace-padded save syncs the trimmed server values into display and edit form', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Sync Player', '3.0');

  // Both forms strip only the ASCII edge class, so a PADDED display name must save cleanly
  // (the old silent-failure bug) and sync the trimmed server value into the heading and the
  // edit input. The padded bio is trimmed client-side too: its trimmed server value must sync
  // back the same way.
  await page.getByRole('button', { name: en.profile.edit }).click();
  await page.getByLabel(en.onboarding.name).fill('  Padded Name  ');
  await page.getByLabel(en.profile.bio).fill('  Padded bio  ');
  await page.getByRole('button', { name: en.profile.save }).click();

  // Display reflects the trimmed values immediately after the save; a visible heading is
  // only possible once the save resolved, so the missing failure alert below is reliable.
  await expect(page.getByRole('heading', { name: 'Padded Name' })).toBeVisible();
  await expect(page.getByText('Padded bio')).toBeVisible();
  await expect(page.getByText(en.profile.saveFailed)).toHaveCount(0);

  // Re-opening edit mode shows the refreshed local state, never the stale padded values.
  await page.getByRole('button', { name: en.profile.edit }).click();
  await expect(page.getByLabel(en.onboarding.name)).toHaveValue('Padded Name');
  await expect(page.getByLabel(en.profile.bio)).toHaveValue('Padded bio');
});

test('first-time onboarding accepts a padded display name and lands on the trimmed profile', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);

  // The very first save is the flow that used to fail silently on padded input: the form
  // now submits name.trim(), so the padded value must be accepted and navigate to the
  // dashboard (navigation only happens after a successful save) showing the trimmed name.
  await page.getByLabel(en.onboarding.name).fill('  Onboard Trim  ');
  await page.getByLabel(en.onboarding.level).fill('3.0');
  const radio = page.getByRole('radio', { name: en.onboarding.sideLeft });
  await radio.check();
  // The form is hydrated once a controlled re-render keeps the radio checked.
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: en.onboarding.save }).click();

  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByRole('heading', { name: 'Onboard Trim' })).toBeVisible();
});

test('an NBSP-edged display name is saved verbatim and persists with its NBSPs', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);

  // The two client forms normalize ONLY the ASCII edge class (space/tab/LF/CR/FF/VT), so an
  // NBSP (U+00A0) edge must reach the server untouched and come back verbatim. This is the
  // drift guard against the old String.prototype.trim() behavior, which silently stripped
  // NBSP edges and diverged from the server policy.
  const nbspName = '\u00A0Ana\u00A0';
  await page.getByLabel(en.onboarding.name).fill(nbspName);
  await page.getByLabel(en.onboarding.level).fill('3.0');
  const radio = page.getByRole('radio', { name: en.onboarding.sideLeft });
  await radio.check();
  // The form is hydrated once a controlled re-render keeps the radio checked.
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);

  // The identity card renders exactly one level-2 heading (the display name); locating it by
  // level avoids the whitespace-normalized accessible-name matching. toHaveText normalizes
  // every whitespace kind (an NBSP collapses like a space), so on its own it could NOT catch
  // a Unicode-trim regression — the raw textContent equality below is the exact drift guard.
  const nameHeading = page.getByRole('heading', { level: 2 });
  await expect(nameHeading).toBeVisible();
  await expect(nameHeading).toHaveText(nbspName);
  expect(await nameHeading.textContent()).toBe(nbspName);

  // The edit form is hydrated from the SERVER-synced profile state (setName(next.display_name)):
  // toHaveValue compares raw input values without whitespace normalization, so the exact
  // NBSP-edged value must have round-tripped through the database.
  await page.getByRole('button', { name: en.profile.edit }).click();
  await expect(page.getByLabel(en.onboarding.name)).toHaveValue(nbspName);

  // A fresh guarded navigation re-reads the persisted row: the NBSPs survived storage, not
  // just the in-memory profile state.
  await settleAfterAuth(page);
  const persistedHeading = page.getByRole('heading', { level: 2 });
  await expect(persistedHeading).toBeVisible();
  expect(await persistedHeading.textContent()).toBe(nbspName);
});

test('the emptiness rule is the ASCII class end-to-end: whitespace-only is rejected, NBSP-only saves', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);

  // ASCII whitespace-only (tab/space/LF): the client-side rule — the shared ASCII strip
  // reducing the value to '' — rejects BEFORE any server call, with the localized validation
  // message and no navigation.
  await page.getByLabel(en.onboarding.name).fill('\t \n');
  await page.getByLabel(en.onboarding.level).fill('3.0');
  const radio = page.getByRole('radio', { name: en.onboarding.sideLeft });
  await radio.check();
  // The form is hydrated once a controlled re-render keeps the radio checked.
  await expect(radio).toBeChecked();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page.getByText(en.onboarding.validationName)).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/onboarding');

  // NBSP-only is NOT empty under the ASCII-only rule, and every layer agrees: the client
  // submits it, the server validator accepts it (no ASCII edge to reject, non-zero code-point
  // length) and the SQL CHECK btrims only the ASCII class. The save must therefore succeed
  // and persist the NBSPs verbatim — a client that re-introduces Unicode trim() would reject
  // here and fail this test.
  const nbspOnly = '\u00A0\u00A0';
  await page.getByLabel(en.onboarding.name).fill(nbspOnly);
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/dashboard$/);
  await expect(page.getByText(en.onboarding.validationName)).toHaveCount(0);

  const nameHeading = page.getByRole('heading', { level: 2 });
  await expect(nameHeading).toBeVisible();
  expect(await nameHeading.textContent()).toBe(nbspOnly);

  // The dashboard SSR'd from the freshly onboarded row: the edit form carrying the exact
  // NBSP-only value proves the database kept it, whitespace normalization can never apply.
  await page.getByRole('button', { name: en.profile.edit }).click();
  await expect(page.getByLabel(en.onboarding.name)).toHaveValue(nbspOnly);
});

test('the profile edit form preserves NBSP edges and trims only ASCII edges on save', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Mila Edge', '3.0');

  // Save through the PROFILE edit form: the same ASCII-only strip policy must hold there.
  await page.getByRole('button', { name: en.profile.edit }).click();
  const nbspName = '\u00A0Mila\u00A0';
  await page.getByLabel(en.onboarding.name).fill(nbspName);
  await page.getByRole('button', { name: en.profile.save }).click();

  await expect(page.getByText(en.profile.saveFailed)).toHaveCount(0);
  const nameHeading = page.getByRole('heading', { level: 2 });
  await expect(nameHeading).toBeVisible();
  await expect(nameHeading).toHaveText(nbspName);
  expect(await nameHeading.textContent()).toBe(nbspName);

  // Re-opening edit mode shows the refreshed server value with the NBSPs intact.
  await page.getByRole('button', { name: en.profile.edit }).click();
  await expect(page.getByLabel(en.onboarding.name)).toHaveValue(nbspName);

  // And the ASCII-only trim still applies on the very same form: padded ASCII edges are
  // stripped before the save lands.
  await page.getByLabel(en.onboarding.name).fill('  Mila Twice  ');
  await page.getByRole('button', { name: en.profile.save }).click();
  await expect(page.getByRole('heading', { name: 'Mila Twice' })).toBeVisible();
  expect(await page.getByRole('heading', { level: 2 }).textContent()).toBe('Mila Twice');
});

test('the onboarding level chips keep the design typography in light and dark themes', async ({
  page
}) => {
  for (const theme of ['light', 'dark'] as const) {
    if (theme === 'dark')
      await page.context().addCookies([{ name: 'theme', value: 'dark', url: BASE_URL }]);
    const email = uniqueEmail();
    await register(page, email);
    await expect(page.getByRole('heading', { name: en.onboarding.title })).toBeVisible();
    // The chips are StyleX-styled (ui.scaleChip): the design 12px/600 must win the cascade
    // over the reset layer's font:inherit.
    const chip = page.getByRole('button', {
      name: en.onboarding.levelChoice.replace('{{level}}', '3.00')
    });
    await expect(chip).toBeVisible();
    const typography = await chip.evaluate((element) => {
      const style = getComputedStyle(element);
      return { fontSize: style.fontSize, fontWeight: style.fontWeight };
    });
    expect(typography, `level chip must keep the design typography (${theme} theme)`).toEqual({
      fontSize: '12px',
      fontWeight: '600'
    });
    // Drop the session (and every other cookie) so the next iteration starts from a clean
    // unauthenticated browser state instead of being bounced off /login by the onboarding
    // gate.
    await page.context().clearCookies();
  }
});

test('signing out returns home and protected routes redirect back to login', async ({ page }) => {
  const email = uniqueEmail();
  await register(page, email);
  await completeOnboarding(page, 'Rio Logout', '3.0');

  await waitHydrated(page);
  await page.getByRole('button', { name: en.signOut }).click();
  await expect(page.getByRole('heading', { name: en.title })).toBeVisible();

  await page.goto('/dashboard');
  expect(new URL(page.url()).pathname).toBe('/login');
  expect(new URL(page.url()).searchParams.get('next')).toBe('/dashboard');
  await expect(page.getByLabel(en.auth.emailAddress)).toBeVisible();
});

test('the login screen shows the OR divider, provider mark and account prompt while the flow still signs in', async ({
  page
}) => {
  const email = uniqueEmail();
  await page.goto('/login');
  await waitHydrated(page);

  // Round-2 field copy: the email input is announced by an EMAIL ADDRESS-style label with an
  // adjacent decorative icon, and carries a localized placeholder example address.
  const emailField = page.getByLabel(en.auth.emailAddress);
  await expect(emailField).toHaveAttribute('placeholder', en.auth.emailPlaceholder);
  const emailLabel = page.locator('label').filter({ hasText: en.auth.emailAddress });
  await expect(emailLabel).toHaveCount(1);
  const labelStyle = await emailLabel.evaluate((element) => {
    const style = getComputedStyle(element);
    return { fontSize: style.fontSize, fontWeight: style.fontWeight };
  });
  expect(labelStyle).toEqual({ fontSize: '12px', fontWeight: '600' });
  await expect(emailField.locator('..').locator('svg[aria-hidden="true"]')).toHaveCount(1);

  // OR divider flanked by rules, with the localized Google provider button and its "G" mark.
  await expect(page.getByText(en.auth.or, { exact: true })).toBeVisible();
  const google = page.getByRole('button', { name: en.signInWithGoogle });
  await expect(google).toBeVisible();
  await expect(google.locator('span[aria-hidden="true"]')).toHaveText('G');
  // Account prompt invites the newcomer to switch into registration mode.
  await expect(page.getByText(en.auth.accountPrompt)).toBeVisible();

  // The password flow still signs the player up and lands on the onboarding gate.
  await page.getByRole('button', { name: en.register }).click();
  await expect(page.getByText(en.auth.returnPrompt)).toBeVisible();
  await page.getByLabel(en.auth.emailAddress).fill(email);
  await page.getByLabel(en.password).fill(PASSWORD);
  await page.getByRole('button', { name: en.register }).click();
  await settleAfterAuth(page);
  await expect(page).toHaveURL(/\/onboarding$/);
});

test('validation errors re-render in the active locale after switching the language', async ({
  page
}) => {
  const email = uniqueEmail();
  await register(page, email);

  // Submit the empty form: the errors are stored as keys and rendered in the active locale.
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page.getByText(en.onboarding.validationName)).toBeVisible();
  await expect(page.getByText(en.onboarding.validationSide)).toBeVisible();

  // Switching language must re-translate the SAME alerts without a resubmit or reload.
  await page.getByLabel(en.language).selectOption('es');
  await expect(page.getByText(es.onboarding.validationName)).toBeVisible();
  await expect(page.getByText(es.onboarding.validationSide)).toBeVisible();
  await expect(page.getByText(en.onboarding.validationName)).toHaveCount(0);
  await expect(page.getByText(en.onboarding.validationSide)).toHaveCount(0);
});

test.describe('sign-out failure handling', () => {
  // Block the service worker so the route below can intercept the cross-origin logout
  // request deterministically (the flow itself does not depend on the service worker).
  test.use({ serviceWorkers: 'block' });

  test('a failing sign-out shows a translated error and stays put; success navigates home', async ({
    page
  }) => {
    const email = uniqueEmail();
    await register(page, email);
    await completeOnboarding(page, 'Sena Out', '3.0');

    // Force the logout endpoint to fail with 500 (a 401/403/404 is intentionally ignored by
    // the auth client as "already signed out").
    await page.route('**/auth/v1/logout**', (route) =>
      route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ msg: 'sign-out outage' })
      })
    );
    // The dashboard was reached via a full navigation: wait for React to attach handlers
    // before clicking, otherwise the click is silently swallowed (SSR button, no listener).
    await waitHydrated(page);
    await page.getByRole('button', { name: en.signOut }).click();
    await expect(page.getByText(en.profile.signOutFailed)).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/dashboard');

    // With the outage gone, the same control signs out and navigates home.
    await page.unroute('**/auth/v1/logout**');
    await page.getByRole('button', { name: en.signOut }).click();
    await expect(page.getByRole('heading', { name: en.title })).toBeVisible();
    expect(new URL(page.url()).pathname).toBe('/');
  });
});

test.describe('onboarding save failure handling', () => {
  // Block the service worker so the route below can intercept the server-function request
  // deterministically (the flow itself does not depend on the service worker).
  test.use({ serviceWorkers: 'block' });

  test('a failed onboarding save shows the localized error, re-enables the form and can be retried', async ({
    page
  }) => {
    const email = uniqueEmail();
    await register(page, email);

    // Valid input, so the ONLY possible failure source is the forced server outage below.
    await page.getByLabel(en.onboarding.name).fill('Nia Retry');
    await page.getByLabel(en.onboarding.level).fill('3.0');
    const radio = page.getByRole('radio', { name: en.onboarding.sideLeft });
    await radio.check();
    // The form is hydrated once a controlled re-render keeps the radio checked.
    await expect(radio).toBeChecked();

    // TanStack Start invokes server functions via same-origin POSTs to /_serverFn/<id>:
    // aborting the request rejects the onboardPlayer fetch, which the submit handler maps
    // to the localized failure alert (any incidental GET server-function call passes
    // through untouched).
    await page.route('**/_serverFn/**', (route) => {
      if (route.request().method() === 'POST') return route.abort();
      return route.continue();
    });
    const saveRequested = page.waitForRequest(
      (request) =>
        request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/_serverFn/')
    );
    await page.getByRole('button', { name: en.onboarding.save }).click();
    await saveRequested;

    // The submit handler's finally block cleared saving: the localized failure alert renders
    // and the same submit button is enabled again — the form never stays stuck disabled, and
    // navigation to the dashboard is withheld after the failed save.
    await expect(page.getByText(en.onboarding.failed)).toBeVisible();
    await expect(page.getByRole('button', { name: en.onboarding.save })).toBeEnabled();
    expect(new URL(page.url()).pathname).toBe('/onboarding');

    // With the outage gone, the same intact form state saves without re-entering anything.
    await page.unroute('**/_serverFn/**');
    await page.getByRole('button', { name: en.onboarding.save }).click();
    await expect(page).toHaveURL(/\/dashboard$/);
    await expect(page.getByRole('heading', { name: 'Nia Retry' })).toBeVisible();
  });

  test('an expired session on submit redirects to the login deep link without the generic failure alert', async ({
    page
  }) => {
    const email = uniqueEmail();
    // Playwright gates EVERY in-page observation (locators, evaluate, waitForFunction)
    // while a navigation is pending — "waiting for navigation to finish" — so the held
    // /login redirect below cannot be read with locators. The sampler installed here runs
    // in the PAGE's own event loop and streams the submit control's disabled state and
    // the failure alert's presence out through console messages, which arrive in the test
    // process as push events while the navigation is held.
    const heldFlightSamples: Array<{ disabled: boolean | null; failed: boolean }> = [];
    let sampling = false;
    page.on('console', (message) => {
      if (sampling && message.text().startsWith('pf-onboard-sample:')) {
        heldFlightSamples.push(JSON.parse(message.text().slice('pf-onboard-sample:'.length)));
      }
    });
    await page.addInitScript((failedCopy) => {
      window.setInterval(() => {
        if (location.pathname !== '/onboarding') return;
        const submit = document.querySelector('form button[type="submit"]');
        console.log(
          `pf-onboard-sample:${JSON.stringify({
            disabled: submit instanceof HTMLButtonElement ? submit.disabled : null,
            failed: document.body.textContent.includes(failedCopy)
          })}`
        );
      }, 50);
    }, en.onboarding.failed);

    await register(page, email);

    // Valid input, so the ONLY possible failure source is the session removal below.
    await page.getByLabel(en.onboarding.name).fill('Ivo Expired');
    await page.getByLabel(en.onboarding.level).fill('3.0');
    const radio = page.getByRole('radio', { name: en.onboarding.sideLeft });
    await radio.check();
    // The form is hydrated once a controlled re-render keeps the radio checked.
    await expect(radio).toBeChecked();

    // Drop every cookie: the onboardPlayer server function resolves its claims from request
    // cookies, so an empty cookie jar deterministically forces the UNAUTHENTICATED
    // early-return in the submit handler — the exact path that used to leave the form stuck.
    await page.context().clearCookies();

    // Hold the onboardPlayer response at the network layer (the real cookie-less request is
    // fetched, its replay is gated). While the result is in flight NO navigation has started,
    // so this pending window is observable with locators: the submit control shows the
    // localized saving label and stays disabled, and the generic failure alert is absent.
    let releaseSaveResponse: () => void = () => {};
    const saveResponseHeld = new Promise<void>((resolve) => {
      releaseSaveResponse = resolve;
    });
    await page.route('**/_serverFn/**', async (route) => {
      if (route.request().method() !== 'POST') return route.continue();
      const response = await route.fetch();
      await saveResponseHeld;
      return route.fulfill({ response });
    });

    // Start collecting samples for the whole pending window: from this click until the
    // held /login navigation is released, the control must never re-enable.
    sampling = true;
    await page.getByRole('button', { name: en.onboarding.save }).click();
    await expect(page.getByRole('button', { name: en.onboarding.saving })).toBeDisabled();
    await expect(page.getByText(en.onboarding.failed)).toHaveCount(0);

    // Hold the handler's login navigation at the network layer as well:
    // window.location.assign('/login?next=/onboarding') fires ONLY from the UNAUTHENTICATED
    // branch, so the intercepted request proves which branch ran — the generic failure branch
    // would stay on /onboarding with the alert rendered and never navigate.
    let resolveHeldLoginRedirect: ((redirect: URL) => void) | undefined;
    const heldLoginRedirect = new Promise<URL>((resolve) => {
      resolveHeldLoginRedirect = resolve;
    });
    let releaseLoginNavigation: () => void = () => {};
    const releaseGate = new Promise<void>((resolve) => {
      releaseLoginNavigation = resolve;
    });
    await page.route(/\/login\?next=\/onboarding$/, async (route) => {
      resolveHeldLoginRedirect?.(new URL(route.request().url()));
      await releaseGate;
      return route.continue();
    });

    // Replaying the held cookie-less response: the handler must take the UNAUTHENTICATED
    // branch and navigate to the login deep link (never to /dashboard, never stay put).
    releaseSaveResponse();
    const loginRedirect = await heldLoginRedirect;
    expect(loginRedirect.pathname).toBe('/login');
    expect(loginRedirect.searchParams.get('next')).toBe('/onboarding');

    // While the /login navigation ITSELF is held, the handler is parked in the
    // UNAUTHENTICATED branch with `navigating` true: the finally cleanup stays skipped.
    // The document is still the onboarding screen, and the samples collected during the
    // hold must ALL report the submit control disabled and the generic failure alert
    // absent — a regression that re-enables the form mid-navigation (or flashes the
    // failure alert) flips a sample and fails here before the redirect lands.
    expect(new URL(page.url()).pathname).toBe('/onboarding');
    const heldWindowStart = heldFlightSamples.length;
    await expect
      .poll(
        () => heldFlightSamples.slice(heldWindowStart).length,
        'sampler must stream during the held /login navigation'
      )
      .toBeGreaterThanOrEqual(8);
    const heldWindow = heldFlightSamples.slice(heldWindowStart);
    expect(
      heldWindow.every((sample) => sample.disabled === true),
      'the save control must stay disabled for every held-navigation sample'
    ).toBe(true);
    expect(
      heldWindow.some((sample) => sample.failed),
      'the generic failure alert must stay absent during the held navigation'
    ).toBe(false);

    // Releasing the gate completes the redirect onto the login screen.
    releaseLoginNavigation();
    await page.waitForURL(/\/login\?/);
    await waitHydrated(page);
    const landed = new URL(page.url());
    expect(landed.pathname).toBe('/login');
    // The settled address bar carries the SANITIZED deep link: the login route's
    // validateSearch runs normalizeReturnPath, whose auth-loop guard rewrites a
    // /onboarding next value to /dashboard (otherwise login → onboarding → unauthenticated
    // → login would loop forever). The exact assigned value next=/onboarding is asserted on
    // the intercepted navigation request above.
    expect(landed.searchParams.get('next')).toBe('/dashboard');
    await expect(page.getByText(en.onboarding.failed)).toHaveCount(0);
  });
});
