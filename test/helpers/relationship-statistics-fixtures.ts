import { DEFAULT_STATISTICS_THRESHOLDS } from '../../src/features/statistics/statistics-config';
import type {
  OpponentRecords,
  OpponentStatistics,
  PairStatistics,
  PartnerRecords,
  RelationshipExtremum,
  RelationshipRecord
} from '../../src/features/statistics/statistics-relationship-contracts';
import { insufficient, ready } from './player-statistics-fixtures';

export const FOCAL = '11111111-1111-4111-8111-111111111111';
export const OTHER = '33333333-3333-4333-8333-333333333333';
export const THIRD = '44444444-4444-4444-8444-444444444444';
export const EVENT = '55555555-5555-4555-8555-555555555555';
export const GROUP = '66666666-6666-4666-8666-666666666666';

const filters = {
  communityId: null,
  leagueId: null,
  type: 'all',
  from: null,
  through: null
} as const;
const config = {
  config_version: 1,
  thresholds: DEFAULT_STATISTICS_THRESHOLDS,
  statistics_revision: 3,
  rating_revision: 4,
  rating_aligned: true
};

export const evidence = (v: number, eventId: string | null = EVENT): RelationshipExtremum => ({
  k: v,
  v,
  at: '2030-02-10T09:00:00Z',
  g: GROUP,
  eventId
});

/** A populated pair/head-to-head record: 7 played = 3W 2L 1D + 1 incomplete. */
export function makeRelationshipRecord(
  overrides: Partial<RelationshipRecord> = {}
): RelationshipRecord {
  return {
    matches: {
      played: 7,
      competitive: 5,
      friendly: 2,
      wins: 3,
      losses: 2,
      draws: 1,
      incomplete: 1,
      winRate: ready(0.5, 3, 6)
    },
    sets: { won: 8, lost: 5, differential: 3, winRate: ready(8 / 13, 8, 13) },
    games: { won: 60, lost: 48, differential: 12, winRate: ready(60 / 108, 60, 108) },
    streaks: { current: { kind: 'W', length: 2 }, longestWins: 3, longestLosses: 1 },
    averageOpponentLevel: ready(3.8, null, 5),
    upsetWins: 1,
    biggestUpset: ready(evidence(0.3)),
    toughestLoss: ready(evidence(0.8)),
    biggestGain: ready(evidence(0.4)),
    biggestLoss: ready(evidence(-0.3)),
    leaderEligibility: ready(6),
    leagues: [{ leagueId: THIRD, name: 'Spring League', groups: 2 }],
    ...overrides
  };
}

const recent = (outcome: 'W' | 'L' | 'D' | 'I', ratingDelta: number | null) => ({
  groupId: GROUP,
  eventId: EVENT,
  playedAt: '2030-02-10T09:00:00Z',
  matchType: 'competitive' as const,
  outcome,
  setsFor: 2,
  setsAgainst: 1,
  gamesFor: 14,
  gamesAgainst: 11,
  expectedScore: 0.4,
  ratingDelta
});

export function makePair(overrides: Partial<PairStatistics> = {}): PairStatistics {
  return {
    focalId: FOCAL,
    otherId: OTHER,
    pairId: '77777777-7777-4777-8777-777777777777',
    filters: { ...filters },
    config,
    players: [
      { userId: FOCAL, displayName: 'Ana' },
      { userId: OTHER, displayName: 'Bea' }
    ],
    record: makeRelationshipRecord(),
    recentOffset: 0,
    recent: [recent('W', null), recent('I', null)],
    ...overrides
  };
}

export function makeOpponent(overrides: Partial<OpponentStatistics> = {}): OpponentStatistics {
  return {
    focalId: FOCAL,
    otherId: OTHER,
    filters: { ...filters },
    config,
    focal: { userId: FOCAL, displayName: 'Ana' },
    other: { userId: OTHER, displayName: 'Cleo' },
    record: makeRelationshipRecord(),
    recentOffset: 0,
    recent: [recent('L', -0.2), recent('W', 0.3), recent('W', null)],
    ...overrides
  };
}

const item = (playerId: string, displayName: string | null, played: number, wins: number) => ({
  playerId,
  displayName,
  played,
  wins,
  losses: played - wins,
  draws: 0,
  incomplete: 0,
  winRate: ready(wins / played, wins, played)
});

const base = {
  playerId: FOCAL,
  filters: { ...filters },
  config,
  limit: 20,
  offset: 0
};

export function makePartnerRecords(overrides: Partial<PartnerRecords> = {}): PartnerRecords {
  return {
    ...base,
    total: 2,
    items: [item(OTHER, 'Bea', 6, 4), item(THIRD, null, 1, 1)],
    mostFrequent: ready({ groups: 6, players: [{ userId: OTHER, displayName: 'Bea' }] }),
    best: ready({
      players: [{ userId: OTHER, displayName: 'Bea' }],
      resolved: 6,
      winRate: 4 / 6,
      imbalance: 2
    }),
    ...overrides
  };
}

export function makeOpponentRecords(overrides: Partial<OpponentRecords> = {}): OpponentRecords {
  const leader = (name: string, id: string) => ({
    players: [{ userId: id, displayName: name }],
    resolved: 5,
    winRate: 0.6,
    imbalance: 1
  });
  return {
    ...base,
    total: 2,
    items: [item(OTHER, 'Cleo', 5, 3), item(THIRD, 'Dani', 2, 0)],
    mostFrequent: ready({ groups: 5, players: [{ userId: OTHER, displayName: 'Cleo' }] }),
    best: ready(leader('Cleo', OTHER)),
    toughest: insufficient('minimum_matches', 2, 5),
    closestRivalry: ready(leader('Cleo', OTHER)),
    ...overrides
  };
}
