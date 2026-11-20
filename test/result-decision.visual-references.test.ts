import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-result-decision/manifest.json';
import recording from '../e2e/references/paf-202-result-recording/manifest.json';

const sentenceCase = (copy: string) => copy === copy.charAt(0).toUpperCase() + copy.slice(1);

describe('result decision visual references', () => {
  it('shares the Clubhouse source design and treats CWJkF as record-only', () => {
    expect(manifest.sourceDesign.sha256).toBe(recording.sourceDesign.sha256);
    expect(Object.keys(manifest.recordOnly)).toEqual(['CWJkF']);
    const mapped = Object.values(manifest.surfaces).flatMap((surface) => surface.frames);
    expect(mapped).toEqual(expect.arrayContaining(['sLXK7', 'JXjNs', 'H6VcqC', 'GMcbD', 'adujr']));
    expect(manifest.surfaces.MatchResultCorrections.frames).toContain('CWJkF');
  });

  it('pins every exported Clubhouse frame by digest and size', () => {
    expect(Object.keys(manifest.exportSha256).sort()).toEqual(
      Object.keys(manifest.frameFindings).sort()
    );
    for (const [id, size] of Object.entries(manifest.exportSize)) {
      const bytes = readFileSync(
        new URL(`../e2e/references/paf-202-result-decision/${id}.png`, import.meta.url)
      );
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(
        Object.entries(manifest.exportSha256).find(([key]) => key === id)?.[1]
      );
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(size);
    }
  });

  it('documents nonzero measured raster budgets above the measured residual', () => {
    for (const budget of Object.values(manifest.rasterBudgets)) {
      expect(budget.measured).toBeGreaterThan(0);
      expect(budget.maxPerceptualDiff).toBeGreaterThanOrEqual(budget.measured);
      expect(budget.maxPerceptualDiff - budget.measured).toBeLessThan(0.01);
      expect(budget.reason.length).toBeGreaterThan(20);
    }
  });

  it('reuses measured baselines with a nonzero bounded budget', () => {
    expect(manifest.pixelEvidence.frames).toEqual(Object.keys(recording.pixelEvidence.lifecycle));
    for (const reused of Object.values(recording.pixelEvidence.lifecycle)) {
      expect(reused.maxDiffRatio).toBeGreaterThan(0);
      expect(reused.maxDiffRatio).toBeLessThanOrEqual(manifest.pixelEvidence.maxDiffRatio);
    }
  });

  it.each(['en', 'pt-BR', 'es'])('keeps result status copy sentence-case in %s', (locale) => {
    const copy = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
    ).matches.results;
    for (const value of [
      copy.pending,
      copy.autoConfirmIn,
      copy.confirmation.manual,
      copy.confirmation.auto
    ])
      expect(sentenceCase(value)).toBe(true);
    for (const value of [copy.pending, copy.autoConfirmIn])
      expect(value).not.toBe(value.toUpperCase());
  });
});
