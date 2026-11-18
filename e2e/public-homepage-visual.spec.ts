import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import en from '../src/locales/en/translation.json' with { type: 'json' };
import es from '../src/locales/es/translation.json' with { type: 'json' };
import ptBR from '../src/locales/pt-BR/translation.json' with { type: 'json' };
import { waitForHydratedPage } from './auth-helpers';
import { fixtures } from './matches-management-fixtures';
import { deriveMaskedPng, type PngMaskRectangle } from './png-mask';

// PAF-201 public homepage: structure first, then pixels. The six Pencil frames (FswwZ, JzVIa, eIW0i,
// aebnS, Jt31N, R91tQr) are committed unchanged under references/paf-201 and pinned by SHA-256 in
// the manifest. The app-wide locale/theme chips are not drawn in the frames, so ONLY their two
// rectangles are painted #FF00FF on both the derived baseline and the actual capture. There is no
// desktop frame: 481-1280px are covered by geometry probes only, never by an image baseline.
// Baselines are derived from the exports (deriveMaskedPng), never regenerated from Chromium: never
// run this spec with --update-snapshots. Per-frame allowances live in the manifest.

type Locale = 'en' | 'es' | 'pt-BR';
type Theme = 'light' | 'dark';

type Frame = {
  frameId: string;
  width: number;
  height: number;
  locale: Locale;
  theme: Theme;
  source: string;
  sourceSha256: string;
  baselineSha256: string;
  maskRectangles: PngMaskRectangle[];
  maxDiffPixelRatio: number;
};
type Manifest = { chipMask: { maskColor: string }; frames: Record<string, Frame> };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isFrame(value: unknown): value is Frame {
  return (
    isRecord(value) &&
    typeof value.frameId === 'string' &&
    typeof value.width === 'number' &&
    typeof value.height === 'number' &&
    (value.locale === 'en' || value.locale === 'es' || value.locale === 'pt-BR') &&
    (value.theme === 'light' || value.theme === 'dark') &&
    typeof value.source === 'string' &&
    typeof value.sourceSha256 === 'string' &&
    typeof value.baselineSha256 === 'string' &&
    typeof value.maxDiffPixelRatio === 'number' &&
    Array.isArray(value.maskRectangles) &&
    value.maskRectangles.every(
      (rectangle) =>
        isRecord(rectangle) &&
        typeof rectangle.name === 'string' &&
        typeof rectangle.x === 'number' &&
        typeof rectangle.y === 'number' &&
        typeof rectangle.width === 'number' &&
        typeof rectangle.height === 'number'
    )
  );
}

function isManifest(value: unknown): value is Manifest {
  return (
    isRecord(value) &&
    isRecord(value.chipMask) &&
    typeof value.chipMask.maskColor === 'string' &&
    isRecord(value.frames) &&
    Object.values(value.frames).every(isFrame)
  );
}

const rawManifest: unknown = JSON.parse(
  readFileSync(new URL('./references/paf-201/manifest.json', import.meta.url), 'utf8')
);
if (!isManifest(rawManifest)) throw new Error('Invalid PAF-201 visual provenance manifest');
const manifest = rawManifest;

function frameFor(name: string): Frame {
  const frame = manifest.frames[name];
  if (!frame) throw new Error(`Missing PAF-201 frame ${name}`);
  return frame;
}

const copies = { en, es, 'pt-BR': ptBR } as const;
const baseURL = 'http://127.0.0.1:4173';
const CONTACT_EMAIL = 'trystan2k@gmail.com';
// Pencil frames hug their content up to the 480px bounded column; 1280 keeps the same column.
const COLUMN_MAX = 480;

test.use({ serviceWorkers: 'block', deviceScaleFactor: 1 });

