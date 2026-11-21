import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-d1-group-c/manifest.json';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBr from '../src/locales/pt-BR/translation.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const source = (path: string) => read(`../src/${path}`).toString('utf8');
const frames = Object.entries(manifest.frames);
const byText = (a: string, b: string) => a.localeCompare(b);

describe('PAF-202 D1 group C visual references', () => {
  it('pins the twelve approved frames from the canonical pen', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend-clubhouse.pen');
    expect(frames).toHaveLength(12);
    expect(new Set(frames.map(([, frame]) => frame.frameId)).size).toBe(12);
    expect(frames.map(([, frame]) => frame.name.replace('-dark', '')).sort(byText)).toEqual(
      [
        ...Array(2).fill('privacy-policy'),
        ...Array(2).fill('league-index'),
        ...Array(2).fill('profile-edit'),
        ...Array(2).fill('journey-expanded'),
        ...Array(2).fill('journey-empty'),
        ...Array(2).fill('journey-error')
      ].sort(byText)
    );
  });

  it('pins each export by digest, byte size and dimensions', () => {
    for (const [name, frame] of frames) {
      const bytes = read(`../e2e/references/paf-202-d1-group-c/${frame.source}`);
      expect([name, digest(bytes)]).toEqual([name, frame.sourceSha256]);
      expect([name, bytes.length]).toEqual([name, frame.bytes]);
      expect([name, bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
        name,
        frame.width,
        frame.height
      ]);
    }
  });

  it('maps every surface to existing frames and records the unsourced elements (D6)', () => {
    expect(manifest.status).toBe('implemented-chromium-region-comparison');
    for (const [surface, ids] of Object.entries(manifest.surfaces)) {
      expect([surface, ids.length > 0]).toEqual([surface, true]);
      for (const id of ids) expect(manifest.frames).toHaveProperty(id);
    }
    expect(manifest.frameOnlyElements.participation).toContain('no participation data');
    expect(manifest.frameOnlyElements.barSampleData).toContain('sample data');
  });

  it('keeps a nonzero measured budget with a documented rule for every compared region', () => {
    const { perScreen, measured } = manifest.visualBudgets;
    const keys = Object.keys(perScreen).sort(byText);
    expect(keys).toEqual(Object.keys(measured).sort(byText));
    expect(keys).toHaveLength(46);
    for (const key of keys) {
      const budget = (perScreen as Record<string, number>)[key] ?? Number.NaN;
      const residual = (measured as Record<string, number>)[key] ?? Number.NaN;
      expect(key.split(':')[0] ?? '').toSatisfy((id: string) => id in manifest.frames);
      expect([key, budget > residual]).toEqual([key, true]);
      expect([key, budget - residual <= 0.03]).toEqual([key, true]);
      expect([key, budget <= 0.35]).toEqual([key, true]);
    }
    expect(manifest.visualBudgets.budgetRule).toContain('nonzero');
  });
});

describe('D1 group C implementation stays on the frame structure', () => {
  it('keeps the privacy page public, with the brand header and Back to home link', () => {
    const page = source('features/privacy/PrivacyPolicy.tsx');
    expect(page).toContain('to="/"');
    expect(page).toContain("t('privacy.backHome')");
    expect(page).not.toContain('<footer');
    expect(source('routes/privacy.tsx')).not.toContain('beforeLoad');
    expect(source('routes/__root.tsx')).toContain("['/', '/privacy']");
  });

  it('builds the league index from its Clubhouse styles', () => {
    const page = source('features/leagues/LeagueListPage.tsx');
    expect(page).toContain("from './league-index.styles'");
    expect(page).toContain('leagues.list.create');
    expect(page).toContain('/leagues/create');
  });

  it('draws the journey from the shared chart model, never from invented bars', () => {
    const chart = source('features/player/RatingProgressChart.tsx');
    expect(chart).toContain('buildLevelChart');
    expect(chart).toContain('rating.progress.showTable');
    expect(chart).toContain('<table');
  });

  it('uses design tokens only: no literal colors or pixel sizes in the new styles', () => {
    for (const file of [
      'features/privacy/privacy-policy.styles.ts',
      'features/leagues/league-index.styles.ts',
      'features/player/profile-edit.styles.ts',
      'features/player/rating-journey.styles.ts'
    ]) {
      const text = source(file);
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/rgba?\(/);
      expect(text).not.toMatch(/:\s*'\d+px'/);
    }
  });
});

describe('D1 group C copy', () => {
  const locales = [
    ['en', en],
    ['pt-BR', ptBr],
    ['es', es]
  ] as const;

  it.each(locales)('has the new keys, sentence-case, in %s', (_locale, copy) => {
    for (const value of [
      copy.privacy.backHome,
      copy.leagues.list.navTitle,
      copy.leagues.list.backToCommunity,
      copy.leagues.list.create,
      copy.leagues.list.sections.active,
      copy.leagues.list.sections.closed,
      copy.profile.navTitle,
      copy.profile.cancel,
      copy.profile.backToProfile,
      copy.profile.changePhoto,
      copy.profile.preferredDays,
      copy.profile.preferredTimes,
      copy.profile.preferences,
      copy.rating.progress.scopeCaption,
      copy.rating.progress.emptyBody,
      copy.rating.progress.startingLevel
    ]) {
      expect(value.length).toBeGreaterThan(2);
      expect(value).toMatch(/^\p{Lu}/u);
      expect(value).not.toBe(value.toUpperCase());
    }
    expect(Object.keys(copy.profile.availabilityDaysShort)).toHaveLength(7);
  });

  it('reads the frame copy in en', () => {
    expect(en.leagues.list.create).toBe('Create league');
    expect(en.leagues.list.sections.active).toBe('Active leagues');
    expect(en.leagues.list.sections.closed).toBe('Closed leagues');
    expect(en.profile.edit).toBe('Edit profile');
    expect(en.profile.save).toBe('Save changes');
    expect(en.rating.progress.scopeCaption).toBe('All time · Level after rated games');
  });

  it.each(locales)('has no sample data from the frames in %s', (_locale, copy) => {
    const text = JSON.stringify([copy.leagues.list, copy.profile, copy.rating.progress]);
    expect(text).not.toMatch(/Autumn League|Friday League|Thiago Ribeiro|3\.82|0\.31/);
  });
});
