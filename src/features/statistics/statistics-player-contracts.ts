import type {
  ExtremumCandidate,
  MetricState,
  RecentOutcome,
  StatisticsConfig,
  StatisticsFilters
} from './statistics-contracts';

/** Group-based counts include confirmed Incomplete results; resolved excludes them. */
export type PlayerMatchTotals = {
  played: number;
  competitive: number;
  friendly: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete: number;
  winRate: MetricState;
  competitiveWinRate: MetricState;
  friendlyWinRate: MetricState;
};

/** Rates are independently denominator-checked within each selected match type. */
export type PlayerTypeRates = Record<
  'competitive' | 'friendly',
  { winRate: MetricState; setRate: MetricState; gameRate: MetricState }
>;

export type PlayerScoreTotals = {
  won: number;
  lost: number;
  differential: number;
  winRate: MetricState;
};

export type PlayerFormSample = {
  /** Resolved outcomes, oldest first; draws break both streaks. */
  outcomes: RecentOutcome[];
  wins: number;
  losses: number;
  draws: number;
  sampleSize: number;
  capacity: 5 | 10;
};

export type PlayerRank = {
  position: number;
  /** Skill ranks are reconstructed from history; League positions follow their standings snapshot. */
  provenance: 'published' | 'reconstructed';
  at: string;
  communityId: string;
  leagueId: string | null;
  /** Immutable standings version a League position was read from. */
  standingsVersion: number | null;
  /** Committed rating revision a skill rank was derived at. */
  ratingRevision: number | null;
};

export type PlayerRankCoverageReason =
  | 'missing_rating_evidence'
  | 'unpublished_league'
  | 'no_history';

export type PlayerRankHistory = {
  best: MetricState<PlayerRank>;
  /** Earliest instant with proven complete transition evidence, null if none is known. */
  coverageFrom: string | null;
  /** End of the evidence (membership end or last published League), null while ongoing. */
  coverageUntil: string | null;
  coverageComplete: boolean;
  coverageReason: PlayerRankCoverageReason | null;
};

export type PlayerRatingStatistics = {
  currentLevel: MetricState;
  reliability: MetricState;
  startingLevel: MetricState;
  highestLevel: MetricState;
  lowestEstablishedLevel: MetricState;
  /** Sum of scoped committed ledger deltas, not an end-minus-start global level. */
  filteredDelta: MetricState;
  communitySkillRank: MetricState<PlayerRank>;
  activeLeaguePosition: MetricState<PlayerRank>;
  bestCommunitySkillRank: PlayerRankHistory;
  bestLeaguePosition: PlayerRankHistory;
};

export type PlayerActivityBucket = { period: string; groups: number };
export type PlayerActivity = {
  /** Inclusive observed UTC days defining the weekly-average denominator. */
  fromDay: string | null;
  throughDay: string | null;
  weeklyAverage: MetricState;
  mostActiveWeek: MetricState<PlayerActivityBucket>;
  mostActiveMonth: MetricState<PlayerActivityBucket>;
  days: PlayerActivityBucket[];
  weeks: PlayerActivityBucket[];
  months: PlayerActivityBucket[];
};

export type PlayerRelationshipLeader = { playerId: string; groups: number };
export type PlayerRelationships = {
  uniquePartners: number;
  uniqueOpponents: number;
  uniqueQuartets: number;
  mostFrequentPartners: PlayerRelationshipLeader[];
  mostFrequentOpponents: PlayerRelationshipLeader[];
  mostFrequentPartnerShare: MetricState;
};

export type PlayerAdvancedStatistics = {
  straightSetWins: number;
  straightSetLosses: number;
  threeSetGroups: number;
  incompleteDeciders: number;
  decidingSetWins: number;
  decidingSetLosses: number;
  decidingSetWinRate: MetricState;
  firstSetConversionRate: MetricState;
  comebackWinRate: MetricState;
  cleanestWin: MetricState<ExtremumCandidate>;
  closestWin: MetricState<ExtremumCandidate>;
  biggestGain: MetricState<ExtremumCandidate>;
  biggestLoss: MetricState<ExtremumCandidate>;
  strongestUpset: MetricState<ExtremumCandidate>;
  toughestLoss: MetricState<ExtremumCandidate>;
};

/** One change of a player's community skill rank, at a rating, initialization or membership boundary. */
export type PlayerRankTransition = {
  communityId: string;
  effectiveFrom: string;
  status: 'ranked' | 'unrated' | 'not_member';
  position: number | null;
  level: number | null;
  reliability: number | null;
  established: boolean | null;
  rankedMembers: number | null;
  /** False while an active member lacked rating evidence, so the rank is not proven. */
  complete: boolean;
  ratingRevision: number | null;
  source: 'ledger' | 'initialization' | null;
};

export type PlayerLeaguePosition = {
  communityId: string;
  leagueId: string;
  standingsVersion: number;
  position: number;
  provenance: 'published' | 'reconstructed';
  publishedAt: string;
};

export type PlayerRankHistoryPage = {
  playerId: string;
  communityId: string | null;
  transitions: PlayerRankTransition[];
  truncated: boolean;
  leaguePositions: PlayerLeaguePosition[];
};

/** Sporting-only response, pinned to the applied configuration and projection revisions. */
export type PlayerStatistics = {
  playerId: string;
  filters: StatisticsFilters;
  config: StatisticsConfig;
  matches: PlayerMatchTotals;
  typeRates: PlayerTypeRates;
  sets: PlayerScoreTotals;
  games: PlayerScoreTotals & {
    averageWonPerGroup: MetricState;
    averageConcededPerGroup: MetricState;
  };
  rating: PlayerRatingStatistics;
  form: {
    last5: MetricState<PlayerFormSample>;
    last10: MetricState<PlayerFormSample>;
    current: { kind: 'W' | 'L' | null; length: number };
    longestWins: number;
    longestLosses: number;
  };
  advanced: PlayerAdvancedStatistics;
  activity: PlayerActivity;
  relationships: PlayerRelationships;
};