function digest(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

function assertProvenance(name: string): void {
  const frame = frameFor(name);
  const source = readFileSync(new URL(`./references/paf-201/${frame.source}`, import.meta.url));
  expect(digest(source), `${name} Pencil export must match its pinned digest`).toBe(
    frame.sourceSha256
  );
  const expected = deriveMaskedPng(source, {
    maskColor: manifest.chipMask.maskColor,
    rectangles: frame.maskRectangles
  });
  expect(digest(expected), `${name} baseline derivation must stay pinned`).toBe(
    frame.baselineSha256
  );
  const baseline = readFileSync(
    new URL(`./public-homepage-visual.spec.ts-snapshots/${name}`, import.meta.url)
  );
  expect(baseline.equals(expected), `${name} baseline must be the masked Pencil export`).toBe(true);
}

test.beforeAll(() => {
  for (const name of Object.keys(manifest.frames)) assertProvenance(name);
});

async function open(
  page: Page,
  { locale, theme, width, height }: { locale: Locale; theme: Theme; width: number; height: number }
): Promise<void> {
  await page.context().addCookies([
    { name: 'locale', value: locale, url: baseURL },
    { name: 'theme', value: theme, url: baseURL }
  ]);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.setViewportSize({ width, height });
  const response = await page.goto('/');
  expect(response?.status()).toBe(200);
  await ready(page);
  await page.evaluate(() => window.scrollTo(0, 0));
}

async function ready(page: Page): Promise<void> {
  await waitForHydratedPage(page);
  await page.evaluate(async () => {
    await Promise.all([
      document.fonts.load('700 32px Manrope'),
      document.fonts.load('400 15px Inter'),
      document.fonts.load('700 14px Inter')
    ]);
    await document.fonts.ready;
    await Promise.all(
      Array.from(document.images, async (image) => {
        if (!image.complete) await image.decode();
      })
    );
  });
  const fonts = await page.evaluate(() => ({
    inter: document.fonts.check('400 15px Inter') && document.fonts.check('700 14px Inter'),
    manrope: document.fonts.check('700 32px Manrope')
  }));
  expect(fonts, 'Inter and Manrope must be loaded before any measurement').toEqual({
    inter: true,
    manrope: true
  });
}

type ProbeInput = {
  width: number;
  expectedHrefs: string[];
  masks: PngMaskRectangle[];
  columnMax: number;
};

/** Every structural invariant of the homepage, measured on the live DOM. Empty list = pass. */
async function structureFailures(tab: Page, input: ProbeInput): Promise<string[]> {
  return tab.evaluate(({ width, expectedHrefs: orderedHrefs, masks, columnMax }) => {
    const failures: string[] = [];
    const fail = (message: string) => failures.push(message);
    const near = (actual: number, expected: number, label: string, tolerance = 1) => {
      if (Math.abs(actual - expected) > tolerance)
        fail(`${label}: expected ${expected}px (±${tolerance}), got ${actual}px`);
    };
    const box = (element: Element) => element.getBoundingClientRect();
    const style = (element: Element) => getComputedStyle(element);
    const doc = document.documentElement;

    if (doc.scrollWidth > doc.clientWidth)
      fail(`horizontal overflow ${doc.scrollWidth - doc.clientWidth}px`);

    // Landmarks and headings.
    const page = document.querySelector('#main-content > div');
    if (!page) return [...failures, 'public homepage root not found'];
    for (const tag of ['header', 'main', 'footer'])
      if (document.querySelectorAll(tag).length !== 1) fail(`expected exactly one <${tag}>`);
    const header = page.querySelector(':scope > header');
    const main = page.querySelector(':scope > main');
    const footer = page.querySelector(':scope > footer');
    if (!header || !main || !footer)
      return [...failures, 'header/main/footer must be direct children'];
    const before = (a: Node, b: Node) =>
      Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (!before(header, main) || !before(main, footer))
      fail('landmark order header → main → footer');
    const headings = [...document.querySelectorAll('h1, h2, h3')].map((heading) => heading.tagName);
    if (headings.join(',') !== 'H1,H2,H2,H2') fail(`heading order ${headings.join(',')}`);
    const hrefs = [...page.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    if (hrefs.join('|') !== orderedHrefs.join('|'))
      fail(`link order ${hrefs.join(' ')} ≠ ${orderedHrefs.join(' ')}`);
    const cards = [...main.querySelectorAll(':scope > ul > li')];
    if (cards.length !== 3) fail(`expected exactly three feature cards, found ${cards.length}`);

    // Rails, column and centering.
    const root = box(page);
    const columnWidth = Math.min(width, columnMax);
    near(root.width, columnWidth, 'column width');
    near(root.left, (width - columnWidth) / 2, 'column centering');
    const rootStyle = style(page);
    for (const side of ['Left', 'Right'] as const)
      if (rootStyle[`padding${side}`] !== '18px')
        fail(`rail padding${side} ${rootStyle[`padding${side}`]}`);
    if (rootStyle.paddingTop !== '56px') fail(`top padding ${rootStyle.paddingTop}`);
    if (rootStyle.paddingBottom !== '32px') fail(`bottom padding ${rootStyle.paddingBottom}`);
    if (rootStyle.rowGap !== '32px') fail(`major gap ${rootStyle.rowGap}`);
    if (style(main).rowGap !== '32px') fail(`main major gap ${style(main).rowGap}`);
    const contentLeft = root.left + 18;
    const contentWidth = columnWidth - 36;
    for (const [name, element] of [
      ['header', header],
      ['main', main],
      ['footer', footer]
    ] as const) {
      near(box(element).left, contentLeft, `${name} left rail`);
      near(box(element).width, contentWidth, `${name} content width`);
    }

    // Wordmark and block rhythm.
    const brand = header.querySelector('span');
    if (!brand) return [...failures, 'wordmark missing'];
    near(box(header).top, 56, 'wordmark/header y');
    near(box(brand).left, contentLeft, 'wordmark x');
    near(box(main).top - box(header).bottom, 32, 'header → main gap');

    // Hero: 16px gap, then 8px inset + 16px gap before the CTAs.
    const hero = main.querySelector(':scope > div');
    const title = hero?.querySelector('h1');
    const description = hero?.querySelector(':scope > p');
    const actions = hero?.querySelector(':scope > div');
    if (!hero || !title || !description || !actions) return [...failures, 'hero parts missing'];
    if (style(hero).rowGap !== '16px') fail(`hero gap ${style(hero).rowGap}`);
    near(box(description).top - box(title).bottom, 16, 'h1 → description gap');
    near(
      box(actions).top - box(description).bottom,
      24,
      'description → CTA inset (16 gap + 8 inset)'
    );
    if (style(actions).marginTop !== '8px') fail(`CTA inset ${style(actions).marginTop}`);
    if (style(actions).rowGap !== '12px') fail(`CTA gap ${style(actions).rowGap}`);
    const ctas = [...actions.querySelectorAll(':scope > a')];
    ctas.forEach((cta, index) => {
      const ctaBox = box(cta);
      near(ctaBox.left, contentLeft, `CTA ${index} left`);
      near(ctaBox.width, contentWidth, `CTA ${index} fill width`);
      if (ctaBox.height < 48) fail(`CTA ${index} designed height ${ctaBox.height}px below 49px`);
      if (index > 0) near(ctaBox.top - box(ctas[index - 1]!).bottom, 12, `CTA ${index} row gap`);
    });
    near(box(hero).bottom, box(actions).bottom, 'hero ends with the CTAs');

    // Feature cards.
    const list = main.querySelector(':scope > ul');
    if (!list) return [...failures, 'feature list missing'];
    near(box(list).top - box(hero).bottom, 32, 'hero → features gap');
    if (style(list).rowGap !== '12px') fail(`card gap ${style(list).rowGap}`);
    cards.forEach((card, index) => {
      const cardBox = box(card);
      const cardStyle = style(card);
      near(cardBox.left, contentLeft, `card ${index} left`);
      near(cardBox.width, contentWidth, `card ${index} width`);
      if (index > 0) near(cardBox.top - box(cards[index - 1]!).bottom, 12, `card ${index} gap`);
      for (const side of ['Top', 'Right', 'Bottom', 'Left'] as const)
        if (cardStyle[`padding${side}`] !== '14px') fail(`card ${index} padding${side}`);
      if (cardStyle.borderTopLeftRadius !== '16px') fail(`card ${index} radius`);
      if (cardStyle.rowGap !== '10px') fail(`card ${index} inner gap ${cardStyle.rowGap}`);
      const [tile, cardTitle, cardText] = [...card.children];
      if (
        !tile ||
        !cardTitle ||
        !cardText ||
        card.children.length !== 3 ||
        cardTitle.tagName !== 'H2'
      ) {
        fail(`card ${index} must be tile, h2, p`);
        return;
      }
      near(box(tile).width, 40, `card ${index} tile width`, 0.5);
      near(box(tile).height, 40, `card ${index} tile height`, 0.5);
      near(box(tile).left, cardBox.left + 14, `card ${index} tile x`);
      near(box(tile).top, cardBox.top + 14, `card ${index} tile y`);
      near(box(cardTitle).top - box(tile).bottom, 10, `card ${index} tile → title`);
      near(box(cardText).top - box(cardTitle).bottom, 10, `card ${index} title → text`);
      near(cardBox.bottom - box(cardText).bottom, 14, `card ${index} bottom padding`);
    });

    // Footer (Pencil): 24px above the divider, 8px below it, 8px between rows of real 44px link
    // rows (contact label and email row are flush), 32px bottom inset.
    const footerStyle = style(footer);
    if (footerStyle.borderTopWidth !== '1px' || footerStyle.borderTopStyle !== 'solid')
      fail(`footer divider ${footerStyle.borderTopWidth} ${footerStyle.borderTopStyle}`);
    if (footerStyle.marginTop !== '24px') fail(`footer top inset ${footerStyle.marginTop}`);
    if (footerStyle.paddingTop !== '8px') fail(`footer divider gap ${footerStyle.paddingTop}`);
    if (footerStyle.rowGap !== '8px') fail(`footer row gap ${footerStyle.rowGap}`);
    const [privacy, contact, operator, audience] = [...footer.children];
    if (
      footer.children.length !== 4 ||
      privacy?.tagName !== 'A' ||
      !contact ||
      !operator ||
      !audience
    )
      return [...failures, 'footer must be privacy link, contact group, operator, audience'];
    const [contactLabel, contactMail] = [...contact.children];
    if (!contactLabel || contactMail?.tagName !== 'A' || contact.children.length !== 2)
      return [...failures, 'footer contact group must be label + email link'];
    near(box(footer).top - box(main).bottom, 32 + 24, 'main → divider (32 gap + 24 inset)');
    near(box(privacy).top, box(footer).top + 1 + 8, 'divider → privacy row');
    near(box(privacy).height, 44, 'privacy row height');
    near(box(contact).top, box(privacy).bottom + 8, 'privacy → contact group');
    near(box(contactMail).top, box(contactLabel).bottom, 'contact label → email row');
    near(box(contactMail).height, 44, 'email row height');
    near(box(operator).top, box(contact).bottom + 8, 'contact → operator');
    near(box(audience).top, box(operator).bottom + 8, 'operator → audience');
    const naturalBottom = box(audience).bottom + 32;
    if (box(page).bottom < naturalBottom - 1)
      fail(`last footer line is cut: page ends ${box(page).bottom}, needs ${naturalBottom}`);

    // 44px hit areas in both dimensions for every link.
    for (const link of page.querySelectorAll('a')) {
      const linkBox = box(link);
      if (linkBox.width < 43.5 || linkBox.height < 43.5)
        fail(`link ${link.getAttribute('href')} target ${linkBox.width}×${linkBox.height}`);
    }

    // Root chips: exact bounds from src/root.styles.ts, never over homepage text or boxes.
    const chips = (['locale', 'theme'] as const).map((id) => {
      const label = document.getElementById(id)?.closest('label');
      return label ? box(label) : null;
    });
    const chipRects = chips.flatMap((chip) => (chip ? [chip] : []));
    const [localeChip, themeChip] = chipRects;
    if (!localeChip || !themeChip)
      return [...failures, 'language and theme chips must both render'];
    near(themeChip.right, doc.clientWidth - 18, 'theme chip right inset', 0.5);
    near(themeChip.top, 26, 'theme chip top', 0.5);
    near(localeChip.top, 26, 'locale chip top', 0.5);
    near(themeChip.left - localeChip.right, 8, 'chip gap', 0.5);
    for (const [name, chip] of [
      ['locale', localeChip],
      ['theme', themeChip]
    ] as const) {
      near(chip.width, 44, `${name} chip width`, 0.5);
      near(chip.height, 44, `${name} chip height`, 0.5);
    }
    for (const mask of masks) {
      const chip = mask.name === 'locale' ? localeChip : themeChip;
      near(chip.left, mask.x, `mask ${mask.name} x`, 0.5);
      near(chip.top, mask.y, `mask ${mask.name} y`, 0.5);
    }
    const covered = [
      ...chipRects,
      ...masks.map((mask) => new DOMRect(mask.x, mask.y, mask.width, mask.height))
    ];
    const meets = (a: DOMRect, b: DOMRect) =>
      a.left < b.right - 0.5 &&
      b.left < a.right - 0.5 &&
      a.top < b.bottom - 0.5 &&
      b.top < a.bottom - 0.5;

    // Text: contained, not clipped, never overlapping other text or the chips.
    const texts: { owner: Element; rect: DOMRect; label: string }[] = [];
    const walker = document.createTreeWalker(page, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      const content = node.textContent?.trim();
      if (!content || !node.parentElement) continue;
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const rect of range.getClientRects())
        if (rect.width > 0 && rect.height > 0)
          texts.push({ owner: node.parentElement, rect, label: content.slice(0, 24) });
    }
    for (const { rect, label, owner } of texts) {
      if (rect.left < contentLeft - 1 || rect.right > contentLeft + contentWidth + 1)
        fail(`text "${label}" leaves the rails`);
      if (rect.right > doc.clientWidth + 0.5 || rect.left < -0.5)
        fail(`text "${label}" off-screen`);
      for (const chip of covered) if (meets(rect, chip)) fail(`text "${label}" under a chip/mask`);
      const block = owner.closest('a, p, h1, h2, span, li');
      if (block && rect.right > box(block).right + 1) fail(`text "${label}" clipped by its box`);
      for (const other of texts)
        if (other.owner !== owner && other.label < label && meets(rect, other.rect))
          fail(`text "${label}" overlaps "${other.label}"`);
    }
    for (const element of page.querySelectorAll('*')) {
      if (element instanceof SVGElement) continue;
      if (element.scrollWidth > element.clientWidth + 1)
        fail(`<${element.tagName.toLowerCase()}> content wider than its box`);
    }
    for (const element of page.querySelectorAll('a, li'))
      for (const chip of covered)
        if (meets(box(element), chip)) fail(`${element.tagName} box under a chip/mask`);
    return failures;
  }, input);
}

function expectedHrefs(authenticated: boolean): string[] {
  return [
    ...(authenticated ? ['/dashboard'] : ['/login', '/onboarding/account']),
    '/privacy',
    `mailto:${CONTACT_EMAIL}`
  ];
}

async function checkStructure(
  page: Page,
  options: { locale: Locale; width: number; authenticated?: boolean; masks?: PngMaskRectangle[] }
): Promise<void> {
  const copy = copies[options.locale];
  await expect(page.locator('html')).toHaveAttribute('lang', options.locale);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.publicHomepage.hero.title);
  await expect(page.getByRole('combobox', { name: copy.language })).toBeVisible();
  await expect(page.getByRole('combobox', { name: copy.theme })).toBeVisible();
  const failures = await structureFailures(page, {
    width: options.width,
    expectedHrefs: expectedHrefs(options.authenticated ?? false),
    masks: options.masks ?? [],
    columnMax: COLUMN_MAX
  });
  expect.soft(failures, failures.join('\n')).toEqual([]);
}

