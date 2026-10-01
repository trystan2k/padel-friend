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
    welcomeTitle: string;
    accountTitle: string;
  };
  onboarding: {
    title: string;
    levelHelp: string;
    level: string;
    levelScale: string;
    advanced: string;
  };
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
  // wzWLt coordinates relative to its 390×844 frame (not the canvas origin).
  await assertGeometry(page.locator('main > header'), 'Welcome header', {
    x: 18,
    y: 24,
    width: 354
  });
  await assertGeometry(page.getByRole('button', { name: en.signInWithGoogle }), 'Google CTA', {
    x: 18,
    width: 354,
    height: 50
  });
  await assertGeometry(page.locator('#login-email'), 'Welcome email input', {
    x: 18,
    y: 421,
    width: 354,
    height: 44
  });
  await assertGeometry(page.locator('#login-password'), 'Welcome password input', {
    x: 18,
    y: 500,
    width: 354,
    height: 44
  });
  await assertGeometry(page.getByRole('button', { name: en.auth.loginSubmit }), 'Login CTA', {
    x: 18,
    y: 558,
    width: 354,
    height: 50
  });
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
  // CLI 0.3.10 reference: 8702/329160 = 2.6437%; 2.75% cap leaves 0.1063pp margin.
  await compare(page, 'login-welcome.png', 0.0275);
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
  // PdRtP frame coordinates: badge, hero, card stack, chips and CTA.
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
  await assertGeometry(page.locator('form > div').nth(2), 'Preferred side card', {
    x: 18,
    y: 459,
    width: 354,
    height: 92
  });
  await assertGeometry(page.locator('form button[type="submit"]'), 'Save profile CTA', {
    x: 18,
    y: 682,
    width: 354,
    height: 44
  });
  // Native 0.1-step slider maps 3.0 to 3/7 of the track (Pencil places 3.0 near its center).
  // Centered choices and $bg thumb stroke: CLI 0.3.10 measured 9740/329160 = 2.9590%; 3.06% cap leaves 0.1010pp margin.
  await compare(page, 'player-setup.png', 0.0306, true);
});
