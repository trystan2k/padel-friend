import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  listMyAdminCommunities: vi.fn<() => Promise<unknown>>(),
  listMyLeagueCommunities: vi.fn<() => Promise<unknown>>(),
  getCommunityAdminDefaults: vi.fn<() => Promise<unknown>>(),
  listMyCommunityNotifications: vi.fn<() => Promise<unknown>>(),
  loadRatingView: vi.fn<() => Promise<unknown>>(),
  getLevelReviewAccess: vi.fn<() => Promise<unknown>>()
}));

vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: mocks.getMyPlayerProfile
}));
vi.mock('../src/features/community/community-admin.functions', () => ({
  listMyAdminCommunities: mocks.listMyAdminCommunities,
  getCommunityAdminDefaults: mocks.getCommunityAdminDefaults
}));
vi.mock('../src/features/leagues/league.functions', () => ({
  listMyLeagueCommunities: mocks.listMyLeagueCommunities
}));
vi.mock('../src/features/leagues/LeagueEntries', () => ({ LeagueEntries: () => null }));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  getLevelReviewAccess: mocks.getLevelReviewAccess
}));
vi.mock('../src/features/level-reviews/PlatformAdminEntry', () => ({
  PlatformAdminEntry: () => null
}));
vi.mock('../src/features/community/community-request.functions', () => ({
  listMyCommunityNotifications: mocks.listMyCommunityNotifications
}));
vi.mock('../src/features/community/CommunityAdmin', () => ({
  CommunityAdminEntries: () => null
}));
vi.mock('../src/features/player/rating-view', () => ({
  loadRatingView: mocks.loadRatingView
}));
vi.mock('../src/features/player/PlayerProfile', () => ({ PlayerProfile: () => null }));

import { loadDashboardData } from '../src/routes/_protected.dashboard';

beforeEach(() => {
  mocks.getMyPlayerProfile.mockReset();
  mocks.listMyAdminCommunities.mockReset();
  mocks.listMyLeagueCommunities.mockReset();
  mocks.listMyLeagueCommunities.mockResolvedValue([]);
  mocks.getCommunityAdminDefaults.mockReset();
  mocks.listMyCommunityNotifications.mockReset();
  mocks.loadRatingView.mockReset();
  mocks.loadRatingView.mockResolvedValue({ status: 'error', code: 'unavailable' });
  mocks.getLevelReviewAccess.mockReset();
  mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: false });
});

describe('dashboard loader', () => {
  it('keeps the profile available when optional admin-community lookup fails', async () => {
    const profile = Object.freeze({});
    mocks.getMyPlayerProfile.mockResolvedValue(profile);
    mocks.listMyAdminCommunities.mockRejectedValue(new Error('temporary admin lookup failure'));
    mocks.listMyCommunityNotifications.mockRejectedValue(new Error('temporary inbox failure'));

    await expect(loadDashboardData()).resolves.toEqual({
      profile,
      rating: { status: 'error', code: 'unavailable' },
      adminCommunities: [],
      leagueCommunities: [],
      inbox: { items: null, error: true },
      platformAdmin: false
    });
    expect(mocks.getMyPlayerProfile).toHaveBeenCalledOnce();
    expect(mocks.listMyAdminCommunities).toHaveBeenCalledOnce();
  });

  it('keeps the dashboard available when the optional League entry lookup fails', async () => {
    mocks.getMyPlayerProfile.mockResolvedValue(Object.freeze({}));
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyLeagueCommunities.mockRejectedValue(new Error('LEAGUE_UNAVAILABLE'));
    mocks.listMyCommunityNotifications.mockResolvedValue([]);

    await expect(loadDashboardData()).resolves.toMatchObject({ leagueCommunities: [] });
  });

  it('reports platform-admin access only from the server access context', async () => {
    mocks.getMyPlayerProfile.mockResolvedValue(Object.freeze({}));
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyCommunityNotifications.mockResolvedValue([]);
    mocks.getLevelReviewAccess.mockResolvedValue({ is_platform_admin: true });
    await expect(loadDashboardData()).resolves.toMatchObject({ platformAdmin: true });

    mocks.getLevelReviewAccess.mockRejectedValue(new Error('LEVEL_REVIEW_UNAVAILABLE'));
    await expect(loadDashboardData()).resolves.toMatchObject({ platformAdmin: false });
  });

  it('hands the committed rating view to the profile alongside the profile row', async () => {
    const profile = Object.freeze({});
    const rating = Object.freeze({ status: 'ok', revision: 4 });
    mocks.getMyPlayerProfile.mockResolvedValue(profile);
    mocks.loadRatingView.mockResolvedValue(rating);
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyCommunityNotifications.mockResolvedValue([]);

    await expect(loadDashboardData()).resolves.toMatchObject({ profile, rating });
    expect(mocks.loadRatingView).toHaveBeenCalledOnce();
  });

  it('still surfaces profile failures', async () => {
    const error = new Error('profile unavailable');
    mocks.getMyPlayerProfile.mockRejectedValue(error);
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.getCommunityAdminDefaults.mockResolvedValue({ timezone: 'UTC' });
    mocks.listMyCommunityNotifications.mockResolvedValue([]);

    await expect(loadDashboardData()).rejects.toBe(error);
  });
});
