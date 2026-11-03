import { describe, expect, it } from 'vitest';
import {
  communityScopeFilters,
  filterSearch,
  parseCommunitySearch,
  parseFilterSearch
} from '../src/features/statistics/statistics-search';
import { validateStatisticsFilters } from '../src/features/statistics/statistics.validators';

const COMMUNITY = '77777777-7777-4777-8777-777777777777';
const LEAGUE = '88888888-8888-4888-8888-888888888888';

describe('statistics URL search', () => {
  it('keeps only non-empty string filters', () => {
    expect(
      parseFilterSearch({ communityId: COMMUNITY, type: '', from: 5, through: null, extra: 'x' })
    ).toEqual({ communityId: COMMUNITY });
  });

  it('round-trips search ↔ normalized filters ↔ search', () => {
    const search = {
      communityId: COMMUNITY,
      leagueId: LEAGUE,
      type: 'friendly',
      from: '2030-02-01',
      through: '2030-02-28'
    };
    const filters = validateStatisticsFilters(parseFilterSearch(search));
    expect(filters).toEqual(search);
    expect(filterSearch(filters)).toEqual(search);
    // The default type never appears in the URL, and an empty search normalizes to all/all.
    expect(filterSearch(validateStatisticsFilters(parseFilterSearch({})))).toEqual({});
    expect(validateStatisticsFilters(parseFilterSearch({}))).toEqual({
      communityId: null,
      leagueId: null,
      type: 'all',
      from: null,
      through: null
    });
  });

  it('keeps the community in the path of the community route and never in its search', () => {
    expect(parseCommunitySearch({ communityId: COMMUNITY, type: 'competitive' })).toEqual({
      type: 'competitive'
    });
  });

  it('maps the path community (or "all") plus search to the server input', () => {
    expect(communityScopeFilters(COMMUNITY, { leagueId: LEAGUE, from: '2030-01-01' })).toEqual({
      communityId: COMMUNITY,
      leagueId: LEAGUE,
      type: 'all',
      from: '2030-01-01',
      through: null
    });
    expect(communityScopeFilters('all', { type: 'friendly' })).toBeNull();
  });

  it('rejects invalid combinations instead of guessing', () => {
    expect(communityScopeFilters('all', { leagueId: LEAGUE })).toBeNull();
    expect(communityScopeFilters('not-a-uuid', {})).toBeNull();
    expect(communityScopeFilters(COMMUNITY, { type: 'ranked' })).toBeNull();
    expect(
      communityScopeFilters(COMMUNITY, { from: '2030-03-01', through: '2030-02-01' })
    ).toBeNull();
    expect(communityScopeFilters(COMMUNITY, { from: '2030-02-31' })).toBeNull();
    expect(communityScopeFilters(COMMUNITY, { leagueId: 'x' })).toBeNull();
  });

  it('keeps links and the community route scope-compatible (communityId in a link, not the path search)', () => {
    const filters = validateStatisticsFilters({ communityId: COMMUNITY, type: 'competitive' });
    expect(filterSearch(filters)).toEqual({ communityId: COMMUNITY, type: 'competitive' });
    expect(filterSearch({ ...filters, communityId: null })).toEqual({ type: 'competitive' });
  });
});
