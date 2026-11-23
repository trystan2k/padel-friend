import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-d1-notifications/manifest.json';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBr from '../src/locales/pt-BR/translation.json';

const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const source = (path: string) => read(`../src/features/${path}`).toString('utf8');
const frames = Object.entries(manifest.frames);
const byText = (a: string, b: string) => a.localeCompare(b);

describe('PAF-202 D1 notification and level review visual references', () => {
  it('pins the eighteen approved D1 frames from the canonical pen', () => {
    expect(manifest.sourceDesign.path).toBe('docs/design/padel-friend-clubhouse.pen');
    expect(frames).toHaveLength(18);
    expect(new Set(frames.map(([, frame]) => frame.frameId)).size).toBe(18);
    expect(frames.map(([, frame]) => frame.frameName.split(' — ')[0] ?? '').sort(byText)).toEqual(
      [
        ...Array(8).fill('notification-detail'),
        ...Array(2).fill('level-review-history'),
        ...Array(2).fill('platform-review-queue'),
        ...Array(6).fill('platform-review-detail')
      ].sort(byText)
    );
  });

  it('pins each export by digest, byte size and dimensions', () => {
    for (const [name, frame] of frames) {
      const bytes = read(`../e2e/references/paf-202-d1-notifications/${frame.source}`);
      expect([name, digest(bytes)]).toEqual([name, frame.sourceSha256]);
      expect([name, bytes.length]).toEqual([name, frame.sourceBytes]);
      expect([name, bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual([
        name,
        frame.width,
        frame.height
      ]);
    }
  });

  it('maps every frame to an app state: none is frame-only and none is blocked', () => {
    expect(manifest.status).toBe('implemented-chromium-region-comparison');
    for (const [name, frame] of frames) {
      expect([name, frame.comparison]).toEqual([name, 'region']);
      expect(frame.appState.length).toBeGreaterThan(20);
    }
    for (const [surface, ids] of Object.entries(manifest.surfaces)) {
      expect([surface, ids.length > 0]).toEqual([surface, true]);
      for (const id of ids) expect(manifest.frames).toHaveProperty(id);
    }
    expect(manifest.stateMapping).toContain('none is frame-only');
  });

  it('keeps a nonzero measured budget with a documented rationale for every compared region', () => {
    const { perScreen, perScreenRationale, measured } = manifest.visualBudgets;
    const keys = Object.keys(perScreen).sort(byText);
    expect(keys).toEqual(Object.keys(perScreenRationale).sort(byText));
    expect(keys).toEqual(Object.keys(measured).sort(byText));
    expect(keys).toHaveLength(56);
    for (const key of keys) {
      const budget = (perScreen as Record<string, number>)[key] ?? Number.NaN;
      const residual = (measured as Record<string, number>)[key] ?? Number.NaN;
      expect(key.split(':')[0] ?? '').toSatisfy((id: string) => id in manifest.frames);
      expect([key, budget > residual]).toEqual([key, true]);
      expect([key, budget - residual <= 0.03]).toEqual([key, true]);
      expect([key, budget <= 0.2]).toEqual([key, true]);
      expect([
        key,
        ((perScreenRationale as Record<string, string>)[key]?.length ?? 0) > 80
      ]).toEqual([key, true]);
    }
  });

  it('records the drawn elements the app cannot source instead of inventing them (D6)', () => {
    const { frameOnlyElements } = manifest;
    expect(frameOnlyElements.previousLevel).toContain('Previous level');
    expect(frameOnlyElements.winChipAndTeams).toContain('classification');
    expect(frameOnlyElements.queueCommunity).toContain('no community');
    expect(frameOnlyElements.inlineApproval).toContain('AlertDialog');
  });
});

describe('D1 implementation stays on the frame structure', () => {
  it('styles the notification detail with the Clubhouse detail styles and keeps the invitation branch', () => {
    const page = source('notifications/NotificationDetailPage.tsx');
    expect(page).toContain("from './notification-detail.styles'");
    expect(page).toContain("from '../community/community-invitation.styles'");
    expect(page).not.toContain('notification-center.styles');
    for (const file of ['NotificationLevelReviewOutcome.tsx', 'NotificationDetailChrome.tsx'])
      expect(source(`notifications/${file}`)).toContain("from './notification-detail.styles'");
  });

  it('styles the history, queue and detail pages with the Clubhouse level review styles', () => {
    for (const file of [
      'PlayerLevelReviewHistory.tsx',
      'PlatformLevelReviewQueue.tsx',
      'PlatformLevelReviewDetail.tsx'
    ]) {
      const text = source(`level-reviews/${file}`);
      expect(text).toContain('level-review-clubhouse.styles');
      expect(text).not.toContain("from './level-review.styles'");
      expect(text).toContain('<TopBar');
    }
  });

  it('keeps the decision flow guards: confirmation dialog, stale preview and offline rejection', () => {
    const text = source('level-reviews/PlatformLevelReviewDetail.tsx');
    expect(text).toContain('AlertDialog.Root');
    expect(text).toContain('LEVEL_REVIEW_STALE_RATING');
    expect(text).toContain('rejectOffline()');
    expect(text).toContain('useUpdateGuard');
  });

  it('uses design tokens only: no literal colors or pixel sizes in the new styles', () => {
    for (const file of [
      'notifications/notification-detail.styles.ts',
      'level-reviews/level-review-clubhouse.styles.ts'
    ]) {
      const text = source(file);
      expect(text).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(text).not.toMatch(/rgba?\(/);
      expect(text).not.toMatch(/:\s*'\d+px'/);
    }
  });
});

describe('D1 copy', () => {
  const locales = [
    ['en', en],
    ['pt-BR', ptBr],
    ['es', es]
  ] as const;

  it.each(locales)('has the new keys and the Deny wording in %s', (_locale, copy) => {
    const lr = copy.levelReview;
    for (const value of [
      copy.notifications.readRow,
      copy.notifications.result.cardTitle,
      copy.notifications.levelReview.cardTitle,
      copy.notifications.levelReview.requestedLabel,
      copy.notifications.levelReview.updatedLabel,
      copy.notifications.levelReview.decidedLabel,
      lr.history.viewRequest,
      lr.admin.requestedRange,
      lr.admin.submittedLabel,
      lr.admin.review,
      lr.admin.submittedLevel,
      lr.adminDecision.confirmApproval,
      lr.adminDecision.confirmDenial,
      lr.adminDecision.levelAfter,
      lr.adminDecision.trailHeading,
      lr.adminDecision.trailSubmitted
    ]) {
      expect(value.length).toBeGreaterThan(2);
      expect(value).toMatch(/^\p{Lu}/u);
    }
    expect(lr.adminDecision.confirmApproval).not.toBe(lr.adminDecision.confirmDenial);
    expect(lr.adminDecision.reject).not.toMatch(/reject|rejeit|rechaz/i);
    expect(lr.status.rejected).not.toMatch(/reject|rejeit|rechaz/i);
  });

  it.each(locales)('has no sample data from the frames in %s', (_locale, copy) => {
    const text = JSON.stringify([copy.notifications, copy.levelReview]);
    expect(text).not.toMatch(/Leo Mart|Mariana Costa|Bruno Silva|Northside|3\.51|3\.76/);
    expect(copy.notifications.levelReview).not.toHaveProperty('previousLabel');
  });

  it('reads Deny, Denied and the frame confirmations in en', () => {
    expect(en.levelReview.adminDecision.reject).toBe('Deny');
    expect(en.levelReview.status.rejected).toBe('Denied');
    expect(en.levelReview.adminDecision.confirmApproval).toBe('Confirm approval');
    expect(en.levelReview.adminDecision.confirmDenial).toBe('Confirm denial');
    expect(en.levelReview.adminDecision.confirmApprove).toBe('Review approval');
    expect(en.levelReview.adminDecision.confirmReject).toBe('Review denial');
  });
});
