import { describe, expect, it } from 'vitest';
import {
  utcRangeBounds,
  validateStatisticsFilters,
  validateStatisticsPageSize,
  validateStatisticsRankHistoryInput
} from '../src/features/statistics/statistics.validators';

const COMMUNITY = '11111111-1111-4111-8111-111111111111';
const LEAGUE = '22222222-2222-4222-8222-222222222222';

describe('statistics filter validation', () => {
  it('normalizes defaults and lowercases identities', () => {
    expect(validateStatisticsFilters(undefined)).toEqual({
      communityId: null,
      leagueId: null,
      type: 'all',
      from: null,
      through: null
    });
    expect(
      validateStatisticsFilters({
        communityId: COMMUNITY.toUpperCase(),
        leagueId: LEAGUE,
        type: 'competitive',
        from: '2030-01-01',
        through: '2030-01-31'
      })
    ).toEqual({
      communityId: COMMUNITY,
      leagueId: LEAGUE,
      type: 'competitive',
      from: '2030-01-01',
      through: '2030-01-31'
    });
  });

  it.each([
    ['unknown key', { scope: 'all' }],
    ['unknown type', { type: 'ranked' }],
    ['malformed community', { communityId: 'abc' }],
    ['League without community', { leagueId: LEAGUE }],
    ['impossible date', { from: '2030-02-31' }],
    ['non-ISO date', { from: '01/02/2030' }],
    ['reversed range', { from: '2030-02-02', through: '2030-02-01' }],
    ['non-object', 'all']
  ])('rejects %s', (_label, input) => {
    expect(() => validateStatisticsFilters(input)).toThrow('INVALID_STATISTICS_INPUT');
  });

  it('accepts a single-day range and a leap day', () => {
    expect(() =>
      validateStatisticsFilters({ from: '2032-02-29', through: '2032-02-29' })
    ).not.toThrow();
  });
});

describe('UTC date bounds', () => {
  it('converts the inclusive through date to the next UTC midnight', () => {
    expect(utcRangeBounds({ from: '2030-12-31', through: '2030-12-31' })).toEqual({
      fromInstant: '2030-12-31T00:00:00.000Z',
      untilInstant: '2031-01-01T00:00:00.000Z'
    });
    expect(utcRangeBounds({ from: null, through: null })).toEqual({
      fromInstant: null,
      untilInstant: null
    });
  });
});

describe('statistics page size', () => {
  it('defaults to 20 and caps at 100', () => {
    expect(validateStatisticsPageSize(undefined)).toBe(20);
    expect(validateStatisticsPageSize(100)).toBe(100);
    expect(validateStatisticsPageSize(101)).toBe(100);
    expect(validateStatisticsPageSize(0)).toBe(20);
    expect(validateStatisticsPageSize(-5)).toBe(20);
    for (const bad of [1.5, '20'])
      expect(() => validateStatisticsPageSize(bad)).toThrow('INVALID_STATISTICS_INPUT');
  });
});

describe('rank history input validation', () => {
  it('defaults the page size and lowercases identities', () => {
    expect(
      validateStatisticsRankHistoryInput({ playerId: COMMUNITY.toUpperCase(), communityId: LEAGUE })
    ).toEqual({ playerId: COMMUNITY, communityId: LEAGUE, limit: 20 });
    expect(validateStatisticsRankHistoryInput({ playerId: COMMUNITY })).toMatchObject({
      communityId: null
    });
  });
  it('rejects a missing player, unknown keys and malformed identities', () => {
    for (const input of [
      {},
      null,
      { playerId: 'nope' },
      { playerId: COMMUNITY, leagueId: LEAGUE },
      { playerId: COMMUNITY, communityId: 'x' },
      { playerId: COMMUNITY, limit: '5' }
    ])
      expect(() => validateStatisticsRankHistoryInput(input)).toThrow('INVALID_STATISTICS_INPUT');
  });
});
