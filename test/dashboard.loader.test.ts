import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getMyPlayerProfile: vi.fn<() => Promise<unknown>>(),
  listMyAdminCommunities: vi.fn<() => Promise<unknown>>()
}));

vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: mocks.getMyPlayerProfile
}));
vi.mock('../src/features/community/community-admin.functions', () => ({
  listMyAdminCommunities: mocks.listMyAdminCommunities
}));
vi.mock('../src/features/community/CommunityAdmin', () => ({
  CommunityAdminEntries: () => null
}));
vi.mock('../src/features/player/PlayerProfile', () => ({ PlayerProfile: () => null }));

import { loadDashboardData } from '../src/routes/_protected.dashboard';

beforeEach(() => {
  mocks.getMyPlayerProfile.mockReset();
  mocks.listMyAdminCommunities.mockReset();
});

describe('dashboard loader', () => {
  it('keeps the profile available when optional admin-community lookup fails', async () => {
    const profile = Object.freeze({});
    mocks.getMyPlayerProfile.mockResolvedValue(profile);
    mocks.listMyAdminCommunities.mockRejectedValue(new Error('temporary admin lookup failure'));

    await expect(loadDashboardData()).resolves.toEqual({ profile, adminCommunities: [] });
    expect(mocks.getMyPlayerProfile).toHaveBeenCalledOnce();
    expect(mocks.listMyAdminCommunities).toHaveBeenCalledOnce();
  });

  it('still surfaces profile failures', async () => {
    const error = new Error('profile unavailable');
    mocks.getMyPlayerProfile.mockRejectedValue(error);
    mocks.listMyAdminCommunities.mockResolvedValue([]);

    await expect(loadDashboardData()).rejects.toBe(error);
  });
});
