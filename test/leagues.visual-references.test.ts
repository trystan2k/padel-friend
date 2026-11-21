import { describe, expect, it } from 'vitest';
import wizard from '../e2e/references/paf-202-create-wizard/manifest.json';
import leagues from '../e2e/references/paf-202-leagues/manifest.json';

describe('League creation and Ranked selector reference ownership', () => {
  it('maps League creation and validation to U17, and the Ranked selector to U13', () => {
    expect(leagues.surfaces.CreateLeaguePage.frames).toEqual(['ik5JC', 'MYsDp']);
    expect(leagues.surfaces.LeagueForm.frames).toEqual(['ik5JC', 'MYsDp']);
    expect(wizard.sourceDesign).toBe(leagues.sourceDesign.path);
    expect(wizard.frames.wHaAb.route).toBe('/matches/create (step 0)');
    expect(wizard.toleranceEvidence.wHaAb.maxDiffPixelRatio).toBe(0.01);
    expect(wizard.decisions.deviations[0]).toContain('league control');
  });
});