async function compareFrame(page: Page, name: string): Promise<void> {
  const frame = frameFor(name);
  assertProvenance(name);
  const documentHeight = await page.evaluate(() => document.documentElement.scrollHeight);
  expect
    .soft(documentHeight, `${name}: whole composition must fit the ${frame.height}px frame`)
    .toBeLessThanOrEqual(frame.height);
  const naturalHeight = await page.evaluate(() => {
    const last = document.querySelector('main + footer > p:last-child');
    return last ? Math.round(last.getBoundingClientRect().bottom + 32) : -1;
  });
  expect
    .soft(
      Math.abs(naturalHeight - frame.height),
      `${name}: content height ${naturalHeight}px vs Pencil frame ${frame.height}px`
    )
    .toBeLessThanOrEqual(2);
  await page.evaluate((rectangles) => {
    for (const { name: maskName, x, y, width, height } of rectangles) {
      const mask = document.createElement('div');
      mask.dataset.visualMask = maskName;
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
  }, frame.maskRectangles);
  try {
    await expect(page).toHaveScreenshot(name, {
      animations: 'disabled',
      caret: 'hide',
      threshold: 0.1,
      maxDiffPixelRatio: frame.maxDiffPixelRatio,
      mask: frame.maskRectangles.map((rectangle) =>
        page.locator(`[data-visual-mask="${rectangle.name}"]`)
      ),
      maskColor: manifest.chipMask.maskColor
    });
  } finally {
    // Detect --update-snapshots overwriting a Pencil-derived baseline.
    assertProvenance(name);
  }
}

const imageCases = [
  'public-homepage-mobile-light.png',
  'public-homepage-mobile-dark.png',
  'public-homepage-mobile-es.png',
  'public-homepage-mobile-pt-br.png',
  'public-homepage-mobile-320-es.png'
] as const;

test.describe('public homepage matches the Pencil frames', { tag: '@visual' }, () => {
  for (const name of imageCases) {
    const frame = frameFor(name);
    test(`${frame.frameId} ${name}`, async ({ page }) => {
      await open(page, frame);
      await checkStructure(page, {
        locale: frame.locale,
        width: frame.width,
        masks: frame.maskRectangles
      });
      await compareFrame(page, name);
    });
  }

  test('eIW0i public-homepage-mobile-signed-in.png: a real signed-in session stays on / with one dashboard CTA', async ({
    browser
  }) => {
    test.setTimeout(240_000);
    const name = 'public-homepage-mobile-signed-in.png';
    const frame = frameFor(name);
    const f = await fixtures(browser, { memberCount: 0 });
    try {
      const page = await f.page(f.creator, frame.locale, frame.width, frame.theme, frame.height);
      await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: frame.theme });
      const response = await page.goto('/');
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toBe('private, no-store');
      await ready(page);
      await page.evaluate(() => window.scrollTo(0, 0));
      expect(new URL(page.url()).pathname).toBe('/');

      const copy = copies.en;
      await expect(
        page.getByRole('link', { name: copy.publicHomepage.actions.dashboard })
      ).toHaveCount(1);
      for (const guest of [
        copy.publicHomepage.actions.signIn,
        copy.publicHomepage.actions.createAccount
      ])
        await expect(page.getByRole('link', { name: guest })).toHaveCount(0);
      await expect(page.getByRole('link', { name: copy.auth.privacyLink })).toHaveAttribute(
        'href',
        '/privacy'
      );
      await expect(page.getByRole('link', { name: CONTACT_EMAIL })).toBeVisible();
      const text = await page.locator('main, footer').allInnerTexts();
      for (const value of [f.creator.name, f.creator.email])
        expect(text.join('\n')).not.toContain(value);
      expect(await page.content()).not.toContain(f.creator.email);

      await checkStructure(page, {
        locale: frame.locale,
        width: frame.width,
        authenticated: true,
        masks: frame.maskRectangles
      });
      await compareFrame(page, name);

      await page.getByRole('link', { name: copy.publicHomepage.actions.dashboard }).click();
      await expect(page).toHaveURL(/\/dashboard$/);
    } finally {
      await f.cleanup();
    }
  });
});

