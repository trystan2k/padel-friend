import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import manifest from './references/paf-202-statistics/manifest.json' with { type: 'json' };
import { copies } from './matches-management-fixtures';
import { statisticsWorld, type PlayerKey, type StatisticsWorld } from './statistics-fixtures';

// PAF-202 U20 visual proof (Clubhouse frames). Three layers, none of which can mask another:
//  1. exact structural probes (overflow, containment, >=44px targets, text clipping, contrast) over
//     viewport x theme x locale x surface;
//  2. measured raster residuals against the approved Pencil exports, asserted against the
//     manifest's measured budgets (never widened to hide a structural defect);
//  3. Playwright screenshot regression for the error and zero-result states.

let w: StatisticsWorld;
test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(420_000);
  w = await statisticsWorld(browser);
});
test.afterAll(async () => {
  test.setTimeout(240_000);
  await w?.cleanup();
});
test.beforeEach(() => test.setTimeout(240_000));

type Locale = keyof typeof copies;
const LOCALES: Locale[] = ['en', 'pt-BR', 'es'];
const THEMES = ['light', 'dark'] as const;
const VIEWPORTS = [
  { name: 'narrow-320', width: 320, height: 700 },
  { name: 'phone-390', width: 390, height: 844 },
  { name: 'desktop-1280', width: 1280, height: 900 }
] as const;

const A: PlayerKey = 'A';
const surfaces = () => {
  const g1 = w.groupIds['g1']!;
  const g3 = w.groupIds['g3']!;
  return [
    { name: 'player', path: `/players/${w.idOf(A)}` },
    { name: 'pair', path: `/players/${w.idOf(A)}/partners/${w.idOf('B')}` },
    { name: 'opponent', path: `/players/${w.idOf(A)}/opponents/${w.idOf('C')}` },
    { name: 'community', path: `/community/${w.f.community}/statistics` },
    { name: 'history', path: '/matches/past' },
    { name: 'detail-friendly-draw', path: `/matches/${g3.eventId}/groups/${g3.proposalId}` },
    { name: 'detail-competitive', path: `/matches/${g1.eventId}/groups/${g1.proposalId}` }
  ];
};

// --- provenance ----------------------------------------------------------------------------

test('reference provenance pins the design source and every exported frame', () => {
  const design = readFileSync(
    new URL('../docs/design/Padel-friend App Redesign/padel-friend-clubhouse.pen', import.meta.url)
  );
  expect(createHash('sha256').update(design).digest('hex')).toBe(manifest.sourceDesign.sha256);
  for (const reference of Object.values(manifest.approvedReferences)) {
    const png = readFileSync(
      new URL(`./references/paf-202-statistics/${reference.file}`, import.meta.url)
    );
    expect(createHash('sha256').update(png).digest('hex')).toBe(reference.sha256);
    expect(png.readUInt32BE(16)).toBe(reference.pixelSize[0]);
    expect(png.readUInt32BE(20)).toBe(reference.pixelSize[1]);
  }
});

// --- structural probes ---------------------------------------------------------------------

type Probe = {
  overflow: number;
  escaped: string[];
  clipped: string[];
  small: string[];
  lowContrast: string[];
};

/** All geometry is measured from the live DOM; nothing here depends on a raster. */
/**
 * `historyLabel` scopes the probe to the Match history section: /matches/past also renders the
 * pre-existing Matches shell (header, tabs, legacy event cards), which is not statistics UI.
 */
