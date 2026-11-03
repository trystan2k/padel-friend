import { DEFAULT_STATISTICS_THRESHOLDS } from '../../src/features/statistics/statistics-config';
import type { MetricState } from '../../src/features/statistics/statistics-contracts';
import type {
  PlayerRank,
  PlayerRankHistory,
  PlayerStatistics
} from '../../src/features/statistics/statistics-player-contracts';

export const ready = <T = number>(
  value: T,
  numerator: number | null = null,
  denominator: number | null = null
): MetricState<T> => ({ state: 'ready', value, numerator, denominator });

export const insufficient = (
  reason: Extract<MetricState, { state: 'insufficient' }>['reason'],
  observed = 0,
  required = 1
): MetricState<never> => ({
  state: 'insufficient',
  value: null,
  numerator: null,
  denominator: null,
  observed,
  required,
  reason
});

export const rank = (position: number, provenance: PlayerRank['provenance']): PlayerRank => ({
  position,
  provenance,
  at: '2030-03-01T10:00:00Z',
  communityId: '22222222-2222-4222-8222-222222222222',
  leagueId: null,
  standingsVersion: null,
  ratingRevision: 4
});

export const rankHistory = (overrides: Partial<PlayerRankHistory> = {}): PlayerRankHistory => ({
  best: ready(rank(2, 'reconstructed')),
  coverageFrom: null,
  coverageUntil: null,
  coverageComplete: true,
  coverageReason: null,
  ...overrides
});

const candidate = (v: number) => ({ k: -v, v, at: '2030-02-10T09:00:00Z', g: 'g1' });
const bucket = (period: string, groups: number) => ({ period, groups });

/** A fully populated, ready player statistics response. */
export function makePlayerStatistics(overrides: Partial<PlayerStatistics> = {}): PlayerStatistics {
  const sample = (size: 5 | 10) => ({
    outcomes: [
      { g: 'a', o: 'W' as const, at: '2030-02-01T10:00:00Z' },
      { g: 'b', o: 'L' as const, at: '2030-02-02T10:00:00Z' },
      { g: 'c', o: 'D' as const, at: '2030-02-03T10:00:00Z' }
    ],
    wins: 1,
    losses: 1,
    draws: 1,
    sampleSize: 3,
    capacity: size
  });
  return {
    playerId: '11111111-1111-4111-8111-111111111111',
    filters: { communityId: null, leagueId: null, type: 'all', from: null, through: null },
    config: {
      config_version: 1,
      thresholds: DEFAULT_STATISTICS_THRESHOLDS,
      statistics_revision: 3,
      rating_revision: 4,
      rating_aligned: true
    },
    matches: {
      played: 12,
      competitive: 8,
      friendly: 4,
      wins: 6,
      losses: 3,
      draws: 1,
      incomplete: 2,
      winRate: ready(0.6, 6, 10),
      competitiveWinRate: ready(0.5, 4, 8),
      friendlyWinRate: ready(0.5, 2, 4)
    },
    typeRates: {
      competitive: {
        winRate: ready(0.5, 4, 8),
        setRate: ready(0.55, 11, 20),
        gameRate: ready(0.5, 60, 120)
      },
      friendly: {
        winRate: ready(0.5, 2, 4),
        setRate: ready(0.5, 5, 10),
        gameRate: ready(0.5, 30, 60)
      }
    },
    sets: { won: 16, lost: 14, differential: 2, winRate: ready(16 / 30, 16, 30) },
    games: {
      won: 90,
      lost: 80,
      differential: 10,
      winRate: ready(90 / 170, 90, 170),
      averageWonPerGroup: ready(9, 90, 10),
      averageConcededPerGroup: ready(8, 80, 10)
    },
    rating: {
      currentLevel: ready(3.5),
      reliability: ready(70),
      startingLevel: ready(3),
      highestLevel: ready(3.6),
      lowestEstablishedLevel: insufficient('not_established'),
      filteredDelta: ready(0.25, null, 9),
      communitySkillRank: ready(rank(4, 'reconstructed')),
      activeLeaguePosition: insufficient('not_in_league'),
      bestCommunitySkillRank: rankHistory(),
      bestLeaguePosition: rankHistory({ best: insufficient('no_applicable_result') })
    },
    form: {
      last5: ready(sample(5)),
      last10: ready(sample(10)),
      current: { kind: 'W', length: 2 },
      longestWins: 4,
      longestLosses: 2
    },
    advanced: {
      straightSetWins: 3,
      straightSetLosses: 1,
      threeSetGroups: 5,
      incompleteDeciders: 1,
      decidingSetWins: 3,
      decidingSetLosses: 2,
      decidingSetWinRate: ready(0.6, 3, 5),
      firstSetConversionRate: ready(0.75, 6, 8),
      comebackWinRate: insufficient('minimum_opportunities', 1, 3),
      cleanestWin: ready(candidate(8)),
      closestWin: ready(candidate(1)),
      biggestGain: ready(candidate(0.4)),
      biggestLoss: ready(candidate(-0.3)),
      strongestUpset: ready(candidate(0.3)),
      toughestLoss: ready(candidate(0.8))
    },
    activity: {
      fromDay: '2030-01-01',
      throughDay: '2030-03-31',
      weeklyAverage: ready(0.9, 12, 13),
      mostActiveWeek: ready(bucket('2030-02-04', 3)),
      mostActiveMonth: ready(bucket('2030-02', 5)),
      days: [],
      weeks: [bucket('2030-02-04', 3)],
      months: [bucket('2030-01', 4), bucket('2030-02', 5), bucket('2030-03', 3)]
    },
    relationships: {
      uniquePartners: 4,
      uniqueOpponents: 6,
      uniqueQuartets: 9,
      mostFrequentPartners: [{ playerId: '33333333-3333-4333-8333-333333333333', groups: 5 }],
      mostFrequentOpponents: [{ playerId: '44444444-4444-4444-8444-444444444444', groups: 4 }],
      mostFrequentPartnerShare: ready(5 / 12, 5, 12)
    },
    ...overrides
  };
}
