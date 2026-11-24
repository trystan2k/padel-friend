import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';

const mocks = vi.hoisted(() => ({
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  loadRatingView: vi.fn<() => Promise<unknown>>(),
  getLevelReviewAccess: vi.fn<() => Promise<unknown>>(),
  getPlayerStatistics: vi.fn<(request: { data: { playerId: string } }) => Promise<unknown>>()
}));

vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: mocks.getMyPlayerProfile
}));
vi.mock('../src/features/player/rating-view', () => ({ loadRatingView: mocks.loadRatingView }));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  getLevelReviewAccess: mocks.getLevelReviewAccess
}));
vi.mock('../src/features/statistics/statistics-player.functions', () => ({
  getPlayerStatistics: mocks.getPlayerStatistics
}));
vi.mock('../src/features/player/PlayerProfile', () => ({ PlayerProfile: () => null }));
vi.mock('../src/features/player/ProfileStates', () => ({
  LoadingProfile: () => null,
  ProfileError: () => null
}));

import { loadMeData } from '../src/routes/_protected.me';

const read = (path: string) => readFileSync(path, 'utf8');

beforeEach(() => {
  mocks.getMyPlayerProfile.mockReset().mockResolvedValue({ user_id: 'u1' });
  mocks.loadRatingView.mockReset().mockResolvedValue({ status: 'error', code: 'X' });
  mocks.getLevelReviewAccess.mockReset();
  mocks.getPlayerStatistics
    .mockReset()
    .mockResolvedValue({ status: 'error', code: 'STATISTICS_UNAVAILABLE' });
});

describe('Me loader (D5)', () => {
  it('reports platform-admin visibility from the server access context', async () => {
    mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: true });
    await expect(loadMeData()).resolves.toMatchObject({ platformAdmin: true });
    mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: false });
    await expect(loadMeData()).resolves.toMatchObject({ platformAdmin: false });
  });

  it('hides the entry when the access read fails but still loads the page', async () => {
    mocks.getLevelReviewAccess.mockRejectedValue(new Error('boom'));
    await expect(loadMeData()).resolves.toMatchObject({
      platformAdmin: false,
      profile: { user_id: 'u1' }
    });
  });

  it('propagates a lost session', async () => {
    mocks.getLevelReviewAccess.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await expect(loadMeData()).rejects.toThrow('UNAUTHENTICATED');
  });

  it('reads the own statistics once, keyed by the authenticated profile, in the default scope', async () => {
    mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: false });
    await loadMeData();
    expect(mocks.getPlayerStatistics).toHaveBeenCalledTimes(1);
    expect(mocks.getPlayerStatistics).toHaveBeenCalledWith({ data: { playerId: 'u1' } });
  });

  it('keeps the page available when the statistics read fails for a non-auth reason', async () => {
    mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: false });
    mocks.getPlayerStatistics.mockRejectedValue(new Error('boom'));
    await expect(loadMeData()).resolves.toMatchObject({
      profile: { user_id: 'u1' },
      statistics: { status: 'unavailable' }
    });
  });

  it('propagates a lost session from the statistics read', async () => {
    mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: false });
    mocks.getPlayerStatistics.mockResolvedValue({
      status: 'error',
      code: 'STATISTICS_UNAUTHENTICATED'
    });
    await expect(loadMeData()).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('Me composition sources', () => {
  const profile = read('src/features/player/PlayerProfile.tsx');

  it('moves the platform-admin entry out of Community and into Me', () => {
    expect(read('src/features/community/CommunitySurface.tsx')).not.toContain('PlatformAdmin');
    expect(read('src/features/community/community-surface.ts')).not.toContain('platformAdmin');
    expect(profile).toContain('<PlatformAdminEntry allowed={platformAdmin} />');
    expect(read('src/routes/_protected.me.tsx')).toContain('platformAdmin={platformAdmin}');
    // Community-scoped entries stay on the Community surface.
    expect(read('src/features/community/CommunitySurface.tsx')).toContain('<CommunityAdminEntries');
  });

  it('orders vARtQ sections: identity, level card, shortcuts, level review, journey, sign-out', () => {
    const order = [
      '<header {...stylex.props(s.identity)}',
      'profile.globalLevel',
      "t('profile.links.label')",
      "t('levelReview.entry.request')",
      '<RatingJourney',
      '<PlatformAdminEntry',
      "t('signOut')"
    ].map((needle) => profile.indexOf(needle));
    expect(order.every((index) => index >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it('opens the profile edit as its own screen on the Clubhouse form (frames VpcMM / xlgw8)', () => {
    expect(profile).toContain('if (editing)');
    expect(profile).toContain('<ProfileEditForm');
    expect(profile).not.toContain('<AvatarUpload');
    const form = read('src/features/player/ProfileEditForm.tsx');
    expect(form).toContain('<TextField');
    expect(form).toContain('<AvailabilityFields');
    expect(form).toContain('pills');
    expect(form).toContain('<Button');
    expect(form).not.toContain('ui.card');
    expect(read('src/features/player/profile-edit.styles.ts')).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });

  it('renders the vARtQ statistics tiles from the one read and no fabricated level trend (D6)', () => {
    expect(profile).toContain('<MeStatisticsTiles');
    expect(profile.indexOf('<MeStatisticsTiles')).toBeGreaterThan(
      profile.indexOf('<header {...stylex.props(s.identity)}')
    );
    expect(profile.indexOf('<MeStatisticsTiles')).toBeLessThan(
      profile.indexOf('profile.globalLevel')
    );
    expect(profile).not.toMatch(/this season/i);
  });

  it('uses tokens only: no literal colors or pixel sizes in the Me styles', () => {
    const styles = read('src/features/player/me.styles.ts');
    expect(styles).not.toMatch(/#[0-9a-f]{3,8}\b/i);
    expect(styles).not.toMatch(/:\s*'\d+px'/);
  });

  it.each(['en', 'pt-BR', 'es'] as const)('has sentence-case Me copy in %s', (locale) => {
    const i18n = createI18n(locale);
    for (const key of [
      'profile.links.statistics',
      'profile.links.matchHistory',
      'profile.links.notifications',
      'profile.links.label',
      'profile.globalLevel',
      'profile.levelScale',
      'profile.dominantHand',
      'profile.bio',
      'rating.progress.scopeCaption',
      'rating.history.emptyTitle'
    ]) {
      const value = i18n.t(key);
      expect([key, value]).not.toEqual([key, key]);
      expect([key, value]).not.toEqual([key, value.toUpperCase()]);
    }
  });
});
