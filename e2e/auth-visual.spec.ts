import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

import { readFileSync } from 'node:fs';
import { waitForHydratedPage, submitAndWaitForAuthDestination } from './auth-helpers';
import { deriveMaskedPng, type PngMaskRectangle } from './png-mask';

type MaskRectangle = PngMaskRectangle;
type VisualManifest = {
  approvedReferences: Record<string, { sha256: string }>;
  screenshotBaselines: Record<string, { sha256: string }>;
  playerSampleDataMask: { maskColor: string; rectangles: MaskRectangle[] };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isReferenceMap(value: unknown): value is Record<string, { sha256: string }> {
  return (
    isRecord(value) &&
    Object.values(value).every(
      (reference) => isRecord(reference) && typeof reference.sha256 === 'string'
    )
  );
}

function isMaskRectangle(value: unknown): value is MaskRectangle {
  return (
    isRecord(value) &&
    typeof value.name === 'string' &&
    typeof value.x === 'number' &&
    typeof value.y === 'number' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number'
  );
}

function isVisualManifest(value: unknown): value is VisualManifest {
  if (!isRecord(value) || !isRecord(value.playerSampleDataMask)) return false;
  const mask = value.playerSampleDataMask;
  return (
    isReferenceMap(value.approvedReferences) &&
    isReferenceMap(value.screenshotBaselines) &&
    typeof mask.maskColor === 'string' &&
    Array.isArray(mask.rectangles) &&
    mask.rectangles.every(isMaskRectangle)
  );
}

const rawManifest: unknown = JSON.parse(
  readFileSync(new URL('./references/paf-1/manifest.json', import.meta.url), 'utf8')
);
if (!isVisualManifest(rawManifest)) throw new Error('Invalid PAF-1 visual provenance manifest');
const visualManifest = rawManifest;

type LocaleCopy = {
  signInWithGoogle: string;
  auth: {
    accountIntro: string;
    signupSubmit: string;
    signupLink: string;
    emailAddress: string;
    signupPasswordLabel: string;
    loginSubmit: string;
    forgotLink: string;
    welcomeTitle: string;
    accountTitle: string;
    forgotTitle: string;
    forgotEmailNote: string;
    forgotSubmit: string;
    backToSignIn: string;
    inboxNoticeTitle: string;
    inboxNoticeCopy: string;
    loginEmailLabel: string;
    loginEmailPlaceholder: string;
    loginPasswordLabel: string;
    loginPasswordPlaceholder: string;
    or: string;
    accountPrompt: string;
    resetTitle: string;
    resetNewPasswordLabel: string;
    resetConfirmPasswordLabel: string;
    resetRequirements: string;
    resetSubmit: string;
  };
  onboarding: {
    title: string;
    levelHelp: string;
    level: string;
    levelScale: string;
    advanced: string;
    handPreferNot: string;
  };
  profile: { dominantHand: string };
};

const en: LocaleCopy = JSON.parse(
  readFileSync(new URL('../src/locales/en/translation.json', import.meta.url), 'utf8')
);

const baseURL = 'http://127.0.0.1:4173';
const password = 'Password123!';

test.use({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  colorScheme: 'light',
  locale: 'en-US',
  serviceWorkers: 'block'
});

async function ready(page: Page): Promise<void> {
  await waitForHydratedPage(page);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, async (image) => {
        if (!image.complete) await image.decode();
      })
    );
  });
  const fonts = await page.evaluate(() => ({
    inter: document.fonts.check('400 12px Inter') && document.fonts.check('600 12px Inter'),
    manrope: document.fonts.check('700 24px Manrope')
  }));
  expect(fonts, 'Inter and Manrope must be available before screenshot').toEqual({
    inter: true,
    manrope: true
  });
}

