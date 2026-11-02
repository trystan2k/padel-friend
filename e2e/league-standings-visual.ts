import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import manifest from './references/paf-12/manifest.json' with { type: 'json' };

// PAF-12 visual certification helpers (same method as PAF-11 `leagues-visual.spec.ts`): capture at
// the exact half-scale reference size, compare against the uncropped 2x Pencil export with the
// pinned perceptual threshold and a documented nonzero per-screen budget. Structural probes live
// in the journeys and never depend on these budgets.
export type StandingsFrame = keyof typeof manifest.visualBudgets.perScreen;

export const standingsViewport = { width: 390, height: 844 };

export type Box = {
  x: number;
  y: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

/** Bounding box in document coordinates, so scroll position never matters. */
export async function docBox(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return {
      x,
      y: y + window.scrollY,
      right,
      bottom: bottom + window.scrollY,
      width,
      height
    };
  });
}

/**
 * Viewport-relative geometry, measured as the page is first shown: every target must lie fully
 * inside the visible viewport (top >= 0, bottom <= height, left >= 0, right <= width) with the
 * page still at scroll 0, so "reachable by scrolling" can never pass for "visible initially".
 */
export async function assertInInitialViewport(
  page: Page,
  targets: Record<string, Locator>,
  label: string
) {
  expect(
    await page.evaluate(() => window.scrollY),
    `${label} is measured before any scrolling`
  ).toBe(0);
  const viewport = await page.evaluate(() => ({
    width: window.innerWidth,
    height: window.innerHeight
  }));
  for (const [name, locator] of Object.entries(targets)) {
    const rect = await locator.evaluate((element) => {
      const { top, bottom, left, right } = element.getBoundingClientRect();
      return { top, bottom, left, right };
    });
    expect.soft(rect.top, `${label} ${name} top inside viewport`).toBeGreaterThanOrEqual(0);
    expect
      .soft(rect.bottom, `${label} ${name} bottom (${rect.bottom}) inside ${viewport.height}px`)
      .toBeLessThanOrEqual(viewport.height);
    expect.soft(rect.left, `${label} ${name} left inside viewport`).toBeGreaterThanOrEqual(0);
    expect
      .soft(rect.right, `${label} ${name} right inside viewport`)
      .toBeLessThanOrEqual(viewport.width);
  }
}

/** The primary ranking's header row and first ranking row: every cell, in table order. */
export function primaryRankingTargets(table: Locator) {
  const rows = table.getByRole('row');
  const targets: Record<string, Locator> = {};
  const header = rows.first();
  const first = rows.nth(1);
  for (const [name, row] of [
    ['header', header],
    ['first ranking row', first]
  ] as const) {
    targets[name] = row;
  }
  targets['place header'] = header.getByRole('columnheader').nth(0);
  targets['award header'] = header.getByRole('columnheader').nth(4);
  targets['first row place'] = first.getByRole('cell').nth(0);
  targets['first row player'] = first.getByRole('rowheader');
  targets['first row record'] = first.getByRole('cell').nth(1);
  targets['first row set difference'] = first.getByRole('cell').nth(2);
  targets['first row award'] = first.getByRole('cell').nth(3);
  return targets;
}

/** No horizontal scroll and every visible control stays inside the viewport. */
export async function assertNoOverflow(page: Page, label: string) {
  const metrics = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth,
    inner: window.innerWidth,
    clipped: [
      ...document.querySelectorAll<HTMLElement>(
        'main a, main button, main input, main select, main textarea, main summary'
      )
    ]
      .filter((element) => element.getClientRects().length > 0)
      .map((element) => ({
        name: element.textContent?.trim() || element.id,
        rect: element.getBoundingClientRect()
      }))
      .filter(
        ({ rect }) => rect.width > 0 && (rect.left < -1 || rect.right > window.innerWidth + 1)
      )
      .map(({ name }) => name)
  }));
  expect(metrics.scroll, `${label} horizontal overflow`).toBeLessThanOrEqual(metrics.inner);
  expect(metrics.clipped, `${label} controls outside viewport`).toEqual([]);
}

/** Interactive controls are at least 44px tall (WCAG 2.5.5 / project rule). */
export async function assertTouchHeights(root: Locator, label: string) {
  const targets = await root
    .locator('a:visible, button:visible, select:visible, summary:visible')
    .evaluateAll((nodes) =>
      nodes.map((node) => ({
        name: (node.textContent || node.id || node.tagName).trim().slice(0, 40),
        height: node.getBoundingClientRect().height
      }))
    );
  expect.soft(targets.length, `${label}: touch-target probe found controls`).toBeGreaterThan(0);
  for (const target of targets)
    expect.soft(target.height, `${label}: ${target.name} touch height`).toBeGreaterThanOrEqual(44);
}