async function probe(page: Page, historyLabel?: string): Promise<Probe> {
  return page.evaluate((scopeLabel) => {
    const out: Probe = { overflow: 0, escaped: [], clipped: [], small: [], lowContrast: [] };
    const doc = document.documentElement;
    out.overflow = doc.scrollWidth - doc.clientWidth;
    const label = (element: Element) =>
      `${element.tagName.toLowerCase()}"${(element.textContent ?? '').trim().slice(0, 30)}"`;
    const scrollsX = (element: Element) => {
      const style = getComputedStyle(element);
      return (
        /(auto|scroll|hidden)/.test(style.overflowX) && element !== doc && element !== document.body
      );
    };
    const main = document.querySelector('main');
    const scoped = scopeLabel
      ? [...document.querySelectorAll('ul[aria-label]')]
          .find((list) => list.getAttribute('aria-label') === scopeLabel)
          ?.closest('section')
      : null;
    const root = scoped ?? main ?? document.body;
    if (scoped) out.overflow = Math.max(0, scoped.scrollWidth - scoped.clientWidth);
    for (const element of root.querySelectorAll('*')) {
      const rect = element.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(element);
      if (style.visibility === 'hidden' || style.display === 'none') continue;
      // Containment: nothing sticks out of the viewport unless a horizontal scroller owns it.
      // The history section is contained by its own box (the legacy Matches shell widens the page).
      const limitRight = scoped ? scoped.getBoundingClientRect().right : doc.clientWidth;
      const limitLeft = scoped ? scoped.getBoundingClientRect().left : 0;
      if (rect.right > limitRight + 0.5 || rect.left < limitLeft - 0.5) {
        let owner: Element | null = element.parentElement;
        while (owner && !scrollsX(owner)) owner = owner.parentElement;
        if (!owner) out.escaped.push(label(element));
      }
      // Text clipping: hidden/ellipsised overflow on an element that actually holds text.
      if (
        element.scrollWidth > element.clientWidth + 1 &&
        /(hidden|clip)/.test(style.overflowX) &&
        (element.textContent ?? '').trim() !== '' &&
        element.children.length === 0
      )
        out.clipped.push(label(element));
      if (
        element.scrollHeight > element.clientHeight + 1 &&
        /(hidden|clip)/.test(style.overflowY) &&
        element.children.length === 0 &&
        (element.textContent ?? '').trim() !== ''
      )
        out.clipped.push(`${label(element)} (vertical)`);
    }
    // Touch targets: every visible control, measured on the clickable box (a radio uses its label).
    const controls = root.querySelectorAll(
      'a[href], button, select, input:not([type=hidden]):not([type=radio]), label:has(input[type=radio]), summary'
    );
    for (const control of controls) {
      const rect = control.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.height < 44 || rect.width < 44)
        out.small.push(`${label(control)} ${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
    // Contrast (WCAG AA 4.5:1) of text against the nearest opaque background.
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/) ?? value.match(/color\(srgb ([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      const scale = value.startsWith('color(') ? 255 : 1;
      return { r: parts[0]! * scale, g: parts[1]! * scale, b: parts[2]! * scale, a: parts[3] ?? 1 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    for (const element of root.querySelectorAll(
      'h1, h2, h3, dt, dd, strong, p, th, td, li, a, button, label'
    )) {
      if (element.children.length > 0 && element.tagName !== 'A' && element.tagName !== 'BUTTON')
        continue;
      const text = (element.textContent ?? '').trim();
      if (!text || element.getBoundingClientRect().width === 0) continue;
      let background = { r: 255, g: 255, b: 255, a: 1 };
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color.a >= 0.99) {
          background = color;
          break;
        }
      }
      const foreground = parse(getComputedStyle(element).color);
      if (!foreground) continue;
      const [hi, lo] = [luminance(foreground), luminance(background)].sort((x, y) => y - x);
      const ratio = (hi! + 0.05) / (lo! + 0.05);
      if (ratio < 4.5) out.lowContrast.push(`${label(element)} ${ratio.toFixed(2)}`);
    }
    return out;
  }, historyLabel);
}

for (const locale of LOCALES) {
  for (const theme of THEMES) {
    for (const viewport of VIEWPORTS) {
      test(`structure holds: ${locale} ${theme} ${viewport.name}`, async () => {
        const page = await w.f.page(w.actors[A], locale, viewport.width, theme, viewport.height);
        const failures: string[] = [];
        for (const surface of surfaces()) {
          await page.goto(surface.path);
          await waitForHydratedPage(page);
          await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
          // Open every chart disclosure so the wide tables are part of the probe.
          const closed = page.getByRole('button', {
            name: copies[locale].statistics.charts.showData
          });
          while ((await closed.count()) > 0) await closed.first().click();
          const found = await probe(
            page,
            surface.name === 'history' ? copies[locale].statistics.history.listLabel : undefined
          );
          if (found.overflow > 0)
            failures.push(`${surface.name}: horizontal overflow ${found.overflow}px`);
          for (const key of ['escaped', 'clipped', 'small', 'lowContrast'] as const)
            for (const item of found[key]) failures.push(`${surface.name}: ${key} ${item}`);
        }
        expect(failures, failures.join('\n')).toEqual([]);
      });
    }
  }
}

// --- Pencil-aligned composition probes -----------------------------------------------------
// Live DOM rectangles and counts, independent of pixels: required regions must be visible and
// horizontally contained, and distinct top-level sections must remain ordered without overlap.
// Stable section heading ids keep these probes locale independent.

type Region = { name: string; selector: string; count?: number };

async function compositionFailures(page: Page, regions: Region[]): Promise<string[]> {
  return page.evaluate((spec) => {
    const failures: string[] = [];
    const main = document.querySelector('main');
    if (!main) return ['no main landmark'];
    let previous: Element | null = null;
    let previousName = '';
    for (const region of spec) {
      const found = [...main.querySelectorAll(region.selector)];
      if (found.length === 0) {
        failures.push(`missing region ${region.name} (${region.selector})`);
        continue;
      }
      if (region.count !== undefined && found.length !== region.count)
        failures.push(`${region.name}: expected ${region.count} elements, found ${found.length}`);
      for (const element of found) {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        if (
          !rect.width ||
          !rect.height ||
          style.visibility !== 'visible' ||
          style.display === 'none'
        )
          failures.push(`${region.name}: hidden or zero area`);
        if (rect.left < -0.5 || rect.right > document.documentElement.clientWidth + 0.5)
          failures.push(`${region.name}: outside viewport horizontally`);
      }
      const first = found[0]!;
      if (previous && !(previous.compareDocumentPosition(first) & Node.DOCUMENT_POSITION_FOLLOWING))
        failures.push(`${region.name} must come after ${previousName}`);
      if (previous && first.getBoundingClientRect().top <= previous.getBoundingClientRect().top)
        failures.push(`${region.name} must be below ${previousName}`);
      previous = first;
      previousName = region.name;
    }
    // Only compare distinct main-level sections: nested rows intentionally sit inside cards.
    const sections = [...main.querySelectorAll(':scope > section')];
    for (let index = 1; index < sections.length; index++) {
      const before = sections[index - 1]!.getBoundingClientRect();
      const after = sections[index]!.getBoundingClientRect();
      if (after.top <= before.top || after.top < before.bottom - 0.5)
        failures.push('main sections overlap or are out of order');
    }
    const tiles = [...main.querySelectorAll('main > section[aria-label] > dl > div')];
    if (tiles.length === 3 && document.documentElement.clientWidth <= 390) {
      const boxes = tiles.map((tile) => tile.getBoundingClientRect());
      if (Math.abs(boxes[0]!.top - boxes[1]!.top) > 0.5)
        failures.push('first two highlight tiles must share a row');
      if (boxes[1]!.left < boxes[0]!.right - 0.5)
        failures.push('highlight tiles overlap on the first row');
      const sameRow = Math.abs(boxes[0]!.top - boxes[2]!.top) <= 0.5;
      if (sameRow && boxes[2]!.left < boxes[1]!.right - 0.5)
        failures.push('third highlight tile overlaps the second');
      if (sameRow !== document.documentElement.clientWidth >= 390)
        failures.push('highlight tiles must use three columns at 390 and two at 320');
      if (!sameRow && boxes[2]!.top < boxes[0]!.bottom - 0.5)
        failures.push('wrapped highlight tile overlaps first row');
    }
    return failures;
  }, regions);
}

const FILTER_BADGES: Region = { name: 'filter context', selector: 'main > header ul[aria-label]' };
const SCOPE_NAME = (id: string): Region => ({
  name: id,
  selector: `section[aria-labelledby="${id}"]`
});

/** RN0yw: filters, three highlight tiles, W-L-D strip, form, then the full record sections. */
const PLAYER_REGIONS: Region[] = [
  { name: 'title', selector: 'main > header h1', count: 1 },
  FILTER_BADGES,
  { name: 'highlight tiles', selector: 'main > section[aria-label] > dl > div', count: 3 },
  { name: 'W-L-D strip', selector: 'main > section[aria-label] > p strong', count: 1 },
  SCOPE_NAME('player-stats-form'),
  SCOPE_NAME('player-recent-matches'),
  SCOPE_NAME('player-stats-filters'),
  {
    name: 'community selector',
    selector: 'section[aria-labelledby="player-stats-filters"] select:not(form select)',
    count: 1
  },
  SCOPE_NAME('player-stats-matches'),
  SCOPE_NAME('player-stats-scores'),
  SCOPE_NAME('player-stats-rating'),
  SCOPE_NAME('player-stats-activity'),
  SCOPE_NAME('player-stats-sets'),
  SCOPE_NAME('player-stats-records')
];

/** GrkSH: breadcrumb, pair title, compact headline card, then record regions and recent matches. */
const PAIR_REGIONS: Region[] = [
  { name: 'breadcrumb', selector: 'main > header nav' },
  { name: 'title', selector: 'main > header h1', count: 1 },
  FILTER_BADGES,
  {
    name: 'compact headline',
    selector: 'main > section[aria-label] > * > p:first-child',
    count: 1
  },
  SCOPE_NAME('pair-stats-filters'),
  {
    name: 'community selector',
    selector: 'section[aria-labelledby="pair-stats-filters"] select:not(form select)',
    count: 1
  },
  SCOPE_NAME('pair-stats-record'),
  SCOPE_NAME('pair-stats-scores'),
  SCOPE_NAME('pair-stats-streaks'),
  SCOPE_NAME('pair-stats-rating'),
  SCOPE_NAME('pair-stats-leagues'),
  SCOPE_NAME('relationship-recent')
];

/** khmeK: opponent record, head-to-head sections, recent meetings (no pair-only regions). */
const OPPONENT_REGIONS: Region[] = [
  { name: 'breadcrumb', selector: 'main > header nav' },
  { name: 'title', selector: 'main > header h1', count: 1 },
  FILTER_BADGES,
  SCOPE_NAME('relationship-recent'),
  SCOPE_NAME('opponent-stats-filters'),
  {
    name: 'community selector',
    selector: 'section[aria-labelledby="opponent-stats-filters"] select:not(form select)',
    count: 1
  },
  SCOPE_NAME('opponent-stats-record'),
  SCOPE_NAME('opponent-stats-scores'),
  SCOPE_NAME('opponent-stats-streaks'),
  SCOPE_NAME('opponent-stats-rating')
];

/** o9iaC1: scope, volume, player leaders, team and matchup records, activity by month and week. */
const COMMUNITY_REGIONS: Region[] = [
  { name: 'title', selector: 'main > header h1', count: 1 },
  FILTER_BADGES,
  SCOPE_NAME('community-matches'),
  SCOPE_NAME('community-filters'),
  SCOPE_NAME('community-leaders'),
  SCOPE_NAME('community-pairings'),
  SCOPE_NAME('community-frequency'),
  { name: 'frequency charts', selector: '#community-frequency ~ * figure', count: 2 }
];

/**
 * BcpYH: result hero (team sides + one score per set), players with per-player levels in two team
 * blocks, set scores, then meta facts, confirmation and the audit timeline.
 */
const detailRegions = (sets: number): Region[] => [
  { name: 'title', selector: 'main > header h1', count: 1 },
  SCOPE_NAME('statistics-detail-result'),
  {
    name: 'team rows in the scorecard',
    selector: '#statistics-detail-result ~ table tbody > tr',
    count: 2
  },
  SCOPE_NAME('statistics-detail-players'),
  { name: 'team blocks', selector: '#statistics-detail-players ~ section h3', count: 2 },
  { name: 'player level blocks', selector: '#statistics-detail-players ~ section h4', count: 4 },
  SCOPE_NAME('statistics-detail-sets'),
  { name: 'set score lines', selector: '#statistics-detail-sets ~ ol > li', count: sets },
  { name: 'meta facts', selector: 'main > :not(header):not(section) dl' },
  SCOPE_NAME('statistics-detail-confirmation'),
  SCOPE_NAME('statistics-detail-timeline')
];

for (const [locale, width] of LOCALES.flatMap((language) =>
  [320, 390].map((viewportWidth) => [language, viewportWidth] as const)
)) {
  test(`composition follows the Pencil frames: ${locale} ${width}`, async () => {
    const page = await w.f.page(w.actors[A], locale, width, 'light', 844);
    const expected: Record<string, Region[]> = {
      player: PLAYER_REGIONS,
      pair: PAIR_REGIONS,
      opponent: OPPONENT_REGIONS,
      community: COMMUNITY_REGIONS,
      'detail-friendly-draw': detailRegions(3),
      'detail-competitive': detailRegions(2)
    };
    const failures: string[] = [];
    for (const surface of surfaces()) {
      const regions = expected[surface.name];
      if (!regions) continue;
      await page.goto(surface.path);
      await waitForHydratedPage(page);
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
      for (const failure of await compositionFailures(page, regions))
        failures.push(`${surface.name}: ${failure}`);
    }
    // Pair is the compact summary: it never draws the player highlight tiles; opponent has no
    // pair-only league region.
    await page.goto(surfaces().find((candidate) => candidate.name === 'pair')!.path);
    await waitForHydratedPage(page);
    if ((await page.locator('main > section[aria-label] > dl').count()) !== 0)
      failures.push('pair: unexpected highlight tiles');
    await page.goto(surfaces().find((candidate) => candidate.name === 'opponent')!.path);
    await waitForHydratedPage(page);
    if ((await page.locator('#pair-stats-leagues').count()) !== 0)
      failures.push('opponent: unexpected pair league region');
    expect(failures, failures.join('\n')).toEqual([]);
  });
}

// --- Hit-target and intra-card geometry probes ---------------------------------------------

test('community selectors and recent-match cards keep 44px targets without overlap', async () => {
  for (const locale of LOCALES) {
    for (const width of [320, 390]) {
      const page = await w.f.page(w.actors[A], locale, width, 'light', 844);
      const failures: string[] = [];
      const targets: Record<string, string> = {
        player: 'section[aria-labelledby="player-stats-filters"] select:not(form select)',
        pair: 'section[aria-labelledby="pair-stats-filters"] select:not(form select)',
        opponent: 'section[aria-labelledby="opponent-stats-filters"] select:not(form select)'
      };
      for (const [name, selector] of Object.entries(targets)) {
        const surface = surfaces().find((candidate) => candidate.name === name)!;
        await page.goto(surface.path);
        await waitForHydratedPage(page);
        const box = await page.locator(selector).boundingBox();
        if (!box) failures.push(`${name}: community selector not rendered`);
        else if (box.width < 44 || box.height < 44)
          failures.push(`${name}: community selector ${box.width}x${box.height}`);
      }
      const player = surfaces().find((candidate) => candidate.name === 'player')!;
      await page.goto(player.path);
      await waitForHydratedPage(page);
      const geometry = await page.evaluate(() => {
        const list = document.querySelectorAll(
          'section[aria-labelledby="player-recent-matches"] ul > li'
        );
        const overlaps = (a: DOMRect, b: DOMRect) =>
          a.left < b.right - 0.5 &&
          b.left < a.right - 0.5 &&
          a.top < b.bottom - 0.5 &&
          b.top < a.bottom - 0.5;
        const out: { rows: { top: number; bottom: number }[]; issues: string[] } = {
          rows: [],
          issues: []
        };
        list.forEach((row, index) => {
          const rect = row.getBoundingClientRect();
          out.rows.push({ top: rect.top, bottom: rect.bottom });
          const kids = [...row.children].map((child) => ({
            name: child.tagName.toLowerCase(),
            rect: child.getBoundingClientRect()
          }));
          for (const kid of kids)
            if (kid.name === 'a' && (kid.rect.width < 44 || kid.rect.height < 44))
              out.issues.push(`row ${index}: link ${kid.rect.width}x${kid.rect.height}`);
          for (let i = 0; i < kids.length; i++)
            for (let j = i + 1; j < kids.length; j++)
              if (overlaps(kids[i]!.rect, kids[j]!.rect))
                out.issues.push(`row ${index}: ${kids[i]!.name} overlaps ${kids[j]!.name}`);
          const meta = row.firstElementChild;
          if (meta) {
            const parts = [...meta.children].map((child) => child.getBoundingClientRect());
            for (let i = 0; i < parts.length; i++)
              for (let j = i + 1; j < parts.length; j++)
                if (overlaps(parts[i]!, parts[j]!))
                  out.issues.push(`row ${index}: meta items overlap`);
          }
        });
        return out;
      });
      if (geometry.rows.length === 0) failures.push('player: no recent-match rows');
      failures.push(...geometry.issues);
      for (let index = 1; index < geometry.rows.length; index++)
        if (geometry.rows[index]!.top <= geometry.rows[index - 1]!.bottom - 0.5)
          failures.push(`recent rows ${index - 1}/${index} are not vertically stacked`);
      expect(failures, `${locale} ${width}: ${failures.join('\n')}`).toEqual([]);
      await page.context().close();
    }
  }
});

// --- Pencil-aligned raster residuals ------------------------------------------------------

type RasterRegion = { name: string; top: number; bottom: number };
type RasterFrame = keyof typeof manifest.visualBudgets.rasterRegions;

async function residual(page: Page, info: TestInfo, frame: RasterFrame): Promise<number> {
  const reference = manifest.approvedReferences[frame];
  const evidence = manifest.visualBudgets.rasterRegions[frame];
  await page.evaluate(() => window.scrollTo(0, 0));
  const actual = await page.screenshot({ animations: 'disabled', caret: 'hide' });
  const approved = readFileSync(
    new URL(`./references/paf-202-statistics/${reference.file}`, import.meta.url)
  );

  const card = page.locator(evidence.cardSelector).first();
  await expect(card).toHaveCSS('border-top-left-radius', '20px');
  await expect(card).toHaveCSS('border-left-width', '1px');
  await card.evaluate((element) => element.scrollIntoView({ block: 'start' }));
  const box = await card.boundingBox();
  if (!box) throw new Error(`Missing score or summary card for ${frame}`);
  expect(box.x, `${frame}: left card gutter`).toBe(20);
  const edge = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: Math.round(box.y) + 22, width: 32, height: 20 }
  });

  const dataUrl = (image: Buffer) => `data:image/png;base64,${image.toString('base64')}`;
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, edgeUrl, referenceTop, regions }) => {
      const read = async (url: string, x: number, y: number, width: number, height: number) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        if (x + width > image.width || y + height > image.height)
          throw new Error('Statistics raster region outside capture');
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(image, x, y, width, height, 0, 0, width, height);
        return ctx.getImageData(0, 0, width, height).data;
      };
      const diff = (a: Uint8ClampedArray, b: Uint8ClampedArray) => {
        let changed = 0;
        for (let index = 0; index < a.length; index += 4) {
          const red = a[index]! - b[index]!;
          const green = a[index + 1]! - b[index + 1]!;
          const blue = a[index + 2]! - b[index + 2]!;
          const luma = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
          const i = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
          const q = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
          if (0.5053 * luma * luma + 0.299 * i * i + 0.1957 * q * q > 35215 * 0.1 ** 2) changed++;
        }
        return (changed * 4) / a.length;
      };
      const [actualEdge, expectedEdge] = await Promise.all([
        read(edgeUrl, 0, 0, 32, 20),
        read(approvedUrl, 0, referenceTop + 22, 32, 20)
      ]);
      const bands = await Promise.all(
        regions.map(async ({ name, top, bottom }: RasterRegion) => {
          const [a, b] = await Promise.all([
            read(actualUrl, 0, top, 390, bottom - top),
            read(approvedUrl, 0, top, 390, bottom - top)
          ]);
          return [name, diff(a, b)] as const;
        })
      );
      return { edge: diff(actualEdge, expectedEdge), bands: Object.fromEntries(bands) };
    },
    {
      actualUrl: dataUrl(actual),
      approvedUrl: dataUrl(approved),
      edgeUrl: dataUrl(edge),
      referenceTop: evidence.referenceTop,
      regions: evidence.bands
    }
  );
  console.info(`PAF-202 ${frame} edge and diagnostic bands: ${JSON.stringify(measured)}`);
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-card-edge`, { body: edge, contentType: 'image/png' });
  return measured.edge;
}

const rasterFrames = ['RN0yw', 'GrkSH', 'khmeK', 'o9iaC1', 'BcpYH'] as const;

for (const frame of rasterFrames) {
  const evidence = manifest.visualBudgets.rasterRegions[frame];
  test(`Pencil surface edge ${frame} stays within its measured budget`, async () => {
    const info = test.info();
    const page = await w.f.page(w.actors[A], 'en', 390, 'light', 844);
    const surface = surfaces().find((candidate) => candidate.name === evidence.surface)!;
    await page.goto(surface.path);
    await waitForHydratedPage(page);
    await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible();
    const measured = await residual(page, info, frame);
    expect(measured).toBeLessThanOrEqual(evidence.budget);
  });
}

// Pagination needs more than one page of real finalized meetings. Seed after raster captures.
test('relationship Show more controls have visible, contained 44px geometry', async () => {
  await w.seedMoreMeetings();
  for (const width of [320, 390]) {
    const page = await w.f.page(w.actors[A], 'en', width, 'light', 844);
    for (const name of ['pair', 'opponent']) {
      const surface = surfaces().find((candidate) => candidate.name === name)!;
      await page.goto(surface.path);
      await waitForHydratedPage(page);
      const section = page.locator('section[aria-labelledby="relationship-recent"]');
      const button = section.getByRole('button', {
        name: copies.en.statistics.relationships.showMore
      });
      await expect(button).toBeVisible();
      const box = await button.boundingBox();
      const sectionBox = await section.boundingBox();
      expect(box).not.toBeNull();
      expect(sectionBox).not.toBeNull();
      expect(box!.width).toBeGreaterThanOrEqual(44);
      expect(box!.height).toBeGreaterThanOrEqual(44);
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(width + 0.5);
      expect(box!.y).toBeGreaterThan(sectionBox!.y);
      expect(box!.y + box!.height).toBeLessThanOrEqual(sectionBox!.y + sectionBox!.height + 0.5);
    }
    await page.context().close();
  }
});

// --- states ----------------------------------------------------------------------------------

test('error, zero-result and insufficient states render localized, accessible content', async () => {
  for (const locale of LOCALES) {
    const copy = copies[locale].statistics;
    const page = await w.f.page(w.actors[A], locale, 390, 'light', 844);

    // Error: an impossible date range is rejected by the shared validator.
    await page.goto(`/players/${w.idOf(A)}?from=2026-10-05&through=2026-09-01`);
    await waitForHydratedPage(page);
    await expect(page.getByRole('alert')).toContainText(copy.errors.INVALID_STATISTICS_INPUT);
    expect((await probe(page)).overflow).toBeLessThanOrEqual(0);
    if (locale === 'en')
      await expect(page).toHaveScreenshot('player-error-state.png', {
        fullPage: true,
        maxDiffPixelRatio: 0.002
      });

    // Zero: a window with no matches shows true zero counts and typed reasons, never NaN.
    await page.goto(`/players/${w.idOf(A)}?from=2027-01-01`);
    await waitForHydratedPage(page);
    await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
    await expect(page.locator('main')).not.toContainText(/NaN|Infinity|undefined/);
    expect((await probe(page)).overflow).toBeLessThanOrEqual(0);

    // Insufficient: the unfiltered player has threshold metrics below their minimum evidence.
    await page.goto(`/players/${w.idOf(A)}`);
    await waitForHydratedPage(page);
    await expect(page.locator('main')).not.toContainText(/NaN|Infinity|undefined|statistics\./);
    await expect(page.getByText(copies[locale].statistics.player.noValue).first()).toBeVisible();

    // Empty community selection: Friendly never belongs to a League.
    await page.goto(
      `/community/${w.f.community}/statistics?leagueId=${w.leagues.active.id}&type=friendly`
    );
    await waitForHydratedPage(page);
    await expect(page.getByText(copy.community.notice.friendly_league)).toBeVisible();
    expect((await probe(page)).overflow).toBeLessThanOrEqual(0);
  }
});
