import { expect, test, type Locator, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';

import { readFileSync } from 'node:fs';
import es from '../src/locales/es/translation.json' with { type: 'json' };
import ptBR from '../src/locales/pt-BR/translation.json' with { type: 'json' };
import { waitForHydratedPage, submitAndWaitForAuthDestination } from './auth-helpers';
import {
  authLogoMask,
  deriveCroppedTopPng,
  deriveMaskedPng,
  type PngMaskRectangle
} from './png-mask';

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

// Clubhouse auth frames (PAF-202 U6): wzWLt, EGb2g, ieoni, FZlHy, ZthyR from
// docs/design/padel-friend-clubhouse.pen, committed unchanged under references/paf-202-auth and
// pinned by SHA-256 in the manifest. The pen frame is 390×844 with a 44px OS status bar the app
// never draws, so each baseline is the export minus those rows (deriveCroppedTopPng) and every
// screenshot is taken at 390×800. Baselines are derived from the exports, never regenerated from
// Chromium: never run this spec with --update-snapshots for the five frames below.
type AuthFrame = {
  frameId: string;
  width: number;
  height: number;
  source: string;
  sourceSha256: string;
  baselineSha256: string;
  maxDiffPixelRatio: number;
};
const STATUS_BAR = 44;

function isAuthFrame(value: unknown): value is AuthFrame {
  return (
    isRecord(value) &&
    typeof value.frameId === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    typeof value.source === 'string' &&
    typeof value.sourceSha256 === 'string' &&
    typeof value.baselineSha256 === 'string' &&
    typeof value.maxDiffPixelRatio === 'number'
  );
}

const rawAuthManifest: unknown = JSON.parse(
  readFileSync(new URL('./references/paf-202-auth/manifest.json', import.meta.url), 'utf8')
);
if (!isRecord(rawAuthManifest) || !isRecord(rawAuthManifest.frames))
  throw new Error('Invalid PAF-202 auth visual provenance manifest');
const authFrames: Record<string, AuthFrame> = {};
for (const [name, frame] of Object.entries(rawAuthManifest.frames)) {
  if (!isAuthFrame(frame)) throw new Error(`Invalid PAF-202 auth frame ${name}`);
  authFrames[name] = frame;
}

type LocaleCopy = {
  signInWithGoogle: string;
  auth: {
    back: string;
    accountBarTitle: string;
    accountStep: string;
    accountTitle: string;
    accountSubtitle: string;
    emailAddress: string;
    signupPasswordLabel: string;
    signupSubmit: string;
    signupLink: string;
    profileFollows: string;
    loginSubmit: string;
    forgotLink: string;
    loginBrand: string;
    welcomeTitle: string;
    welcomeSubtitle: string;
    forgotBarTitle: string;
    forgotTitle: string;
    forgotDescription: string;
    forgotEmailNote: string;
    forgotSubmit: string;
    backToSignIn: string;
    inboxNoticeCopy: string;
    loginEmailLabel: string;
    loginPasswordLabel: string;
    or: string;
    accountPrompt: string;
    resetBarTitle: string;
    resetTitle: string;
    resetNewPasswordLabel: string;
    resetConfirmPasswordLabel: string;
    resetRuleMatch: string;
    resetSubmit: string;
  };
  onboarding: {
    title: string;
    avatarLabel: string;
    avatarSkip: string;
    levelHelp: string;
    level: string;
    levelScale: string;
    advanced: string;
    handPreferNot: string;
  };
  profile: { dominantHand: string; bio: string; availabilityDaysLegend: string };
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
    await Promise.all(
      ['400', '500', '600', '700', '800'].map((weight) =>
        document.fonts.load(`${weight} 16px Figtree`)
      )
    );
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, async (image) => {
        if (!image.complete) await image.decode();
      })
    );
  });
  const fonts = await page.evaluate(() => ({
    figtree: ['400', '600', '700', '800'].every((weight) =>
      document.fonts.check(`${weight} 16px Figtree`)
    )
  }));
  expect(fonts, 'Figtree must be available before screenshot').toEqual({ figtree: true });
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

