import type { MatchCallerBadge } from '../matches/match-contracts';

/** Independent section outcome: a failed read is never reported as empty or zero. */
export type HomeSection<T> =
  | { status: 'ok'; value: T }
  | { status: 'empty' }
  | { status: 'unavailable' }
  | { status: 'error' };

export type HomeCommunity = { id: string; name: string };

/** `unavailable` is a requested community the caller cannot use; its name is never exposed. */
export type HomeSelection = {
  selectedId: string | null;
  requestedUnavailable: boolean;
};

export type HomeMatchCard = {
  event_id: string;
  venue_name: string;
  starts_at: string;
  timezone: string;
  community_name: string;
  caller_badge: MatchCallerBadge | null;
  playing_count: number;
  more_needed: number;
  competition_status: 'ranked' | 'unranked' | null;
};

export type HomeMatches = { next: HomeMatchCard | null; available: HomeMatchCard[] };

export type HomeActionKind =
  | 'result_review'
  | 'reconfirmation'
  | 'organizer_requests'
  | 'reserve_standby';

export type HomeAction = {
  kind: HomeActionKind;
  event_id: string;
  venue_name: string;
  starts_at: string;
  timezone: string;
  /** Pending request count, only for organizer_requests. */
  count: number | null;
};

/** `partial` means a source read failed, so the list may be incomplete. */
export type HomeActions = { items: HomeAction[]; partial: boolean };

export type HomeRankMovement =
  | { state: 'up' | 'down'; places: number }
  | { state: 'same' }
  | { state: 'new' };

export type HomeSkillRank = {
  status: 'ranked' | 'unrated' | 'not_member';
  position: number | null;
  rankedMembers: number | null;
  movement: HomeRankMovement | null;
};

export type HomeLeagueRow = {
  user_id: string;
  display_name: string | null;
  position: number;
  wins: number;
  losses: number;
  isSelf: boolean;
};

export type HomeLeagueRank = {
  league_id: string;
  name: string;
  /** Number of active Leagues in the community; the shown one is the deterministic first. */
  activeCount: number;
  /** False when the League list was truncated, so more active Leagues may exist. */
  activeCountExact: boolean;
  top: HomeLeagueRow[];
  self: HomeLeagueRow | null;
  movement: HomeRankMovement | null;
};

/** Skill rank and League are independent reads: one failing never hides or fakes the other. */
export type HomeRanking = {
  skill: HomeSection<HomeSkillRank>;
  league: HomeSection<HomeLeagueRank>;
};

export type HomeActivity =
  | {
      kind: 'rating';
      at: string;
      scope: 'global';
      event_id: string;
      delta: number;
      level: number;
      reliability: number;
    }
  | {
      kind: 'adjustment';
      at: string;
      scope: 'global';
      level: number;
      reliability: number;
    }
  | {
      kind: 'rank';
      at: string;
      scope: 'community';
      position: number;
      previous: number | null;
    };

export type HomeData = {
  /** Server instant every time-relative section was computed against. */
  asOf: string;
  communities: HomeSection<HomeCommunity[]>;
  selection: HomeSelection;
  matches: HomeSection<HomeMatches>;
  actions: HomeSection<HomeActions>;
  ranking: HomeSection<HomeRanking>;
  activity: HomeSection<HomeActivity[]>;
  /** Account-wide unread count, null when unknown. */
  unread: number | null;
};
