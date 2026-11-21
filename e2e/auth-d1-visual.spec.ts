import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import en from '../src/locales/en/translation.json' with { type: 'json' };
import { submitAndWaitForAuthDestination, waitForHydratedPage } from './auth-helpers';
import { sql } from './matches-management-fixtures';
import { deriveCroppedTopPng } from './png-mask';

// Clubhouse D1 auth frames (PAF-202, Group A): invitation confirmation, claim password and claim
// verify from docs/design/padel-friend-clubhouse.pen. The 20 exports are committed unchanged under
// references/paf-202-d1-auth and pinned by SHA-256. Each baseline is the export minus the 44px OS
// status bar (deriveCroppedTopPng) and every screenshot is taken at 390×800. Frames the app cannot
// reach (no counterpart state) stay pinned in the manifest with comparison "frame-only" and are
// never compared. Never run this spec with --update-snapshots: baselines are derived, not captured.
type D1Frame = {
  frameId: string;
  source: string;
  sourceSha256: string;
  baselineSha256: string | null;
  width: number;
  height: number;
  comparison: 'pixel' | 'frame-only';
  maxDiffPixelRatio: number | null;
};

const manifest: { frames: Record<string, D1Frame> } = JSON.parse(
  readFileSync(new URL('./references/paf-202-d1-auth/manifest.json', import.meta.url), 'utf8')
);

const baseURL = 'http://127.0.0.1:4173';
const password = 'Password123!';
const STATUS_BAR = 44;
const FRAME_VIEWPORT = { width: 390, height: 800 };

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
  serviceWorkers: 'block'
});

function digestBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertFrameProvenance(name: string): void {
  const frame = manifest.frames[name];
  if (!frame) throw new Error(`Missing PAF-202 D1 auth frame ${name}`);
  const source = readFileSync(
    new URL(`./references/paf-202-d1-auth/${frame.source}`, import.meta.url)
  );
  expect(digestBuffer(source), `${name} Pencil export must match its pinned digest`).toBe(
    frame.sourceSha256
  );
  if (frame.comparison !== 'pixel') return;
  const expected = deriveCroppedTopPng(source, STATUS_BAR);
  expect(digestBuffer(expected), `${name} baseline derivation must stay pinned`).toBe(
    frame.baselineSha256
  );
  const baseline = readFileSync(
    new URL(`./auth-d1-visual.spec.ts-snapshots/${name}.png`, import.meta.url)
  );
  expect(baseline.equals(expected), `${name} baseline must be the cropped Pencil export`).toBe(
    true
  );
}

test.beforeAll(() => {
  for (const name of Object.keys(manifest.frames)) assertFrameProvenance(name);
});

async function compareFrame(page: Page, name: string): Promise<void> {
  const frame = manifest.frames[name];
  if (frame?.comparison !== 'pixel' || frame.maxDiffPixelRatio === null)
    throw new Error(`${name} is not a pixel-compared D1 frame`);
  expect(page.viewportSize(), `${name} must be captured at the frame viewport`).toEqual(
    FRAME_VIEWPORT
  );
  try {
    await expect.soft(page).toHaveScreenshot(`${name}.png`, {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: frame.maxDiffPixelRatio
    });
  } finally {
    // Detect --update-snapshots overwriting a reference-derived baseline.
    assertFrameProvenance(name);
  }
}

async function ready(page: Page): Promise<void> {
  await waitForHydratedPage(page);
  await page.evaluate(async () => {
    await Promise.all(
      ['400', '500', '600', '700', '800'].map((weight) =>
        document.fonts.load(`${weight} 16px Figtree`)
      )
    );
    await document.fonts.ready;
  });
}

async function useTheme(context: BrowserContext, theme: 'light' | 'dark'): Promise<void> {
  await context.addCookies([
    { name: 'locale', value: 'en', url: baseURL },
    { name: 'theme', value: theme, url: baseURL }
  ]);
}

type Geometry = { x?: number; y?: number; width?: number; height?: number };

