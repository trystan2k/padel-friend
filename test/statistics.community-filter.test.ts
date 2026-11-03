import { describe, expect, it, vi } from 'vitest';
import {
  readFilterOptions,
  selectCommunityScope
} from '../src/features/statistics/statistics-filter-options';

vi.mock('../src/features/leagues/league.functions', () => ({
  listMyLeagueCommunities: async () => [{ id: 'member', name: 'Member community' }]
}));
vi.mock('../src/features/statistics/statistics-community.functions', () => ({
  getCommunityStatistics: async () => ({
    status: 'ok',
    value: { leagues: [{ id: 'new-league', name: 'League' }], activeLeagueId: 'new-league' }
  })
}));

describe('statistics community scope', () => {
  it('loads only membership-scoped choices and the selected community leagues', async () => {
    const options = await readFilterOptions({
      communityId: 'member',
      leagueId: null,
      type: 'all',
      from: null,
      through: null
    });
    expect(options.communities).toEqual([{ id: 'member', name: 'Member community' }]);
    expect(options.leagues).toEqual([{ id: 'new-league', name: 'League' }]);
  });
  it('clears the league when switching community while retaining other filters', () => {
    expect(
      selectCommunityScope(
        { communityId: 'old', leagueId: 'league', type: 'friendly', from: null, through: null },
        'new'
      )
    ).toEqual({ communityId: 'new', leagueId: null, type: 'friendly', from: null, through: null });
  });

  it('clears the league when selecting all communities', () => {
    expect(
      selectCommunityScope(
        { communityId: 'old', leagueId: 'league', type: 'all', from: null, through: null },
        null
      )
    ).toEqual({ communityId: null, leagueId: null, type: 'all', from: null, through: null });
  });
});
