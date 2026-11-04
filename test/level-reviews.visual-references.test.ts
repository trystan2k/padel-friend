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
    perScreenRationale: Record<string, string>;
  };
};
const manifest: Manifest = JSON.parse(readFileSync(join(directory, 'manifest.json'), 'utf8'));
const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');

describe('level review visual reference candidates', () => {
  it('records the design digest and verified export provenance', () => {
    expect(manifest.status).toBe('verified-references-unmeasured-budgets');
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend.pen');
    expect(manifest.sourceDesign.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(manifest.sourceDesign.provenanceNote).toContain('byte-for-byte');
  });

  it.each(['qWosG', 'OKYtp'])('records frame %s, image digest and viewport', (id) => {
    const reference = manifest.approvedReferences[id];
    expect(reference).toBeDefined();
    if (!reference) throw new Error('Missing reference ' + id);
    expect(reference.frameId).toBe(id);
    const bytes = readFileSync(join(directory, reference.file));
    expect(digest(bytes)).toBe(reference.sha256);
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(reference.pixelSize);
    expect(reference.pixelSize).toEqual([780, 1688]);
    expect(reference.viewport).toEqual([390, 844]);
    expect(manifest.visualBudgets.perScreen[id]).toBeGreaterThan(0);
    expect(manifest.visualBudgets.perScreen[id]).toBeLessThan(0.5);
    expect(manifest.visualBudgets.perScreenRationale[id]).toContain('calibrated');
    expect(manifest.visualBudgets.status).toBe('unmeasured-not-certified');
  });
});
