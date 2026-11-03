import { describe, expect, it } from 'vitest';
import { decodeCommunityStatistics } from '../src/features/statistics/statistics-community.server';
import {
  ANA,
  COMMUNITY,
  emptyCommunityStatistics,
  makeCommunityStatistics
} from './helpers/community-statistics-fixtures';

const wire = (value: unknown): unknown => JSON.parse(JSON.stringify(value));

describe('decodeCommunityStatistics', () => {
  it('round-trips a populated aggregate', () => {
    const stats = makeCommunityStatistics();
    expect(decodeCommunityStatistics(wire(stats))).toEqual(stats);
  });

  it('keeps typed insufficient states instead of fake zeros', () => {
    const stats = emptyCommunityStatistics();
    const decoded = decodeCommunityStatistics(wire(stats));
    expect(decoded.mostWins).toMatchObject({
      state: 'insufficient',
      reason: 'no_applicable_result'
    });
    expect(decoded.highestWinRate).toMatchObject({ state: 'insufficient', required: 5 });
    expect(decoded.rankingMatches).toMatchObject({
      state: 'insufficient',
      reason: 'not_in_league'
    });
    expect(decoded.averageMatchesPerWeek).toMatchObject({ reason: 'no_denominator' });
    expect(decoded.weeks).toEqual([]);
  });

  it('keeps the friendly + League notice and the selected League', () => {
    const decoded = decodeCommunityStatistics(
      wire(
        emptyCommunityStatistics({
          notice: 'friendly_league',
          league: { id: COMMUNITY, name: 'Spring', status: 'closed' }
        })
      )
    );
    expect(decoded.notice).toBe('friendly_league');
    expect(decoded.league).toEqual({ id: COMMUNITY, name: 'Spring', status: 'closed' });
  });

  it('rejects partitions that do not add up (a group counted twice)', () => {
    const stats = makeCommunityStatistics();
    expect(() =>
      decodeCommunityStatistics(
        wire({ ...stats, matches: { ...stats.matches, decided: stats.matches.decided + 1 } })
      )
    ).toThrow('INVALID_STATISTICS_RESPONSE');
    expect(() =>
      decodeCommunityStatistics(
        wire({ ...stats, matches: { ...stats.matches, friendly: stats.matches.friendly + 1 } })
      )
    ).toThrow('INVALID_STATISTICS_RESPONSE');
  });

  it('rejects unknown notices, malformed leaders and negative counters', () => {
    const stats = makeCommunityStatistics();
    expect(() => decodeCommunityStatistics(wire({ ...stats, notice: 'other' }))).toThrow(
      'INVALID_STATISTICS_RESPONSE'
    );
    expect(() => decodeCommunityStatistics(wire({ ...stats, activePlayers: -1 }))).toThrow(
      'INVALID_STATISTICS_RESPONSE'
    );
    expect(() =>
      decodeCommunityStatistics(
        wire({
          ...stats,
          mostWins: {
            state: 'ready',
            value: { value: 1, total: 1, players: [] },
            numerator: null,
            denominator: null
          }
        })
      )
    ).toThrow('INVALID_STATISTICS_RESPONSE');
    expect(() =>
      decodeCommunityStatistics(
        wire({
          ...stats,
          mostWins: {
            state: 'ready',
            value: {
              value: 1,
              total: 1,
              players: [
                { userId: ANA, displayName: 'A' },
                { userId: COMMUNITY, displayName: 'B' }
              ]
            },
            numerator: null,
            denominator: null
          }
        })
      )
    ).toThrow('INVALID_STATISTICS_RESPONSE');
  });
});