function digestBuffer(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function digest(path: URL): string {
  return digestBuffer(readFileSync(path));
}

function assertApprovedReferenceDigests(): void {
  for (const [reference, approved] of Object.entries(visualManifest.approvedReferences)) {
    const path = new URL(`./references/paf-1/${reference}`, import.meta.url);
    expect(digest(path), `${reference} must match its reviewed PAF-1 digest`).toBe(approved.sha256);
  }
}

test.beforeAll(() => assertApprovedReferenceDigests());

function assertReferenceProvenance(reference: string, maskSampleData = false): void {
  const baseline = new URL(`./auth-visual.spec.ts-snapshots/${reference}`, import.meta.url);
  const design = new URL(`./references/paf-1/${reference}`, import.meta.url);
  const baselineApproval = visualManifest.screenshotBaselines[reference];
  if (!baselineApproval) throw new Error(`Missing reviewed screenshot baseline for ${reference}`);
  const source = readFileSync(design);
  const expected = maskSampleData
    ? deriveMaskedPng(source, visualManifest.playerSampleDataMask)
    : source;

  expect(digestBuffer(expected), `${reference} expected baseline derivation must stay pinned`).toBe(
    baselineApproval.sha256
  );
  expect(
    digest(baseline),
    `${reference} baseline must match its reviewed reference derivation`
  ).toBe(baselineApproval.sha256);
  if (maskSampleData)
    expect(
      readFileSync(baseline),
      `${reference} baseline must be the masked approved reference`
    ).toEqual(expected);
}

type Geometry = { x?: number; y?: number; width?: number; height?: number };

async function assertGeometry(locator: Locator, name: string, design: Geometry): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${name} must be rendered`).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const expected = design[key];
    if (expected === undefined) continue;
    expect(
      Math.abs(box![key] - expected),
      `${name} ${key}: Pencil ${expected}px, actual ${box![key]}px`
    ).toBeLessThanOrEqual(1);
  }
}

async function compare(
  page: Page,
  reference: string,
  maxDiffPixelRatio: number,
  maskSampleData = false
): Promise<void> {
  assertReferenceProvenance(reference, maskSampleData);
  if (maskSampleData) {
    // PAF-21 mask rectangles are sourced from the reviewed manifest and applied to both images.
    await page.evaluate(({ rectangles }) => {
      for (const { name, x, y, width, height } of rectangles) {
        const mask = document.createElement('div');
        mask.dataset.visualMask = name;
        Object.assign(mask.style, {
          position: 'fixed',
          left: `${x}px`,
          top: `${y}px`,
          width: `${width}px`,
          height: `${height}px`,
          pointerEvents: 'none'
        });
        document.body.appendChild(mask);
      }
    }, visualManifest.playerSampleDataMask);
  }
  try {
    // Each budget follows its exported source frame; geometry probes guard against layout drift.
    await expect(page).toHaveScreenshot(reference, {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio,
      ...(maskSampleData && {
        mask: visualManifest.playerSampleDataMask.rectangles.map(({ name }) =>
          page.locator(`[data-visual-mask="${name}"]`)
        ),
        maskColor: visualManifest.playerSampleDataMask.maskColor
      })
    });
  } finally {
    // Detect --update-snapshots overwriting any reference-derived baseline.
    assertReferenceProvenance(reference, maskSampleData);
  }
}

test.beforeEach(async ({ page, context }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await context.addCookies([
    { name: 'locale', value: 'en', url: baseURL },
    { name: 'theme', value: 'light', url: baseURL }
  ]);
  await page.clock.setFixedTime(new Date('2026-09-30T12:00:00Z'));
});

test('auth destination fails on a 5xx without retrying', async ({ page }) => {
  const outageUrl = `${baseURL}/__e2e/auth?next=%2Fdashboard&case=server-error`;
  let attempts = 0;
  await page.route(outageUrl, async (route) => {
    attempts += 1;
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'service unavailable' })
    });
  });

  await expect(
    submitAndWaitForAuthDestination(page, new RegExp('__e2e/auth'), async () => {
      await page.goto(outageUrl);
    })
  ).rejects.toThrow('Auth destination returned 500');
  expect(attempts).toBe(1);
});

async function inspectNativeCredentialForm(
  page: Page,
  pathname: string,
  emailSelector: string,
  passwordSelector: string,
  submitName: string
): Promise<void> {
  await page.goto(pathname);
  await expect(page.locator(emailSelector)).toBeDisabled();
  await expect(page.locator(passwordSelector)).toBeDisabled();
  await expect(page.getByRole('button', { name: submitName })).toBeDisabled();

  const formState = await page.locator('form').evaluate((element) => {
    if (!(element instanceof HTMLFormElement)) throw new Error('expected a native form');
    const controls = Array.from(element.querySelectorAll<HTMLInputElement>('input[name]'));
    for (const control of controls) {
      control.value = control.name === 'email' ? 'credential-leak@example.test' : 'secret-password';
    }
    return {
      method: element.method,
      fields: controls.map((control) => ({ name: control.name, disabled: control.disabled })),
      submittedKeys: Array.from(new FormData(element).keys())
    };
  });
  expect(formState.method).toBe('get');
  expect(formState.fields.every(({ disabled }) => disabled)).toBe(true);
  expect(formState.submittedKeys).toEqual([]);

  await Promise.all([
    page.waitForNavigation({ waitUntil: 'domcontentloaded' }),
    page.locator('form').evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) throw new Error('expected a native form');
      element.requestSubmit();
    })
  ]);
  const submittedUrl = new URL(page.url());
  expect(submittedUrl.pathname).toBe(pathname);
  expect(submittedUrl.searchParams.has('email')).toBe(false);
  expect(submittedUrl.searchParams.has('password')).toBe(false);
  expect(submittedUrl.href).not.toContain('credential-leak@example.test');
  expect(submittedUrl.href).not.toContain('secret-password');
}

test('SSR login and signup forms cannot put credentials in a native GET without JavaScript', async ({
  browser
}) => {
  const context = await browser.newContext({ baseURL, javaScriptEnabled: false });
  const page = await context.newPage();
  try {
    await inspectNativeCredentialForm(
      page,
      '/login',
      'input[name="email"]',
      'input[name="password"]',
      en.auth.loginSubmit
    );
    await inspectNativeCredentialForm(
      page,
      '/onboarding/account',
      'input[name="email"]',
      'input[name="password"]',
      en.auth.signupSubmit
    );
  } finally {
    await context.close();
  }
});

test('Welcome credentials stay inert while application scripts are delayed', async ({
  browser
}) => {
  const context = await browser.newContext({ baseURL, viewport: { width: 390, height: 844 } });
  let releaseScripts: () => void = () => {};
  const scripts = new Promise<void>((resolve) => {
    releaseScripts = resolve;
  });
  await context.route('**/*.js', async (route) => {
    await scripts;
    await route.continue();
  });
  const page = await context.newPage();

  try {
    await page.goto('/login', { waitUntil: 'commit' });
    await page.waitForSelector('input[name="email"]');
    await expect(page.locator('input[name="email"]')).toBeDisabled();
    await expect(page.locator('input[name="password"]')).toBeDisabled();
    await expect(page.getByRole('button', { name: en.auth.loginSubmit })).toBeDisabled();
    const submittedKeys = await page.locator('form').evaluate((element) => {
      if (!(element instanceof HTMLFormElement)) throw new Error('expected a native form');
      const controls = Array.from(element.querySelectorAll<HTMLInputElement>('input[name]'));
      for (const control of controls) {
        control.value =
          control.name === 'email' ? 'credential-leak@example.test' : 'secret-password';
      }
      return Array.from(new FormData(element).keys());
    });
    expect(submittedKeys).toEqual([]);
    await Promise.all([
      page.waitForNavigation({ waitUntil: 'commit' }),
      page.locator('form').evaluate((element) => {
        if (!(element instanceof HTMLFormElement)) throw new Error('expected a native form');
        element.requestSubmit();
      })
    ]);
    const submittedUrl = new URL(page.url());
    expect(submittedUrl.pathname).toBe('/login');
    expect(submittedUrl.searchParams.has('email')).toBe(false);
    expect(submittedUrl.searchParams.has('password')).toBe(false);
    expect(submittedUrl.href).not.toContain('credential-leak@example.test');
    expect(submittedUrl.href).not.toContain('secret-password');
  } finally {
    releaseScripts();
    await context.close();
  }
});

test('Welcome matches frame wzWLt', async ({ page }) => {
  await page.goto('/login');
  await expect(page.getByRole('heading', { name: en.auth.welcomeTitle })).toBeVisible();
  await ready(page);
  // Independent measurements from the approved 390×844 PNG: header ink y28–108, Google outline
  // y130–181, field contours y242–287 / y321–366, forgot-link ink y383–394, CTA fill y409–458,
  // and signup ink y482–492. Probe boxes below map those painted bounds back to element frames.
  await assertGeometry(page.locator('main > header'), 'Welcome header', {
    x: 18,
    y: 24,
    width: 354,
    height: 87
  });
  const googleButton = page.getByRole('button', { name: en.signInWithGoogle });
  await assertGeometry(googleButton, 'Google CTA', {
    x: 18,
    y: 131,
    width: 354,
    height: 50
  });
  await assertGeometry(page.locator('#login-email'), 'Welcome email input', {
    x: 18,
    y: 243,
    width: 354,
    height: 44
  });
  await assertGeometry(page.locator('#login-password'), 'Welcome password input', {
    x: 18,
    y: 322,
    width: 354,
    height: 44
  });
  const forgotLink = page.getByRole('link', { name: en.auth.forgotLink });
  await assertGeometry(forgotLink.locator('..'), 'Forgot password row', {
    x: 18,
    y: 380,
    width: 354,
    height: 15
  });
  await assertGeometry(page.getByRole('button', { name: en.auth.loginSubmit }), 'Login CTA', {
    x: 18,
    y: 409,
    width: 354,
    height: 50
  });
  await assertGeometry(page.locator('main > div:last-child'), 'Sign-up prompt container', {
    x: 18,
    y: 479,
    width: 354,
    height: 15
  });
  const effectiveTarget = await forgotLink.evaluate((link) => {
    const hitArea = getComputedStyle(link, '::before');
    return {
      width: Number.parseFloat(hitArea.width),
      height: Number.parseFloat(hitArea.height),
      position: getComputedStyle(link).position
    };
  });
  expect(effectiveTarget.width).toBeGreaterThanOrEqual(44);
  expect(effectiveTarget.height).toBe(44);
  expect(effectiveTarget.position).toBe('relative');

  await googleButton.focus();
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await page.keyboard.press('Tab');
  await expect(forgotLink).toBeFocused();
  const focusRing = await forgotLink.evaluate((link) => {
    const style = getComputedStyle(link);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  expect(focusRing).toEqual({ outlineStyle: 'solid', outlineWidth: '2px' });
  await forgotLink.evaluate((link) => link.blur());

  const googleOverrides = await page
    .getByRole('button', { name: en.signInWithGoogle })
    .evaluate((button) => ({
      gap: getComputedStyle(button).gap,
      fontWeight: getComputedStyle(button).fontWeight,
      markColor: getComputedStyle(button.querySelector('span')!).color
    }));
  expect(googleOverrides).toEqual({
    gap: '8px',
    fontWeight: '700',
    markColor: 'rgb(18, 37, 29)'
  });
  expect(
    await page.locator('#login-email').evaluate((input) => getComputedStyle(input).fontSize)
  ).toBe('14px');
  expect(
    await page
      .getByRole('button', { name: en.auth.loginSubmit })
      .evaluate((button) => getComputedStyle(button).fontSize)
  ).toBe('13px');
  // CLI 0.3.10 measured: 6077/329160 = 1.8462%; 1.95% cap leaves 0.1038pp margin.
  await compare(page, 'login-welcome.png', 0.0195);
});

test('account matches approved password adaptation of EGb2g', async ({ page }) => {
  await page.goto('/onboarding/account');
  await expect(page.getByRole('heading', { name: en.auth.accountTitle })).toBeVisible();
  await ready(page);
  // EGb2g badge/header/hero/email bounds; password/CTA from approved adaptation.
  await assertGeometry(page.locator('main > span').first(), 'Account step badge', {
    x: 18,
    y: 18,
    height: 25
  });
  await assertGeometry(
    page.getByRole('heading', { name: en.auth.accountTitle }).locator('..'),
    'Account header',
    {
      x: 18,
      y: 55,
      width: 354
    }
  );
  await assertGeometry(
    page.getByRole('heading', { name: en.auth.accountIntro }).locator('..'),
    'Account hero',
    {
      x: 18,
      y: 116,
      width: 354,
      height: 100
    }
  );
  await assertGeometry(page.locator('main form > div').first(), 'Account form card', {
    x: 18,
    y: 230,
    width: 354,
    height: 188
  });
  const emailControl = page.locator('#signup-email');
  await assertGeometry(emailControl, 'Account email control', {
    x: 32,
    y: 265,
    height: 44
  });
  await emailControl.focus();
  await expect(emailControl).toBeFocused();
  await emailControl.evaluate((input) => input instanceof HTMLInputElement && input.blur());
  await assertGeometry(page.locator('#signup-password'), 'Account password hit target', {
    y: 339,
    height: 44
  });
  const accountCard = page.locator('main form > div').first();
  expect(await accountCard.evaluate((card) => getComputedStyle(card).gap)).toBe('9px');
  const accountHero = page.locator('main > div').first();
  expect(await accountHero.evaluate((hero) => getComputedStyle(hero).marginTop)).toBe('-2px');
  expect(await accountHero.evaluate((hero) => getComputedStyle(hero).color)).toBe(
    'rgb(255, 255, 255)'
  );
  // CLI 0.3.10 reference: 9779/329160 = 2.9709%; 3.08% cap leaves 0.1091pp margin.
  await compare(page, 'account-adapted.png', 0.0308);
});

test('incomplete authenticated player setup matches frame PdRtP', async ({ page }) => {
  // Same real Supabase signup/onboarding gate as e2e/onboarding.spec.ts; generated
  // identity stays out of screenshot (player form never displays auth email).
  await page.goto('/login');
  await ready(page);
  await page.getByRole('link', { name: en.auth.signupLink }).click();
  await expect(page).toHaveURL(/\/onboarding\/account/);
  await ready(page);
  const signupEmail = page.locator('#signup-email');
  await expect(signupEmail).toBeEnabled();
  const email = `e2e-visual-${Date.now()}-${Math.random().toString(36).slice(2)}@test.local`;
  await signupEmail.fill(email);
  await page.getByLabel(en.auth.signupPasswordLabel).fill(password);
  await submitAndWaitForAuthDestination(page, /\/onboarding$/, () =>
    page.getByRole('button', { name: en.auth.signupSubmit }).click()
  );
  await ready(page);
  await expect(page.getByRole('heading', { name: en.onboarding.title })).toBeVisible();
  await expect(page.getByRole('group', { name: en.profile.dominantHand })).toBeVisible();
  await expect(page.getByRole('radio', { name: en.onboarding.handPreferNot })).toBeChecked();
  // PdRtP frame coordinates: badge, hero, card stack, hand row and CTA.
  await assertGeometry(
    page.locator('main > div').first().locator('span').first(),
    'Player step badge',
    {
      x: 18,
      y: 18,
      height: 25
    }
  );
  await assertGeometry(
    page.getByRole('heading', { name: en.onboarding.levelHelp }).locator('..'),
    'Player hero',
    {
      x: 18,
      y: 116,
      width: 354,
      height: 97
    }
  );
  await assertGeometry(page.locator('form > div').first(), 'Display name field', {
    x: 18,
    y: 225,
    width: 354,
    height: 65
  });
  await assertGeometry(page.locator('#player-name'), 'Display name control', {
    x: 18,
    y: 246,
    width: 354,
    height: 44
  });
  await assertGeometry(page.locator('form > div').nth(1), 'Starting level card', {
    x: 18,
    y: 302,
    width: 354,
    height: 145
  });
  await assertGeometry(
    page.getByText(en.onboarding.level, { exact: true }),
    'Level heading label',
    {
      x: 32,
      y: 316
    }
  );
  const advancedCaption = page.getByText(en.onboarding.advanced, { exact: true });
  await assertGeometry(advancedCaption.locator('..'), 'Scale caption row', {
    x: 32,
    y: 419,
    width: 264
  });
  await assertGeometry(advancedCaption, 'Advanced caption inset', { x: 228, y: 419 });
  await assertGeometry(
    page.getByRole('slider', { name: en.onboarding.levelScale }),
    'Level slider hit target',
    {
      x: 32,
      width: 326,
      height: 44
    }
  );
  await assertGeometry(page.locator('form > div').nth(2), 'Preferred side and hand card', {
    x: 18,
    y: 459,
    width: 354,
    height: 170
  });
  await assertGeometry(page.locator('#player-hand-options'), 'Dominant hand options row', {
    x: 32,
    y: 571,
    width: 326,
    height: 44
  });
  await assertGeometry(page.locator('form button[type="submit"]'), 'Save profile CTA', {
    x: 18,
    y: 761,
    width: 354,
    height: 44
  });
  // Native 0.1-step slider maps 3.0 to 3/7 of the track (Pencil places 3.0 near its center).
  // Updated PdRtP at threshold 0.1: 7342/329160 = 2.2304%; 2.33% cap leaves 0.0996pp margin.
  await compare(page, 'player-setup.png', 0.0233, true);
});

test('forgot password matches frame ieoni', async ({ page }) => {
  await page.goto('/forgot-password');
  await expect(page.getByRole('heading', { name: en.auth.forgotTitle })).toBeVisible();
  await ready(page);

  // Reference PNG measurements: field outline x18–371/y166–211; note ink y227–239;
  // CTA fill x18–371/y254–303; back-link ink x144–244/y327–336.
  await assertGeometry(page.locator('main > header'), 'Forgot-password header', {
    x: 18,
    y: 24,
    width: 354,
    height: 103
  });
  await assertGeometry(page.locator('#forgot-email'), 'Forgot-password email field', {
    x: 18,
    y: 167,
    width: 354,
    height: 44
  });
  await assertGeometry(page.getByText(en.auth.forgotEmailNote, { exact: true }), 'Privacy note', {
    x: 18,
    y: 226,
    width: 354,
    height: 15
  });
  await assertGeometry(page.getByRole('button', { name: en.auth.forgotSubmit }), 'Reset-link CTA', {
    x: 18,
    y: 254,
    width: 354,
    height: 50
  });
  await assertGeometry(page.getByRole('link', { name: en.auth.backToSignIn }), 'Back link', {
    x: 144,
    y: 325,
    width: 102,
    height: 44
  });
  // CLI 0.3.10 measured: 5938/329160 = 1.8040%; 1.90% cap leaves 0.0960pp margin.
  await compare(page, 'forgot-password.png', 0.019);
});

test('login inbox matches frame FZlHy', async ({ page }) => {
  await page.goto('/login?reset=sent');
  await expect(page.getByRole('heading', { name: en.auth.inboxNoticeTitle })).toBeVisible();
  await ready(page);

  // FZlHy pixel measurements: header ends at the y111 frame line; notice fill spans
  // y131–204; Google border y224–275; divider ink y292–299; email/password outlines
  // y336–381/y415–460; forgot ink y477–488; login fill y503–552; sign-up ink y576–586.
  await assertGeometry(page.locator('main > header'), 'Inbox header', {
    x: 18,
    y: 24,
    width: 354,
    height: 87
  });
  await assertGeometry(page.locator('main > output'), 'Inbox notice card', {
    x: 18,
    y: 131,
    width: 354,
    height: 74
  });
  await assertGeometry(
    page.getByRole('button', { name: en.signInWithGoogle }),
    'Inbox Google button',
    { x: 18, y: 225, width: 354, height: 50 }
  );
  await assertGeometry(page.getByText(en.auth.or, { exact: true }).locator('..'), 'Divider row', {
    x: 18,
    y: 289,
    width: 354,
    height: 15
  });
  await assertGeometry(page.locator('#login-email'), 'Inbox email field', {
    x: 18,
    y: 337,
    width: 354,
    height: 44
  });
  await assertGeometry(page.locator('#login-password'), 'Inbox password field', {
    x: 18,
    y: 416,
    width: 354,
    height: 44
  });
  await assertGeometry(
    page.getByRole('link', { name: en.auth.forgotLink }).locator('..'),
    'Inbox forgot-link row',
    { x: 18, y: 475, width: 354, height: 15 }
  );
  await assertGeometry(page.getByRole('button', { name: en.auth.loginSubmit }), 'Inbox login CTA', {
    x: 18,
    y: 503,
    width: 354,
    height: 50
  });
  await assertGeometry(
    page.getByText(en.auth.accountPrompt, { exact: false }).locator('..'),
    'Sign-up prompt',
    { x: 18, y: 574, width: 354, height: 15 }
  );
  // CLI 0.3.10 measured: 7734/329160 = 2.3496%; 2.45% cap leaves 0.1004pp margin.
  await compare(page, 'login-inbox.png', 0.0245);
});

test('create new password matches frame ZthyR with an authenticated session', async ({ page }) => {
  const email = `e2e-visual-reset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
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

  await page.goto('/reset-password');
  await expect(page.getByRole('heading', { name: en.auth.resetTitle })).toBeVisible();
  await ready(page);
  // ZthyR measured from the PNG: new-password outline y149–194; confirmation y228–273;
  // requirements ink y290–299; update button fill y316–365.
  await assertGeometry(page.locator('main > header'), 'Reset-password header', {
    x: 18,
    y: 24,
    width: 354,
    height: 87
  });
  await assertGeometry(page.locator('#reset-password'), 'New password field', {
    x: 18,
    y: 150,
    width: 354,
    height: 44
  });
  await assertGeometry(page.locator('#reset-password-confirmation'), 'Confirm password field', {
    x: 18,
    y: 229,
    width: 354,
    height: 44
  });
  await assertGeometry(
    page.locator('#reset-password-confirmation-helper'),
    'Password requirements helper',
    { x: 18, y: 288, width: 354, height: 15 }
  );
  await assertGeometry(page.getByRole('button', { name: en.auth.resetSubmit }), 'Update CTA', {
    x: 18,
    y: 316,
    width: 354,
    height: 50
  });
  // CLI 0.3.10 measured: 7201/329160 = 2.1877%; 2.29% cap leaves 0.1023pp margin.
  await compare(page, 'reset-password.png', 0.0229);
});
