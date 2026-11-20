import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  comparePng,
  deriveCroppedTopPng,
  deriveMaskedPng,
  derivePaddedRowsPng,
  type PngMask
} from '../e2e/png-mask';
import publicManifest from '../e2e/references/paf-202-public/manifest.json';

type VisualManifest = {
  playerSampleDataMask: PngMask;
  screenshotBaselines: { 'player-setup.png': { sha256: string } };
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isPngMask(value: unknown): value is PngMask {
  if (!isRecord(value) || typeof value.maskColor !== 'string' || !Array.isArray(value.rectangles))
    return false;
  return value.rectangles.every(
    (rectangle) =>
      isRecord(rectangle) &&
      typeof rectangle.name === 'string' &&
      typeof rectangle.x === 'number' &&
      typeof rectangle.y === 'number' &&
      typeof rectangle.width === 'number' &&
      typeof rectangle.height === 'number'
  );
}

function isVisualManifest(value: unknown): value is VisualManifest {
  if (!isRecord(value) || !isPngMask(value.playerSampleDataMask)) return false;
  if (!isRecord(value.screenshotBaselines)) return false;
  const playerBaseline = value.screenshotBaselines['player-setup.png'];
  return isRecord(playerBaseline) && typeof playerBaseline.sha256 === 'string';
}

const reference = readFileSync(
  new URL('../e2e/references/paf-1/player-setup.png', import.meta.url)
);
const rawManifest: unknown = JSON.parse(
  readFileSync(new URL('../e2e/references/paf-1/manifest.json', import.meta.url), 'utf8')
);
if (!isVisualManifest(rawManifest)) throw new Error('Invalid PAF-1 visual mask manifest');
const manifest = rawManifest;
const approvedBaselineDigest = manifest.screenshotBaselines['player-setup.png'].sha256;

describe('deriveCroppedTopPng', () => {
  it('drops exactly the top rows and rejects a crop that leaves no rows', () => {
    const cropped = deriveCroppedTopPng(reference, 44);
    expect(cropped.readUInt32BE(16)).toBe(reference.readUInt32BE(16));
    expect(cropped.readUInt32BE(20)).toBe(reference.readUInt32BE(20) - 44);
    expect(deriveCroppedTopPng(reference, 44)).toEqual(cropped);
    expect(() => deriveCroppedTopPng(reference, reference.readUInt32BE(20))).toThrow(
      'Top crop must leave rows'
    );
    expect(() => deriveCroppedTopPng(reference, -1)).toThrow('Top crop must leave rows');
  }, 15_000);
});

describe('derivePaddedRowsPng', () => {
  it('keeps the six PAF-202 public visual allowances close to measured residuals', () => {
    const { frames, calibration } = publicManifest;
    const entries = Object.values(frames);
    expect(entries.map(({ frameId }) => frameId).sort()).toEqual(
      ['xhsTX', 'K5DgRu', 'QtxDQ', 'DHZoj', 'HkMpo', 'UuaXy'].sort()
    );
    for (const frame of entries) {
      const measurement = Object.entries(calibration.measured).find(
        ([frameId]) => frameId === frame.frameId
      )?.[1];
      if (!measurement) throw new Error(`Missing visual measurement for ${frame.frameId}`);
      expect(measurement.total).toBe(frame.width * (frame.height + frame.ctaTops.length * 5));
      expect(measurement.ratio).toBeCloseTo(measurement.differing / measurement.total, 6);
      expect(frame.maxDiffPixelRatio).toBeGreaterThan(measurement.ratio);
      expect(frame.maxDiffPixelRatio - measurement.ratio).toBeLessThanOrEqual(0.003);
    }
  });

  it('duplicates approved rows without changing width or existing pixels', () => {
    const source = readFileSync(
      new URL('../e2e/references/paf-202-public/xhsTX.png', import.meta.url)
    );
    const adapted = derivePaddedRowsPng(source, [
      { y: 282, count: 2 },
      { y: 303, count: 3 }
    ]);
    expect(adapted.readUInt32BE(16)).toBe(390);
    expect(adapted.readUInt32BE(20)).toBe(1016);
    expect(
      comparePng(
        deriveCroppedTopPng(adapted, 0, 1016 - 282),
        deriveCroppedTopPng(source, 0, 1011 - 282),
        0
      )
    ).toBeNull();
    expect(
      comparePng(deriveCroppedTopPng(adapted, 308), deriveCroppedTopPng(source, 303), 0)
    ).toBeNull();
    expect(() => derivePaddedRowsPng(source, [{ y: 1011, count: 1 }])).toThrow('PNG row insertion');
  }, 15_000);
});

describe('onboarding crop comparator', () => {
  it('compares only the frame-owned rows and reports pixel differences', () => {
    const frame = deriveCroppedTopPng(reference, 44, 205);
    expect(frame.readUInt32BE(20)).toBe(595);
    expect(comparePng(frame, frame, 0)).toBeNull();
    const different = deriveMaskedPng(frame, {
      maskColor: '#FF00FF',
      rectangles: [{ name: 'probe', x: 0, y: 0, width: 10, height: 10 }]
    });
    expect(comparePng(different, frame, 0)?.errorMessage).toContain('100 pixels');
    expect(() => deriveCroppedTopPng(reference, 44, 800)).toThrow('Top crop must leave rows');
  }, 15_000);
});

describe('deriveMaskedPng', () => {
  // Two PNG codec round-trips per run: CPU-bound, and the default 5s budget is not
  // reliable when parallel suite workers saturate the machine (observed 6.2s).
  it('is deterministic, preserves source bytes, and keeps the approved baseline digest', () => {
    const sourceBeforeMasking = Buffer.from(reference);
    const firstDerivation = deriveMaskedPng(reference, manifest.playerSampleDataMask);
    const secondDerivation = deriveMaskedPng(reference, manifest.playerSampleDataMask);
    const derivedDigest = createHash('sha256').update(firstDerivation).digest('hex');

    expect(reference).toEqual(sourceBeforeMasking);
    expect(secondDerivation).toEqual(firstDerivation);
    expect(derivedDigest).toBe(approvedBaselineDigest);
  }, 15_000);
});
