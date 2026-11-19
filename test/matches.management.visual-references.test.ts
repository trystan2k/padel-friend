import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-match-management/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('management visual reference provenance', () => {
  it('ships the pinned real venue JPEG without runtime downloads', () => {
    const bytes = readFileSync(new URL('./helpers/fixtures/venue-court.jpg', import.meta.url));
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.subarray(-2).toString('hex')).toBe('ffd9');
    expect(digest(bytes)).toBe('6fe0458b5db3355d4c22b673968f6d62d80920b86f7df20b22bdc5dee7078be4');
  });
  it('pins the Clubhouse source and all management and add-player frame exports', () => {
    const frames = [...Object.values(manifest.frames), ...Object.values(manifest.addPlayer)];
    expect(frames).toHaveLength(32);
    expect(new Set(frames).size).toBe(32);
    expect(Object.keys(manifest.exportSha256).sort()).toEqual([...frames].sort());
    expect(digest(readFileSync(manifest.sourceDesign.path))).toBe(manifest.sourceDesign.sha256);

    for (const [id, sha256] of Object.entries(manifest.exportSha256)) {
      const bytes = readFileSync(
        new URL(`../e2e/references/paf-202-match-management/${id}.png`, import.meta.url)
      );
      expect(digest(bytes)).toBe(sha256);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([390, 844]);
    }
  });

  it('binds every management state to its own bounded fixture regression gate', () => {
    expect(Object.keys(manifest.pixelEvidence.perFrame).sort()).toEqual(
      Object.values(manifest.frames).sort()
    );
    for (const { maxDiffPixelRatio } of Object.values(manifest.pixelEvidence.perFrame)) {
      expect(maxDiffPixelRatio).toBeGreaterThan(0);
      expect(maxDiffPixelRatio).toBeLessThanOrEqual(0.005);
    }
  });
});
