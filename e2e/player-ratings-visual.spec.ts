import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import {
  expect,
  test,
  type ElementHandle,
  type Locator,
  type Page,
  type TestInfo
} from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import manifest from './references/paf-10/manifest.json' with { type: 'json' };
import { confirmGroup, pastEvent, removeProvisionalEvidence } from './player-ratings-fixtures';
import { copies, resultFixtures, type Actor } from './matches-results-fixtures';

type Fixtures = Awaited<ReturnType<typeof resultFixtures>>;
const rating = copies.en.rating;
let f: Fixtures;
let host: Actor;

test.use({ serviceWorkers: 'block' });
test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  test.setTimeout(300_000);
  f = await resultFixtures(browser, {
    creatorName: 'Thiago Ribeiro',
    memberNames: ['Ana M.', 'Pedro L.', 'Carlos F.', 'Luis G.'],
    communityName: 'Padel Friends',
    memberCount: 4
  });
  host = f.creator;
  const [a, b, c, d] = f.members.map((member) => member.id);
  // Three confirmed games through the production finalizer: win, loss, draw.
  const games: [string, [string, string, string, string], 'team_a' | 'team_b' | 'draw'][] = [
    ['2026-10-10T18:00:00Z', [host.id, a!, b!, c!], 'team_a'],
    ['2026-10-12T18:00:00Z', [host.id, b!, a!, d!], 'team_b'],
    ['2026-10-14T18:00:00Z', [host.id, d!, c!, a!], 'draw']
  ];
  for (const [playedAt, players, classification] of games)
    await confirmGroup({
      eventId: await pastEvent(f),
      players,
      playedAt,
      submittedBy: host.id,
      classification
    });
});
test.afterAll(async () => {
  test.setTimeout(120_000);
  await removeProvisionalEvidence([]);
  await f?.cleanup();
});
test.beforeEach(() => test.setTimeout(120_000));

const FRAME = 'vARtQ';
const WIDTH = 390;
// Two separately aligned regions of the one frame export (CSS px, frame coordinates):
// the header/identity/level card; the "Rating journey" heading + progression card; and the
// recent-matches card. Each is aligned on its own anchor so one shifted block never skews another.
const REGIONS = {
  top: { name: 'top', y: 0, height: 308, budgetKey: FRAME },
  journey: { name: 'journey', y: 396, height: 184, budgetKey: `${FRAME}:journey` },
  history: { name: 'history', y: 588, height: 160, budgetKey: `${FRAME}:history` }
} as const;
type Region = (typeof REGIONS)[keyof typeof REGIONS];
// The frame's journey heading text is centred 22px below the journey crop top.
const JOURNEY_HEADING_CENTRE = 22;

// --- helpers -----------------------------------------------------------------------------

type Box = { x: number; y: number; right: number; bottom: number; width: number; height: number };
const box = (locator: Locator): Promise<Box> =>
  locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y, right, bottom, width, height };
  });

