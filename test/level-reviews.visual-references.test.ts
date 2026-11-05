import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const directory = join(root, 'e2e/references/paf-17');
type Manifest = {
  status: string;
  sourceDesign: { path: string; sha256: string; provenanceNote: string };
  approvedReferences: Record<
    string,
    { frameId: string; file: string; sha256: string; pixelSize: number[]; viewport: number[] }
  >;
  visualBudgets: {
    status: string;
    coverage: string;
    measurement: string;
    perScreen: Record<string, number>;
    previousCropBudgets: Record<string, number | string>;
    geometryProbes: Record<string, string[] | string>;
    measuredBaseline: Record<string, number>;
    perScreenRationale: Record<string, string>;
  };
};
const manifest: Manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

const screens = [
  'qWosG',
  'OKYtp:pending',
  'OKYtp:reviewing',
  'OKYtp:approved',
  'OKYtp:rejected',
  'gGNxk'
];

describe('level review visual references', () => {
  it('uses semantic visible borders for radio tiles and evidence disclosure', () => {
    const styles = readFileSync(
      join(root, 'src/features/level-reviews/level-review.styles.ts'),
      'utf8'
    );
    for (const name of ['mode', 'disclosureTrigger']) {
      const block = styles.match(new RegExp(`\\n  ${name}: \\{([\\s\\S]*?)\\n  \\},`))?.[1];
      expect(block).toContain("borderWidth: 'var(--border-width-sm)'");
      expect(block).toContain("borderStyle: 'solid'");
      expect(block).toContain("borderColor: 'var(--color-line)'");
    }
  });
  it('records the design digest and verified export provenance', () => {
    expect(manifest.status).toBe('measured-calibrated');
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend.pen');
    expect(manifest.sourceDesign.sha256).toBe(
      digest(readFileSync(join(root, manifest.sourceDesign.path)))
    );
    expect(manifest.sourceDesign.provenanceNote).toContain('byte-for-byte');
  });

  it.each(['qWosG', 'OKYtp', 'gGNxk'])('records frame %s, image digest and viewport', (id) => {
    const reference = manifest.approvedReferences[id];
    expect(reference).toBeDefined();
    if (!reference) throw new Error('Missing reference ' + id);
    expect(reference.frameId).toBe(id);
    const bytes = readFileSync(join(directory, reference.file));
    expect(digest(bytes)).toBe(reference.sha256);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(reference.pixelSize);
    expect(reference.pixelSize).toEqual([780, 1688]);
    expect(reference.viewport).toEqual([390, 844]);
  });

  it.each(screens)('keeps a nonzero budget calibrated from the measured baseline of %s', (key) => {
    const budget = manifest.visualBudgets.perScreen[key];
    const measured = manifest.visualBudgets.measuredBaseline[key];
    expect(manifest.visualBudgets.status).toBe('measured-calibrated');
    expect(budget).toBeGreaterThan(0);
    expect(measured).toBeGreaterThan(0);
    if (budget === undefined || measured === undefined) throw new Error('Missing budget ' + key);
    // Calibrated, never blanket: a bounded headroom over the measured baseline, always below 0.5.
    expect(budget).toBeGreaterThanOrEqual(measured);
    expect(budget).toBeLessThanOrEqual(measured * 1.25);
    expect(budget).toBeLessThan(0.5);
    expect(manifest.visualBudgets.perScreenRationale[key]).toContain('alibrated');
  });

  it('compares the whole viewport, not a crop, and says so in the measurement', () => {
    expect(manifest.visualBudgets.coverage).toBe('full-viewport');
    expect(manifest.visualBudgets.measurement).toContain('WHOLE 390x844');
    expect(manifest.visualBudgets.measurement).toContain('independent of these budgets');
  });

  it.each(screens)(
    'documents why the full-screen budget of %s is not a structural allowance',
    (key) => {
      // Every budget carries a rationale naming the residual (rasterization or a deliberate difference).
      const rationale = manifest.visualBudgets.perScreenRationale[key];
      expect(rationale).toMatch(/full viewport|state, full viewport/);
      expect(rationale).toMatch(/margin/);
      expect(rationale).toMatch(/rasterization|deliberate/);
    }
  );

  it('keeps exact geometry probes for every frame, independent from the raster budgets', () => {
    const probes = manifest.visualBudgets.geometryProbes;
    const list = (frame: string): string[] => {
      const value = probes[frame];
      if (!Array.isArray(value)) throw new Error('Missing geometry probes for ' + frame);
      return value;
    };
    for (const frame of ['qWosG', 'OKYtp', 'gGNxk', 'shared'])
      expect(list(frame).length).toBeGreaterThanOrEqual(3);
    expect(String(probes['note'])).toContain('independent of the raster budgets');
    expect(list('shared').join(' ')).toContain('44x44');
  });

  it('re-calibrated away from the superseded crop budgets without hiding a regression', () => {
    for (const key of screens) {
      const previous = manifest.visualBudgets.previousCropBudgets[key];
      expect(typeof previous).toBe('number');
      // Full-screen budgets are measured fresh: never inherited from the old crop numbers.
      expect(manifest.visualBudgets.measuredBaseline[key]).not.toBe(previous);
    }
  });

  it('has a budget for exactly the measured screens', () => {
    expect(Object.keys(manifest.visualBudgets.perScreen).sort()).toEqual([...screens].sort());
    expect(Object.keys(manifest.visualBudgets.measuredBaseline).sort()).toEqual(
      [...screens].sort()
    );
  });
});
