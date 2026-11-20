import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = fileURLToPath(new URL('../', import.meta.url));
const manifestDir = join(root, 'e2e/references/paf-202-statistics');
const featureDir = join(root, 'src/features/statistics');

// Pencil node ids are short alphanumeric tokens. Frame existence is a Pencil-side concern.
const NODE_ID = /^[A-Za-z0-9]{4,8}$/;
const FRAMES = ['RN0yw', 'RRuhH', 'z6vIR', 'QVLTH', 'GrkSH', 'khmeK', 'o9iaC1', 'm8Loju', 'BcpYH'];
const SURFACES = [
  'PlayerStatistics',
  'CommunityStatistics',
  'PlayerMetric',
  'PlayerStatisticsRecords',
  'PlayerRecentMatches',
  'MatchHistory',
  'ConfirmedGroupDetail',
  'PartnerRecords',
  'OpponentRecords',
  'PairStatistics',
  'OpponentStatistics',
  'RelationshipList',
  'RelationshipMeetings',
  'RelationshipRecordView'
];
const SHARED = [
  'StatisticsFilters',
  'StatisticsFilterSection',
  'StatisticsChart',
  'StatisticsDataTable',
  'StatisticsBreadcrumb',
  'StatisticsStates'
];

type Entry = { frames: string[]; note: string; route?: string };
type Reference = { frameId: string; file: string; sha256: string; pixelSize: number[] };
type Manifest = {
  sourceDesign: { path: string; sha256: string; exportCommand: string; provenanceNote: string };
  approvedReferences: Record<string, Reference>;
  frameFindings: Record<string, string>;
  surfaces: Record<string, Entry>;
  sharedComponents: Record<string, Entry>;
  omittedDrawnElements: Record<string, string>;
  visualBudgets: {
    rasterRegions: Record<
      string,
      {
        cardSelector: string;
        referenceTop: number;
        budget: number;
        previousViewportResidual: number;
        bands: { name: string; top: number; bottom: number; classification: string }[];
      }
    >;
  };
};

const manifest: Manifest = JSON.parse(readFileSync(join(manifestDir, 'manifest.json'), 'utf8'));

// Every mapped surface or shared component is a statistics module of the same name.
const modules = new Set(
  readdirSync(featureDir)
    .filter((file) => file.endsWith('.tsx'))
    .map((file) => file.replace(/\.tsx$/, ''))
);

describe('statistics visual references (Clubhouse)', () => {
  it('records the source design digest and export provenance', () => {
    expect(manifest.sourceDesign.path).toBe(
      'docs/design/Padel-friend App Redesign/padel-friend-clubhouse.pen'
    );
    expect(manifest.sourceDesign.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(manifest.sourceDesign.exportCommand).toContain('Pencil MCP');
    expect(manifest.sourceDesign.provenanceNote.length).toBeGreaterThan(80);
  });

  it('maps the 14 surfaces and 6 shared components to real statistics modules', () => {
    expect(Object.keys(manifest.surfaces).sort()).toEqual([...SURFACES].sort());
    expect(Object.keys(manifest.sharedComponents).sort()).toEqual([...SHARED].sort());
    for (const name of [...SURFACES, ...SHARED]) {
      expect([name, modules.has(name)]).toEqual([name, true]);
      const entry = manifest.surfaces[name] ?? manifest.sharedComponents[name];
      expect(entry?.note.trim().length ?? 0).toBeGreaterThan(20);
    }
  });

  it('accounts for all nine frames and exports each one individually', () => {
    expect(Object.keys(manifest.approvedReferences).sort()).toEqual([...FRAMES].sort());
    expect(Object.keys(manifest.frameFindings).sort()).toEqual([...FRAMES].sort());
    const used = new Set(
      [...Object.values(manifest.surfaces), ...Object.values(manifest.sharedComponents)].flatMap(
        (entry) => entry.frames
      )
    );
    for (const frame of FRAMES) expect([frame, used.has(frame)]).toEqual([frame, true]);
    for (const [key, reference] of Object.entries(manifest.approvedReferences)) {
      expect(reference.frameId).toBe(key);
      expect(key).toMatch(NODE_ID);
    }
  });

  it('maps BcpYH to the confirmed group detail only (D7)', () => {
    const owners = Object.entries(manifest.surfaces)
      .filter(([, entry]) => entry.frames.includes('BcpYH'))
      .map(([name]) => name);
    expect(owners).toEqual(['ConfirmedGroupDetail']);
    expect(manifest.surfaces['ConfirmedGroupDetail']?.route).toBe(
      '/matches/$eventId/groups/$groupId'
    );
    expect(manifest.surfaces['MatchHistory']?.frames).toEqual([]);
  });

  it('records the elements the frames draw without a data source', () => {
    for (const key of ['avgLevelVenue', 'correctionShare', 'periodSegment']) {
      expect((manifest.omittedDrawnElements[key] ?? '').length).toBeGreaterThan(30);
    }
  });

  it('ships every approved PNG with its recorded digest and size', () => {
    for (const reference of Object.values(manifest.approvedReferences)) {
      const path = join(manifestDir, reference.file);
      expect(existsSync(path)).toBe(true);
      const bytes = readFileSync(path);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sha256);
      // PNG IHDR: width and height are big-endian at bytes 16 and 20.
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(reference.pixelSize);
      expect(reference.pixelSize[0]).toBe(390);
    }
  });

  it('gates the common card edge without using the full-viewport residual as a budget', () => {
    const { rasterRegions } = manifest.visualBudgets;
    expect(Object.keys(rasterRegions).sort()).toEqual(
      ['RN0yw', 'GrkSH', 'khmeK', 'o9iaC1', 'BcpYH'].sort()
    );
    for (const region of Object.values(rasterRegions)) {
      const { budget, bands, cardSelector, referenceTop, previousViewportResidual } = region;
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThanOrEqual(0.02);
      expect(budget).toBeLessThan(previousViewportResidual);
      expect(referenceTop).toBeGreaterThan(0);
      expect(cardSelector).not.toBe('');
      expect(bands.map(({ top }) => top)).toEqual([
        0,
        ...bands.slice(0, -1).map(({ bottom }) => bottom)
      ]);
      expect(bands.at(-1)?.bottom).toBe(844);
      for (const { classification } of bands) expect(classification.length).toBeGreaterThan(40);
    }
  });
});