/** WCAG contrast of an element's text against its nearest opaque ancestor background. */
async function contrast(locator: Locator): Promise<number> {
  return locator.evaluate((element) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/) ?? value.match(/color\(srgb ([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      const scale = value.startsWith('color(') ? 255 : 1;
      return {
        r: parts[0]! * scale,
        g: parts[1]! * scale,
        b: parts[2]! * scale,
        a: parts[3] ?? 1
      };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    let background = { r: 255, g: 255, b: 255, a: 1 };
    for (let node: Element | null = element; node; node = node.parentElement) {
      const color = parse(getComputedStyle(node).backgroundColor);
      if (color && color.a >= 0.99) {
        background = color;
        break;
      }
    }
    const text = parse(getComputedStyle(element).color)!;
    const [hi, lo] = [luminance(text), luminance(background)].sort((x, y) => y - x);
    return (hi! + 0.05) / (lo! + 0.05);
  });
}

/**
 * Exact vertical geometry of the profile → rating journey stack, from DOM measurement only
 * (independent of every raster comparison). Returns human-readable violations; empty = sound.
 *
 * Bounds are derived, not measured-once:
 *  - Inter-block gaps: the layout declares them with a token gap on the shared grid/flex
 *    parent (`main` row-gap between level card and journey, `--space-8` inside the journey
 *    grid). The expected gap is that parent's computed row-gap, ±1px for sub-pixel rounding,
 *    and the declared gap itself must be a sane token step: ≥ --space-4 (blocks never touch)
 *    and ≤ --space-20 (no blank band; the largest card-scale step). A pushed or collapsed
 *    block therefore fails regardless of how it is rasterised.
 *  - Card content: a card is at least as tall as the sum of its children (natural minimum),
 *    its last child ends inside it (not clipped, not overflowing), and it has no vertical
 *    scroll overflow.
 *  - Page: both cards sit fully inside `main` and the document height.
 *  - Plot: the SVG keeps the viewBox aspect ratio (not shrunk), and every marker, the trend
 *    line and the area stay inside the SVG box (no clipped/out-of-range points).
 */
async function journeyVerticalViolations(region: Locator): Promise<string[]> {
  return region.evaluate((section) => {
    const out: string[] = [];
    const px = (value: string) => Number.parseFloat(value) || 0;
    const rect = (element: Element) => element.getBoundingClientRect();
    const root = getComputedStyle(document.documentElement);
    const token = (name: string) => px(root.getPropertyValue(name));
    const minGap = token('--space-4');
    const maxGap = token('--space-20');
    const main = section.closest('main')!;
    const levelCard = [...main.querySelectorAll('section')].find(
      (candidate) => candidate !== section && candidate.querySelector('progress')
    )!;
    const header = section.firstElementChild!;
    const cards = [...section.children].filter(
      (child) => child.tagName === 'DIV' && child !== header
    );
    const [chartCard, historyCard] = cards;
    if (!chartCard || !historyCard) return ['journey chart and history cards missing'];

    const gap = (what: string, upper: Element, lower: Element, parent: Element) => {
      const declared = px(getComputedStyle(parent).rowGap);
      const actual = rect(lower).top - rect(upper).bottom;
      if (declared < minGap || declared > maxGap)
        out.push(`${what}: declared gap ${declared}px outside token range ${minGap}-${maxGap}px`);
      if (Math.abs(actual - declared) > 1)
        out.push(`${what}: gap ${actual.toFixed(1)}px differs from declared ${declared}px`);
    };
    // The level card may be followed by other profile blocks only when editing; anchor on the
    // element that actually precedes the journey.
    const before = section.previousElementSibling ?? levelCard;
    gap('level card → journey heading', before, header, main);
    gap('journey heading → chart card', header, chartCard, section);
    gap('chart card → history card', chartCard, historyCard, section);

    const mainBox = rect(main);
    const pageBottom = document.documentElement.scrollHeight;
    for (const [what, card] of [
      ['chart', chartCard],
      ['history', historyCard]
    ] as const) {
      const bounds = rect(card);
      const children = [...card.children].filter((child) => rect(child).height > 0);
      const natural = children.reduce((sum, child) => sum + rect(child).height, 0);
      if (bounds.height + 1 < natural)
        out.push(`${what} card ${bounds.height}px shorter than content ${natural}px`);
      const lastBottom = Math.max(...children.map((child) => rect(child).bottom));
      if (lastBottom > bounds.bottom + 1)
        out.push(`${what} card clips content (${lastBottom} > ${bounds.bottom})`);
      if (card.scrollHeight - card.clientHeight > 1) out.push(`${what} card scrolls vertically`);
      if (bounds.top < mainBox.top - 1 || bounds.bottom > mainBox.bottom + 1)
        out.push(`${what} card outside page container`);
      if (bounds.bottom > pageBottom + 1) out.push(`${what} card outside document`);
    }

    const rows = [...historyCard.querySelectorAll('li')].filter((li) => li.querySelector('time'));
    if (rows.length === 0) out.push('history rows missing');
    for (const row of rows) {
      const bounds = rect(row);
      if (bounds.height <= 0) out.push('history row has no height');
      if (bounds.bottom > rect(historyCard).bottom + 1)
        out.push('history row outside history card');
    }

    const svg = chartCard.querySelector('svg')!;
    const svgBox = rect(svg);
    // Design plot: viewBox 320×120. The viewBox itself is pinned (an altered viewBox is a defect),
    // and the SVG must fill the plot grid's fluid column: grid content width minus the axis
    // column and column gap, all measured from the live container, never hardcoded px.
    const DESIGN_WIDTH = 320;
    const DESIGN_HEIGHT = 120;
    const viewBox = svg.viewBox.baseVal;
    if (viewBox.width !== DESIGN_WIDTH || viewBox.height !== DESIGN_HEIGHT)
      out.push(`chart svg viewBox ${viewBox.width}x${viewBox.height} != design viewBox`);
    const plotGrid = svg.parentElement!;
    const plotStyle = getComputedStyle(plotGrid);
    const axisBox = rect(plotGrid.firstElementChild!);
    const expectedWidth =
      rect(plotGrid).width -
      px(plotStyle.paddingLeft) -
      px(plotStyle.paddingRight) -
      axisBox.width -
      px(plotStyle.columnGap);
    const expectedHeight = (expectedWidth * DESIGN_HEIGHT) / DESIGN_WIDTH;
    if (svgBox.height <= 0) out.push('chart svg has no height');
    if (Math.abs(svgBox.width - expectedWidth) > 1)
      out.push(`chart svg width ${svgBox.width} != container column ${expectedWidth}`);
    if (Math.abs(svgBox.height - expectedHeight) > 1)
      out.push(`chart svg height ${svgBox.height} != container ratio ${expectedHeight}`);
    for (const shape of svg.querySelectorAll('circle, polyline, polygon')) {
      const bounds = rect(shape);
      if (
        bounds.left < svgBox.left - 0.5 ||
        bounds.right > svgBox.right + 0.5 ||
        bounds.top < svgBox.top - 0.5 ||
        bounds.bottom > svgBox.bottom + 0.5
      )
        out.push(`plot ${shape.tagName} leaves the svg bounds`);
    }
    return out;
  });
}

async function openProfile(
  theme: 'light' | 'dark',
  width: number,
  height: number
): Promise<{ page: Page; region: Locator }> {
  const page = await f.page(host, 'en', width, theme, height);
  await page.goto('/dashboard');
  await waitForHydratedPage(page);
  const region = page.getByRole('region', { name: rating.journey.title });
  await expect(region).toBeVisible();
  return { page, region };
}

async function compareRegion(
  page: Page,
  info: TestInfo,
  region: Region,
  top: number
): Promise<number> {
  await page.setViewportSize({ width: WIDTH, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    clip: { x: 0, y: top, width: WIDTH, height: region.height },
    path: info.outputPath(`${FRAME}-${region.name}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-10/${FRAME}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, area }) => {
      const load = async (url: string, crop: number, offset: number) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = area.width;
        canvas.height = area.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(
          image,
          0,
          offset * crop,
          area.width * crop,
          area.height * crop,
          0,
          0,
          area.width,
          area.height
        );
        return context.getImageData(0, 0, area.width, area.height).data;
      };
      const [rendered, reference] = await Promise.all([
        load(actualUrl, 1, 0),
        load(approvedUrl, 2, area.y)
      ]);
      let changed = 0;
      for (let index = 0; index < rendered.length; index += 4) {
        const red = rendered[index]! - reference[index]!;
        const green = rendered[index + 1]! - reference[index + 1]!;
        const blue = rendered[index + 2]! - reference[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        )
          changed++;
      }
      return changed / (area.width * area.height);
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
      area: { width: WIDTH, height: region.height, y: region.y }
    }
  );
  console.info(`${FRAME} PAF-10 ${region.name} region measurement: ${measured}`);
  await info.attach(`${FRAME}-${region.name}-actual`, { body: actual, contentType: 'image/png' });
  return measured;
}

// --- provenance --------------------------------------------------------------------------

test('reference provenance pins the current design source and exported frame', () => {
  const design = readFileSync(new URL('../docs/design/padel-friend.pen', import.meta.url));
  expect(createHash('sha256').update(design).digest('hex')).toBe(manifest.sourceDesign.sha256);
  const png = readFileSync(new URL(`./references/paf-10/${FRAME}.png`, import.meta.url));
  expect(createHash('sha256').update(png).digest('hex')).toBe(
    manifest.approvedReferences[FRAME].sha256
  );
  expect(png.readUInt32BE(16)).toBe(manifest.approvedReferences[FRAME].pixelSize[0]);
  expect(png.readUInt32BE(20)).toBe(manifest.approvedReferences[FRAME].pixelSize[1]);
});

// --- structure + raster ------------------------------------------------------------------

test('profile keeps the Pencil order, geometry and a reviewed raster budget (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const { page, region } = await openProfile('light', 390, 844);
  const name = page.getByRole('heading', { level: 2, name: host.name });
  const title = page.getByRole('heading', { level: 1, name: copies.en.profile.title });
  const levelLabel = page.getByText(copies.en.profile.globalLevel, { exact: true });
  const journeyHeading = region.getByRole('heading', { level: 2, name: rating.journey.title });
  const scope = region.getByText(rating.journey.scope, { exact: true });
  const [t, n, l, j, s] = await Promise.all(
    [title, name, levelLabel, journeyHeading, scope].map(box)
  );

  // Exact structural order of the frame: title → identity hero → level card → journey header.
  expect(t!.bottom).toBeLessThanOrEqual(n!.y);
  expect(n!.bottom).toBeLessThanOrEqual(l!.y);
  expect(l!.bottom).toBeLessThanOrEqual(j!.y);
  expect(Math.abs(s!.y - j!.y), 'scope tag shares the heading row').toBeLessThanOrEqual(12);
  expect(s!.x).toBeGreaterThan(j!.x);

  // Journey cards share the page gutter and never leave the viewport.
  const cards = region.locator('> div');
  expect(await cards.count()).toBeGreaterThanOrEqual(2);
  const levelCard = await box(levelLabel.locator('xpath=ancestor::section[1]'));
  for (const [index, card] of (await cards.all()).entries()) {
    const b = await box(card);
    expect(b.x, `card ${index} left gutter`).toBeGreaterThanOrEqual(levelCard.x - 2);
    expect(b.right, `card ${index} right gutter`).toBeLessThanOrEqual(levelCard.right + 2);
    expect(b.right).toBeLessThanOrEqual(390);
  }

  // Chart: plot fills its card, axis labels precede it, text equivalent follows it.
  const svg = region.locator('svg').first();
  const plot = await box(svg);
  const chartCard = await box(
    region.getByRole('heading', { name: rating.progress.title }).locator('xpath=..')
  );
  expect(plot.x).toBeGreaterThanOrEqual(chartCard.x);
  expect(plot.right).toBeLessThanOrEqual(chartCard.right + 1);
  expect(plot.height).toBeGreaterThan(60);
  await expect(region.getByText(/Level moved from/)).toBeVisible();

  // History rows stack in order without overlap; every control is a ≥44px touch target.
  const rows = await region
    .getByRole('listitem')
    .filter({ has: page.locator('time') })
    .all();
  expect(rows).toHaveLength(3);
  let previous: Box | undefined;
  for (const row of rows) {
    const b = await box(row);
    if (previous) expect(previous.bottom).toBeLessThanOrEqual(b.y + 1);
    previous = b;
  }
  for (const control of await region.locator('button').all()) {
    const b = await box(control);
    expect.soft(b.height).toBeGreaterThanOrEqual(44);
    expect.soft(b.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);

  // The app shell above the profile is out of this frame: align on the title (frame offset 20px).
  const measured = await compareRegion(page, info, REGIONS.top, Math.max(0, Math.round(t!.y) - 20));
  expect(measured, `${FRAME} raster budget`).toBeLessThanOrEqual(
    manifest.visualBudgets.perScreen[FRAME]
  );
  expect(manifest.visualBudgets.perScreen[FRAME]).toBeGreaterThan(0);
});

test('rating journey keeps the Pencil order, card geometry and a reviewed raster budget (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const { page, region } = await openProfile('light', 390, 844);
  const journeyHeading = region.getByRole('heading', { level: 2, name: rating.journey.title });
  const chartHeading = region.getByRole('heading', { name: rating.progress.title });
  const chartCard = chartHeading.locator('xpath=..');
  const firstRow = region
    .getByRole('listitem')
    .filter({ has: page.locator('time') })
    .first();
  const historyCard = firstRow.locator('xpath=ancestor::*[self::div or self::section][1]');
  const levelCard = page
    .getByText(copies.en.profile.globalLevel, { exact: true })
    .locator('xpath=ancestor::section[1]');

  // Order: heading → chart card → history card, in the DOM and on screen.
  const order = await page.evaluate(
    ([chart, history]) =>
      (chart.compareDocumentPosition(history) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
    [await chartCard.elementHandle(), await historyCard.elementHandle()] as [
      ElementHandle<Element>,
      ElementHandle<Element>
    ]
  );
  expect(order, 'chart card precedes history card in the DOM').toBe(true);
  const [j, c, h] = await Promise.all([journeyHeading, chartCard, historyCard].map(box));
  expect(j!.bottom).toBeLessThanOrEqual(c!.y);
  expect(c!.bottom, 'chart card ends before history card starts').toBeLessThanOrEqual(h!.y);
  expect(c!.y).toBeGreaterThan(j!.y);

  // Card geometry: both cards share the level card's gutters, radius token and surface, and
  // contain their content (no overflow, no clipped plot).
  const [lc] = await Promise.all([levelCard].map(box));
  for (const [what, card] of [
    ['chart', chartCard],
    ['history', historyCard]
  ] as const) {
    const b = await box(card);
    expect(
      Math.abs(b.x - lc!.x),
      `${what} card left gutter matches level card`
    ).toBeLessThanOrEqual(1);
    expect(Math.abs(b.right - lc!.right), `${what} card right gutter`).toBeLessThanOrEqual(1);
    const style = await card.evaluate((element) => {
      const computed = getComputedStyle(element);
      const root = getComputedStyle(document.documentElement);
      return {
        radius: computed.borderTopLeftRadius,
        tokens: ['--radius-16', '--radius-18', '--radius-20'].map((name) =>
          root.getPropertyValue(name).trim()
        ),
        overflowX: element.scrollWidth - element.clientWidth,
        position: computed.position
      };
    });
    expect(style.tokens, `${what} card radius is a design-token value`).toContain(style.radius);
    expect(style.overflowX, `${what} card content containment`).toBeLessThanOrEqual(0);
  }
  const levelRadius = await levelCard.evaluate((e) => getComputedStyle(e).borderTopLeftRadius);
  expect(await chartCard.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe(
    levelRadius
  );
  expect(await historyCard.evaluate((e) => getComputedStyle(e).borderTopLeftRadius)).toBe(
    levelRadius
  );
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);

  // Vertical geometry, exact and raster-independent (see journeyVerticalViolations).
  expect(await journeyVerticalViolations(region), 'journey vertical geometry').toEqual([]);

  // Probe sensitivity: each injected defect must be reported, so the probes cannot pass
  // vacuously. Injections are page-local and the raster comparison below re-reads a reload.
  const inject = async (
    what: string,
    mutate: (section: Element) => void,
    expected: RegExp,
    { forbidden }: { forbidden?: RegExp } = {}
  ) => {
    await region.evaluate(mutate);
    const violations = (await journeyVerticalViolations(region)).join('\n');
    expect(violations, `${what} is detected`).toMatch(expected);
    // Detection must come from the intended probe alone, not a neighbouring one.
    if (forbidden)
      expect(violations, `${what} detected only by its own probe`).not.toMatch(forbidden);
    console.info(`PAF-10 probe sensitivity: ${what} -> ${violations.split('\n').join(' | ')}`);
  };
  await inject(
    'blank band before history',
    (section) => section.children[3]?.setAttribute('style', 'margin-top: 40px'),
    /chart card → history card: gap/
  );
  await page.reload();
  await waitForHydratedPage(page);
  await inject(
    'blank band before journey heading',
    (section) => section.firstElementChild?.setAttribute('style', 'margin-top: 40px'),
    /level card → journey heading: gap|declared gap/
  );
  await page.reload();
  await waitForHydratedPage(page);
  await inject(
    'clipped chart card',
    (section) => section.children[2]?.setAttribute('style', 'max-height: 40px; overflow: hidden'),
    /chart card (clips|scrolls)|shorter than content/
  );
  await page.reload();
  await waitForHydratedPage(page);
  await inject(
    'shrunken chart svg',
    (section) => section.querySelector('svg')?.setAttribute('style', 'height: 20px'),
    /chart svg height/
  );
  await page.reload();
  await waitForHydratedPage(page);
  // Proportional shrink keeps the aspect ratio valid; only the container-relative size check
  // can catch it, so it must report the width/height-vs-container violations specifically.
  await inject(
    'proportionally shrunken chart svg',
    (section) => section.querySelector('svg')?.setAttribute('style', 'width: 50%'),
    /chart svg width .* != container column/,
    { forbidden: /viewBox|leaves the svg bounds/ }
  );
  await page.reload();
  await waitForHydratedPage(page);
  // Viewbox and svg box stay valid; only the plot shapes move out of bounds, so the plot
  // containment probe is the sole detection path (no size/ratio/viewBox violation allowed).
  await inject(
    'plot points outside the svg',
    (section) =>
      section
        .querySelectorAll('svg:not([viewBox="0 0 12 12"]) circle, polyline, polygon')
        .forEach((shape) => shape.setAttribute('style', 'transform: translateY(200px)')),
    /plot (circle|polyline|polygon) leaves the svg bounds/,
    // Exclusivity: every violation must be a plot-containment violation — any other
    // probe kind (size, ratio, viewBox, gap, card overflow, …) must not fire here.
    { forbidden: /^(?!plot (circle|polyline|polygon) leaves the svg bounds)/ }
  );
  await page.reload();
  await waitForHydratedPage(page);
  expect(await journeyVerticalViolations(region), 'geometry restored after reload').toEqual([]);

  // The frame centres the "Rating journey" heading 22px below the region top: align on it.
  const top = Math.max(0, Math.round(j!.y + j!.height / 2 - JOURNEY_HEADING_CENTRE));
  const journeyMeasured = await compareRegion(page, info, REGIONS.journey, top);
  const journeyBudget = manifest.visualBudgets.perScreen[REGIONS.journey.budgetKey];
  expect(journeyMeasured, `${REGIONS.journey.budgetKey} raster budget`).toBeLessThanOrEqual(
    journeyBudget
  );
  expect(journeyBudget).toBeGreaterThan(0);

  // The history card is aligned on its own top edge (frame card top = 588px).
  const historyMeasured = await compareRegion(page, info, REGIONS.history, Math.round(h!.y));
  const historyBudget = manifest.visualBudgets.perScreen[REGIONS.history.budgetKey];
  expect(historyMeasured, `${REGIONS.history.budgetKey} raster budget`).toBeLessThanOrEqual(
    historyBudget
  );
  expect(historyBudget).toBeGreaterThan(0);
});

test('explanation dialog fits the viewport, scrolls inside itself and keeps readable contrast (light, dark, narrow, desktop)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  for (const [theme, width, height] of [
    ['light', 390, 844],
    ['dark', 390, 844],
    ['dark', 320, 640],
    ['light', 1280, 800]
  ] as const) {
    const { page, region } = await openProfile(theme, width, height);
    const label = `${theme} ${width}`;
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth
      ),
      `${label} overflow`
    ).toBeLessThanOrEqual(0);

    // Text contrast (WCAG AA 4.5:1) for copy, deltas, outcome chips and actions.
    const row = region
      .getByRole('listitem')
      .filter({ has: page.locator('time') })
      .first();
    for (const [what, target] of [
      ['history copy', row.locator('p').first()],
      ['delta', row.locator('strong')],
      ['outcome', row.locator('span').first()],
      ['explain action', row.getByRole('button')],
      ['journey scope', region.getByText(rating.journey.scope, { exact: true })]
    ] as const)
      expect.soft(await contrast(target), `${label} ${what} contrast`).toBeGreaterThanOrEqual(4.5);

    const trigger = row.getByRole('button');
    await trigger.click();
    const dialog = page.getByRole('dialog', { name: rating.explanation.title });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText(rating.explanation.loading)).toHaveCount(0);
    const b = await box(dialog);
    expect(b.x).toBeGreaterThanOrEqual(0);
    expect(b.right).toBeLessThanOrEqual(width);
    expect(b.y).toBeGreaterThanOrEqual(0);
    expect(b.bottom, `${label} dialog inside viewport`).toBeLessThanOrEqual(height);
    const close = await box(dialog.getByRole('button', { name: rating.explanation.close }));
    expect(close.height).toBeGreaterThanOrEqual(44);
    expect(close.right).toBeLessThanOrEqual(b.right + 1);
    for (const note of await dialog.locator('dd').all())
      expect
        .soft(await contrast(note), `${label} dialog fact contrast`)
        .toBeGreaterThanOrEqual(4.5);
    await info.attach(`explanation-${theme}-${width}`, {
      body: await page.screenshot({ animations: 'disabled', caret: 'hide' }),
      contentType: 'image/png'
    });
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    await page.context().close();
  }
});
