import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestDir = join(root, 'e2e/references/paf-13');
const featureDir = join(root, 'src/features/statistics');

// Pencil node ids are short alphanumeric tokens. Frame existence is a Pencil-side concern.
const NODE_ID = /^[A-Za-z0-9]{4,8}$/;
const SURFACES = [
  'playerStatistics',
  'filters',
  'pairStatistics',
  'opponentStatistics',
  'matchHistory',
  'groupDetail',
  'communityStatistics'
];

type Frame = {
  frameId: string;
  role: string;
  regions: Record<string, string>;
  provenance?: string;
};
type Surface = {
  route: string;
  components: string[];
  frames: Frame[];
  adaptation: string;
  budget: string;
};
type Reference = { frameId: string; file: string; sha256: string; pixelSize: number[] };
type Manifest = {
  sourceDesign: { path: string; sha256: string; exportCommand: string; provenanceNote: string };
  components: Record<string, { name: string; usedBy: string }>;
  approvedReferences: Record<string, Reference>;
  surfaces: Record<string, Surface>;
  visualBudgets: {
    perScreen: Record<string, number>;
    perScreenRationale: Record<string, string>;
    measuredResiduals: Record<string, number>;
    honesty: string;
  };
};

const manifest: Manifest = JSON.parse(readFileSync(join(manifestDir, 'manifest.json'), 'utf8'));

function surfaceOf(name: string): Surface {
  const surface = manifest.surfaces[name];
  if (!surface) throw new Error('Missing surface ' + name);
  return surface;
}

const exported = new Set(
  readdirSync(featureDir)
    .filter((file) => file.endsWith('.tsx'))
    .flatMap((file) =>
      [
        ...readFileSync(join(featureDir, file), 'utf8').matchAll(
          /^export (?:function|const) (\w+)/gm
        )
      ].map((match) => match[1] ?? '')
    )
);

describe('statistics visual references', () => {
  it('records the source design digest and export provenance', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend.pen');
    expect(manifest.sourceDesign.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceDesign.exportCommand).toContain('Pencil MCP');
    expect(manifest.sourceDesign.provenanceNote.length).toBeGreaterThan(80);
  });

  it('covers every statistics surface', () => {
    expect(Object.keys(manifest.surfaces).sort()).toEqual([...SURFACES].sort());
    for (const surface of Object.values(manifest.surfaces)) {
      expect(surface.route).toMatch(/^\//);
      expect(surface.frames.length).toBeGreaterThan(0);
      expect(surface.adaptation.trim()).not.toBe('');
    }
  });

  it.each(SURFACES)('%s references real statistics components', (name) => {
    const { components } = surfaceOf(name);
    expect(components.length).toBeGreaterThan(0);
    for (const component of components) expect(exported.has(component)).toBe(true);
  });

  it('maps the primary views to a surface', () => {
    const used = new Set(Object.values(manifest.surfaces).flatMap((surface) => surface.components));
    for (const main of [
      'PlayerStatistics',
      'PairStatistics',
      'OpponentStatistics',
      'MatchHistory'
    ]) {
      expect(used.has(main)).toBe(true);
    }
    expect(used.has('ConfirmedGroupDetail')).toBe(true);
    expect(used.has('CommunityStatistics')).toBe(true);
  });

  it('uses well-formed node ids and never an unexplained frame', () => {
    for (const [key, reference] of Object.entries(manifest.approvedReferences)) {
      expect(reference.frameId).toBe(key);
      expect(key).toMatch(NODE_ID);
    }
    for (const id of Object.keys(manifest.components)) expect(id).toMatch(NODE_ID);
    const frames = Object.values(manifest.surfaces).flatMap((surface) => surface.frames);
    for (const frame of frames) {
      expect(frame.frameId).toMatch(NODE_ID);
      for (const region of Object.keys(frame.regions)) expect(region).toMatch(NODE_ID);
    }
    // A frame without an approved export must say why it is referenced.
    const unexplained = frames.filter(
      (frame) =>
        !manifest.approvedReferences[frame.frameId] && (frame.provenance ?? '').trim().length <= 20
    );
    expect(unexplained).toEqual([]);
  });

  it('ships every approved PNG with its recorded digest and size', () => {
    for (const reference of Object.values(manifest.approvedReferences)) {
      const path = join(manifestDir, reference.file);
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sha256);
      // PNG IHDR: width and height are big-endian at bytes 16 and 20.
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(reference.pixelSize);
    }
  });

  it('declares a nonzero, justified tolerance for every surface', () => {
    const { perScreen, perScreenRationale, honesty } = manifest.visualBudgets;
    expect(Object.keys(perScreen).sort()).toEqual([...SURFACES].sort());
    for (const name of SURFACES) {
      const budget = perScreen[name] ?? 0;
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThan(0.5);
      expect((perScreenRationale[name] ?? '').trim().length).toBeGreaterThan(40);
      expect(surfaceOf(name).budget).toBe(name);
    }
    // Measured in U8: budget = measured residual plus a small margin, never below it.
    const measured = manifest.visualBudgets.measuredResiduals;
    expect(Object.keys(measured).sort()).toEqual(
      [
        'communityStatistics',
        'groupDetail',
        'opponentStatistics',
        'pairStatistics',
        'playerStatistics'
      ].sort()
    );
    for (const [name, residual] of Object.entries(measured)) {
      const budget = perScreen[name] ?? 0;
      expect(budget).toBeGreaterThanOrEqual(residual);
      expect(budget - residual).toBeLessThanOrEqual(0.05);
    }
    expect(honesty).toContain('unmeasured ceilings');
  });
});
