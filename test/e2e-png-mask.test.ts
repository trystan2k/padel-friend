import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { deriveMaskedPng, type PngMask } from '../e2e/png-mask';

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
