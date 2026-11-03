import { DEFAULT_STATISTICS_THRESHOLDS } from '../../src/features/statistics/statistics-config';
import type { CommunityStatistics } from '../../src/features/statistics/statistics-community-contracts';
import { insufficient, ready } from './player-statistics-fixtures';

export const COMMUNITY = '77777777-7777-4777-8777-777777777777';
export const LEAGUE = '88888888-8888-4888-8888-888888888888';
export const ANA = '11111111-1111-4111-8111-111111111111';
export const BEA = '33333333-3333-4333-8333-333333333333';
export const CAL = '44444444-4444-4444-8444-444444444444';
export const DEE = '99999999-9999-4999-8999-999999999999';

export const name = (userId: string, displayName: string | null) => ({ userId, displayName });

/** A populated community aggregate: 10 groups = 6 decided + 3 draws + 1 incomplete. */
export function makeCommunityStatistics(
  overrides: Partial<CommunityStatistics> = {}
): CommunityStatistics {
  const leader = (userId: string, display: string, value: number) =>
    ready({ value, total: 1, players: [name(userId, display)] });
  return {
    config: {
      config_version: 1,
      thresholds: DEFAULT_STATISTICS_THRESHOLDS,
      statistics_revision: 3,
      rating_revision: 4,
      rating_aligned: true
    },
    filters: { communityId: COMMUNITY, leagueId: null, type: 'all', from: null, through: null },
    notice: null,
    communities: [{ id: COMMUNITY, name: 'Padel Club' }],
    leagues: [{ id: LEAGUE, name: 'Spring League', status: 'active' }],
    activeLeagueId: LEAGUE,
    league: null,
    matches: { played: 10, competitive: 7, friendly: 3, decided: 6, draws: 3, incomplete: 1 },
    totals: { sets: 21, games: 190 },
    rankingMatches: ready({ groups: 4, leagues: 1 }),
    activePlayers: 4,
    mostActivePlayer: leader(ANA, 'Ana', 10),
    mostWins: leader(BEA, 'Bea', 5),
    highestWinRate: ready({
      value: 0.75,
      total: 2,
      players: [name(ANA, 'Ana'), name(BEA, 'Bea')]
    }),
    bestSetDifferential: leader(ANA, 'Ana', 4),
    bestGameDifferential: leader(ANA, 'Ana', 18),
    mostImproved: leader(CAL, 'Cal', 0.42),
    mostFrequentPair: ready({
      groups: 6,
      total: 1,
      items: [{ id: ANA, teams: [[name(ANA, 'Ana'), name(BEA, 'Bea')]] }]
    }),
    mostCommonMatchup: ready({
      groups: 5,
      total: 1,
      items: [
        {
          id: BEA,
          teams: [
            [name(ANA, 'Ana'), name(BEA, 'Bea')],
            [name(CAL, 'Cal'), name(DEE, null)]
          ]
        }
      ]
    }),
    closestRivalry: ready({
      imbalance: 0,
      resolved: 6,
      total: 1,
      relationships: [
        { first: name(ANA, 'Ana'), second: name(CAL, 'Cal'), wins: 3, losses: 3, draws: 0 }
      ]
    }),
    window: { from: '2030-01-07', through: '2030-02-17', elapsedDays: 42 },
    averageMatchesPerWeek: ready(10 / 6, 10, 42),
    weeks: [
      { start: '2030-01-07', groups: 4 },
      { start: '2030-01-14', groups: 0 },
      { start: '2030-02-11', groups: 6 }
    ],
    months: [
      { month: '2030-01', groups: 4 },
      { month: '2030-02', groups: 6 }
    ],
    ...overrides
  };
}

export const emptyCommunityStatistics = (
  overrides: Partial<CommunityStatistics> = {}
): CommunityStatistics =>
  makeCommunityStatistics({
    matches: { played: 0, competitive: 0, friendly: 0, decided: 0, draws: 0, incomplete: 0 },
    totals: { sets: 0, games: 0 },
    rankingMatches: insufficient('not_in_league'),
    activePlayers: 0,
    mostActivePlayer: insufficient('no_applicable_result'),
    mostWins: insufficient('no_applicable_result'),
    highestWinRate: insufficient('no_applicable_result', 0, 5),
    bestSetDifferential: insufficient('no_applicable_result'),
    bestGameDifferential: insufficient('no_applicable_result'),
    mostImproved: insufficient('no_applicable_result'),
    mostFrequentPair: insufficient('no_applicable_result'),
    mostCommonMatchup: insufficient('no_applicable_result'),
    closestRivalry: insufficient('no_applicable_result', 0, 5),
    window: { from: null, through: null, elapsedDays: 0 },
    averageMatchesPerWeek: insufficient('no_denominator'),
    weeks: [],
    months: [],
    ...overrides
  });