// Tolerance evidence (PAF-202 U6). The five Clubhouse auth frames are compared against exports of
// the new Figtree/Clubhouse design, so the earlier Inter/Manrope-era PAF-1 baselines and their
// budgets are retired: both the redesign (new structure, 52px controls, sticky action bar, top
// bar) and the font swap (Figtree metrics) invalidate them. Per-frame allowances now live in
// references/paf-202-auth/manifest.json next to their measured residuals and are read by
// compareFrame(). Budgets only absorb Pencil-vs-Chromium glyph rasterization (fractional text
// placement, 1.5px stroke antialiasing); structure is gated by the exact geometry probes below,
// never by these allowances, and a budget is never raised to hide a layout defect.
//
// Legacy PdRtP (player setup) keeps its PAF-1 reference until U7 (PAF-212) re-exports it.
type VisualReference = 'player-setup.png';

const VISUAL_BUDGETS: Record<VisualReference, number> = {
  // macOS 7,342/329,160 = 2.2304%; Linux 12,420/329,160 = 3.7730% → 3.92% (margin 0.1500pp).
  'player-setup.png': 0.0392
};

// Transitional screenshot only: until U7 (PAF-212) migrates player setup, this Chromium golden
// captures its existing composition with inherited Figtree / SurfaceCard / control styles. Its
// legacy PAF-1 export and probes remain pinned but are not Clubhouse evidence. The original 2.5%
// cross-platform screenshot budget is unchanged; avatar/card order, padding and targets still
// have their own structural probes.
const PHASE2_VISUAL_BUDGETS = {
  'player-setup-phase2.png': 0.025
} as const;

async function comparePhase2(page: Page, name: keyof typeof PHASE2_VISUAL_BUDGETS): Promise<void> {
  await expect(page).toHaveScreenshot(name, {
    animations: 'disabled',
    caret: 'hide',
    threshold: 0.1,
    maxDiffPixelRatio: PHASE2_VISUAL_BUDGETS[name]
  });
}

type Geometry = { x?: number; y?: number; width?: number; height?: number };

// Tolerance is ±1px per asserted axis by default: every probe measures CSS-driven layout boxes.
// Pass a per-axis map (e.g. { x: 2 }) only for glyph-metric-derived text edges, where font
// rasterizer differences between macOS and Linux legitimately move the box by 1–2px.
type GeometryTolerance = number | Partial<Record<keyof Geometry, number>>;

async function assertGeometry(
  locator: Locator,
  name: string,
  design: Geometry,
  tolerance: GeometryTolerance = 1
): Promise<void> {
  const box = await locator.boundingBox();
  expect(box, `${name} must be rendered`).not.toBeNull();
  for (const key of ['x', 'y', 'width', 'height'] as const) {
    const expected = design[key];
    if (expected === undefined) continue;
    const allowed = typeof tolerance === 'number' ? tolerance : (tolerance[key] ?? 1);
    expect(
      Math.abs(box![key] - expected),
      `${name} ${key}: Pencil ${expected}px, actual ${box![key]}px`
    ).toBeLessThanOrEqual(allowed);
  }
}

