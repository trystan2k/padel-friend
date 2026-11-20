import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-leagues/manifest.json';

describe('League standings reference scope', () => {
  it('bounds reference masks to the two approved viewport comparisons', () => {
    const { referenceMasks, perScreen, maxMaskedFraction } = manifest.visualBudgets;
    expect(Object.keys(perScreen).sort()).toEqual(['xbIxj', 'ywfn7']);
    for (const id of ['ywfn7', 'xbIxj'] as const) {
      expect(perScreen[id]).toBe(0.01);
      expect(maxMaskedFraction[id]).toBe(0.95);
      const [width, height] = manifest.exportSize[id];
      for (const rect of referenceMasks[id]) {
        expect(rect.name.length).toBeGreaterThan(3);
        expect(rect.x).toBeGreaterThanOrEqual(0);
        expect(rect.y).toBeGreaterThanOrEqual(0);
        expect(rect.x + rect.width).toBeLessThanOrEqual(width!);
        expect(rect.y + rect.height).toBeLessThanOrEqual(height!);
      }
    }
  });

  it('records structural-only closure and keeps audited history distinct from active standings', () => {
    expect(manifest.structuralOnly.d6ANDN).toContain('structural and token probes');
    expect(manifest.visualBudgets.perScreen).not.toHaveProperty('d6ANDN');
    expect(manifest.surfaces.LeagueStandings.frames).toEqual(['ywfn7']);
    expect(manifest.surfaces.LeagueStandingsHistory.frames).toEqual(['xbIxj']);
  });
});
