import type { LeagueStatus } from './league-contracts';

/**
 * One row of the live League standings, keyed by permanent user UUID. Carries sporting facts only:
 * no rating, level, reliability or delta, so the order can neither be seeded from nor sorted by
 * global skill.
 */
export type LeagueStandingEntry = {
  user_id: string;
  display_name: string | null;
  is_provisional: boolean;
  /** Competition position: rows equal on Wins, Losses, Set Diff and Sets Won share it (1, 1, 3). */
  position: number;
  matches: number;
  wins: number;
  losses: number;
  draws: number;
  sets_won: number;
  sets_lost: number;
  set_differential: number;
  /** Threshold-only: matches >= the League's minimum. Never filters or reorders rows. */
  award_eligible: boolean;
  matches_remaining: number;
};

export const LEAGUE_STANDINGS_CAUSES = [
  'closed',
  'late_first_confirmation',
  'repair',
  'reconstruction',
  'result_amendment',
  'result_void'
] as const;
export type LeagueStandingsCause = (typeof LEAGUE_STANDINGS_CAUSES)[number];

type LeagueStandingsBase = {
  league_id: string;
  status: LeagueStatus;
  minimum_matches_for_final_award: number;
  /** Ordered by position, then by user UUID (presentation only inside a shared position). */
  entries: LeagueStandingEntry[];
};

/** Open League: computed now from the materialized counters plus the zero overlay. */
export type LeagueLiveStandings = LeagueStandingsBase & {
  source: 'live';
  standings_version: null;
  latest_standings_version: null;
  generated_at: null;
  cause: null;
};

/** Closed League: one immutable published version, frozen with its own threshold and labels. */
export type LeagueFinalStandings = LeagueStandingsBase & {
  source: 'final';
  standings_version: number;
  latest_standings_version: number;
  generated_at: string;
  cause: LeagueStandingsCause;
};

export type LeagueStandingsResult = LeagueLiveStandings | LeagueFinalStandings;

/** Safe publication facts of the confirmation that caused a late revision (no actor, no ids). */
export type LeagueStandingsVersionConfirmation = {
  source: 'MANUAL' | 'AUTO_48H';
  confirmed_at: string;
  played_at: string;
};

export type LeagueStandingsVersionSummary = {
  standings_version: number;
  cause: LeagueStandingsCause;
  basis: 'published' | 'reconstructed';
  generated_at: string;
  effective_end_at: string;
  minimum_matches_for_final_award: number;
  entry_count: number;
  confirmation: LeagueStandingsVersionConfirmation | null;
};

export type LeagueStandingsVersionsResult = {
  league_id: string;
  status: LeagueStatus;
  /** Newest first. */
  versions: LeagueStandingsVersionSummary[];
  /** Pass as `before_version` to continue; null when the history is complete. */
  next_before_version: number | null;
};

/** Allowlisted audit facts only (versions, instants, counts); never raw ids or display copy. */
export type LeagueStandingsAuditDetailValue = string | number | null;

export type LeagueStandingsAuditEvent = {
  action: 'closed' | 'standings_revised';
  actor_id: string | null;
  system_reason: string | null;
  occurred_at: string;
  details: Record<string, LeagueStandingsAuditDetailValue>;
};

export type LeagueStandingsAuditResult = {
  league_id: string;
  /** Newest first (owner/Admin only). */
  events: LeagueStandingsAuditEvent[];
};
