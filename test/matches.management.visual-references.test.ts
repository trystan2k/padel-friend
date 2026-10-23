import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-6/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('management visual reference provenance', () => {
  it('ships the pinned real venue JPEG without runtime downloads', () => {
    const bytes = readFileSync(new URL('./helpers/fixtures/venue-court.jpg', import.meta.url));
    expect(bytes.subarray(0, 2).toString('hex')).toBe('ffd8');
    expect(bytes.subarray(-2).toString('hex')).toBe('ffd9');
    expect(digest(bytes)).toBe('6fe0458b5db3355d4c22b673968f6d62d80920b86f7df20b22bdc5dee7078be4');
  });
  it('maps all nineteen states to unique approved exports', () => {
    const states = Object.values(manifest.stateCoverage);
    expect(states).toHaveLength(19);
    expect(Object.keys(manifest.approvedReferences)).toHaveLength(19);
    expect(new Set(states.map((state) => state.frameId)).size).toBe(19);
    expect(manifest.status).toBe('implemented-certification-passing');
    expect(manifest.runtimeEnforcement.status).toBe('passing');
    for (const state of states) expect(state.status).toBe('approved-reference');
  });

  it('preserves every approved PNG digest and uncropped source dimensions', () => {
    const budgets: Record<string, { baselineSha256: string | null }> =
      manifest.visualBudgets.perScreen;
    for (const [filename, reference] of Object.entries(manifest.approvedReferences)) {
      const bytes = readFileSync(new URL(`../e2e/references/paf-6/${filename}`, import.meta.url));
      expect(digest(bytes)).toBe(reference.sha256);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect(reference.sourceSize).toMatch(/^390x\d+$/);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(
        reference.sourceSize.split('x').map(Number)
      );
      expect(filename).toBe(`${reference.frameId}.png`);
      expect(budgets[filename]?.baselineSha256).toBe(reference.sha256);
    }
    // Opaque bytes only: encrypted .pen content is never decoded or parsed.
    expect(digest(readFileSync(manifest.sourceDesign.path))).toBe(manifest.sourceDesign.sha256);
  });

  it('masks only native datetime input chrome and the fixture-clock date block', () => {
    const references: Record<
      string,
      {
        sourceSize: string;
        maskRegions?: { x: number; y: number; width: number; height: number }[];
      }
    > = manifest.approvedReferences;
    for (const [filename, reference] of Object.entries(references)) {
      const masks = reference.maskRegions ?? [];
      expect(masks).toHaveLength(filename === 'Tm3XM.png' ? 2 : filename === 'tVzco.png' ? 1 : 0);
      const [width, height] = reference.sourceSize.split('x').map(Number);
      for (const mask of masks) {
        expect([mask.x, mask.y, mask.width, mask.height].every(Number.isInteger)).toBe(true);
        expect(mask.x).toBeGreaterThanOrEqual(0);
        expect(mask.y).toBeGreaterThanOrEqual(0);
        expect(mask.width).toBeGreaterThan(0);
        expect(mask.height).toBeGreaterThan(0);
        expect(mask.x + mask.width).toBeLessThanOrEqual(width!);
        expect(mask.y + mask.height).toBeLessThanOrEqual(height!);
      }
    }
  });

  it('binds each state to a separately declared screenshot budget', () => {
    for (const { frameId } of Object.values(manifest.stateCoverage)) {
      const filename = `${frameId}.png`;
      expect(manifest.approvedReferences).toHaveProperty(filename);
      expect(manifest.visualBudgets.perScreen).toHaveProperty(filename);
    }
  });

  it('certifies rebuilt full frames within reviewed cross-renderer budgets', () => {
    for (const [frameId, height] of Object.entries(manifest.referenceMeasurements.frameHeights)) {
      const filename = `${frameId}.png`;
      const references: Record<string, { sourceSize: string }> = manifest.approvedReferences;
      const budgets: Record<string, { measured: number | null; budget: number | null }> =
        manifest.visualBudgets.perScreen;
      expect(references[filename]?.sourceSize).toBe(`390x${height}`);
      const measured = budgets[filename]?.measured;
      const budget = budgets[filename]?.budget;
      expect(measured).toBeTypeOf('number');
      expect(budget).toBeTypeOf('number');
      expect(measured).toBeLessThanOrEqual(budget!);
      expect(budget).toBe(Math.ceil((measured! + 0.005) * 1000) / 1000);
      expect(budgets[filename]).not.toHaveProperty('compareRegion');
    }
  });
});