// Geometry-only coverage: no image baseline exists for these widths (no desktop frame is approved).
const geometryCases: { locale: Locale; theme: Theme; width: number; height: number }[] = [
  { locale: 'en', theme: 'light', width: 320, height: 700 },
  { locale: 'pt-BR', theme: 'light', width: 320, height: 700 },
  { locale: 'pt-BR', theme: 'dark', width: 320, height: 700 },
  { locale: 'es', theme: 'dark', width: 390, height: 844 },
  { locale: 'pt-BR', theme: 'dark', width: 390, height: 844 },
  { locale: 'en', theme: 'light', width: 600, height: 800 },
  { locale: 'es', theme: 'dark', width: 768, height: 1024 },
  { locale: 'pt-BR', theme: 'light', width: 768, height: 1024 },
  { locale: 'en', theme: 'light', width: 1280, height: 900 },
  { locale: 'en', theme: 'dark', width: 1280, height: 900 },
  { locale: 'es', theme: 'light', width: 1280, height: 900 },
  { locale: 'es', theme: 'dark', width: 1280, height: 900 },
  { locale: 'pt-BR', theme: 'light', width: 1280, height: 900 },
  { locale: 'pt-BR', theme: 'dark', width: 1280, height: 900 }
];

test.describe('public homepage geometry across widths, locales and themes', () => {
  for (const config of geometryCases) {
    test(`${config.locale} ${config.theme} ${config.width}px`, async ({ page }) => {
      await open(page, config);
      await checkStructure(page, config);
      // The page never scrolls sideways, and the footer is reachable at the end of the document.
      await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
      await expect(page.locator('footer p').last()).toBeInViewport();
    });
  }
});