type MaskRect = { x: number; y: number; width: number; height: number };

/**
 * Production blocks that carry a documented composition/content delta against the Pencil frame
 * (real details card, heading row, own summary, tables, disclosure, callout, rules, version
 * history, page header). Viewport-relative rects at scroll 0; each block is gated by exact
 * structural probes in the journeys, so the screenshot budget never has to absorb them.
 */
async function productionMasks(page: Page): Promise<MaskRect[]> {
  return page.evaluate(() => {
    const rect = (element: Element) => {
      const { x, y, width, height } = element.getBoundingClientRect();
      return { x, y, width, height };
    };
    const standings = document.querySelector('section[aria-labelledby="league-standings-heading"]');
    const nodes: Element[] = [...document.querySelectorAll('main header')];
    if (standings) {
      nodes.push(...standings.children);
      if (standings.previousElementSibling) nodes.push(standings.previousElementSibling);
      for (let next = standings.nextElementSibling; next; next = next.nextElementSibling)
        nodes.push(next);
    }
    return nodes.map(rect).filter(({ width, height }) => width > 0 && height > 0);
  });
}

/** Viewport capture compared with the uncropped 2x Pencil export of `frame`. */
export async function measureStandingsFrame(page: Page, frame: StandingsFrame, info: TestInfo) {
  await page.setViewportSize(standingsViewport);
  const masks = [
    ...manifest.visualBudgets.referenceMasks[frame].map(({ x, y, width, height }) => ({
      x,
      y,
      width,
      height
    })),
    ...(await productionMasks(page))
  ];
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${frame}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-12/${frame}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl, maskRects }) => {
      async function readPixels(url: string, scale: number) {
        const image = new Image();
        image.src = url;
        await image.decode();
        const canvas = document.createElement('canvas');
        canvas.width = image.width / scale;
        canvas.height = image.height / scale;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('Canvas context unavailable');
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return {
          width: canvas.width,
          height: canvas.height,
          data: context.getImageData(0, 0, canvas.width, canvas.height).data
        };
      }
      const [rendered, reference] = await Promise.all([
        readPixels(actualUrl, 1),
        readPixels(approvedUrl, 2)
      ]);
      if (rendered.width !== reference.width || rendered.height !== reference.height)
        return {
          dimensionMismatch: true,
          perceptualPixelDifference: null as number | null,
          fullFramePixelDifference: null as number | null,
          maskedFraction: null as number | null
        };
      let changed = 0;
      let changedAll = 0;
      let masked = 0;
      for (let index = 0; index < rendered.data.length; index += 4) {
        const pixel = index / 4;
        const x = (pixel % rendered.width) + 0.5;
        const y = Math.floor(pixel / rendered.width) + 0.5;
        const inMask = maskRects.some(
          (rect) =>
            x >= rect.x - 1 &&
            x < rect.x + rect.width + 1 &&
            y >= rect.y - 1 &&
            y < rect.y + rect.height + 1
        );
        if (inMask) masked++;
        const red = rendered.data[index]! - reference.data[index]!;
        const green = rendered.data[index + 1]! - reference.data[index + 1]!;
        const blue = rendered.data[index + 2]! - reference.data[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        ) {
          changedAll++;
          if (!inMask) changed++;
        }
      }
      const total = rendered.width * rendered.height;
      return {
        dimensionMismatch: false,
        perceptualPixelDifference: changed / (total - masked),
        fullFramePixelDifference: changedAll / total,
        maskedFraction: masked / total
      };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`,
      maskRects: masks
    }
  );
  console.info(`${frame} PAF-12 scoped measurement: ${JSON.stringify(measured)}`);
  const budget = manifest.visualBudgets.perScreen[frame];
  expect
    .soft(measured.dimensionMismatch, `${frame} dimensions must match the 2x Pencil export`)
    .toBe(false);
  expect.soft(budget, `${frame} needs a reviewed nonzero screenshot budget`).toBeGreaterThan(0);
  if (measured.perceptualPixelDifference !== null)
    expect
      .soft(measured.perceptualPixelDifference, `${frame} reviewed raster budget (unmasked area)`)
      .toBeLessThanOrEqual(budget);
  if (measured.maskedFraction !== null)
    expect
      .soft(measured.maskedFraction, `${frame} masks stay a bounded share of the frame`)
      .toBeLessThanOrEqual(manifest.visualBudgets.maxMaskedFraction[frame]);
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-approved`, { body: approved, contentType: 'image/png' });
  return measured;
}
