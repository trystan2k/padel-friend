import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import paf7Manifest from '../e2e/references/paf-7/manifest.json';
import manifest from '../e2e/references/paf-8/manifest.json';

describe('PAF-8 result lifecycle visual references', () => {
  it('pins uncropped approved Pencil exports by digest and source provenance', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend.pen');
    expect(manifest.sourceDesign.sha256).toBe(paf7Manifest.sourceDesign.sha256);
    expect(Object.keys(manifest.approvedReferences).sort()).toEqual(
      [
        'H6VcqC.png',
        'GMcbD.png',
        'sLXK7.png',
        'CWJkF.png',
        'JXjNs.png',
        'ausNa.png',
        'BcpYH.png',
        'alZmm.png'
      ].sort()
    );

    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    for (const [filename, reference] of Object.entries(manifest.approvedReferences)) {
      const bytes = readFileSync(new URL(`../e2e/references/paf-8/${filename}`, import.meta.url));
      expect(`${filename}: ${digest(bytes)}`).toBe(`${filename}: ${reference.sha256}`);
      expect(`${filename}: ${bytes.subarray(1, 4).toString()}`).toBe(`${filename}: PNG`);
      expect(`${filename}: ${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`).toBe(
        `${filename}: ${reference.pixelSize.join('x')}`
      );
      expect(filename).toBe(`${reference.frameId}.png`);
    }
  });

  it('pins measured nonzero Chromium budgets and per-frame adaptation rationale', () => {
    expect(manifest.status).toBe('chromium-certified-with-scoped-route-adaptations');
    expect(manifest.visualBudgets.status).toBe('measured-chromium-viewport-pixel-difference');
    expect(manifest.visualBudgets.measurementMethod).toContain('reject any dimension mismatch');
    const frames = Object.keys(manifest.approvedReferences).map((name) => name.replace('.png', ''));
    const budgets = Object.values(manifest.visualBudgets.perScreen);
    expect(budgets).toHaveLength(8);
    for (const budget of budgets) {
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThan(0.29);
    }
    expect(Object.keys(manifest.visualBudgets.perScreenRationale).sort()).toEqual(frames.sort());
    for (const rationale of Object.values(manifest.visualBudgets.perScreenRationale))
      expect(rationale.trim().length).toBeGreaterThan(20);
    expect(Object.keys(manifest.structuralProbes).sort()).toEqual(frames.sort());
  });
});
