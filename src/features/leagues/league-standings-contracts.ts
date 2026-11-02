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

export type LeagueStandingsResult = {
  league_id: string;
  status: LeagueStatus;
  minimum_matches_for_final_award: number;
  /** Ordered by position, then by user UUID (presentation only inside a shared position). */
  entries: LeagueStandingEntry[];
};
