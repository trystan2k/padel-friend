import { createRequire } from 'node:module';

type PngImage = { width: number; height: number; data: Buffer };
type PngModule = {
  PNG: { sync: { read(buffer: Buffer): PngImage; write(image: PngImage): Buffer } };
};

export type PngMaskRectangle = {
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

export type PngMask = {
  maskColor: string;
  rectangles: readonly PngMaskRectangle[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPngModule(value: unknown): value is PngModule {
  if (!isRecord(value) || !('PNG' in value)) return false;
  const png = value.PNG;
  if (typeof png !== 'function' || !('sync' in png) || !isRecord(png.sync)) return false;
  return typeof png.sync.read === 'function' && typeof png.sync.write === 'function';
}

// Playwright exposes its PNG codec through a private bundle; keep that dependency isolated here.
const playwrightTestRequire = createRequire(
  createRequire(import.meta.url).resolve('@playwright/test')
);
const playwrightCoreRequire = createRequire(playwrightTestRequire.resolve('playwright-core'));
const pngModule: unknown = playwrightCoreRequire('playwright-core/lib/utilsBundle');
if (!isPngModule(pngModule)) throw new Error('Playwright PNG decoder is unavailable');
const { PNG } = pngModule;

// Pencil frames include a 44px OS status bar ("9:41", signal glyphs) that the app never renders.
// Dropping those rows turns the frame into the page viewport, with no scaling or recoloring.
export function deriveCroppedTopPng(buffer: Buffer, top: number, bottom = 0): Buffer {
  const image = PNG.sync.read(buffer);
  if (
    !Number.isInteger(top) ||
    !Number.isInteger(bottom) ||
    top < 0 ||
    bottom < 0 ||
    top + bottom >= image.height
  )
    throw new Error('Top crop must leave rows of the approved reference frame');
  const rowBytes = image.width * 4;
  return PNG.sync.write({
    width: image.width,
    height: image.height - top - bottom,
    data: image.data.subarray(top * rowBytes, (image.height - bottom) * rowBytes)
  });
}

// Add only flat raster rows to the approved artwork for the 47px → 52px CTA target.
export function derivePaddedRowsPng(
  buffer: Buffer,
  inserts: readonly { y: number; count: number }[]
): Buffer {
  const image = PNG.sync.read(buffer);
  const rowBytes = image.width * 4;
  const rows: Buffer[] = [];
  let cursor = 0;
  let added = 0;
  for (const { y, count } of inserts) {
    if (
      !Number.isInteger(y) ||
      !Number.isInteger(count) ||
      y < cursor ||
      y >= image.height ||
      count < 1
    )
      throw new Error('PNG row insertion must be ordered, positive and fit the reference');
    const start = y * rowBytes;
    rows.push(image.data.subarray(cursor * rowBytes, start));
    for (let i = 0; i < count; i += 1) rows.push(image.data.subarray(start, start + rowBytes));
    cursor = y;
    added += count;
  }
  rows.push(image.data.subarray(cursor * rowBytes));
  return PNG.sync.write({
    width: image.width,
    height: image.height + added,
    data: Buffer.concat(rows)
  });
}

export function comparePng(
  actual: Buffer,
  expected: Buffer,
  maxDiffPixelRatio: number
): { errorMessage: string; diff?: Buffer } | null {
  const core: unknown = playwrightCoreRequire('playwright-core/lib/coreBundle');
  if (!isRecord(core) || !isRecord(core.utils) || typeof core.utils.getComparator !== 'function')
    throw new Error('Playwright PNG comparator is unavailable');
  const compare: unknown = core.utils.getComparator('image/png');
  if (typeof compare !== 'function') throw new Error('Invalid Playwright PNG comparator');
  const result: unknown = compare(actual, expected, { threshold: 0.1, maxDiffPixelRatio });
  if (result === null) return null;
  if (!isRecord(result) || typeof result.errorMessage !== 'string')
    throw new Error('Invalid Playwright image comparison result');
  return {
    errorMessage: result.errorMessage,
    diff: Buffer.isBuffer(result.diff) ? result.diff : undefined
  };
}

// D8 requires the supplied app icon rather than the illustrative Pencil tile. The spec checks
// its exact position and served bytes separately; mask only that tile for pixel comparison.
export const authLogoMask: PngMask = {
  maskColor: '#FF00FF',
  rectangles: [{ name: 'brand tile', x: 24, y: 28, width: 64, height: 64 }]
};

export function deriveMaskedPng(buffer: Buffer, mask: PngMask): Buffer {
  const image = PNG.sync.read(buffer);
  const red = Number.parseInt(mask.maskColor.slice(1, 3), 16);
  const green = Number.parseInt(mask.maskColor.slice(3, 5), 16);
  const blue = Number.parseInt(mask.maskColor.slice(5, 7), 16);

  for (const { x, y, width, height } of mask.rectangles) {
    if (x < 0 || y < 0 || x + width > image.width || y + height > image.height)
      throw new Error('PAF-21 visual mask must fit inside its approved reference frame');
    for (let row = y; row < y + height; row += 1) {
      for (let column = x; column < x + width; column += 1) {
        const offset = (row * image.width + column) * 4;
        image.data[offset] = red;
        image.data[offset + 1] = green;
        image.data[offset + 2] = blue;
        image.data[offset + 3] = 255;
      }
    }
  }
  return PNG.sync.write(image);
}
