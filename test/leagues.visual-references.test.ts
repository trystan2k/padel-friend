import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-11/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const frames = ['ik5JC', 'MYsDp', 'wHaAb'];

describe('PAF-11 League and Ranked visual references', () => {
  it('pins the source design digest to the current design bytes', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend.pen');
    // Never inherit an older manifest's digest: hash the actual file the exports came from.
    const source = readFileSync(new URL(`../${manifest.sourceDesign.path}`, import.meta.url));
    expect(digest(source)).toBe(manifest.sourceDesign.sha256);
  });

  it('pins uncropped approved Pencil exports by digest, size and frame name', () => {
    expect(Object.keys(manifest.approvedReferences).sort()).toEqual(
      frames.map((frame) => `${frame}.png`).sort()
    );
    for (const [filename, reference] of Object.entries(manifest.approvedReferences)) {
      const bytes = readFileSync(new URL(`../e2e/references/paf-11/${filename}`, import.meta.url));
      expect(`${filename}: ${digest(bytes)}`).toBe(`${filename}: ${reference.sha256}`);
      expect(`${filename}: ${bytes.subarray(1, 4).toString()}`).toBe(`${filename}: PNG`);
      expect(`${filename}: ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(
        `${filename}: ${reference.pixelSize.join('x')}`
      );
      expect(filename).toBe(`${reference.frameId}.png`);
    }
  });

  it('pins measured nonzero budgets above each residual with documented rationale', () => {
    expect(manifest.status).toBe('chromium-certified-with-scoped-route-adaptations');
    expect(manifest.visualBudgets.status).toBe('measured-chromium-viewport-pixel-difference');
    expect(manifest.visualBudgets.measurementMethod).toContain('reject any dimension mismatch');
    expect(Object.keys(manifest.visualBudgets.perScreen).sort()).toEqual([...frames].sort());
    const measuredByFrame = new Map(Object.entries(manifest.visualBudgets.measured));
    for (const [frame, budget] of Object.entries(manifest.visualBudgets.perScreen)) {
      const measured = measuredByFrame.get(frame) ?? Number.NaN;
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThan(0.29);
      // Budgets only absorb raster variance: a budget far above the residual would hide defects.
      expect(budget).toBeGreaterThanOrEqual(measured);
      expect(budget - measured).toBeLessThan(0.02);
    }
    expect(Object.keys(manifest.visualBudgets.perScreenRationale).sort()).toEqual(
      [...frames].sort()
    );
    for (const rationale of Object.values(manifest.visualBudgets.perScreenRationale))
      expect(rationale.trim().length).toBeGreaterThan(20);
    expect(Object.keys(manifest.structuralProbes).sort()).toEqual([...frames].sort());
  });

  it('records the supplemental states that have no approved Pencil frame', () => {
    expect(manifest.sourceDesign.provenanceNote).toContain('invalid Ranked-result resolution');
    expect(manifest.sourceDesign.provenanceNote).toContain('no budget exists for them');
  });
});
