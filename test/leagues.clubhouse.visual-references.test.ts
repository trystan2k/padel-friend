import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-leagues/manifest.json';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const sentenceCase = (copy: string) => copy === copy.charAt(0).toUpperCase() + copy.slice(1);

describe('league Clubhouse visual references', () => {
  it('pins the source design digest to the current Clubhouse design bytes', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend-clubhouse.pen');
    expect(
      createHash('sha256')
        .update(read(`../${manifest.sourceDesign.path}`))
        .digest('hex')
    ).toBe(manifest.sourceDesign.sha256);
  });

  it('pins every exported frame by digest and size', () => {
    expect(Object.keys(manifest.exportSha256).sort()).toEqual(
      Object.keys(manifest.frameFindings).sort()
    );
    for (const [id, size] of Object.entries(manifest.exportSize)) {
      const pinned = new Map(Object.entries(manifest.exportSha256)).get(id);
      const bytes = read(`../e2e/references/paf-202-leagues/${id}.png`);
      expect(createHash('sha256').update(bytes).digest('hex')).toBe(pinned);
      expect(bytes.subarray(1, 4).toString()).toBe('PNG');
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(size);
    }
  });

  it('maps every league surface to a frame, and records the league index as implemented in D1 group C', () => {
    const mapped = Object.values(manifest.surfaces).flatMap((surface) => surface.frames);
    expect(new Set(mapped)).toEqual(new Set(Object.keys(manifest.frameFindings)));
    expect(manifest.surfaces.LeagueListPage.frames).toEqual([]);
    expect(manifest.surfaces.LeagueListPage.implemented).toMatch(/Fj5bc \/ ssomJ/);
    expect('blocked' in manifest.surfaces.LeagueListPage).toBe(false);
  });

  it('documents nonzero raster budgets above the measured residual', () => {
    for (const budget of Object.values(manifest.rasterBudgets)) {
      expect(budget.measured).toBeGreaterThan(0);
      expect(budget.maxPerceptualDiff).toBeGreaterThanOrEqual(budget.measured);
      expect(budget.maxPerceptualDiff - budget.measured).toBeLessThan(0.01);
      expect(budget.reason.length).toBeGreaterThan(20);
    }
    expect(Object.keys(manifest.visualBudgets.maxMaskedFraction).sort()).toEqual(
      Object.keys(manifest.visualBudgets.perScreen).sort()
    );
    for (const budget of Object.values(manifest.visualBudgets.perScreen)) {
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThanOrEqual(0.02);
    }
    for (const fraction of Object.values(manifest.visualBudgets.maxMaskedFraction))
      expect(fraction).toBeLessThan(1);
  });

  it('builds the league index from its own Clubhouse styles and the shared back chevron', () => {
    const source = readFileSync(
      new URL('../src/features/leagues/LeagueListPage.tsx', import.meta.url),
      'utf8'
    );
    expect(source).toContain("from './league-index.styles'");
    expect(source).toContain('LeagueBackIcon');
    expect(source).not.toContain('styles.itemLink');
  });

  it.each(['en', 'pt-BR', 'es'])('keeps frame-mapped league copy sentence-case in %s', (locale) => {
    const copy = JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
    ).leagues;
    for (const value of [
      copy.form.title,
      copy.form.submit,
      copy.form.endModeLegend,
      copy.form.mode.manual,
      copy.form.conflict.title,
      copy.history.correctionBanner,
      copy.former.title,
      copy.detail.close,
      copy.detail.closeConfirm.confirm,
      copy.detail.closeConfirm.cancel
    ]) {
      expect(sentenceCase(value)).toBe(true);
      expect(value).not.toBe(value.toUpperCase());
    }
    expect(copy.form.conflict.body).toContain('{{name}}');
    expect(copy.form.conflict.review).toContain('{{name}}');
  });
});
