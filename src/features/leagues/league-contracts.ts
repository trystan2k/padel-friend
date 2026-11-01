import type { CommunityTimezone } from '../community/community-settings';

export const LEAGUE_END_MODES = ['fixed_date', 'manual'] as const;
export type LeagueEndMode = (typeof LEAGUE_END_MODES)[number];
export const LEAGUE_STATUSES = ['upcoming', 'active', 'closed'] as const;
export type LeagueStatus = (typeof LEAGUE_STATUSES)[number];
export const LEAGUE_BLOCKED_REASONS = [
  'active_league_exists',
  'explicit_activation_required'
] as const;
export type LeagueBlockedReason = (typeof LEAGUE_BLOCKED_REASONS)[number];
export const LEAGUE_CLOSED_REASONS = [
  'manual',
  'fixed_end_reached',
  'expired_before_activation'
] as const;
export type LeagueClosedReason = (typeof LEAGUE_CLOSED_REASONS)[number];

export const LEAGUE_NAME_MAX = 80;
export const LEAGUE_DESCRIPTION_MAX = 500;
export const LEAGUE_MINIMUM_MATCHES_MIN = 1;
export const LEAGUE_MINIMUM_MATCHES_MAX = 100;
export const LEAGUE_DEFAULT_MINIMUM_MATCHES = 1;

export type LeagueDto = {
  id: string;
  community_id: string;
  name: string;
  description: string | null;
  owner_id: string;
  owner_name: string | null;
  timezone: CommunityTimezone;
  start_at: string;
  end_mode: LeagueEndMode;
  end_at: string | null;
  /** Local calendar dates in the League timezone (`YYYY-MM-DD`). */
  start_date: string;
  end_date: string | null;
  status: LeagueStatus;
  blocked_reason: LeagueBlockedReason | null;
  /** Upcoming and its start instant has passed (the scheduler has not, or could not, activate it). */
  activation_due: boolean;
  minimum_matches_for_final_award: number;
  activated_at: string | null;
  closed_at: string | null;
  closed_reason: LeagueClosedReason | null;
  created_at: string;
  version: number;
  can_manage: boolean;
  /** Period (start/end mode/end) can no longer change: closed or referenced by a published event. */
  period_locked: boolean;
};

export type LeagueCommunityDto = {
  id: string;
  name: string;
  timezone: CommunityTimezone;
  creation_enabled: boolean;
  can_create: boolean;
};

export type LeagueListResult = { community: LeagueCommunityDto; leagues: LeagueDto[] };
export type LeagueDetailResult = { community: LeagueCommunityDto; league: LeagueDto };

export type CreateLeagueInput = {
  request_id: string;
  community_id: string;
  name: string;
  description: string | null;
  end_mode: LeagueEndMode;
  start_date: string;
  end_date: string | null;
  minimum_matches: number;
};

export type UpdateLeagueChanges = {
  name?: string;
  description?: string | null;
  minimum_matches_for_final_award?: number;
  end_mode?: LeagueEndMode;
  start_date?: string;
  end_date?: string | null;
};

export type LeagueCommunityEntry = { id: string; name: string };

export type LeagueErrorCode =
  | 'UNAUTHENTICATED'
  | 'LEAGUE_FORBIDDEN'
  | 'LEAGUE_CREATION_DISABLED'
  | 'PROVISIONAL_PLAYER_RESTRICTED'
  | 'LEAGUE_NOT_FOUND'
  | 'LEAGUE_NAME_INVALID'
  | 'LEAGUE_DESCRIPTION_INVALID'
  | 'LEAGUE_MINIMUM_INVALID'
  | 'LEAGUE_END_MODE_INVALID'
  | 'LEAGUE_START_DATE_INVALID'
  | 'LEAGUE_START_IN_PAST'
  | 'LEAGUE_END_DATE_REQUIRED'
  | 'LEAGUE_END_DATE_NOT_ALLOWED'
  | 'LEAGUE_END_NOT_AFTER_START'
  | 'LEAGUE_END_IN_PAST'
  | 'LEAGUE_CHANGES_INVALID'
  | 'LEAGUE_INVALID_INPUT'
  | 'LEAGUE_INVALID_STATE'
  | 'LEAGUE_NOT_DUE'
  | 'LEAGUE_ACTIVE_EXISTS'
  | 'LEAGUE_CLOSE_NOT_MANUAL'
  | 'LEAGUE_PERIOD_LOCKED'
  | 'LEAGUE_START_LOCKED'
  | 'LEAGUE_VERSION_CONFLICT'
  | 'LEAGUE_REQUEST_CONFLICT'
  | 'LEAGUE_UNAVAILABLE'
  | 'INVALID_LEAGUE_INPUT'
  | 'INVALID_LEAGUE_RESPONSE';
