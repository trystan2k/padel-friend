import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  listMyAdminCommunities: vi.fn<() => Promise<unknown>>(),
  listMyLeagueCommunities: vi.fn<() => Promise<unknown>>(),
  getCommunityAdminDefaults: vi.fn<() => Promise<unknown>>(),
  listMyCommunityNotifications: vi.fn<() => Promise<unknown>>(),
  loadRatingView: vi.fn<() => Promise<unknown>>(),
  getHome: vi.fn<(request: { data: { community_id: string | null } }) => Promise<unknown>>(),
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
vi.mock('../src/features/home/home.functions', () => ({ getHome: mocks.getHome }));

import { loadDashboardData } from '../src/routes/_protected.dashboard';

const HOME = Object.freeze({ asOf: '2030-06-01T12:00:00.000Z', unread: 5 });
const COMMUNITY = '00000000-0000-4000-8000-00000000000a';

beforeEach(() => {
  mocks.getHome.mockReset();
  mocks.getHome.mockResolvedValue(HOME);
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
      home: HOME,
      notificationCount: 5,
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

  it('reads Home for the selected community and keeps its unread count', async () => {
    mocks.getMyPlayerProfile.mockResolvedValue(Object.freeze({}));
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyCommunityNotifications.mockResolvedValue([]);

    await expect(loadDashboardData({ community: COMMUNITY })).resolves.toMatchObject({
      home: HOME,
      notificationCount: 5
    });
    expect(mocks.getHome).toHaveBeenCalledWith({ data: { community_id: COMMUNITY } });
    await loadDashboardData();
    expect(mocks.getHome).toHaveBeenLastCalledWith({ data: { community_id: null } });
  });

  it('turns a failed Home read into an explicit null Home without hiding the profile', async () => {
    const profile = Object.freeze({});
    mocks.getMyPlayerProfile.mockResolvedValue(profile);
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyCommunityNotifications.mockResolvedValue([]);
    mocks.getHome.mockRejectedValue(new Error('HOME_UNAVAILABLE'));

    const result = await loadDashboardData();
    expect(result.home).toBeNull();
    expect(result.profile).toBe(profile);
    expect(result.notificationCount).toBeUndefined();
  });

  it('keeps an unknown unread count unknown', async () => {
    mocks.getMyPlayerProfile.mockResolvedValue(Object.freeze({}));
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyCommunityNotifications.mockResolvedValue([]);
    mocks.getHome.mockResolvedValue({ ...HOME, unread: null });

    await expect(loadDashboardData()).resolves.toMatchObject({ notificationCount: undefined });
  });

  it('invalidates the whole private view when Home reports an expired session', async () => {
    mocks.getMyPlayerProfile.mockResolvedValue(Object.freeze({}));
    mocks.listMyAdminCommunities.mockResolvedValue([]);
    mocks.listMyCommunityNotifications.mockResolvedValue([]);
    const expired = new Error('UNAUTHENTICATED');
    mocks.getHome.mockRejectedValue(expired);

    await expect(loadDashboardData()).rejects.toBe(expired);
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
