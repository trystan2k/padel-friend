export const STATISTICS_MATCH_TYPES = ['all', 'competitive', 'friendly'] as const;
export type StatisticsMatchType = (typeof STATISTICS_MATCH_TYPES)[number];

export const STATISTICS_SCOPE_KINDS = ['all', 'community', 'league'] as const;
export type StatisticsScopeKind = (typeof STATISTICS_SCOPE_KINDS)[number];

export const STATISTICS_SUBJECT_KINDS = [
  'player',
  'pair',
  'opponent',
  'matchup',
  'community'
] as const;
export type StatisticsSubjectKind = (typeof STATISTICS_SUBJECT_KINDS)[number];

/** Resolved outcomes only: an Incomplete group never enters an ordered outcome sequence. */
export type StatisticsOutcome = 'W' | 'L' | 'D';

/** Server reason tokens; the UI translates them, the server never returns English copy. */
export const STATISTICS_REASONS = [
  'no_denominator',
  'no_resolved_matches',
  'minimum_opportunities',
  'minimum_matches',
  'missing_evidence',
  'no_applicable_result',
  'not_established',
  'not_ranked',
  'rank_coverage_boundary',
  'not_in_league',
  'forbidden',
  'unavailable'
] as const;
export type StatisticsReason = (typeof STATISTICS_REASONS)[number];

/**
 * Evidence-carrying metric: ready has a value, insufficient has a typed reason (never 0%, NaN or
 * Infinity), unavailable means the evidence cannot be produced for this viewer or scope.
 */
export type MetricState<T = number> =
  | { state: 'ready'; value: T; numerator: number | null; denominator: number | null }
  | {
      state: 'insufficient';
      value: null;
      numerator: number | null;
      denominator: number | null;
      observed: number | null;
      required: number | null;
      reason: StatisticsReason;
    }
  | { state: 'unavailable'; value: null; reason: StatisticsReason };

/** Run of one outcome kind at an end of an ordered sequence. */
export type SequenceRun = { k: StatisticsOutcome; len: number };

/** Associative streak monoid: merging two ordered halves never loses a boundary-crossing run. */
export type SequenceState = {
  n: number;
  prefix: SequenceRun | null;
  suffix: SequenceRun | null;
  best_win: number;
  best_loss: number;
};

export type RecentOutcome = { g: string; o: StatisticsOutcome; at: string };

/** Smaller k wins; ties break by (at, g) so the same facts always select the same record. */
export type ExtremumCandidate = { k: number; v: number; at: string; g: string };
export const STATISTICS_EXTREMA_KEYS = [
  'cleanest_win',
  'closest_win',
  'biggest_gain',
  'biggest_loss',
  'strongest_upset',
  'toughest_loss'
] as const;
export type StatisticsExtremumKey = (typeof STATISTICS_EXTREMA_KEYS)[number];
export type StatisticsExtrema = Partial<Record<StatisticsExtremumKey, ExtremumCandidate>>;

/** Nested additive counters keyed by identity: relations.partners[id].g etc. */
export type JsonCounts = { [key: string]: number | JsonCounts };

/** Everything additive or ordered about a set of Game Groups, shared by summaries and buckets. */
export type StatisticsAggregate = {
  confirmed_groups: number;
  wins: number;
  losses: number;
  draws: number;
  incomplete_groups: number;
  competitive_groups: number;
  friendly_groups: number;
  sets_won: number;
  sets_lost: number;
  games_won: number;
  games_lost: number;
  straight_set_wins: number;
  straight_set_losses: number;
  three_set_groups: number;
  incomplete_decider_groups: number;
  deciding_set_wins: number;
  deciding_set_losses: number;
  first_set_won_groups: number;
  first_set_won_converted: number;
  first_set_lost_groups: number;
  first_set_lost_converted: number;
  rated_groups: number;
  rating_delta_sum: number;
  opponent_strength_sum: number;
  opponent_strength_groups: number;
  upset_wins: number;
  first_played_at: string | null;
  first_game_group_id: string | null;
  last_played_at: string | null;
  last_game_group_id: string | null;
  sequence: SequenceState;
  recent: RecentOutcome[];
  extrema: StatisticsExtrema;
  relations: JsonCounts;
  activity: JsonCounts;
};

export type StatisticsKey = {
  subject_kind: StatisticsSubjectKind;
  subject_a: string;
  subject_b: string;
  scope_kind: StatisticsScopeKind;
  scope_id: string;
  match_type: StatisticsMatchType;
};

export type StatisticsSummaryRow = StatisticsKey &
  StatisticsAggregate & { subject_players: string[] };
export type StatisticsDailyBucket = StatisticsSummaryRow & { played_day: string };

export type StatisticsThresholds = {
  basic_min_denominator: number;
  best_opponent_min_meetings: number;
  best_partnership_min_matches: number;
  closest_rivalry_min_meetings: number;
  community_leader_min_matches: number;
  extremum_min_facts: number;
  form_min_resolved: number;
  lowest_established_min_states: number;
  rank_min_states: number;
  rate_min_opportunities: number;
  upset_expected_score_max: number;
};

export type StatisticsConfig = {
  config_version: number;
  thresholds: StatisticsThresholds;
  statistics_revision: number;
  rating_revision: number;
  /** False while the rating-derived fields lag the committed rating revision: retry, never mix. */
  rating_aligned: boolean;
};

/** Normalized filter contract shared by every reader (UTC whole dates, both inclusive). */
export type StatisticsFilters = {
  communityId: string | null;
  leagueId: string | null;
  type: StatisticsMatchType;
  from: string | null;
  through: string | null;
};
