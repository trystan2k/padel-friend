import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const dir = join(root, 'e2e/references/paf-202-home');

type Region = {
  status: 'gated' | 'finding' | 'measure';
  budget?: number;
  pixels?: 'compare' | 'none';
  pixelsReason?: string;
  classification: string;
};
type Manifest = {
  sourceDesign: { path: string; sha256: string };
  frames: Record<string, { file: string; sha256: string; pixelSize: number[] }>;
  frameRegions: Record<string, Record<string, Region>>;
};

const manifest: Manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const sha = (buffer: Buffer) => createHash('sha256').update(buffer).digest('hex');

describe('Home visual references (hKncV, AlfRD)', () => {
  it('pins the canonical design and both exported frames by digest', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend-clubhouse.pen');
    expect(sha(readFileSync(join(root, manifest.sourceDesign.path)))).toBe(
      manifest.sourceDesign.sha256
    );
    expect(Object.keys(manifest.frames).sort()).toEqual(['AlfRD', 'hKncV']);
    for (const frame of Object.values(manifest.frames)) {
      expect(sha(readFileSync(join(dir, frame.file)))).toBe(frame.sha256);
      expect(frame.pixelSize).toEqual([390, 844]);
    }
  });

  it('gates every region with a measured budget or documents why pixels are skipped', () => {
    const problems: string[] = [];
    for (const [frame, regions] of Object.entries(manifest.frameRegions)) {
      expect(Object.keys(regions).sort()).toEqual([
        'attentionRow',
        'bell',
        'levelCard',
        'nextCard',
        'pill'
      ]);
      for (const [name, region] of Object.entries(regions)) {
        const id = `${frame}/${name}`;
        if (region.status === 'measure') problems.push(`${id}: unmeasured`);
        if (region.classification.length <= 20) problems.push(`${id}: classification`);
        if (region.status === 'gated' && !(region.budget && region.budget > 0))
          problems.push(`${id}: gated without a budget`);
        if (region.pixels === 'none' && !region.pixelsReason)
          problems.push(`${id}: skipped pixels without a reason`);
      }
    }
    expect(problems).toEqual([]);
  });
});
