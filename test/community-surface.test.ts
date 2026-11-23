import { describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { HomeData } from '../src/features/home/home-contracts';

const { getHome, listMyAdminCommunities, searchCommunityMembers } = vi.hoisted(() => ({
  getHome: vi.fn<(request: { data: { community_id: string | null } }) => Promise<HomeData>>(),
  listMyAdminCommunities: vi.fn<() => Promise<{ id: string; name: string }[]>>(async () => []),
  searchCommunityMembers:
    vi.fn<(request: { data: Record<string, unknown> }) => Promise<unknown[]>>()
}));
vi.mock('../src/features/home/home.functions', () => ({ getHome }));
vi.mock('../src/features/community/community-admin.functions', () => ({
  listMyAdminCommunities,
  getCommunityAdminContext: vi.fn<() => Promise<null>>(async () => null),
  searchCommunityMembers
}));
vi.mock('../src/features/community/community.functions', () => ({
  getPublicCommunity: vi.fn<() => Promise<null>>(async () => null)
}));
vi.mock('../src/features/leagues/league.functions', () => ({
  listMyLeagueCommunities: async () => []
}));
vi.mock('../src/features/level-reviews/level-review.functions', () => ({
  getLevelReviewAccess: async () => ({ is_platform_admin: false })
}));
vi.mock('../src/features/player/player.functions', () => ({
  getMyPlayerProfile: async () => ({
    display_name: 'Self',
    display_level: 3,
    reliability_percent: 20
  })
}));
vi.mock('../src/features/player/rating-view', () => ({
  loadRatingView: async () => ({ status: 'error' })
}));
vi.mock('../src/features/community/community-request.functions', () => ({
  listMyCommunityNotifications: async () => []
}));

import {
  JOIN_REQUEST_PAGE_SIZE,
  joinRequestCount,
  loadCommunitySurface,
  parseRankingSearch,
  resolveCommunitySurface
} from '../src/features/community/community-surface';

const id = '00000000-0000-4000-8000-00000000000a';
const selected = { id, name: 'Club' };
const home: HomeData = {
  asOf: '2030-06-01T12:00:00.000Z',
  communities: { status: 'ok', value: [selected] },
  selection: { selectedId: id, requestedUnavailable: false },
  matches: { status: 'empty' },
  actions: { status: 'empty' },
  ranking: { status: 'ok', value: { skill: { status: 'error' }, league: { status: 'empty' } } },
  activity: { status: 'empty' },
  unread: null
};

describe('community surface loader', () => {
  it('uses authorized selected membership and preserves independent ranking outcomes', async () => {
    getHome.mockResolvedValueOnce(home);
    await expect(loadCommunitySurface(id.toUpperCase(), 'ranking')).resolves.toMatchObject({
      status: 'ready',
      selected,
      ranking: home.ranking,
      level: { display_level: 3, reliability_percent: 20 }
    });
    expect(getHome).toHaveBeenLastCalledWith({ data: { community_id: id } });
  });

  it('does not project another community’s data into an unauthorized URL', async () => {
    getHome.mockResolvedValueOnce(home);
    await expect(loadCommunitySurface('invalid', 'overview')).resolves.toEqual({
      status: 'denied',
      communities: [selected]
    });
  });

  it('reads join requests once for the selected community admin and proves exact counts only from a short page', async () => {
    listMyAdminCommunities.mockResolvedValueOnce([selected]);
    searchCommunityMembers.mockResolvedValueOnce([{}, {}, {}]);
    getHome.mockResolvedValueOnce(home);
    await expect(loadCommunitySurface(id, 'overview')).resolves.toMatchObject({
      joinRequests: { status: 'ok', total: 3, exact: true }
    });
    expect(searchCommunityMembers).toHaveBeenCalledTimes(1);
    expect(searchCommunityMembers).toHaveBeenLastCalledWith({
      data: {
        community_id: id,
        query: '',
        status: 'pending',
        offset: 0,
        limit: JOIN_REQUEST_PAGE_SIZE
      }
    });
  });

  it('presents an exact zero and a full page as a lower bound', () => {
    expect(joinRequestCount([])).toEqual({ status: 'ok', total: 0, exact: true });
    expect(joinRequestCount(Array.from({ length: JOIN_REQUEST_PAGE_SIZE }))).toEqual({
      status: 'ok',
      total: JOIN_REQUEST_PAGE_SIZE,
      exact: false
    });
  });

  it('never reads join requests for a non-admin or an admin of another community', async () => {
    searchCommunityMembers.mockClear();
    listMyAdminCommunities.mockResolvedValueOnce([]);
    getHome.mockResolvedValueOnce(home);
    await expect(loadCommunitySurface(id, 'overview')).resolves.toMatchObject({
      joinRequests: { status: 'unavailable' }
    });
    listMyAdminCommunities.mockResolvedValueOnce([
      { id: '00000000-0000-4000-8000-00000000000b', name: 'Other' }
    ]);
    getHome.mockResolvedValueOnce(home);
    await expect(loadCommunitySurface(id, 'overview')).resolves.toMatchObject({
      joinRequests: { status: 'unavailable' }
    });
    expect(searchCommunityMembers).not.toHaveBeenCalled();
  });

  it('localizes a failed non-authentication read as unavailable and rethrows authentication', async () => {
    listMyAdminCommunities.mockResolvedValue([selected]);
    getHome.mockResolvedValue(home);
    searchCommunityMembers.mockRejectedValueOnce(new Error('boom'));
    await expect(loadCommunitySurface(id, 'overview')).resolves.toMatchObject({
      joinRequests: { status: 'unavailable' }
    });
    searchCommunityMembers.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(loadCommunitySurface(id, 'overview')).rejects.toThrow('UNAUTHENTICATED');
    listMyAdminCommunities.mockReset();
    listMyAdminCommunities.mockResolvedValue([]);
    getHome.mockReset();
  });

  it('distinguishes a failed membership read from empty membership', () => {
    expect(resolveCommunitySurface({ ...home, communities: { status: 'error' } }, null)).toEqual({
      status: 'error'
    });
    expect(resolveCommunitySurface({ ...home, communities: { status: 'empty' } }, null)).toEqual({
      status: 'empty'
    });
  });

  it('only accepts the league search value, making skill the canonical default', () => {
    expect(parseRankingSearch({ by: 'league' })).toEqual({ by: 'league' });
    expect(parseRankingSearch({ by: ['league'] })).toEqual({});
    expect(parseRankingSearch({ by: 'skill' })).toEqual({});
  });

  it.each(['en', 'pt-BR', 'es'] as const)(
    'has localized labels and truthful states in %s',
    (locale) => {
      const localized = createI18n(locale);
      const bundle = localized.getResourceBundle(locale, 'translation').communitySurface;
      const english = localized.getResourceBundle('en', 'translation').communitySurface;
      expect(Object.keys(bundle)).toEqual(Object.keys(english));
      expect(localized.t('communitySurface.selfName', { name: 'Alex' })).toContain('Alex');
      expect(
        Object.values(bundle).every((value) => typeof value === 'string' && value.length > 0)
      ).toBe(true);
    }
  );
});