async function assertGeometry(
  locator: Locator,
  name: string,
  design: Geometry,
  tolerance = 1
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${name} must be rendered`).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const expected = design[key];
    if (expected === undefined) continue;
    expect(
      Math.abs(box![key] - expected),
      `${name} ${key}: Pencil ${expected}px, actual ${box![key]}px`
    ).toBeLessThanOrEqual(tolerance);
  }
}

// Frame top bar: 56px tall, centered 17px title between the 48px back slot and the 72px action slot.
async function assertTopBar(page: Page, title: string): Promise<void> {
  const bar = page.locator('main > div').first();
  await assertGeometry(bar, 'Top bar', { x: 0, y: 0, width: 390, height: 56 });
  await assertGeometry(bar.locator('span', { hasText: title }).last(), 'Top bar title', {
    x: 56,
    y: 18,
    width: 254,
    height: 20
  });
}

// Frame sticky action bar: 12/20/24 inset, hairline top border, anchored to the viewport bottom.
async function assertActionBar(bar: Locator, height: number): Promise<void> {
  await assertGeometry(bar, 'Sticky action bar', { x: 0, y: 800 - height, width: 390, height }, 2);
  const style = await bar.evaluate((element) => {
    const computed = getComputedStyle(element);
    return {
      position: computed.position,
      borderTop: computed.borderTopWidth,
      paddingTop: computed.paddingTop,
      paddingBottom: computed.paddingBottom,
      paddingInline: [computed.paddingLeft, computed.paddingRight]
    };
  });
  expect(style).toEqual({
    position: 'sticky',
    borderTop: '1px',
    paddingTop: '12px',
    paddingBottom: '24px',
    paddingInline: ['20px', '20px']
  });
}

async function assertNoTextTransform(locators: Locator[]): Promise<void> {
  for (const locator of locators)
    expect(await locator.evaluate((element) => getComputedStyle(element).textTransform)).toBe(
      'none'
    );
}

// 320px and wide layouts: nothing overflows, every control keeps the 44px target and stays on screen.
async function assertControlFit(page: Page, width: number): Promise<void> {
  const layout = await page.locator('main').evaluate((main) => ({
    pageWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainWidth: main.getBoundingClientRect().width,
    targets: [...main.querySelectorAll('a, button, input')]
      .filter((control) => control.getAttribute('type') !== 'hidden')
      .map((control) => {
        const { width: targetWidth, height, left, right } = control.getBoundingClientRect();
        return { width: targetWidth, height, left, right };
      })
  }));
  expect(layout.scrollWidth).toBeLessThanOrEqual(layout.pageWidth);
  expect(layout.mainWidth).toBe(Math.min(width, 480));
  expect(layout.targets.length).toBeGreaterThan(0);
  for (const target of layout.targets) {
    expect(target.width).toBeGreaterThanOrEqual(44);
    expect(target.height).toBeGreaterThanOrEqual(44);
    expect(target.left).toBeGreaterThanOrEqual(0);
    expect(target.right).toBeLessThanOrEqual(width);
  }
}

async function assertResponsive(page: Page): Promise<void> {
  await page.setViewportSize({ width: 320, height: 800 });
  await assertControlFit(page, 320);
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertControlFit(page, 1280);
  await page.setViewportSize(FRAME_VIEWPORT);
}

// Status tile: 56×56 at the left content edge, 12px radius, 12px below the 4px content inset (frame y 72 after crop).
async function assertTile(page: Page, heading: string): Promise<void> {
  // content > [tile row > tile] + [heading block > h1]
  const tile = page.getByRole('heading', { name: heading }).locator('xpath=../../div[1]/div');
  await assertGeometry(tile, 'Status tile', { x: 20, y: 72, width: 56, height: 56 });
  expect(await tile.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('12px');
}

for (const theme of ['light', 'dark'] as const) {
  test(`invitation confirmation matches frames b7ymtm, wdEqM and KZhFq (${theme})`, async ({
    page,
    context
  }) => {
    await useTheme(context, theme);
    await page.setViewportSize(FRAME_VIEWPORT);

    // Expired (wdEqM): no pending invitation cookie, so the confirmation is unavailable.
    await page.goto('/auth/confirm-invite');
    await expect(page.getByRole('heading', { name: en.auth.inviteExpiredTitle })).toBeVisible();
    await ready(page);
    await assertTopBar(page, en.auth.inviteBarTitle);
    await assertTile(page, en.auth.inviteExpiredTitle);
    const help = page.getByRole('heading', { name: en.auth.inviteHelpTitle }).locator('..');
    await assertGeometry(help, 'Help card', { x: 20, width: 350 });
    expect(await help.evaluate((element) => getComputedStyle(element).borderRadius)).toBe('20px');
    const back = page.getByRole('button', { name: en.auth.inviteBackToSignIn });
    await assertActionBar(page.locator('main > div').last(), 88);
    await assertGeometry(back, 'Back to sign in', { x: 20, y: 724, width: 350, height: 52 });
    await assertNoTextTransform([back]);
    await expect(page.getByRole('alert')).toContainText(en.auth.inviteConfirmExpired);
    await compareFrame(page, `invite-expired-${theme}`);
    await assertResponsive(page);

    // Default (b7ymtm): a pending invitation waits for the explicit, one-use confirmation.
    await page.goto('/auth/callback?token_hash=unverified-invite&type=invite');
    await expect(page).toHaveURL(/\/auth\/confirm-invite$/);
    await expect(page.getByRole('heading', { name: en.auth.inviteConfirmTitle })).toBeVisible();
    await ready(page);
    await assertTopBar(page, en.auth.inviteBarTitle);
    await assertTile(page, en.auth.inviteConfirmTitle);
    await assertGeometry(page.getByRole('heading', { name: en.auth.inviteConfirmTitle }), 'Title', {
      x: 20,
      y: 142,
      width: 350
    });
    const accept = page.getByRole('button', { name: en.auth.inviteConfirm, exact: true });
    const cancel = page.getByRole('button', { name: en.auth.inviteCancel });
    // Frame bar holds one 52px button (88px); the app keeps its cancel action, +60px.
    await assertActionBar(page.locator('main form > div').last(), 148);
    await assertGeometry(accept, 'Accept button', { x: 20, y: 664, width: 350, height: 52 });
    await assertGeometry(cancel, 'Cancel link', { x: 20, y: 724, width: 350, height: 52 });
    await assertNoTextTransform([accept, cancel]);
    await compareFrame(page, `invite-default-${theme}`);
    await assertResponsive(page);

    // Busy (KZhFq): the document POST is in flight. Cancel the native navigation after React's
    // submit handler ran, so the pending state stays on screen.
    await page.locator('form').evaluate((form) => {
      form.addEventListener('submit', (event) => event.preventDefault());
    });
    await accept.click();
    await expect(page.getByRole('heading', { name: en.auth.inviteBusyTitle })).toBeVisible();
    const busy = page.getByRole('button', { name: en.auth.inviteAccepting });
    await expect(busy).toBeDisabled();
    await expect(busy).toHaveAttribute('aria-busy', 'true');
    await expect(cancel).toHaveCount(0);
    await assertGeometry(busy, 'Busy button', { x: 20, y: 724, width: 350, height: 52 });
    await compareFrame(page, `invite-busy-${theme}`);
  });
}

async function reachClaimPassword(page: Page, email: string): Promise<void> {
  await page.goto('/login');
  await ready(page);
  await page.getByRole('link', { name: en.auth.signupLink }).click();
  await expect(page).toHaveURL(/\/onboarding\/account/);
  await ready(page);
  await page.locator('#signup-email').fill(email);
  await page.getByLabel(en.auth.signupPasswordLabel).fill(password);
  await submitAndWaitForAuthDestination(page, /\/onboarding$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await ready(page);
  await page.getByLabel(en.onboarding.name).fill('Claim Visual');
  await page.getByLabel(en.onboarding.preciseLevel).fill('3.0');
  await page.getByRole('radio', { name: en.onboarding.sideEitherShort }).check();
  await page.getByRole('button', { name: en.onboarding.save }).click();
  await expect(page).toHaveURL(/\/onboarding\/community(\?.*)?$/);
  // The claim reset the password and the server still owes one: pending row + no stored password.
  await sql(`insert into public.provisional_claim_password_pending(user_id)
    select id from auth.users where email='${email}' on conflict do nothing`);
  await sql(`update auth.users set encrypted_password='' where email='${email}'`);
  await page.goto('/onboarding');
  await expect(
    page.getByRole('heading', { level: 1, name: en.auth.claim.passwordTitle })
  ).toBeVisible();
  await ready(page);
}

for (const theme of ['light', 'dark'] as const) {
  test(`claim password matches frames LzVgj, j6753 and uo9wF (${theme})`, async ({
    page,
    context
  }) => {
    test.setTimeout(120_000);
    await useTheme(context, theme);
    await page.setViewportSize(FRAME_VIEWPORT);
    await reachClaimPassword(
      page,
      `e2e-visual-claim-${theme}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`
    );

    const heading = page.getByRole('heading', { level: 1, name: en.auth.claim.passwordTitle });
    await expect(heading).toBeFocused();
    await assertTopBar(page, en.auth.claim.passwordBarTitle);
    await assertGeometry(heading, 'Title', { x: 20, y: 60, width: 350, height: 32 });
    const first = page.locator('#claim-password');
    const second = page.locator('#claim-password-confirmation');
    for (const [input, name] of [
      [first, 'New password input'],
      [second, 'Confirm password input']
    ] as const) {
      await assertGeometry(input, name, { x: 20, width: 350, height: 52 });
    }
    const strength = page.locator('[data-strength]');
    await expect(strength).toHaveAttribute('data-strength', 'empty');
    await expect(strength).toHaveText(en.auth.passwordStrengthEmpty);
    const segments = strength.locator('xpath=../following-sibling::div/span');
    await expect(segments).toHaveCount(4);
    for (let index = 0; index < 4; index += 1)
      await assertGeometry(segments.nth(index), `Strength segment ${index + 1}`, {
        width: 84.5,
        height: 4
      });
    const submit = page.getByRole('button', { name: en.auth.resetSubmit });
    await assertActionBar(page.locator('main form > div').last(), 88);
    await assertGeometry(submit, 'Continue button', { x: 20, y: 724, width: 350, height: 52 });
    await assertNoTextTransform([submit]);
    await compareFrame(page, `claim-password-${theme}`);
    await assertResponsive(page);

    // Strong (j6753): both rules met, policy satisfied.
    await first.fill('Claim-pass-9');
    await second.fill('Claim-pass-9');
    await expect(strength).toHaveAttribute('data-strength', 'strong');
    await expect(strength).toHaveText(en.auth.passwordStrengthStrong);
    await compareFrame(page, `claim-password-strong-${theme}`);

    // Error (uo9wF): a valid password with a different confirmation reports the mismatch inline.
    await second.fill('Claim-pass');
    await submit.click();
    await expect(page.getByText(en.auth.resetMismatch)).toBeVisible();
    await expect(second).toHaveAttribute('aria-invalid', 'true');
    await compareFrame(page, `claim-password-error-${theme}`);
  });
}
