import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import manifest from '../e2e/references/paf-202-notifications/manifest.json';
import { notificationGlyph } from '../src/features/notifications/notification-presentation';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBr from '../src/locales/pt-BR/translation.json';

const read = (path: string) => readFileSync(new URL(path, import.meta.url));
const source = (path: string) => read(`../src/${path}`).toString('utf8');

describe('notification Clubhouse references', () => {
  it('pins the Pencil source and all six exported frames', () => {
    const digest = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
    expect(digest(read(`../${manifest.sourceDesign.path}`))).toBe(manifest.sourceDesign.sha256);
    expect(Object.keys(manifest.approvedReferences)).toEqual([
      'cAqsQ',
      'Z0gRd',
      'qNVpA',
      'y8ErQ',
      'nRn4M',
      'tzBrY'
    ]);
    for (const entry of Object.values(manifest.approvedReferences)) {
      const bytes = read(`../e2e/references/paf-202-notifications/${entry.file}`);
      expect(digest(bytes)).toBe(entry.sha256);
      expect([bytes.readUInt32BE(16), bytes.readUInt32BE(20)]).toEqual(entry.pixelSize);
    }
  });

  it('keeps the D1 detail and level-review outcome off center-only styling', () => {
    expect(manifest.surfaces.NotificationDetailPage).toEqual([]);
    expect(manifest.surfaces.NotificationLevelReviewOutcome).toEqual([]);
    expect(manifest.blockedDetail).toContain('D1');
    for (const file of ['NotificationDetailPage', 'NotificationLevelReviewOutcome']) {
      const text = source(`features/notifications/${file}.tsx`);
      expect(text).toContain("from './notifications.styles'");
      expect(text).not.toContain('notification-center.styles');
      expect(text).not.toContain('appearance="feed"');
    }
  });
});

describe('notification presentation', () => {
  it.each([
    ['match_registration_requested', 'matches', '?', 'neutral'],
    ['match_registration_rejected', 'matches', '×', 'danger'],
    ['match_registration_quartet_complete', 'matches', '✓', 'positive'],
    ['match_registration_promoted', 'matches', '↑', 'positive'],
    ['result_review_needed', 'results', '◷', 'warning'],
    ['future_kind', 'rankings', '#', 'neutral']
  ])('maps %s to a decorative glyph', (kind, category, symbol, tone) => {
    expect(notificationGlyph(kind, category)).toEqual({ symbol, tone });
  });

  it.each([
    ['en', en],
    ['pt-BR', ptBr],
    ['es', es]
  ] as const)('includes readable settings and unread labels in %s', (_locale, copy) => {
    const prefs = copy.notificationPreferences;
    expect(Object.keys(prefs.categoryHelp)).toEqual(Object.keys(prefs.categories));
    for (const label of [
      copy.notifications.backHome,
      copy.notifications.unreadRow,
      copy.notifications.markAllRead,
      prefs.preferencesLink,
      prefs.title,
      prefs.alwaysOn,
      ...Object.values(prefs.categoryHelp)
    ]) {
      expect(label).toMatch(/^\p{Lu}/u);
      expect(label).not.toBe(label.toUpperCase());
    }
  });
});
