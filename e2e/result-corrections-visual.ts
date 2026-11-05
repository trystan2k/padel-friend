import { readFileSync } from 'node:fs';
import { expect, type Locator, type Page, type TestInfo } from '@playwright/test';
import manifest from './references/paf-14/manifest.json' with { type: 'json' };

// PAF-14 visual certification helpers (same method as PAF-8/PAF-12): capture at the exact half-scale
// reference size, compare with the uncropped 2x Pencil export under the pinned perceptual threshold
// and a documented nonzero per-screen budget. Structural, accessibility and locale probes live in
// the journeys and never depend on these budgets.
export type CorrectionFrame = keyof typeof manifest.visualBudgets.perScreen;
export const frameViewport = { width: 390, height: 844 };

export type Box = {
  x: number;
  y: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
};

export async function box(locator: Locator): Promise<Box> {
  return locator.evaluate((element) => {
    const { x, y, right, bottom, width, height } = element.getBoundingClientRect();
    return { x, y: y + window.scrollY, right, bottom: bottom + window.scrollY, width, height };
  });
}

/** Document-order stacking: each box ends before the next begins (small subpixel tolerance). */
export function assertStacked(boxes: Record<string, Box>) {
  const entries = Object.entries(boxes);
  for (let index = 1; index < entries.length; index++)
    expect
      .soft(entries[index]![1].y, `${entries[index]![0]} follows ${entries[index - 1]![0]}`)
      .toBeGreaterThanOrEqual(entries[index - 1]![1].bottom - 2);
}

export function assertContained(parent: Box, child: Box, label: string, tolerance = 2) {
  expect.soft(child.x, `${label} left`).toBeGreaterThanOrEqual(parent.x - tolerance);
  expect.soft(child.right, `${label} right`).toBeLessThanOrEqual(parent.right + tolerance);
  expect.soft(child.y, `${label} top`).toBeGreaterThanOrEqual(parent.y - tolerance);
  expect.soft(child.bottom, `${label} bottom`).toBeLessThanOrEqual(parent.bottom + tolerance);
}

/** No horizontal scroll and nothing painted outside the viewport width (long translated text). */
export async function assertNoOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => ({
    scroll: document.documentElement.scrollWidth - window.innerWidth,
    // Content inside a scroll container that itself fits the viewport is reachable, not overflow.
    outside: [...document.querySelectorAll('main *')]
      .filter((element) => {
        if (element.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        for (let node = element.parentElement; node; node = node.parentElement) {
          const scrolls = ['auto', 'scroll'].includes(getComputedStyle(node).overflowX);
          if (scrolls && node.getBoundingClientRect().right <= window.innerWidth + 1) return false;
        }
        return true;
      })
      .map((element) => element.tagName + ':' + (element.textContent ?? '').slice(0, 30))
  }));
  expect.soft(overflow.scroll, `${label} horizontal scroll`).toBeLessThanOrEqual(0);
  expect.soft(overflow.outside, `${label} elements beyond viewport`).toEqual([]);
}

/** Every visible interactive control inside the root meets the 44px target on both axes. */
export async function assertTargets(root: Locator, label: string) {
  const targets = await root
    .locator('a, button, summary, [role=radio], input:not([type=hidden]), textarea, select')
    .evaluateAll((nodes) =>
      nodes
        .map((node) => {
          const target = node.closest('label') ?? node;
          const rect = target.getBoundingClientRect();
          return {
            name: (node.textContent ?? '').trim().slice(0, 40),
            w: rect.width,
            h: rect.height
          };
        })
        .filter((item) => item.w > 0 && item.h > 0)
    );
  expect(targets.length, `${label} has controls`).toBeGreaterThan(0);
  for (const item of targets) {
    expect.soft(item.h, `${label} ${item.name} height`).toBeGreaterThanOrEqual(44);
    expect.soft(item.w, `${label} ${item.name} width`).toBeGreaterThanOrEqual(44);
  }
}

