import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { expect, test, type Locator, type Page, type TestInfo } from '@playwright/test';
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
const REGION = { width: 390, height: 308 }; // header, identity hero and level card of the frame

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
  await page.goto('/dashboard');
  await waitForHydratedPage(page);
  const region = page.getByRole('region', { name: rating.journey.title });
  await expect(region).toBeVisible();
  return { page, region };
}

async function compareRegion(page: Page, info: TestInfo, top: number): Promise<number> {
  await page.setViewportSize({ width: REGION.width, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    clip: { x: 0, y: top, ...REGION },
    path: info.outputPath(`${FRAME}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-10/${FRAME}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, region }) => {
      const load = async (url: string, crop: number, scale: number) => {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = region.width;
        canvas.height = region.height;
        const context = canvas.getContext('2d')!;
        context.drawImage(
          image,
          0,
          0,
          region.width * crop,
          region.height * crop,
          0,
          0,
          region.width,
          region.height
        );
        void scale;
        return context.getImageData(0, 0, region.width, region.height).data;
      };
      const [rendered, reference] = await Promise.all([
        load(actualUrl, 1, 1),
        load(approvedUrl, 2, 2)
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
      return changed / (region.width * region.height);
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
      region: REGION
    }
  );
  console.info(`${FRAME} PAF-10 region measurement: ${measured}`);
  await info.attach(`${FRAME}-actual`, { body: actual, contentType: 'image/png' });
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
  const measured = await compareRegion(page, info, Math.max(0, Math.round(t!.y) - 20));
  expect(measured, `${FRAME} raster budget`).toBeLessThanOrEqual(
    manifest.visualBudgets.perScreen[FRAME]
  );
  expect(manifest.visualBudgets.perScreen[FRAME]).toBeGreaterThan(0);
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
