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

/** Viewport capture compared with the uncropped 2x Pencil export of `frame`. */
export async function measureStandingsFrame(page: Page, frame: StandingsFrame, info: TestInfo) {
  await page.setViewportSize(standingsViewport);
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${frame}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-12/${frame}.png`, import.meta.url));
  const measured = await page.evaluate(
    async ({ actualUrl, approvedUrl }) => {
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
        return { dimensionMismatch: true, perceptualPixelDifference: null as number | null };
      let changed = 0;
      for (let index = 0; index < rendered.data.length; index += 4) {
        const red = rendered.data[index]! - reference.data[index]!;
        const green = rendered.data[index + 1]! - reference.data[index + 1]!;
        const blue = rendered.data[index + 2]! - reference.data[index + 2]!;
        const luminance = red * 0.29889531 + green * 0.58662247 + blue * 0.11448223;
        const chromaI = red * 0.59597799 - green * 0.2741761 - blue * 0.32180189;
        const chromaQ = red * 0.21147017 - green * 0.52261711 + blue * 0.31114694;
        if (
          0.5053 * luminance * luminance + 0.299 * chromaI * chromaI + 0.1957 * chromaQ * chromaQ >
          35215 * 0.1 ** 2
        )
          changed++;
      }
      return {
        dimensionMismatch: false,
        perceptualPixelDifference: changed / (rendered.width * rendered.height)
      };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`
    }
  );
  console.info(`${frame} PAF-12 full-frame measurement: ${JSON.stringify(measured)}`);
  const budget = manifest.visualBudgets.perScreen[frame];
  expect
    .soft(measured.dimensionMismatch, `${frame} dimensions must match the 2x Pencil export`)
    .toBe(false);
  expect.soft(budget, `${frame} needs a reviewed nonzero screenshot budget`).toBeGreaterThan(0);
  if (measured.perceptualPixelDifference !== null)
    expect
      .soft(measured.perceptualPixelDifference, `${frame} reviewed raster budget`)
      .toBeLessThanOrEqual(budget);
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-approved`, { body: approved, contentType: 'image/png' });
  return measured;
}
