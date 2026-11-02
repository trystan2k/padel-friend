import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-12/manifest.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const frames = ['ywfn7', 'd6ANDN', 'xbIxj'] as const;
const budgeted: ('ywfn7' | 'xbIxj')[] = ['ywfn7', 'xbIxj'];

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
    expect(manifest.visualBudgets.status).toBe('measured-chromium-scoped-pixel-difference');
    expect(manifest.visualBudgets.measurementMethod).toContain('reject any dimension mismatch');
    expect(Object.keys(manifest.visualBudgets.perScreen).sort()).toEqual([...budgeted].sort());
    const measuredByFrame = new Map(Object.entries(manifest.visualBudgets.measured));
    for (const [frame, budget] of Object.entries(manifest.visualBudgets.perScreen)) {
      const measured = measuredByFrame.get(frame) ?? Number.NaN;
      expect(budget).toBeGreaterThan(0);
      // Budgets only absorb raster variance: a budget far above the residual would hide defects.
      expect(budget).toBeGreaterThanOrEqual(measured);
      expect(budget - measured).toBeLessThanOrEqual(0.02);
      expect(budget).toBeLessThan(0.05);
    }
    expect(Object.keys(manifest.visualBudgets.perScreenRationale).sort()).toEqual(
      [...budgeted].sort()
    );
    for (const rationale of Object.values(manifest.visualBudgets.perScreenRationale))
      expect(rationale.trim().length).toBeGreaterThan(20);
  });

  it('scopes budgets to unmasked raster with bounded masks and documented composition deltas', () => {
    const { referenceMasks, maxMaskedFraction, informationalFullFrame } = manifest.visualBudgets;
    expect(Object.keys(referenceMasks).sort()).toEqual([...budgeted].sort());
    for (const frame of budgeted) {
      const rects = referenceMasks[frame];
      expect(rects.length).toBeGreaterThan(0);
      for (const rect of rects) {
        expect(rect.name.length).toBeGreaterThan(3);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(390);
        expect(rect.y + rect.height).toBeLessThanOrEqual(844);
      }
      // Masks can never swallow the frame: the compared share stays at least 9%.
      expect(maxMaskedFraction[frame]).toBeLessThanOrEqual(0.91);
      // The full-frame residual stays visible as information, never as a budget.
      expect(informationalFullFrame[frame]).toBeGreaterThan(
        manifest.visualBudgets.perScreen[frame]
      );
    }
    expect(Object.keys(manifest.compositionDeltas).sort()).toEqual([...frames].sort());
    for (const deltas of Object.values(manifest.compositionDeltas))
      for (const entry of deltas) {
        expect(entry.delta.length).toBeGreaterThan(20);
        expect(entry.probes.length).toBeGreaterThan(0);
      }
  });

  it('certifies masked content with geometry probes plus token/style assertions', () => {
    const { maskedContentCoverage } = manifest;
    expect(maskedContentCoverage.policy).toContain('geometry probes');
    expect(maskedContentCoverage.policy).toContain('design-tokens/dist/tokens.css');
    expect(Object.keys(maskedContentCoverage).sort()).toEqual(['policy', ...frames].sort());
    const spec = readFileSync(new URL('../e2e/league-standings.spec.ts', import.meta.url), 'utf8');
    const helpers = readFileSync(
      new URL('../e2e/league-standings-visual.ts', import.meta.url),
      'utf8'
    );
    for (const frame of frames) {
      const { theme, elements } = maskedContentCoverage[frame];
      expect(['light', 'dark']).toContain(theme);
      expect(elements.length).toBeGreaterThan(0);
      // Every listed element is really asserted by name, and each frame has structural probes too.
      for (const name of elements) expect(spec + helpers).toContain(`name: '${name}'`);
      expect(manifest.structuralProbes[frame].length).toBeGreaterThan(0);
      expect(spec).toContain(`'${frame} masked content'`);
    }
    // Every masked (budgeted) frame has style coverage for the card, table and type it masks.
    for (const frame of budgeted)
      expect(maskedContentCoverage[frame].elements).toEqual(
        expect.arrayContaining(['own summary card', 'primary table', 'viewer row (highlighted)'])
      );
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
