import type { MetricState, StatisticsConfig, StatisticsFilters } from './statistics-contracts';
import type { RelationshipName } from './statistics-relationship-contracts';

/** Why a filter combination is empty even though the data may exist (typed token, no copy). */
export type CommunityNotice = 'friendly_league';

export type CommunityOption = { id: string; name: string };
export type CommunityLeagueOption = { id: string; name: string; status: 'active' | 'closed' };

/** Players tied on a leader value, in id order; only the first ten are listed (total is complete). */
export type CommunityLeader = { value: number; total: number; players: RelationshipName[] };

export type CommunityPairing = {
  id: string;
  /** One team for a pair, two teams for a matchup; each team lists its two players. */
  teams: RelationshipName[][];
};
export type CommunityFrequent = { groups: number; total: number; items: CommunityPairing[] };

export type CommunityRivalry = {
  imbalance: number;
  resolved: number;
  total: number;
  relationships: {
    first: RelationshipName;
    second: RelationshipName;
    wins: number;
    losses: number;
    draws: number;
  }[];
};

export type CommunityWeek = { start: string; groups: number };
export type CommunityMonth = { month: string; groups: number };

/**
 * Community aggregate. Every Game Group is counted once (not once per participant or pair).
 * 'decided' are groups with a winning team; 'draws' and 'incomplete' complete the partition.
 */
export type CommunityStatistics = {
  config: StatisticsConfig;
  filters: StatisticsFilters;
  notice: CommunityNotice | null;
  communities: CommunityOption[];
  leagues: CommunityLeagueOption[];
  activeLeagueId: string | null;
  league: { id: string; name: string; status: 'upcoming' | 'active' | 'closed' } | null;
  matches: {
    played: number;
    competitive: number;
    friendly: number;
    decided: number;
    draws: number;
    incomplete: number;
  };
  totals: { sets: number; games: number };
  rankingMatches: MetricState<{ groups: number; leagues: number }>;
  /** Distinct actual confirmed participants in the window: not the member count. */
  activePlayers: number;
  mostActivePlayer: MetricState<CommunityLeader>;
  mostWins: MetricState<CommunityLeader>;
  highestWinRate: MetricState<CommunityLeader>;
  bestSetDifferential: MetricState<CommunityLeader>;
  bestGameDifferential: MetricState<CommunityLeader>;
  /** Scoped ledger movement, never a global-level difference. */
  mostImproved: MetricState<CommunityLeader>;
  mostFrequentPair: MetricState<CommunityFrequent>;
  mostCommonMatchup: MetricState<CommunityFrequent>;
  closestRivalry: MetricState<CommunityRivalry>;
  window: { from: string | null; through: string | null; elapsedDays: number };
  averageMatchesPerWeek: MetricState;
  /** UTC ISO weeks (Monday start), zero buckets included inside the observed range. */
  weeks: CommunityWeek[];
  months: CommunityMonth[];
};
