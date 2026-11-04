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
    perScreen: Record<string, number>;
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

  it('has a budget for exactly the measured screens', () => {
    expect(Object.keys(manifest.visualBudgets.perScreen).sort()).toEqual([...screens].sort());
    expect(Object.keys(manifest.visualBudgets.measuredBaseline).sort()).toEqual(
      [...screens].sort()
    );
  });
});
