import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-12/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const frames = ['ywfn7', 'd6ANDN', 'xbIxj'];
const budgeted = ['ywfn7', 'xbIxj'];

describe('PAF-12 League standings visual references', () => {
  it('pins the source design digest to the current design bytes', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend.pen');
    const source = readFileSync(new URL(`../${manifest.sourceDesign.path}`, import.meta.url));
    expect(digest(source)).toBe(manifest.sourceDesign.sha256);
  });

  it('pins uncropped approved Pencil exports by digest, size and frame name', () => {
    expect(Object.keys(manifest.approvedReferences).sort()).toEqual(
      frames.map((frame) => `${frame}.png`).sort()
    );
    for (const [filename, reference] of Object.entries(manifest.approvedReferences)) {
      const bytes = readFileSync(new URL(`../e2e/references/paf-12/${filename}`, import.meta.url));
      expect(`${filename}: ${digest(bytes)}`).toBe(`${filename}: ${reference.sha256}`);
      expect(`${filename}: ${bytes.subarray(1, 4).toString()}`).toBe(`${filename}: PNG`);
      expect(`${filename}: ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(
        `${filename}: ${reference.pixelSize.join('x')}`
      );
      expect(filename).toBe(`${reference.frameId}.png`);
    }
  });

  it('pins measured nonzero budgets just above each residual with documented rationale', () => {
    expect(manifest.visualBudgets.status).toBe('measured-chromium-viewport-pixel-difference');
    expect(manifest.visualBudgets.measurementMethod).toContain('reject any dimension mismatch');
    expect(Object.keys(manifest.visualBudgets.perScreen).sort()).toEqual([...budgeted].sort());
    const measuredByFrame = new Map(Object.entries(manifest.visualBudgets.measured));
    for (const [frame, budget] of Object.entries(manifest.visualBudgets.perScreen)) {
      const measured = measuredByFrame.get(frame) ?? Number.NaN;
      expect(budget).toBeGreaterThan(0);
      // Budgets only absorb raster variance: a budget far above the residual would hide defects.
      expect(budget).toBeGreaterThanOrEqual(measured);
      expect(budget - measured).toBeLessThan(0.02);
      expect(budget).toBeLessThan(0.25);
    }
    expect(Object.keys(manifest.visualBudgets.perScreenRationale).sort()).toEqual(
      [...budgeted].sort()
    );
    for (const rationale of Object.values(manifest.visualBudgets.perScreenRationale))
      expect(rationale.trim().length).toBeGreaterThan(20);
  });

  it('keeps the modal close dialog structural-only instead of inventing a masking budget', () => {
    expect(Object.keys(manifest.structuralOnlyScreens)).toEqual(['d6ANDN']);
    expect(manifest.structuralOnlyScreens.d6ANDN.reason.length).toBeGreaterThan(20);
    expect(manifest.visualBudgets.perScreen).not.toHaveProperty('d6ANDN');
    expect(Object.keys(manifest.structuralProbes).sort()).toEqual([...frames].sort());
  });

  it('records supplemental states and the late-first-confirmation adaptation', () => {
    expect(manifest.sourceDesign.provenanceNote).toContain('late-first-confirmation');
    expect(manifest.sourceDesign.provenanceNote).toContain('no budget exists for them');
  });
});