async function compare(
  page: Page,
  reference: VisualReference,
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
    // Each screen's cross-platform budget lives in VISUAL_BUDGETS; geometry probes guard layout.
    await expect(page).toHaveScreenshot(reference, {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: VISUAL_BUDGETS[reference],
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

function hasLogo(name: string): boolean {
  return name === 'login-welcome.png' || name === 'login-inbox.png';
}

function assertFrameProvenance(name: string): void {
  const frame = authFrames[name];
  if (!frame) throw new Error(`Missing PAF-202 auth frame ${name}`);
  const source = readFileSync(
    new URL(`./references/paf-202-auth/${frame.source}`, import.meta.url)
  );
  expect(digestBuffer(source), `${name} Pencil export must match its pinned digest`).toBe(
    frame.sourceSha256
  );
  const cropped = deriveCroppedTopPng(source, STATUS_BAR);
  const expected = hasLogo(name) ? deriveMaskedPng(cropped, authLogoMask) : cropped;
  expect(digestBuffer(expected), `${name} baseline derivation must stay pinned`).toBe(
    frame.baselineSha256
  );
  const baseline = readFileSync(
    new URL(`./auth-visual.spec.ts-snapshots/${name}`, import.meta.url)
  );
  expect(baseline.equals(expected), `${name} baseline must be the cropped Pencil export`).toBe(
    true
  );
}

test.beforeAll(() => {
  for (const name of Object.keys(authFrames)) assertFrameProvenance(name);
});

async function compareFrame(page: Page, name: string): Promise<void> {
  const frame = authFrames[name];
  if (!frame) throw new Error(`Missing PAF-202 auth frame ${name}`);
  expect(page.viewportSize(), `${name} must be captured at the frame viewport`).toEqual({
    width: frame.width,
    height: frame.height
  });
  try {
    await expect(page).toHaveScreenshot(name, {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: frame.maxDiffPixelRatio,
      ...(hasLogo(name) && { mask: [page.locator('main img')], maskColor: authLogoMask.maskColor })
    });
  } finally {
    // Detect --update-snapshots overwriting a reference-derived baseline.
    assertFrameProvenance(name);
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

// Clubhouse frame probes. Pencil coordinates are frame y minus the 44px status bar (not rendered),
// measured per node with Get() bounds on the committed frames; the page is captured at 390×800.
// Copy that wraps differently from the pen (D2 truthful copy: the real password policy is longer
// than the frame's "At least 8 characters") grows only the named block by one text line.
const FRAME_VIEWPORT = { width: 390, height: 800 };

async function openFrame(page: Page, pathname: string, heading: string): Promise<void> {
  await page.setViewportSize(FRAME_VIEWPORT);
  await page.goto(pathname);
  await expect(page.getByRole('heading', { name: heading })).toBeVisible();
  await ready(page);
}

async function assertControlFit(page: Page, width: number): Promise<void> {
  const layout = await page.locator('main').evaluate((main) => ({
    pageWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mainWidth: main.getBoundingClientRect().width,
    targets: [...main.querySelectorAll('a, button, input')].map((control) => {
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

for (const [locale, theme, width, copy] of [
  ['es', 'dark', 320, es.auth],
  ['pt-BR', 'light', 1280, ptBR.auth]
] as const) {
  test(`public auth keeps localized controls usable at ${width}px (${locale}, ${theme})`, async ({
    page,
    context
  }) => {
    await context.addCookies([
      { name: 'locale', value: locale, url: baseURL },
      { name: 'theme', value: theme, url: baseURL }
    ]);
    await page.setViewportSize({ width, height: 800 });
    for (const [route, title] of [
      ['/login', copy.welcomeTitle],
      ['/login?reset=sent', copy.welcomeTitle],
      ['/onboarding/account', copy.accountTitle],
      ['/forgot-password', copy.forgotTitle]
    ] as const) {
      const response = await page.goto(route);
      expect(response?.ok()).toBe(true);
      await ready(page);
      await expect(page.locator('html')).toHaveAttribute('lang', locale);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expect(page.getByRole('heading', { name: title, exact: true })).toBeVisible();
      await assertControlFit(page, width);
    }
  });
}

async function assertTopBar(page: Page, title: string, withBack: boolean): Promise<void> {
  const bar = page.locator('main > div').first();
  await assertGeometry(bar, 'Top bar', { x: 0, y: 0, width: 390, height: 56 });
  // The title is centered between the 48px back slot and the 72px action slot (center x 183, not
  // 195): its box spans x 56-310, exactly the frame's free space between the two slots.
  await assertGeometry(bar.locator('span', { hasText: title }).last(), 'Top bar title', {
    x: 56,
    y: 18,
    width: 254,
    height: 20
  });
  const back = page.getByRole('link', { name: en.auth.back, exact: true });
  if (withBack) {
    await assertGeometry(back, 'Back target', { x: 8, y: 4, width: 48, height: 48 });
    expect(await back.getAttribute('href')).toContain('/login');
  } else {
    await expect(back).toHaveCount(0);
  }
}

async function assertActionBar(
  page: Page,
  height: number,
  actions: Array<[Locator, string, Geometry]>
): Promise<void> {
  const bar = page.locator('main form > div').last();
  // Pencil rounds the 14px/1.45 note line (20.3px) to 20px, so the bar may differ by ±2px.
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
  for (const [locator, name, geometry] of actions) await assertGeometry(locator, name, geometry);
}

// The CSS uppercase transform is gone: copy is authored in sentence case, never transformed.
async function assertNoTextTransform(locators: Locator[]): Promise<void> {
  for (const locator of locators)
    expect(await locator.evaluate((element) => getComputedStyle(element).textTransform)).toBe(
      'none'
    );
}

test('Welcome matches frame wzWLt', async ({ page }) => {
  await openFrame(page, '/login', en.auth.welcomeTitle);
  const brandBlock = page.locator('main > div').first();
  await assertGeometry(brandBlock, 'Brand block', { x: 24, y: 28, width: 342, height: 94 });
  await assertGeometry(brandBlock.locator('img'), 'Brand tile', {
    x: 24,
    y: 28,
    width: 64,
    height: 64
  });
  await assertGeometry(page.getByText(en.auth.loginBrand, { exact: true }), 'Wordmark', {
    x: 24,
    y: 104,
    height: 18
  });
  await assertGeometry(page.getByRole('heading', { name: en.auth.welcomeTitle }), 'Title', {
    x: 24,
    y: 136,
    width: 342,
    height: 32
  });
  await assertGeometry(page.getByText(en.auth.welcomeSubtitle), 'Body', {
    x: 24,
    y: 182,
    width: 342,
    height: 23
  });
  await assertGeometry(page.locator('#login-email'), 'Email input', {
    x: 24,
    y: 243,
    width: 342,
    height: 52
  });
  await assertGeometry(page.locator('#login-password'), 'Password input', {
    x: 24,
    y: 333,
    width: 342,
    height: 52
  });
  const forgotLink = page.getByRole('link', { name: en.auth.forgotLink });
  // Repo mandate (AGENTS.md): touch targets are >=44px, stricter than the frame's 18px text row.
  // The row's negative block margin keeps every sibling at its frame position; only this row's own
  // box differs, centered on the frame's text row (y 399 + 9 = 408). x/width follow glyph advances.
  await assertGeometry(
    forgotLink,
    'Forgot link',
    { x: 241, y: 386, width: 125, height: 44 },
    { x: 2, width: 2 }
  );
  const loginButton = page.getByRole('button', { name: en.auth.loginSubmit });
  await assertGeometry(loginButton, 'Log in button', { x: 24, y: 431, width: 342, height: 52 });
  const orLabel = page.getByText(en.auth.or, { exact: true });
  await assertGeometry(orLabel.locator('..'), 'Divider row', {
    x: 24,
    y: 497,
    width: 342,
    height: 17
  });
  const google = page.getByRole('button', { name: en.signInWithGoogle });
  await assertGeometry(google, 'Google button', { x: 24, y: 528, width: 342, height: 52 });
  await assertGeometry(page.locator('main > div').last(), 'Sign-up row', {
    x: 24,
    y: 581, // frame 594 + 9 (text row center) - 22: the sign-up link row is a 44px target too
    width: 342,
    height: 44
  });

  const typography = await page.evaluate(() => {
    const read = (element: Element | null) => {
      if (!element) return null;
      const style = getComputedStyle(element);
      return { size: style.fontSize, weight: style.fontWeight, family: style.fontFamily };
    };
    return {
      title: read(document.querySelector('h1')),
      input: read(document.querySelector('#login-email')),
      button: read(document.querySelector('button[type="submit"]'))
    };
  });
  expect(typography.title).toMatchObject({ size: '28px', weight: '800' });
  expect(typography.title?.family).toContain('Figtree');
  expect(typography.input).toMatchObject({ size: '16px' });
  expect(typography.button).toMatchObject({ size: '16px', weight: '700' });
  await assertNoTextTransform([loginButton, google, orLabel]);

  // Keyboard order follows the frame: email, password, forgot link, Log in, Google, sign-up.
  await page.locator('#login-email').focus();
  for (const target of [
    page.locator('#login-password'),
    forgotLink,
    loginButton,
    google,
    page.getByRole('link', { name: en.auth.signupLink })
  ]) {
    await page.keyboard.press('Tab');
    await expect(target).toBeFocused();
  }
  await forgotLink.focus();
  const focusRing = await forgotLink.evaluate((link) => {
    const style = getComputedStyle(link);
    return { outlineStyle: style.outlineStyle, outlineWidth: style.outlineWidth };
  });
  // --focus-width token (3px), the unified Clubhouse control ring.
  expect(focusRing).toEqual({ outlineStyle: 'solid', outlineWidth: '3px' });
  await forgotLink.evaluate((link) => link.blur());
  const logo = brandBlock.locator('img');
  await expect(logo).toHaveAttribute('alt', '');
  const url = await logo.evaluate((image: HTMLImageElement) => image.currentSrc);
  const icon = await page.request.get(url);
  expect(icon.ok()).toBe(true);
  expect(digestBuffer(await icon.body())).toBe(
    digest(new URL('../docs/design/padel-friends-app-icon.png', import.meta.url))
  );
  await compareFrame(page, 'login-welcome.png');
});

test('account matches frame EGb2g', async ({ page }) => {
  await openFrame(page, '/onboarding/account', en.auth.accountTitle);
  await assertTopBar(page, en.auth.accountBarTitle, true);
  const progress = page.locator('main form > div > div[aria-hidden="true"]').first();
  await assertGeometry(progress, 'Progress', { x: 20, y: 60, width: 350, height: 6 });
  const segments = progress.locator('span');
  await expect(segments).toHaveCount(3);
  await assertGeometry(segments.nth(0), 'Progress segment 1', { x: 20, width: 112.7, height: 6 });
  await assertGeometry(segments.nth(2), 'Progress segment 3', {
    x: 257.3,
    width: 112.7,
    height: 6
  });
  await assertGeometry(page.getByText(en.auth.accountStep), 'Step label', {
    x: 20,
    y: 82,
    height: 17
  });
  await assertGeometry(page.getByRole('heading', { name: en.auth.accountTitle }), 'Title', {
    x: 20,
    y: 115,
    width: 350,
    height: 32
  });
  await assertGeometry(page.getByText(en.auth.accountSubtitle), 'Body', {
    x: 20,
    y: 163,
    width: 350,
    height: 46
  });
  await assertGeometry(page.locator('#signup-email'), 'Email input', {
    x: 20,
    y: 249,
    width: 350,
    height: 52
  });
  await assertGeometry(page.locator('#signup-password'), 'Password input', {
    x: 20,
    y: 341,
    width: 350,
    height: 52
  });
  // Frame Meta is one 20px line ("At least 8 characters"); the real policy
  // (auth.passwordRequirements) wraps to two lines at 390px, so the block is 40px.
  await assertGeometry(
    page.locator('#signup-password-helper'),
    'Password policy',
    { x: 20, y: 399, width: 350, height: 40 },
    { height: 2 }
  );
  const submit = page.getByRole('button', { name: en.auth.signupSubmit });
  await assertActionBar(page, 116, [
    [
      page.getByText(en.auth.profileFollows),
      'Hand-off note',
      { x: 20, y: 696, width: 350, height: 20 }
    ],
    [submit, 'Create account button', { x: 20, y: 724, width: 350, height: 52 }]
  ]);
  await assertNoTextTransform([submit]);
  await compareFrame(page, 'account-signup.png');
});

// U7 owns the Clubhouse migration for this legacy player-setup frame.
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
  // Phase-2 composition probes (structure first, then the reviewed current-layout snapshot).
  const avatarPicker = page.getByLabel(en.onboarding.avatarLabel);
  const avatarCard = page.locator('form > div').filter({ has: avatarPicker });
  const nameField = page.locator('form > div').first();
  const levelCard = page.locator('form > div').nth(2);
  const [nameBox, avatarBox, levelBox, ctaBox, pickerBox, skipBox] = await Promise.all([
    nameField.boundingBox(),
    avatarCard.boundingBox(),
    levelCard.boundingBox(),
    page.locator('form button[type="submit"]').boundingBox(),
    avatarPicker.boundingBox(),
    page.getByRole('button', { name: en.onboarding.avatarSkip }).boundingBox()
  ]);
  expect(avatarBox, 'avatar card must be rendered').not.toBeNull();
  // Form gap is 12px: avatar card directly after the display name, level card directly after it.
  expect(Math.abs(avatarBox!.y - (nameBox!.y + nameBox!.height + 12))).toBeLessThanOrEqual(1);
  expect(Math.abs(levelBox!.y - (avatarBox!.y + avatarBox!.height + 12))).toBeLessThanOrEqual(1);
  expect(avatarBox!.y + avatarBox!.height).toBeLessThan(ctaBox!.y);
  expect(avatarBox!.x).toBeCloseTo(18, 0);
  expect(avatarBox!.width).toBeCloseTo(354, 0);
  expect(pickerBox!.height).toBeGreaterThanOrEqual(44);
  expect(skipBox!.height).toBeGreaterThanOrEqual(44);
  expect(await avatarCard.evaluate((card) => getComputedStyle(card).gap)).toBe('9px');
  // Exact card + control geometry (PAF-25 F3): the screenshot budget below must never be the only
  // guard for card height or the picker/skip control boxes. Derived from existing roles/labels only.
  const avatarLabel = avatarCard.locator(`label[for="${await avatarPicker.getAttribute('id')}"]`);
  const avatarThumb = avatarCard.locator('span').first();
  const avatarBody = avatarLabel.locator('..');
  const [labelBox, thumbBox, bodyBox, cardPad] = await Promise.all([
    avatarLabel.boundingBox(),
    avatarThumb.boundingBox(),
    avatarBody.boundingBox(),
    avatarCard.evaluate((card) => {
      const style = getComputedStyle(card);
      return {
        top: parseFloat(style.paddingTop),
        bottom: parseFloat(style.paddingBottom),
        left: parseFloat(style.paddingLeft),
        right: parseFloat(style.paddingRight)
      };
    })
  ]);
  expect(labelBox, 'avatar label must be rendered').not.toBeNull();
  expect(thumbBox, 'avatar preview must be rendered').not.toBeNull();
  expect(bodyBox, 'avatar controls column must be rendered').not.toBeNull();
  // The inherited SurfaceCard now adds a 1px outline on every side.
  const border = await avatarCard.evaluate((card) => getComputedStyle(card).borderWidth);
  expect(border).toBe('1px');
  const avatarContentHeight = Math.max(thumbBox!.height, bodyBox!.height);
  expect(
    Math.abs(avatarBox!.height - (cardPad.top + cardPad.bottom + avatarContentHeight + 2))
  ).toBeLessThanOrEqual(1);
  // Independent ABSOLUTE bounds (PAF-25 F3-it2): the relational check above is self-referential, so
  // these come from design sources only (never from live child boxes). Tokens: card padding
  // --space-16 = 16px (32px vertical) + 2px border, column gap --space-9 = 9px (27px; label/
  // picker/help/skip), controls min-height --space-40 + --space-4 = 44px (plan A3/AC5), preview
  // avatar --space-40 + --space-16 = 56px, caption/label font --font-size-12 = 12px. Text lines
  // are bounded by line-height 1.1-1.5 x 12px = 13-18px: the label is 1 line, the help 1-3 lines.
  //   min = 34 + 27 + 13 (label) + 44 (picker) + 13 (help, 1 line) + 44 (skip) = 175px
  //   max = 34 + 27 + 18 (label) + 52 (picker, padding 12 + text) + 54 (help, 3 lines) + 52 (skip) = 237px
  // A growth in padding, gaps, or control heights beyond these bounds fails here even though the
  // relational check would still pass.
  const expectedCardMinHeight = 34 + 27 + 13 + 44 + 13 + 44;
  const expectedCardMaxHeight = 34 + 27 + 18 + 52 + 54 + 52;
  expect(avatarBox!.height, 'avatar card absolute min height').toBeGreaterThanOrEqual(
    expectedCardMinHeight
  );
  expect(avatarBox!.height, 'avatar card absolute max height').toBeLessThanOrEqual(
    expectedCardMaxHeight
  );
  expect(cardPad, 'avatar card padding is the 16px token on every side').toEqual({
    top: 16,
    bottom: 16,
    left: 16,
    right: 16
  });
  // Controls-column gap (PAF-25 F3-it3): onboardingAvatarBody is a flex column with gap
  // --space-9; the height window above could absorb ~30px of internal gap growth, so pin the
  // applied gap properties exactly (shorthand + both axes, flex-direction column).
  expect(
    await avatarBody.evaluate((body) => {
      const style = getComputedStyle(body);
      return {
        display: style.display,
        flexDirection: style.flexDirection,
        gap: style.gap,
        rowGap: style.rowGap,
        columnGap: style.columnGap
      };
    }),
    'avatar controls column gap is the 9px token'
  ).toEqual({
    display: 'flex',
    flexDirection: 'column',
    gap: '9px',
    rowGap: '9px',
    columnGap: '9px'
  });
  expect(thumbBox!.width, 'avatar preview width (56px token)').toBeCloseTo(56, 0);
  expect(thumbBox!.height, 'avatar preview height (56px token)').toBeCloseTo(56, 0);
  // Controls column starts at the card's inner top edge and is fully contained horizontally.
  expect(Math.abs(bodyBox!.y - (avatarBox!.y + cardPad.top + 1))).toBeLessThanOrEqual(1);
  expect(bodyBox!.x).toBeGreaterThanOrEqual(avatarBox!.x + cardPad.left - 1);
  expect(bodyBox!.x + bodyBox!.width).toBeLessThanOrEqual(
    avatarBox!.x + avatarBox!.width - cardPad.right + 1
  );
  // Preview sits left of the controls, inside the card, without overlapping them.
  expect(Math.abs(thumbBox!.x - (avatarBox!.x + cardPad.left + 1))).toBeLessThanOrEqual(1);
  expect(thumbBox!.x + thumbBox!.width).toBeLessThanOrEqual(bodyBox!.x + 1);
  // Vertical order inside the column: label, file picker, skip; no overlap, all inside the card.
  expect(labelBox!.y + labelBox!.height).toBeLessThanOrEqual(pickerBox!.y + 1);
  expect(pickerBox!.y + pickerBox!.height).toBeLessThanOrEqual(skipBox!.y + 1);
  expect(skipBox!.y + skipBox!.height).toBeLessThanOrEqual(
    avatarBox!.y + avatarBox!.height - cardPad.bottom + 1
  );
  // Interactive targets: full column width, >=44px (plan A3/AC5), inside the card horizontally.
  for (const [control, box] of [
    ['file picker', pickerBox!],
    ['skip button', skipBox!]
  ] as const) {
    expect(box.height, `${control} target height`).toBeGreaterThanOrEqual(44);
    expect(box.width, `${control} target width`).toBeGreaterThanOrEqual(44);
    expect(box.x, `${control} left edge`).toBeGreaterThanOrEqual(avatarBox!.x);
    expect(box.x + box.width, `${control} right edge`).toBeLessThanOrEqual(
      avatarBox!.x + avatarBox!.width + 1
    );
  }
  // Optional availability closes the form: a full-width card after the CTA and the bio, below
  // the first viewport, so the screenshot baselines above are unaffected.
  const availabilityCard = page
    .locator('form > div')
    .filter({ has: page.getByRole('group', { name: en.profile.availabilityDaysLegend }) });
  const [availabilityBox, bioBox] = await Promise.all([
    availabilityCard.boundingBox(),
    page.getByLabel(en.profile.bio).boundingBox()
  ]);
  expect(availabilityBox, 'availability card must be rendered').not.toBeNull();
  expect(availabilityBox!.y).toBeGreaterThan(ctaBox!.y + ctaBox!.height);
  expect(availabilityBox!.y).toBeGreaterThan(bioBox!.y + bioBox!.height);
  expect(availabilityBox!.x).toBeCloseTo(18, 0);
  expect(availabilityBox!.width).toBeCloseTo(354, 0);
  await comparePhase2(page, 'player-setup-phase2.png');
  // 320px: the translated-text-safe card wraps instead of overflowing the viewport.
  await page.setViewportSize({ width: 320, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= document.documentElement.clientWidth
    )
  ).toBe(true);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setViewportSize({ width: 390, height: 844 });
  await test.step.skip(
    'PAF-212: migrate the historical PdRtP comparison to Clubhouse',
    async () => {
      // The historical PdRtP frame has no photo section: take the card out of flow so every
      // original frame probe and the pinned PAF-1 comparison below keep their exact coordinates.
      await avatarCard.evaluate((card) => {
        card.style.display = 'none';
      });
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
      await assertGeometry(levelCard, 'Starting level card', {
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
      // ADVANCED is end-anchored in the constrained caption row: x tracks Inter advance widths
      // (glyph metrics differ per platform), so ±2px on x only; the row y stays CSS-exact at ±1px.
      await assertGeometry(advancedCaption, 'Advanced caption inset', { x: 228, y: 419 }, { x: 2 });
      await assertGeometry(
        page.getByRole('slider', { name: en.onboarding.levelScale }),
        'Level slider hit target',
        {
          x: 32,
          width: 326,
          height: 44
        }
      );
      await assertGeometry(page.locator('form > div').nth(3), 'Preferred side and hand card', {
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
      await compare(page, 'player-setup.png', true);
    }
  );
});

test('forgot password matches frame ieoni', async ({ page }) => {
  await openFrame(page, '/forgot-password', en.auth.forgotTitle);
  await assertTopBar(page, en.auth.forgotBarTitle, true);
  await assertGeometry(page.getByRole('heading', { name: en.auth.forgotTitle }), 'Title', {
    x: 20,
    y: 60,
    width: 350,
    height: 32
  });
  await assertGeometry(page.getByText(en.auth.forgotDescription), 'Body', {
    x: 20,
    y: 108,
    width: 350,
    height: 46
  });
  await assertGeometry(page.locator('#forgot-email'), 'Email input', {
    x: 20,
    y: 194,
    width: 350,
    height: 52
  });
  await assertGeometry(page.getByText(en.auth.forgotEmailNote), 'Privacy note', {
    x: 20,
    y: 252,
    width: 350,
    height: 20
  });
  const send = page.getByRole('button', { name: en.auth.forgotSubmit });
  await assertActionBar(page, 144, [
    [send, 'Send reset link button', { x: 20, y: 668, width: 350, height: 52 }],
    [
      page.getByRole('link', { name: en.auth.backToSignIn }),
      'Back to log in link',
      { x: 20, y: 728, width: 350, height: 48 }
    ]
  ]);
  await assertNoTextTransform([send]);
  await compareFrame(page, 'forgot-password.png');
});

test('login inbox matches frame FZlHy', async ({ page }) => {
  await openFrame(page, '/login?reset=sent', en.auth.welcomeTitle);
  // FZlHy is the login screen with the reset confirmation above the form (D7).
  const notice = page.getByRole('main').getByRole('status');
  await expect(notice).toContainText(en.auth.inboxNoticeCopy);
  await assertGeometry(notice, 'Inbox notice', { x: 24, y: 219, width: 342, height: 90 });
  await assertGeometry(page.getByRole('heading', { name: en.auth.welcomeTitle }), 'Title', {
    x: 24,
    y: 136,
    width: 342,
    height: 32
  });
  await assertGeometry(page.locator('#login-email'), 'Email input', {
    x: 24,
    y: 347,
    width: 342,
    height: 52
  });
  await assertGeometry(page.locator('#login-password'), 'Password input', {
    x: 24,
    y: 437,
    width: 342,
    height: 52
  });
  await assertGeometry(
    page.getByRole('link', { name: en.auth.forgotLink }),
    'Forgot link',
    { x: 241, y: 490, width: 125, height: 44 },
    { x: 2, width: 2 }
  );
  await assertGeometry(page.getByRole('button', { name: en.auth.loginSubmit }), 'Log in button', {
    x: 24,
    y: 535,
    width: 342,
    height: 52
  });
  await assertGeometry(page.getByText(en.auth.or, { exact: true }).locator('..'), 'Divider row', {
    x: 24,
    y: 601,
    width: 342,
    height: 17
  });
  await assertGeometry(page.getByRole('button', { name: en.signInWithGoogle }), 'Google button', {
    x: 24,
    y: 632,
    width: 342,
    height: 52
  });
  await assertGeometry(page.locator('main > div').last(), 'Sign-up row', {
    x: 24,
    y: 685,
    width: 342,
    height: 44
  });
  await compareFrame(page, 'login-inbox.png');
});

test('create new password matches frame ZthyR with an authenticated session', async ({ page }) => {
  const email = `e2e-visual-reset-${Date.now()}-${Math.random().toString(36).slice(2, 10)}@test.local`;
  await page.setViewportSize(FRAME_VIEWPORT);
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

  await openFrame(page, '/reset-password', en.auth.resetTitle);
  // No safe back destination from a recovery session: only the title is drawn in the top bar.
  await assertTopBar(page, en.auth.resetBarTitle, false);
  await assertGeometry(page.getByRole('heading', { name: en.auth.resetTitle }), 'Title', {
    x: 20,
    y: 60,
    width: 350,
    height: 32
  });
  await assertGeometry(page.locator('#reset-password'), 'New password input', {
    x: 20,
    y: 132,
    width: 350,
    height: 52
  });
  await assertGeometry(page.locator('#reset-password-confirmation'), 'Repeat password input', {
    x: 20,
    y: 224,
    width: 350,
    height: 52
  });
  // Frame Rules = two 20px lines + 6px gap; rule 1 is the real policy (auth.passwordRequirements),
  // which wraps to two lines at 390px, so +20px.
  await assertGeometry(
    page.locator('#reset-password-rules'),
    'Password rules',
    { x: 20, y: 292, width: 350, height: 66 },
    { height: 2 }
  );
  const save = page.getByRole('button', { name: en.auth.resetSubmit });
  await assertActionBar(page, 88, [
    [save, 'Save password button', { x: 20, y: 724, width: 350, height: 52 }]
  ]);
  await assertNoTextTransform([save]);
  await compareFrame(page, 'reset-password.png');
  await page.setViewportSize({ width: 320, height: 800 });
  await assertControlFit(page, 320);
  await page.setViewportSize({ width: 1280, height: 800 });
  await assertControlFit(page, 1280);
});
