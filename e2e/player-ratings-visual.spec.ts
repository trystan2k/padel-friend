import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';
import manifest from './references/paf-202-me/manifest.json' with { type: 'json' };
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
// Clubhouse vARtQ regions (CSS px at scale 1, frame coordinates). The frame's stats tiles are exact
// structural probes (real own-profile statistics read, F39); the season trend, bar chart and link
// list have no real source or differ per row, so only the identity header and the level card
// heading/value are compared as raster; each region aligns on its own DOM anchor. The rating journey is not drawn in vARtQ: it is covered by structural probes.
const REGIONS = {
  identity: { name: 'identity', y: 48, height: 72, budgetKey: `${FRAME}:identity` },
  level: { name: 'level', y: 212, height: 78, budgetKey: `${FRAME}:level` }
} as const;
type Region = (typeof REGIONS)[keyof typeof REGIONS];

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

async function openProfile(
  theme: 'light' | 'dark',
  width: number,
  height: number
): Promise<{ page: Page; region: Locator }> {
  const page = await f.page(host, 'en', width, theme, height);
  await page.goto('/me');
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
  const approved = readFileSync(new URL(`./references/paf-202-me/${FRAME}.png`, import.meta.url));
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
        load(approvedUrl, 1, area.y)
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
  console.info(`${FRAME} PAF-202 Me ${region.name} region measurement: ${measured}`);
  await info.attach(`${FRAME}-${region.name}-actual`, { body: actual, contentType: 'image/png' });
  return measured;
}

// --- provenance --------------------------------------------------------------------------

test('reference provenance pins the current design source and exported frame', () => {
  const design = readFileSync(
    new URL('../docs/design/Padel-friend App Redesign/padel-friend-clubhouse.pen', import.meta.url)
  );
  expect(createHash('sha256').update(design).digest('hex')).toBe(manifest.sourceDesign.sha256);
  const png = readFileSync(new URL(`./references/paf-202-me/${FRAME}.png`, import.meta.url));
  expect(createHash('sha256').update(png).digest('hex')).toBe(
    manifest.approvedReferences[FRAME].sha256
  );
  expect(png.readUInt32BE(16)).toBe(manifest.approvedReferences[FRAME].pixelSize[0]);
  expect(png.readUInt32BE(20)).toBe(manifest.approvedReferences[FRAME].pixelSize[1]);
});

// --- structure + raster ------------------------------------------------------------------

