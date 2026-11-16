import type { StatisticsThresholds } from './statistics-contracts';

/**
 * Plan "Concrete insufficient-data defaults". The server returns the thresholds it actually applied
 * with every response; this copy only seeds tests and fixtures, readers always use the response.
 */
export const DEFAULT_STATISTICS_THRESHOLDS: StatisticsThresholds = {
  basic_min_denominator: 1,
  best_opponent_min_meetings: 5,
  best_partnership_min_matches: 5,
  closest_rivalry_min_meetings: 5,
  community_leader_min_matches: 5,
  extremum_min_facts: 1,
  form_min_resolved: 1,
  lowest_established_min_states: 1,
  rank_min_states: 1,
  rate_min_opportunities: 3,
  upset_expected_score_max: 0.35
};

/**
 * Activity series are bounded to the latest 366 inclusive UTC days of the selected scope (a
 * leap-year-sized visualization). 366 days span at most 54 ISO weeks and 13 calendar months.
 */
export const STATISTICS_ACTIVITY_WINDOW_MAX_DAYS = 366;
export const STATISTICS_ACTIVITY_WINDOW_MAX_WEEKS = 54;
export const STATISTICS_ACTIVITY_WINDOW_MAX_MONTHS = 13;

export const STATISTICS_HISTORY_PAGE_DEFAULT = 20;
export const STATISTICS_HISTORY_PAGE_MAX = 100;
