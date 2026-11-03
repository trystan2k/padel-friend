import { describe, expect, it } from 'vitest';
import {
  utcRangeBounds,
  validateStatisticsFilters
} from '../src/features/statistics/statistics.validators';

const COMMUNITY = '77777777-7777-4777-8777-777777777777';
const LEAGUE = '88888888-8888-4888-8888-888888888888';

describe('statistics filter contract', () => {
  const types = ['all', 'competitive', 'friendly'] as const;
  const scopes = [
    { name: 'all communities', filter: {} },
    { name: 'selected community', filter: { communityId: COMMUNITY } },
    { name: 'selected League', filter: { communityId: COMMUNITY, leagueId: LEAGUE } }
  ];
  const ranges = [
    { name: 'no dates', filter: {} },
    { name: 'from only', filter: { from: '2030-01-01' } },
    { name: 'through only', filter: { through: '2030-01-31' } },
    { name: 'both', filter: { from: '2030-01-01', through: '2030-01-31' } },
    { name: 'a single day', filter: { from: '2030-01-15', through: '2030-01-15' } }
  ];

  for (const scope of scopes) {
    for (const type of types) {
      for (const range of ranges) {
        it(`normalizes ${scope.name} × ${type} × ${range.name}`, () => {
          const filters = validateStatisticsFilters({ ...scope.filter, type, ...range.filter });
          expect(filters).toEqual({
            communityId: null,
            leagueId: null,
            from: null,
            through: null,
            ...scope.filter,
            type,
            ...range.filter
          });
          // Normalizing a normalized filter changes nothing.
          expect(validateStatisticsFilters(filters)).toEqual(filters);
        });
      }
    }
  }

  it('lowercases ids and defaults the type', () => {
    expect(validateStatisticsFilters({ communityId: COMMUNITY.toUpperCase() })).toMatchObject({
      communityId: COMMUNITY,
      type: 'all'
    });
  });

  it('rejects malformed ids, unknown keys, bad types, reversed or impossible dates', () => {
    for (const input of [
      { communityId: 'nope' },
      { communityId: COMMUNITY, leagueId: 'nope' },
      { leagueId: LEAGUE },
      { type: 'ranked' },
      { from: '2030-13-01' },
      { from: '2030-02-30' },
      { from: '2030-1-1' },
      { from: '2030-01-01T00:00:00Z' },
      { from: '2030-02-02', through: '2030-02-01' },
      { unknown: true },
      'text',
      []
    ])
      expect(() => validateStatisticsFilters(input)).toThrow('INVALID_STATISTICS_INPUT');
  });
});

describe('UTC whole-date bounds', () => {
  it('converts through to the exclusive next UTC midnight and keeps from at its own midnight', () => {
    expect(utcRangeBounds({ from: '2030-03-04', through: '2030-03-04' })).toEqual({
      fromInstant: '2030-03-04T00:00:00.000Z',
      untilInstant: '2030-03-05T00:00:00.000Z'
    });
    expect(utcRangeBounds({ from: null, through: null })).toEqual({
      fromInstant: null,
      untilInstant: null
    });
  });

  it('rolls month, year and leap-day boundaries and ISO week edges without drift', () => {
    expect(utcRangeBounds({ from: null, through: '2030-12-31' }).untilInstant).toBe(
      '2031-01-01T00:00:00.000Z'
    );
    expect(utcRangeBounds({ from: null, through: '2032-02-28' }).untilInstant).toBe(
      '2032-02-29T00:00:00.000Z'
    );
    expect(utcRangeBounds({ from: null, through: '2031-02-28' }).untilInstant).toBe(
      '2031-03-01T00:00:00.000Z'
    );
    // Sunday 2030-01-06 closes the ISO week that starts Monday 2029-12-31; Monday opens the next.
    expect(utcRangeBounds({ from: '2030-01-07', through: '2030-01-06' }).fromInstant).toBe(
      '2030-01-07T00:00:00.000Z'
    );
    expect(utcRangeBounds({ from: null, through: '2030-01-06' }).untilInstant).toBe(
      '2030-01-07T00:00:00.000Z'
    );
  });
});
