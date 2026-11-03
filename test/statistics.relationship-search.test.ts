import { describe, expect, it } from 'vitest';
import {
  filterSearch,
  parseRelationshipSearch
} from '../src/features/statistics/statistics-search';

describe('relationship search', () => {
  it('retains valid meeting offsets alongside filters', () => {
    expect(parseRelationshipSearch({ communityId: 'community', recentOffset: 40 })).toEqual({
      communityId: 'community',
      recentOffset: 40
    });
  });
  it('resets the offset when writing fresh filters', () => {
    expect(
      filterSearch({
        communityId: null,
        leagueId: null,
        type: 'friendly',
        from: null,
        through: null
      })
    ).toEqual({ type: 'friendly' });
  });
  it('ignores malformed offsets', () => {
    expect(parseRelationshipSearch({ recentOffset: -1 })).toEqual({});
    for (const recentOffset of ['abc', '-20', '1.5', '25', '', '99999999999', ' 20'])
      expect(parseRelationshipSearch({ recentOffset })).toEqual({});
  });
  it('reads the string offset of a reloaded URL and round-trips filters', () => {
    const filters = {
      communityId: null,
      leagueId: null,
      type: 'friendly' as const,
      from: null,
      through: null
    };
    const written = { ...filterSearch(filters), recentOffset: 40 };
    expect(parseRelationshipSearch(written)).toEqual({ type: 'friendly', recentOffset: 40 });
    expect(parseRelationshipSearch({ ...written, recentOffset: '40' })).toEqual({
      type: 'friendly',
      recentOffset: 40
    });
  });
});
