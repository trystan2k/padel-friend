import { expect, test, type Page } from '@playwright/test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import en from '../src/locales/en/translation.json' with { type: 'json' };
import es from '../src/locales/es/translation.json' with { type: 'json' };
import ptBR from '../src/locales/pt-BR/translation.json' with { type: 'json' };
import { waitForHydratedPage } from './auth-helpers';
import { fixtures } from './matches-management-fixtures';
import {
  comparePng,
  deriveMaskedPng,
  derivePaddedRowsPng,
  type PngMaskRectangle
} from './png-mask';

// PAF-202: read-only Pencil exports, exact live structure, then per-frame image comparisons.

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
  maskRectangles: PngMaskRectangle[];
  ctaTops: number[];
  maxDiffPixelRatio: number;
};
type Manifest = {
  sourceDesign: { path: string; sourceSha256: string };
  annotations: Record<string, { source: string; sha256: string }>;
  logoMask: { maskColor: string };
  frames: Record<string, Frame>;
};

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
    typeof value.maxDiffPixelRatio === 'number' &&
    Array.isArray(value.ctaTops) &&
    value.ctaTops.every((top) => Number.isInteger(top)) &&
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
    isRecord(value.sourceDesign) &&
    typeof value.sourceDesign.path === 'string' &&
    typeof value.sourceDesign.sourceSha256 === 'string' &&
    isRecord(value.annotations) &&
    Object.values(value.annotations).every(
      (annotation) =>
        isRecord(annotation) &&
        typeof annotation.source === 'string' &&
        typeof annotation.sha256 === 'string'
    ) &&
    isRecord(value.logoMask) &&
    typeof value.logoMask.maskColor === 'string' &&
    isRecord(value.frames) &&
    Object.values(value.frames).every(isFrame)
  );
}

const rawManifest: unknown = JSON.parse(
  readFileSync(new URL('./references/paf-202-public/manifest.json', import.meta.url), 'utf8')
);
if (!isManifest(rawManifest)) throw new Error('Invalid PAF-202 visual provenance manifest');
const manifest = rawManifest;

