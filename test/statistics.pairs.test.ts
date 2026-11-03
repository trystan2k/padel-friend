import { describe, expect, it } from 'vitest';
import { decodePairStatistics } from '../src/features/statistics/statistics-relationships.server';
import { filterSearch, parseFilterSearch } from '../src/features/statistics/statistics-search';
import {
  validateStatisticsRelationshipInput,
  validateStatisticsRelationshipListInput
} from '../src/features/statistics/statistics.validators';
import { insufficient } from './helpers/player-statistics-fixtures';
import {
  FOCAL,
  OTHER,
  makePair,
  makeRelationshipRecord
} from './helpers/relationship-statistics-fixtures';

describe('relationship input validation', () => {
  it('accepts two distinct players with shared filters, lowercased', () => {
    expect(
      validateStatisticsRelationshipInput({
        playerId: FOCAL.toUpperCase(),
        otherId: OTHER,
        communityId: FOCAL,
        type: 'friendly',
        from: '2030-01-01'
      })
    ).toEqual({
      playerId: FOCAL,
      otherId: OTHER,
      filters: {
        communityId: FOCAL,
        leagueId: null,
        type: 'friendly',
        from: '2030-01-01',
        through: null
      }
    });
  });
  it('rejects a self pair, missing players, unknown keys and League without community', () => {
    for (const input of [
      { playerId: FOCAL, otherId: FOCAL },
      { playerId: FOCAL },
      { otherId: OTHER },
      { playerId: FOCAL, otherId: OTHER, email: 'a@b.c' },
      { playerId: FOCAL, otherId: OTHER, leagueId: OTHER },
      { playerId: FOCAL, otherId: OTHER, from: '2030-02-02', through: '2030-02-01' }
    ])
      expect(() => validateStatisticsRelationshipInput(input)).toThrow('INVALID_STATISTICS_INPUT');
  });
  it('clamps the page size and rejects a negative offset', () => {
    expect(validateStatisticsRelationshipListInput({ playerId: FOCAL, limit: 9999 })).toMatchObject(
      {
        limit: 100,
        offset: 0
      }
    );
    expect(validateStatisticsRelationshipListInput({ playerId: FOCAL })).toMatchObject({
      limit: 20
    });
    expect(() => validateStatisticsRelationshipListInput({ playerId: FOCAL, offset: -1 })).toThrow(
      'INVALID_STATISTICS_INPUT'
    );
  });
});

describe('focal context in links', () => {
  it('keeps every non-default filter and drops defaults', () => {
    expect(
      filterSearch({
        communityId: FOCAL,
        leagueId: OTHER,
        type: 'competitive',
        from: '2030-01-01',
        through: null
      })
    ).toEqual({ communityId: FOCAL, leagueId: OTHER, type: 'competitive', from: '2030-01-01' });
    expect(
      filterSearch({ communityId: null, leagueId: null, type: 'all', from: null, through: null })
    ).toEqual({});
  });
  it('parses only non-empty string search values', () => {
    expect(parseFilterSearch({ type: 'friendly', from: '', through: 3, other: 'x' })).toEqual({
      type: 'friendly'
    });
  });
});

describe('pair decoding', () => {
  it('round-trips a populated pair, keeping the focal player and canonical pair id', () => {
    const pair = makePair();
    expect(decodePairStatistics(pair)).toEqual(pair);
  });
  it('is identical for either player order apart from the focal player', () => {
    const forward = decodePairStatistics(makePair());
    const reverse = decodePairStatistics(makePair({ focalId: OTHER, otherId: FOCAL }));
    expect(reverse.pairId).toBe(forward.pairId);
    expect(reverse.record).toEqual(forward.record);
    expect(reverse.players).toEqual(forward.players);
    expect(reverse.focalId).toBe(OTHER);
  });
  it('keeps a one-match pair visible while ineligible for a best claim', () => {
    const record = makeRelationshipRecord({
      matches: {
        played: 1,
        competitive: 1,
        friendly: 0,
        wins: 1,
        losses: 0,
        draws: 0,
        incomplete: 0,
        winRate: { state: 'ready', value: 1, numerator: 1, denominator: 1 }
      },
      leaderEligibility: insufficient('minimum_matches', 1, 5)
    });
    const decoded = decodePairStatistics(makePair({ record }));
    expect(decoded.record.matches.winRate).toMatchObject({ state: 'ready', value: 1 });
    expect(decoded.record.leaderEligibility).toMatchObject({
      state: 'insufficient',
      reason: 'minimum_matches',
      observed: 1,
      required: 5
    });
  });
  it('rejects a lagging rating revision, broken partitions and missing players', () => {
    const lagging = makePair();
    expect(() =>
      decodePairStatistics({ ...lagging, config: { ...lagging.config, rating_aligned: false } })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
    const broken = makeRelationshipRecord();
    expect(() =>
      decodePairStatistics({
        ...lagging,
        record: { ...broken, matches: { ...broken.matches, wins: broken.matches.wins + 1 } }
      })
    ).toThrow('INVALID_STATISTICS_RESPONSE');
    expect(() => decodePairStatistics({ ...lagging, players: [lagging.players[0]] })).toThrow(
      'INVALID_STATISTICS_RESPONSE'
    );
  });
  it('requires a typed reason for missing opponent-level evidence', () => {
    const record = makeRelationshipRecord({
      averageOpponentLevel: insufficient('missing_evidence')
    });
    expect(decodePairStatistics(makePair({ record })).record.averageOpponentLevel).toMatchObject({
      state: 'insufficient',
      reason: 'missing_evidence',
      value: null
    });
  });
});