function channel(value: number): number {
  const scaled = value / 255;
  return scaled <= 0.03928 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
}

function luminance(color: string): number {
  const match = /^rgba?\((\d+),\s*(\d+),\s*(\d+)/.exec(color);
  if (!match) throw new Error(`Unsupported computed color ${color}`);
  return (
    0.2126 * channel(Number(match[1])) +
    0.7152 * channel(Number(match[2])) +
    0.0722 * channel(Number(match[3]))
  );
}

function contrast(a: string, b: string): number {
  const [first, second] = [luminance(a), luminance(b)];
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test.describe('public homepage keyboard order and focus rings', () => {
  for (const theme of ['light', 'dark'] as const) {
    test(`skip link, chips and links in order with a visible ring (${theme})`, async ({ page }) => {
      await open(page, { locale: 'en', theme, width: 390, height: 1080 });
      const stops: string[] = [];
      for (let index = 0; index < 7; index += 1) {
        await page.keyboard.press('Tab');
        const stop = await page.evaluate(() => {
          const active = document.activeElement;
          if (!active) return null;
          const computed = getComputedStyle(active);
          const bounds = active.getBoundingClientRect();
          const surface = document.querySelector('#main-content > div');
          return {
            label:
              active.getAttribute('href') ??
              (active instanceof HTMLSelectElement ? `select#${active.id}` : active.tagName),
            visible:
              bounds.width > 0 &&
              bounds.height > 0 &&
              bounds.top >= 0 &&
              bounds.bottom <= window.innerHeight,
            outlineStyle: computed.outlineStyle,
            outlineWidth: computed.outlineWidth,
            outlineColor: computed.outlineColor,
            background: surface ? getComputedStyle(surface).backgroundColor : '',
            chipRing: active.closest('label')
              ? getComputedStyle(active.closest('label')!).outlineStyle
              : ''
          };
        });
        expect(stop, `tab stop ${index}`).not.toBeNull();
        expect(stop!.visible, `tab stop ${index} (${stop!.label}) must be visible`).toBe(true);
        stops.push(stop!.label);
        if (stop!.label.startsWith('/') || stop!.label.startsWith('mailto:')) {
          expect(stop!.outlineStyle, `${stop!.label} focus ring`).toBe('solid');
          expect(
            Number.parseFloat(stop!.outlineWidth),
            `${stop!.label} ring width`
          ).toBeGreaterThanOrEqual(2);
          expect(
            contrast(stop!.outlineColor, stop!.background),
            `${stop!.label} ring contrast on the ${theme} background`
          ).toBeGreaterThanOrEqual(3);
        } else if (stop!.label.startsWith('select#')) {
          expect(stop!.chipRing, `${stop!.label} chip focus ring`).toBe('solid');
        }
      }
      expect(stops).toEqual([
        '#main-content',
        'select#locale',
        'select#theme',
        '/login',
        '/onboarding/account',
        '/privacy',
        `mailto:${CONTACT_EMAIL}`
      ]);
    });
  }
});