test('Me keeps the vARtQ order, geometry and reviewed raster budgets (mobile light)', async ({
  browserName
}, info) => {
  expect(browserName).toBe('chromium');
  const { page, region } = await openProfile('light', 390, 844);
  const title = page.getByRole('heading', { level: 1, name: copies.en.profile.title });
  const name = page.getByRole('heading', { level: 2, name: host.name });
  const avatar = page.locator('main > header > span, main > header > img').first();
  const levelLabel = page.getByText(copies.en.profile.globalLevel, { exact: true });
  const levelCard = levelLabel.locator('xpath=ancestor::div[.//progress][1]');
  const shortcuts = page.getByRole('navigation', { name: copies.en.profile.links.label });
  const journeyHeading = region.getByRole('heading', { level: 2, name: rating.journey.title });
  const [n, a, l, sc, j] = await Promise.all(
    [name, avatar, levelLabel, shortcuts, journeyHeading].map(box)
  );
  await expect(title).toHaveCount(1);

  // Exact structural order of the frame: identity → stats tiles → level card → shortcuts → journey.
  expect(a!.right).toBeLessThanOrEqual(n!.x + 1);
  expect(n!.bottom).toBeLessThanOrEqual(l!.y);

  // vARtQ tiles (F39): matches, W–L–D and win rate from the one own-profile statistics read. The
  // fixture host has three confirmed groups (win, loss, draw); the win rate is the contract metric.
  const tiles = page.locator('main dl[aria-label] > [data-stat]');
  await expect(tiles).toHaveCount(3);
  const statCopy = copies.en.profile.stats;
  const tileBoxes = await Promise.all((await tiles.all()).map(box));
  const identityBox = await box(page.locator('main > header').first());
  expect(tileBoxes[0]!.y).toBeGreaterThanOrEqual(identityBox.bottom);
  expect(tileBoxes[0]!.bottom).toBeLessThanOrEqual(l!.y);
  for (const tile of tileBoxes) {
    expect(Math.abs(tile.y - tileBoxes[0]!.y), 'tiles share one row').toBeLessThanOrEqual(1);
    expect(Math.abs(tile.width - tileBoxes[0]!.width), 'tiles are equal width').toBeLessThanOrEqual(
      1
    );
  }
  // One consolidated card (frame vARtQ): the three columns sit inside a single surface, not three cards.
  const statsCard = page.locator('main dl[aria-label]');
  const cardBox = await box(statsCard);
  expect(cardBox.height).toBeGreaterThanOrEqual(60);
  expect(tileBoxes[0]!.x).toBeGreaterThanOrEqual(cardBox.x);
  expect(tileBoxes[2]!.right).toBeLessThanOrEqual(cardBox.right + 1);
  expect(
    await tiles.first().evaluate((element) => getComputedStyle(element).backgroundColor),
    'tiles are columns of the card, not separate surfaces'
  ).toBe('rgba(0, 0, 0, 0)');
  for (const [key, label] of [
    ['matches', statCopy.matches],
    ['record', statCopy.record],
    ['winRate', statCopy.winRate]
  ] as const)
    await expect(page.locator(`main [data-stat="${key}"] dt`)).toHaveText(label);
  await expect(page.locator('main [data-stat="matches"] dd')).toHaveText('3');
  await expect(page.locator('main [data-stat="record"] dd')).toHaveText('1–1–1');
  await expect(page.locator('main [data-stat="winRate"] dd')).toHaveText(
    new RegExp(`^(\\d+%|—${statCopy.notAvailable})$`)
  );
  // Value above label (frame), value is the heading-font figure.
  const tileValue = await box(page.locator('main [data-stat="matches"] dd'));
  const tileLabel = await box(page.locator('main [data-stat="matches"] dt'));
  expect(tileValue.bottom).toBeLessThanOrEqual(tileLabel.y + 1);
  expect(l!.bottom).toBeLessThanOrEqual(sc!.y);
  expect(sc!.bottom).toBeLessThanOrEqual(j!.y);
  // Avatar is the frame's 72px circle.
  expect(Math.round(a!.width)).toBe(72);
  expect(Math.round(a!.height)).toBe(72);

  // Shortcut rows: hairline card, ≥60px rows, every destination present, chevrons decorative.
  const rowLinks = await shortcuts.getByRole('link').all();
  // Frame vARtQ order: Statistics, Match history, Request a level review, Notifications; the extra
  // "My review requests" history destination (F70) follows the frame's rows.
  const hrefs = await Promise.all(rowLinks.map((link) => link.getAttribute('href')));
  expect(hrefs.map((href) => href?.replace(/^\/players\/[^/]+$/, '/players/:id'))).toEqual([
    '/players/:id',
    '/matches/past',
    '/level-reviews/new',
    '/notifications',
    '/level-reviews'
  ]);
  for (const link of rowLinks) expect((await box(link)).height).toBeGreaterThanOrEqual(60);
  const levelBox = await box(levelCard);
  for (const [what, element] of [
    ['shortcut list', shortcuts.locator('ul')],
    ['journey card', region.locator('> div').first()]
  ] as const) {
    const b = await box(element);
    expect(Math.abs(b.x - levelBox.x), `${what} left gutter`).toBeLessThanOrEqual(1);
    expect(Math.abs(b.right - levelBox.right), `${what} right gutter`).toBeLessThanOrEqual(1);
    expect(b.right).toBeLessThanOrEqual(390);
  }
  expect(
    await shortcuts.locator('ul').evaluate((element) => getComputedStyle(element).borderTopWidth)
  ).toBe('1px');

  // Chart: the bar plot fills its card; the text equivalent stays in the document.
  const bars = await box(region.locator('[aria-hidden="true"]').first());
  const chartCard = await box(region.locator('> div').first());
  expect(bars.x).toBeGreaterThanOrEqual(chartCard.x);
  expect(bars.right).toBeLessThanOrEqual(chartCard.right + 1);
  expect(bars.height).toBeGreaterThan(60);
  await expect(region.getByText(/Level moved from/)).toBeAttached();

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
  for (const control of await page.locator('main button').all()) {
    const b = await box(control);
    expect.soft(b.height).toBeGreaterThanOrEqual(44);
    expect.soft(b.width).toBeGreaterThanOrEqual(44);
  }
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    )
  ).toBeLessThanOrEqual(0);

  // Raster regions aligned on their own anchors (identity: avatar top; level: card top).
  for (const [frameRegion, top] of [
    [REGIONS.identity, Math.round(a!.y)],
    [REGIONS.level, Math.round(levelBox.y)]
  ] as const) {
    const measured = await compareRegion(page, info, frameRegion, top);
    const budget = manifest.visualBudgets.perScreen[frameRegion.budgetKey];
    expect(measured, `${frameRegion.budgetKey} raster budget`).toBeLessThanOrEqual(budget);
    expect(budget).toBeGreaterThan(0);
  }
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
      ['history date', row.locator('h4')],
      ['level change', row.locator('strong').first()],
      ['explain action', row.getByRole('button')],
      ['chart caption', region.getByText(rating.progress.scopeCaption, { exact: true })]
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
