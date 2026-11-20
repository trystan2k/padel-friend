import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-level-reviews/manifest.json';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const source = (name: string) => read(`../src/features/level-reviews/${name}`).toString('utf8');
const sentenceCase = (copy: string) => copy === copy.charAt(0).toUpperCase() + copy.slice(1);
const BLOCKED = [
  'PlayerLevelReviewHistory.tsx',
  'PlatformLevelReviewQueue.tsx',
  'PlatformLevelReviewDetail.tsx',
  'LevelReviewStates.tsx'
];

describe('level review Clubhouse visual references', () => {
  it('pins the source design digest to the current Clubhouse design bytes', () => {
    expect(manifest.sourceDesign.path).toBe(
      'docs/design/Padel-friend App Redesign/padel-friend-clubhouse.pen'
    );
    expect(
      createHash('sha256')
        .update(read(`../${manifest.sourceDesign.path}`))
        .digest('hex')
    ).toBe(manifest.sourceDesign.sha256);
  });

  it.each(['qWosG', 'OKYtp'] as const)('pins frame %s by digest and size', (id) => {
    const reference = manifest.approvedReferences[id];
    const bytes = read(`../e2e/references/paf-202-level-reviews/${id}.png`);
    expect(reference.frameId).toBe(id);
    expect(createHash('sha256').update(bytes).digest('hex')).toBe(reference.sha256);
    expect(bytes.subarray(1, 4).toString()).toBe('PNG');
    expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(reference.pixelSize);
  });

  it('maps the request and status pages to their frames and records the rest as blocked (D1)', () => {
    const { surfaces } = manifest;
    expect(surfaces.PlayerLevelReviewRequest.frames).toEqual(['qWosG']);
    expect(surfaces.PlayerLevelReviewStatus.frames).toEqual(['OKYtp']);
    for (const blocked of [
      surfaces.PlayerLevelReviewHistory,
      surfaces.PlatformLevelReviewQueue,
      surfaces.PlatformLevelReviewDetail
    ]) {
      expect(blocked.frames).toEqual([]);
      expect(blocked.blocked).toMatch(/D1/);
    }
    expect(surfaces.PlatformLevelReviewQueue.blocked).toMatch(/D7/);
  });

  it('records the drawn elements without a source instead of inventing them (D6)', () => {
    expect(manifest.omittedDrawnElements.requestId).toContain('LR-2048');
    expect(manifest.omittedDrawnElements.sla).toContain('2-3 days');
    expect(manifest.omittedDrawnElements.stepper).toMatch(/min\/max/);
  });

  it('documents nonzero raster budgets for each measured region', () => {
    const budgets = Object.entries(manifest.visualBudgets.perScreen);
    expect(budgets.map(([key]) => key).sort()).toEqual(
      Object.keys(manifest.visualBudgets.perScreenRationale).sort()
    );
    for (const [key, budget] of budgets) {
      expect(budget).toBeGreaterThan(0);
      expect(budget).toBeLessThanOrEqual(0.3);
      expect(
        (manifest.visualBudgets.perScreenRationale as Record<string, string>)[key]?.length
      ).toBeGreaterThan(40);
    }
  });

  it('keeps the blocked pages off the Clubhouse-only styles and components', () => {
    for (const file of BLOCKED) {
      const text = source(file);
      expect(text).not.toContain('level-review-clubhouse.styles');
      expect(text).not.toContain('levelReviewClubhouse');
      expect(text).not.toContain('LevelReviewBackLink');
    }
  });

  it('uses the Clubhouse styles on the request and status pages only', () => {
    for (const file of ['PlayerLevelReviewRequest.tsx', 'PlayerLevelReviewStatus.tsx']) {
      const text = source(file);
      expect(text).toContain('level-review-clubhouse.styles');
      expect(text).not.toContain("from './level-review.styles'");
    }
  });
});

describe('level review link destinations', () => {
  it('no level review surface links to the dashboard any more', () => {
    for (const file of [...BLOCKED, 'PlayerLevelReviewRequest.tsx', 'PlayerLevelReviewStatus.tsx'])
      expect(source(file)).not.toContain('/dashboard');
  });

  it('points the profile back links at /me and the status back link at the request list', () => {
    expect(source('PlayerLevelReviewRequest.tsx')).toContain('<LevelReviewBackLink to="/me"');
    expect(source('PlayerLevelReviewHistory.tsx')).toContain('to="/me"');
    expect(source('LevelReviewStates.tsx')).toContain("backTo = '/me'");
    expect(source('PlayerLevelReviewStatus.tsx')).toContain(
      '<LevelReviewBackLink to="/level-reviews"'
    );
    expect(source('PlayerLevelReviewStatus.tsx')).toContain('<Link to="/me"');
  });
});

describe('level review Clubhouse copy', () => {
  const levelReviewCopy = (locale: string) =>
    JSON.parse(
      readFileSync(new URL(`../src/locales/${locale}/translation.json`, import.meta.url), 'utf8')
    ).levelReview;

  it.each(['en', 'pt-BR', 'es'])('keeps the frame-mapped copy sentence-case in %s', (locale) => {
    const copy = levelReviewCopy(locale);
    for (const value of [
      copy.request.intro,
      copy.request.forwardOnly,
      copy.detail.timelineWaiting,
      copy.detail.timelineDecision,
      copy.detail.timelineNotify,
      copy.detail.ifApprovedTitle,
      copy.detail.ifApprovedBody,
      copy.detail.ifRejectedTitle,
      copy.detail.ifRejectedBody
    ]) {
      expect(sentenceCase(value)).toBe(true);
      expect(value).not.toBe(value.toUpperCase());
    }
    expect(copy.detail.summary).toContain('{{from}}');
    expect(copy.detail.summary).toContain('{{to}}');
    expect(copy.detail.summary).toContain('{{id}}');
  });

  it.each(['en', 'pt-BR', 'es'])('has no invented SLA or sample request id in %s', (locale) => {
    const text = JSON.stringify(levelReviewCopy(locale));
    expect(text).not.toMatch(/LR-\d/);
    expect(text).not.toMatch(/2[–-]3/);
  });

  it.each(['en', 'pt-BR', 'es'])('drops the replaced context keys in %s', (locale) => {
    const copy = levelReviewCopy(locale);
    expect(copy.request.context).toBeUndefined();
    expect(copy.detail.context).toBeUndefined();
  });
});
