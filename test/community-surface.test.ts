import { describe, expect, it, vi } from 'vitest';
import { createI18n } from '../src/i18n/config';
import type { HomeData } from '../src/features/home/home-contracts';

const { getHome } = vi.hoisted(() => ({
  getHome: vi.fn<(request: { data: { community_id: string | null } }) => Promise<HomeData>>()
}));
vi.mock('../src/features/home/home.functions', () => ({ getHome }));
vi.mock('../src/features/community/community-admin.functions', () => ({
  listMyAdminCommunities: async () => [],
  getCommunityAdminContext: vi.fn<() => Promise<null>>()
}));
vi.mock('../src/features/community/community.functions', () => ({
  getPublicCommunity: vi.fn<() => Promise<null>>()
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
