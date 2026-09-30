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
