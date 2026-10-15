import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  listMyAdminCommunities: vi.fn<() => Promise<unknown>>(),
  getCommunityAdminDefaults: vi.fn<() => Promise<unknown>>(),
  listMyCommunityNotifications: vi.fn<() => Promise<unknown>>()
}));

vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: mocks.getMyPlayerProfile
}));
vi.mock('../src/features/community/community-admin.functions', () => ({
  listMyAdminCommunities: mocks.listMyAdminCommunities,
  getCommunityAdminDefaults: mocks.getCommunityAdminDefaults
}));
vi.mock('../src/features/community/community-request.functions', () => ({
  listMyCommunityNotifications: mocks.listMyCommunityNotifications
}));
vi.mock('../src/features/community/CommunityAdmin', () => ({
  CommunityAdminEntries: () => null
}));
vi.mock('../src/features/player/PlayerProfile', () => ({ PlayerProfile: () => null }));

import { loadDashboardData } from '../src/routes/_protected.dashboard';

beforeEach(() => {
  mocks.getMyPlayerProfile.mockReset();
  mocks.listMyAdminCommunities.mockReset();
  mocks.getCommunityAdminDefaults.mockReset();
  mocks.listMyCommunityNotifications.mockReset();
});

describe('dashboard loader', () => {
  it('keeps the profile available when optional admin-community lookup fails', async () => {
    const profile = Object.freeze({});
    mocks.getMyPlayerProfile.mockResolvedValue(profile);
    mocks.listMyAdminCommunities.mockRejectedValue(new Error('temporary admin lookup failure'));
    mocks.listMyCommunityNotifications.mockRejectedValue(new Error('temporary inbox failure'));

    await expect(loadDashboardData()).resolves.toEqual({
      profile,
      adminCommunities: [],
      inbox: { items: null, error: true }
    });
    expect(mocks.getMyPlayerProfile).toHaveBeenCalledOnce();
    expect(mocks.listMyAdminCommunities).toHaveBeenCalledOnce();
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
