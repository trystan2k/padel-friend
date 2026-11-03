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
  });
});
