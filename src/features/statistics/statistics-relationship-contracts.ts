import type {
  ExtremumCandidate,
  MetricState,
  StatisticsConfig,
  StatisticsFilters
} from './statistics-contracts';
import type { PlayerScoreTotals } from './statistics-player-contracts';

/** Display name only: no email, invitation or membership detail leaves the sporting DTO. */
export type RelationshipName = { userId: string; displayName: string | null };

/** Evidence candidate plus the event its Game Group belongs to, so the UI can link the detail. */
export type RelationshipExtremum = ExtremumCandidate & { eventId: string | null };

export type RelationshipMatches = {
  played: number;
  competitive: number;
  friendly: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete: number;
  winRate: MetricState;
};

/** Pair and head-to-head record, always oriented to the subject it was requested for. */
export type RelationshipRecord = {
  matches: RelationshipMatches;
  sets: PlayerScoreTotals;
  games: PlayerScoreTotals;
  streaks: {
    current: { kind: 'W' | 'L' | null; length: number };
    longestWins: number;
    longestLosses: number;
  };
  /** Stored pre-match opposing team strength; the denominator is the evidence sample size. */
  averageOpponentLevel: MetricState;
  upsetWins: number;
  biggestUpset: MetricState<RelationshipExtremum>;
  toughestLoss: MetricState<RelationshipExtremum>;
  biggestGain: MetricState<RelationshipExtremum>;
  biggestLoss: MetricState<RelationshipExtremum>;
  /** Ready once the resolved matches reach the leader threshold; otherwise the record is still shown. */
  leaderEligibility: MetricState;
  leagues: { leagueId: string; name: string | null; groups: number }[];
};

export type RelationshipMatch = {
  groupId: string;
  eventId: string;
  playedAt: string;
  matchType: 'competitive' | 'friendly';
  outcome: 'W' | 'L' | 'D' | 'I';
  setsFor: number;
  setsAgainst: number;
  gamesFor: number;
  gamesAgainst: number;
  expectedScore: number | null;
  /** Focal rating effect of a head-to-head meeting; null without rating evidence. */
  ratingDelta: number | null;
};

export type PairStatistics = {
  focalId: string;
  otherId: string;
  /** Canonical identity: identical for A+B and B+A and for either team side. */
  pairId: string;
  filters: StatisticsFilters;
  config: StatisticsConfig;
  /** Sorted by player id, so both URL orders return the same pair. */
  players: RelationshipName[];
  record: RelationshipRecord;
  recent: RelationshipMatch[];
  recentOffset: number;
};

export type OpponentStatistics = {
  focalId: string;
  otherId: string;
  filters: StatisticsFilters;
  config: StatisticsConfig;
  focal: RelationshipName;
  other: RelationshipName;
  record: RelationshipRecord;
  recent: RelationshipMatch[];
  recentOffset: number;
};

export type RelationshipListItem = {
  playerId: string;
  displayName: string | null;
  played: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete: number;
  winRate: MetricState;
};

export type RelationshipMostFrequent = { groups: number; players: RelationshipName[] };

/** Every tied identity is kept, in player id order. */
export type RelationshipLeader = {
  players: RelationshipName[];
  resolved: number;
  winRate: number | null;
  imbalance: number | null;
};

type RelationshipRecordsBase = {
  playerId: string;
  filters: StatisticsFilters;
  config: StatisticsConfig;
  limit: number;
  offset: number;
  total: number;
  items: RelationshipListItem[];
  mostFrequent: MetricState<RelationshipMostFrequent>;
  best: MetricState<RelationshipLeader>;
};

export type PartnerRecords = RelationshipRecordsBase;

export type OpponentRecords = RelationshipRecordsBase & {
  toughest: MetricState<RelationshipLeader>;
  closestRivalry: MetricState<RelationshipLeader>;
};
