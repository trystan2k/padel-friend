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
import onboarding from '../e2e/references/paf-202-onboarding/manifest.json';
import publicManifest from '../e2e/references/paf-202-public/manifest.json';

const reference = readFileSync(
  new URL('../e2e/references/paf-202-onboarding/PdRtP.png', import.meta.url)
);
const testMask: PngMask = {
  maskColor: '#FF00FF',
  rectangles: [{ name: 'probe', x: 0, y: 0, width: 10, height: 10 }]
};

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
  it('is deterministic and preserves the approved source bytes', () => {
    const sourceBeforeMasking = Buffer.from(reference);
    const firstDerivation = deriveMaskedPng(reference, testMask);
    const secondDerivation = deriveMaskedPng(reference, testMask);
    expect(reference).toEqual(sourceBeforeMasking);
    expect(createHash('sha256').update(reference).digest('hex')).toBe(
      onboarding.frames.PdRtP.sha256
    );
    expect(secondDerivation).toEqual(firstDerivation);
    expect(comparePng(firstDerivation, reference, 0)?.errorMessage).toContain('100 pixels');
  }, 15_000);
});