/** WCAG AA text contrast of every visible text element against its effective background. */
export async function assertContrast(root: Locator, label: string) {
  const failures = await root.evaluate((container) => {
    const parse = (value: string) => {
      const match = value.match(/rgba?\(([^)]+)\)/);
      if (!match) return null;
      const parts = match[1]!
        .split(/[ ,/]+/)
        .filter(Boolean)
        .map(Number);
      return { r: parts[0]!, g: parts[1]!, b: parts[2]!, a: parts[3] ?? 1 };
    };
    const luminance = ({ r, g, b }: { r: number; g: number; b: number }) => {
      const channel = (value: number) => {
        const unit = value / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const background = (element: Element) => {
      for (let node: Element | null = element; node; node = node.parentElement) {
        const color = parse(getComputedStyle(node).backgroundColor);
        if (color && color.a > 0.99) return color;
      }
      return { r: 255, g: 255, b: 255, a: 1 };
    };
    const bad: string[] = [];
    for (const element of container.querySelectorAll('*')) {
      const own = [...element.childNodes].some(
        (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim()
      );
      const style = getComputedStyle(element);
      if (!own || style.visibility === 'hidden' || element.getBoundingClientRect().width === 0)
        continue;
      const color = parse(style.color);
      if (!color) continue;
      const fg = luminance(color);
      const bg = luminance(background(element));
      const ratio = (Math.max(fg, bg) + 0.05) / (Math.min(fg, bg) + 0.05);
      const size = Number.parseFloat(style.fontSize);
      const large = size >= 24 || (size >= 18.66 && Number(style.fontWeight) >= 700);
      if (ratio < (large ? 3 : 4.5))
        bad.push(`${(element.textContent ?? '').trim().slice(0, 30)} ${ratio.toFixed(2)}`);
    }
    return bad;
  });
  expect.soft(failures, `${label} AA contrast`).toEqual([]);
}

/** Reduced motion: no running animation and no transition longer than a frame inside the root. */
export async function assertReducedMotion(page: Page, root: Locator, label: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const moving = await root.evaluate((container) =>
    [container, ...container.querySelectorAll('*')]
      .filter((element) => {
        const style = getComputedStyle(element);
        const seconds = (value: string) =>
          Math.max(...value.split(',').map((part) => Number.parseFloat(part) || 0));
        return (
          (style.animationName !== 'none' && seconds(style.animationDuration) > 0.01) ||
          seconds(style.transitionDuration) > 0.01
        );
      })
      .map((element) => element.tagName)
  );
  expect.soft(moving, `${label} honours reduced motion`).toEqual([]);
}

export async function measureFrame(frame: CorrectionFrame, page: Page, info: TestInfo) {
  await page.setViewportSize(frameViewport);
  const actual = await page.screenshot({
    animations: 'disabled',
    caret: 'hide',
    path: info.outputPath(`${frame}-actual.png`)
  });
  const approved = readFileSync(new URL(`./references/paf-14/${frame}.png`, import.meta.url));
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
        return { dimensionMismatch: true, difference: null as number | null };
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
        difference: changed / (rendered.width * rendered.height)
      };
    },
    {
      actualUrl: `data:image/png;base64,${actual.toString('base64')}`,
      approvedUrl: `data:image/png;base64,${approved.toString('base64')}`
    }
  );
  console.info(`${frame} PAF-14 full-frame measurement: ${JSON.stringify(measured)}`);
  const budget = manifest.visualBudgets.perScreen[frame];
  expect
    .soft(measured.dimensionMismatch, `${frame} dimensions match the 2x Pencil export`)
    .toBe(false);
  expect.soft(budget, `${frame} needs a reviewed nonzero screenshot budget`).toBeGreaterThan(0);
  if (measured.difference !== null)
    expect.soft(measured.difference, `${frame} reviewed raster budget`).toBeLessThanOrEqual(budget);
  await info.attach(`${frame}-actual`, { body: actual, contentType: 'image/png' });
  await info.attach(`${frame}-measurement`, {
    body: JSON.stringify(measured, null, 2),
    contentType: 'application/json'
  });
  return measured;
}