function frameFor(name: string): Frame {
  const frame = manifest.frames[name];
  if (!frame) throw new Error(`Missing PAF-202 frame ${name}`);
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

function referenceFor(name: string): Buffer {
  const frame = frameFor(name);
  const source = readFileSync(
    new URL(`./references/paf-202-public/${frame.source}`, import.meta.url)
  );
  expect(digest(source), `${name} Pencil export must match its pinned digest`).toBe(
    frame.sourceSha256
  );
  expect([source.readUInt32BE(16), source.readUInt32BE(20)]).toEqual([frame.width, frame.height]);
  const masked = deriveMaskedPng(source, {
    maskColor: manifest.logoMask.maskColor,
    rectangles: frame.maskRectangles
  });
  return derivePaddedRowsPng(
    masked,
    frame.ctaTops.flatMap((top) => [
      { y: top + 13, count: 2 },
      { y: top + 34, count: 3 }
    ])
  );
}

test.beforeAll(() => {
  expect(digest(readFileSync(new URL(`../${manifest.sourceDesign.path}`, import.meta.url)))).toBe(
    manifest.sourceDesign.sourceSha256
  );
  for (const { source, sha256 } of Object.values(manifest.annotations)) {
    const bytes = readFileSync(new URL(`./references/paf-202-public/${source}`, import.meta.url));
    expect(digest(bytes), source).toBe(sha256);
  }
  for (const name of Object.keys(manifest.frames)) referenceFor(name);
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
  expect(fonts, 'Figtree must be loaded before any measurement').toEqual({ figtree: true });
}

type ProbeInput = {
  width: number;
  expectedHrefs: string[];
  authenticated: boolean;
  columnMax: number;
};

/** Every structural invariant of the homepage, measured on the live DOM. Empty list = pass. */
async function structureFailures(tab: Page, input: ProbeInput): Promise<string[]> {
  return tab.evaluate(({ width, expectedHrefs: orderedHrefs, authenticated, columnMax }) => {
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
    const page = document.querySelector('[data-public-homepage]');
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
    if (headings.join(',') !== 'H1,H2,H3,H3,H3') fail(`heading order ${headings.join(',')}`);
    const hrefs = [...page.querySelectorAll('a')].map((link) => link.getAttribute('href'));
    if (hrefs.join('|') !== orderedHrefs.join('|'))
      fail(`link order ${hrefs.join(' ')} ≠ ${orderedHrefs.join(' ')}`);
    const cards = [...main.querySelectorAll(':scope > section > ul > li > div')];
    if (cards.length !== 3) fail(`expected exactly three feature cards, found ${cards.length}`);

    // Rails, column and centering.
    const root = box(page);
    const columnWidth = Math.min(width, columnMax);
    near(root.width, columnWidth, 'column width');
    near(root.left, (width - columnWidth) / 2, 'column centering');
    const contentLeft = root.left + 24;
    const contentWidth = columnWidth - 48;
    const brand = header.querySelector('div');
    const logo = brand?.querySelector('img');
    const hero = main.querySelector(':scope > div');
    const title = hero?.querySelector('h1');
    const description = hero?.querySelector(':scope > p');
    const actions = hero?.querySelector(':scope > div');
    const features = main.querySelector('section');
    const list = features?.querySelector('ul');
    if (!brand || !logo || !hero || !title || !description || !actions || !features || !list)
      return [...failures, 'missing brand, hero or features'];
    for (const [label, element] of [
      ['brand', brand],
      ['hero', hero],
      ['features', features]
    ] as const) {
      near(box(element).left, contentLeft, `${label} left rail`);
    }
    near(box(header).height, 76, 'header height');
    near(box(logo).top, 18, 'logo top');
    near(box(logo).width, 40, 'logo width');
    near(box(logo).height, 40, 'logo height');
    near(box(hero).top - box(header).bottom, 20, 'main top inset');
    near(box(description).top - box(title).bottom, 14, 'hero text gap');
    near(box(actions).top - box(description).bottom, 14, 'hero action gap');

    const ctas = [...actions.querySelectorAll(':scope > a')];
    if (ctas.length !== (authenticated ? 1 : 2)) fail('N6wce CTA swap');
    ctas.forEach((cta, index) => {
      near(box(cta).left, contentLeft, `CTA ${index} left`);
      near(box(cta).width, contentWidth, `CTA ${index} width`);
      if (box(cta).height < 52) fail(`CTA ${index} below 52px`);
      near(
        box(cta).top - (index ? box(ctas[index - 1]!).bottom : box(actions).top),
        index ? 12 : 10,
        `CTA ${index} gap`
      );
    });
    if (Boolean(actions.querySelector('p')) !== authenticated) fail('QtxDQ signed-in note');
    near(box(features).top - box(hero).bottom, 32, 'hero → features gap');
    if (style(features).rowGap !== '14px') fail('features heading gap');
    if (style(list).rowGap !== '12px') fail('feature card gap');
    cards.forEach((card, index) => {
      const [tile, copy] = [...card.children];
      if (!tile || !copy || !copy.querySelector('h3 + p')) {
        fail(`feature card ${index} structure`);
        return;
      }
      near(box(card).width, contentWidth, `card ${index} width`);
      near(box(tile).left - box(card).left, 16, `card ${index} left inset`);
      near(box(tile).top - box(card).top, 16, `card ${index} top inset`);
      near(box(tile).width, 44, `card ${index} tile width`);
      near(box(tile).height, 44, `card ${index} tile height`);
      near(box(copy).left - box(tile).right, 14, `card ${index} tile → copy`);
      if (style(card).borderTopLeftRadius !== '20px') fail(`card ${index} radius`);
    });

    const [links, operator] = [...footer.children];
    const privacy = links?.querySelector('a[href="/privacy"]');
    const contact = links?.querySelector('div');
    const email = contact?.querySelector('a');
    if (!links || !operator || !privacy || !contact || !email)
      return [...failures, 'footer privacy, contact or operator missing'];
    near(box(footer).top - box(features).bottom, 32, 'features → footer gap');
    near(box(privacy).top - box(footer).top, 24, 'footer top inset');
    near(box(contact).top - box(privacy).bottom, 4, 'footer link row gap');
    near(box(operator).top - box(contact).bottom, 16, 'footer operator gap');
    near(box(footer).bottom - box(operator).bottom, 32, 'footer bottom inset');
    near(box(privacy).left, contentLeft, 'footer links left rail');

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
    near(themeChip.right, root.right - 24, 'theme chip right inset', 0.5);
    near(themeChip.top, 16, 'theme chip top', 0.5);
    near(localeChip.top, 16, 'locale chip top', 0.5);
    near(themeChip.left - localeChip.right, 8, 'chip gap', 0.5);
    for (const chip of chipRects) {
      near(chip.width, 44, 'chip width', 0.5);
      near(chip.height, 44, 'chip height', 0.5);
    }
    if (box(brand).right > localeChip.left) fail('ju6S4 brand overlaps floating controls');
    const covered = chipRects;
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
      const block = owner.closest('a, p, h1, h2, h3, span, li');
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
  options: { locale: Locale; width: number; authenticated?: boolean }
): Promise<void> {
  const copy = copies[options.locale];
  await expect(page.locator('html')).toHaveAttribute('lang', options.locale);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(copy.publicHomepage.hero.title);
  await expect(page.getByRole('combobox', { name: copy.language })).toBeVisible();
  await expect(page.getByRole('combobox', { name: copy.theme })).toBeVisible();
  const failures = await structureFailures(page, {
    width: options.width,
    expectedHrefs: expectedHrefs(options.authenticated ?? false),
    authenticated: options.authenticated ?? false,
    columnMax: COLUMN_MAX
  });
  expect.soft(failures, failures.join('\n')).toEqual([]);
}

async function compareFrame(page: Page, name: string): Promise<void> {
  const frame = frameFor(name);
  const logo = page.locator('header img');
  await expect(logo).toHaveAttribute('alt', '');
  const logoUrl = await logo.getAttribute('src');
  if (!logoUrl) throw new Error('Missing homepage logo URL');
  const served = await page.request.get(logoUrl);
  expect(served.ok()).toBe(true);
  expect(
    (await served.body()).equals(
      readFileSync(new URL('../docs/design/padel-friends-app-icon.png', import.meta.url))
    )
  ).toBe(true);

  const height = frame.height + frame.ctaTops.length * 5;
  await page.setViewportSize({ width: frame.width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  const ctaTops = await page
    .locator('main a')
    .evaluateAll((links) => links.map((link) => link.getBoundingClientRect().top));
  expect(ctaTops).toHaveLength(frame.ctaTops.length);
  frame.ctaTops.forEach((y, index) => {
    expect(Math.abs(ctaTops[index]! - (y + index * 5))).toBeLessThanOrEqual(1);
  });
  const footerBottom = await page
    .locator('footer')
    .evaluate((footer) => footer.getBoundingClientRect().bottom);
  expect(
    Math.abs(footerBottom - height),
    'full legal footer must match the adapted frame'
  ).toBeLessThanOrEqual(1);
  const capture = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const actual = deriveMaskedPng(capture, {
    maskColor: manifest.logoMask.maskColor,
    rectangles: frame.maskRectangles
  });
  const expected = referenceFor(name);
  const result = comparePng(actual, expected, frame.maxDiffPixelRatio);
  if (result?.diff) {
    await test.info().attach('Chromium', { body: actual, contentType: 'image/png' });
    await test.info().attach('Pencil', { body: expected, contentType: 'image/png' });
    await test.info().attach('pixel difference', { body: result.diff, contentType: 'image/png' });
  }
  expect(result?.errorMessage).toBeUndefined();
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
        width: frame.width
      });
      await compareFrame(page, name);
    });
  }

  test('QtxDQ public-homepage-mobile-signed-in.png: a real signed-in session stays on / with one dashboard CTA', async ({
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
        authenticated: true
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
          const surface = document.querySelector('[data-public-homepage]');
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
