/**
 * Lifecycle of a history entry, separate from the match type. Only played and incomplete entries
 * are confirmed sporting results; pending, disputed, awaiting_result, canceled and
 * reserve_not_playing are never presented as played and carry no score or rating.
 */
export const HISTORY_STATUSES = [
  'played',
  'incomplete',
  'disputed',
  'pending',
  'awaiting_result',
  'canceled',
  'reserve_not_playing'
] as const;
export type HistoryStatus = (typeof HISTORY_STATUSES)[number];

export type HistorySide = 'team_a' | 'team_b';
export type HistoryOutcome = 'win' | 'loss' | 'draw';

export type HistorySetRow = {
  position: number;
  team_a_games: number;
  team_b_games: number;
  completed: boolean;
};

export type HistoryItem = {
  /** Stable keyset identity: g:<proposal id> or e:<event id>:<group number, 0 = event level>. */
  key: string;
  kind: 'group' | 'event';
  event_id: string;
  group_number: number | null;
  /** Proposal id = logical Game Group id; null for event-level and awaiting entries. */
  game_group_id: string | null;
  status: HistoryStatus;
  match_type: 'competitive' | 'friendly';
  community_id: string;
  community_name: string;
  league_id: string | null;
  league_name: string | null;
  venue_name: string;
  timezone: string;
  /** Played instant for confirmed groups; scheduled start for lifecycle entries. */
  sort_at: string;
  played_at: string | null;
  viewer_side: HistorySide | null;
  opponents?: (string | null)[];
  outcome: HistoryOutcome | null;
  classification: 'team_a' | 'team_b' | 'draw' | 'incomplete' | null;
  sets: HistorySetRow[] | null;
  sets_a: number | null;
  sets_b: number | null;
  games_a: number | null;
  games_b: number | null;
  rating_delta: number | null;
};

export type HistoryCursor = { at: string; key: string };

export type HistoryPage = {
  items: HistoryItem[];
  next_cursor: HistoryCursor | null;
  statistics_revision: number;
  limit: number;
};

/** What the browser receives: the cursor is opaque and carries the pinned revision. */
export type HistoryView = Omit<HistoryPage, 'next_cursor'> & { next_cursor: string | null };

export type DetailRatingState = 'applied' | 'not_applied' | 'unavailable';
export type DetailRatingReason = 'friendly' | 'incomplete' | 'not_rated' | 'missing_evidence';

export type DetailPlayerRating = {
  state: DetailRatingState;
  reason: DetailRatingReason | null;
  before_level: number | null;
  after_level: number | null;
  delta: number | null;
  before_reliability: number | null;
  after_reliability: number | null;
  expected_score: number | null;
};

export type DetailPlayer = {
  user_id: string;
  display_name: string | null;
  is_provisional: boolean;
  rating: DetailPlayerRating;
};

export type DetailActor = { user_id: string; display_name: string | null };

export type DetailTimelineEntry = {
  kind: 'submitted' | 'corrected' | 'approved' | 'confirmed';
  version: number;
  occurred_at: string;
  actor: DetailActor | null;
  source: 'MANUAL' | 'AUTO_48H' | null;
};

/** Confirmed detail must use pre-match evidence from its committed projection revision. */
export type GroupDetail = {
  event_id: string;
  game_group_id: string;
  group_number: number;
  statistics_revision: number;
  community: { id: string; name: string };
  venue_name: string;
  court_label: string | null;
  timezone: string;
  starts_at: string;
  played_at: string;
  played_at_local: string;
  played_at_offset_seconds: number;
  match_type: 'competitive' | 'friendly';
  league: { id: string; name: string; eligible: boolean } | null;
  result: {
    classification: 'team_a' | 'team_b' | 'draw' | 'incomplete';
    winner: 'team_a' | 'team_b' | 'draw' | null;
    sets: HistorySetRow[];
    sets_a: number;
    sets_b: number;
    games_a: number;
    games_b: number;
  };
  teams: { team_a: DetailPlayer[]; team_b: DetailPlayer[] };
  rating_state: 'applied' | 'friendly' | 'incomplete' | 'unavailable';
  matchup: {
    team_a_strength: number | null;
    team_b_strength: number | null;
    team_a_expected: number | null;
    team_b_expected: number | null;
    upset: boolean | null;
    reason: 'friendly' | 'incomplete' | 'missing_evidence' | null;
  };
  confirmation: {
    source: 'MANUAL' | 'AUTO_48H';
    automatic: boolean;
    confirmed_at: string;
    effective_at: string;
    approver: DetailActor | null;
  };
  submitter: { user_id: string; display_name: string | null; submitted_at: string };
  correction: { corrected: boolean; version: number };
  timeline: DetailTimelineEntry[];
};

export type StatisticsErrorCode =
  | 'INVALID_STATISTICS_INPUT'
  | 'INVALID_STATISTICS_RESPONSE'
  | 'STATISTICS_UNAUTHENTICATED'
  | 'STATISTICS_NOT_FOUND'
  | 'STATISTICS_STALE_REVISION'
  | 'STATISTICS_UNAVAILABLE';

export type StatisticsResponse<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: StatisticsErrorCode };

const DATABASE_TOKENS: Record<string, StatisticsErrorCode> = {
  STATISTICS_UNAUTHENTICATED: 'STATISTICS_UNAUTHENTICATED',
  UNAUTHENTICATED: 'STATISTICS_UNAUTHENTICATED',
  STATISTICS_NOT_FOUND: 'STATISTICS_NOT_FOUND',
  STATISTICS_STALE_REVISION: 'STATISTICS_STALE_REVISION',
  STATISTICS_REVISION_STALE: 'STATISTICS_STALE_REVISION',
  STATISTICS_INVALID_INPUT: 'INVALID_STATISTICS_INPUT'
};

/** Database failures map to stable codes; auth/permission failures are never an empty result. */
export function statisticsErrorCode(error: {
  message?: string;
  code?: string;
}): StatisticsErrorCode {
  const token = Object.keys(DATABASE_TOKENS).find((name) => error.message?.includes(name));
  if (token) return DATABASE_TOKENS[token] ?? 'STATISTICS_UNAVAILABLE';
  return error.code === '28000' ? 'STATISTICS_UNAUTHENTICATED' : 'STATISTICS_UNAVAILABLE';
}
