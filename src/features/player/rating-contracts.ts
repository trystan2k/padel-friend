// Sporting-data DTO contracts for the app-wide rating readers. Decoders rebuild every
// object from a fixed key whitelist and fail closed (null) on any unexpected shape, so a
// future SQL column can never leak into a browser response by accident.

export type RatingSummary = {
  initial_display_level: number;
  display_level: number;
  highest_display_level: number;
  reliability_percent: number;
  confirmed_competitive_game_groups: number;
  last_rating_at: string | null;
  rating_engine: string;
  rating_engine_version: string;
  rating_config_version: number;
};

/** unavailable: no rating row (not onboarded); empty: rated, no confirmed group yet. */
export type RatingSummaryState = 'unavailable' | 'empty' | 'ready';
export type RatingSummaryResult = {
  revision: number;
  state: RatingSummaryState;
  summary: RatingSummary | null;
};

export type RatingTeam = 'team_a' | 'team_b';
export type RatingClassification = 'team_a' | 'team_b' | 'draw';

export type RatingHistoryItem = {
  game_group_id: string;
  match_event_id: string;
  game_group_number: number;
  played_at: string;
  classification: RatingClassification;
  team: RatingTeam;
  outcome_value: number;
  expected_score: number;
  before_display_level: number;
  after_display_level: number;
  applied_delta: number;
  clamped: boolean;
  before_reliability_percent: number;
  after_reliability_percent: number;
  after_confirmed_groups: number;
  calculation_revision: number;
  recalculated: boolean;
};

export type RatingHistoryCursor = { played_at: string; game_group_id: string };
export type RatingHistoryPage = {
  revision: number;
  state: 'empty' | 'ready';
  total_events: number;
  items: RatingHistoryItem[];
  next_cursor: RatingHistoryCursor | null;
};

/** What the browser receives: the keyset position is folded into an opaque cursor string. */
export type RatingHistoryView = Omit<RatingHistoryPage, 'next_cursor'> & {
  next_cursor: string | null;
};

export type RatingProgressPoint = {
  ordinal: number;
  game_group_id: string;
  played_at: string;
  display_level: number;
};
export type RatingProgress = {
  revision: number;
  state: 'unavailable' | 'empty' | 'ready';
  scope: 'lifetime';
  resolution: 'event' | 'sampled';
  abbreviated: boolean;
  total_events: number;
  baseline: { display_level: number } | null;
  range: { from: string; to: string } | null;
  points: RatingProgressPoint[];
};

export type RatingExplanationPlayer = {
  user_id: string;
  display_name: string;
  is_provisional: boolean;
  team: RatingTeam;
  calculation_revision: number;
  recalculated: boolean;
  engine: string;
  engine_version: string;
  config_version: number;
  before_display_level: number;
  after_display_level: number;
  before_reliability_percent: number;
  after_reliability_percent: number;
  before_confirmed_groups: number;
  after_confirmed_groups: number;
  own_team_strength: number;
  opponent_team_strength: number;
  expected_score: number;
  outcome_value: number;
  reliability_factor: number;
  raw_delta: number;
  rounded_delta: number;
  applied_delta: number;
  clamped: boolean;
};
export type RatingGroupExplanation = {
  revision: number;
  game_group_id: string;
  match_event_id: string;
  game_group_number: number;
  played_at: string;
  players: RatingExplanationPlayer[];
};

export type RatingChangePlayer = {
  user_id: string;
  display_name: string;
  is_provisional: boolean;
  team: RatingTeam;
  before_display_level: number;
  after_display_level: number;
  before_reliability_percent: number;
  after_reliability_percent: number;
  applied_delta: number;
  clamped: boolean;
};
export type RatingChangeGroup = {
  game_group_id: string;
  game_group_number: number;
  played_at: string;
  players: RatingChangePlayer[];
};
export type MatchEventRatingChanges = {
  revision: number;
  match_event_id: string;
  groups: RatingChangeGroup[];
};

export type RatingErrorCode =
  | 'unauthenticated'
  | 'forbidden'
  | 'stale_revision'
  | 'invalid_request'
  | 'unavailable';

/** Handlers return data or an explicit error; an auth failure is never an empty result. */
export type RatingResponse<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: RatingErrorCode };

type Rec = Record<string, unknown>;

function isRec(value: unknown): value is Rec {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function rec(value: unknown): Rec | null {
  return isRec(value) ? value : null;
}
/** True when no decoded field is null, i.e. the object satisfies the full contract. */
function isComplete<T extends object>(value: { [K in keyof T]: T[K] | null }): value is T {
  return Object.values(value).every((field) => field !== null);
}
function num(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function int(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}
function str(value: unknown, max = 200): string | null {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : null;
}
function bool(value: unknown): boolean | null {
  return typeof value === 'boolean' ? value : null;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value);
}
export function isInstant(value: unknown): value is string {
  return typeof value === 'string' && INSTANT.test(value) && !Number.isNaN(Date.parse(value));
}
function uuid(value: unknown): string | null {
  return isUuid(value) ? value : null;
}
function instant(value: unknown): string | null {
  return isInstant(value) ? value : null;
}
function team(value: unknown): RatingTeam | null {
  return value === 'team_a' || value === 'team_b' ? value : null;
}
function classificationOf(value: unknown): RatingClassification | null {
  return value === 'team_a' || value === 'team_b' || value === 'draw' ? value : null;
}
function all<T>(values: (T | null)[]): T[] | null {
  const result: T[] = [];
  for (const value of values) {
    if (value === null) return null;
    result.push(value);
  }
  return result;
}
function list<T>(value: unknown, decode: (item: unknown) => T | null): T[] | null {
  return Array.isArray(value) ? all(value.map(decode)) : null;
}

export function parseRatingSummaryResult(value: unknown): RatingSummaryResult | null {
  const input = rec(value);
  const revision = int(input?.['revision']);
  const state = input?.['state'];
  if (!input || revision === null) return null;
  if (state !== 'unavailable' && state !== 'empty' && state !== 'ready') return null;
  if (input['summary'] === null) {
    return state === 'unavailable' ? { revision, state, summary: null } : null;
  }
  const summary = rec(input['summary']);
  const lastRatingAt =
    summary?.['last_rating_at'] === null ? null : instant(summary?.['last_rating_at']);
  const decoded = {
    initial_display_level: num(summary?.['initial_display_level']),
    display_level: num(summary?.['display_level']),
    highest_display_level: num(summary?.['highest_display_level']),
    reliability_percent: int(summary?.['reliability_percent']),
    confirmed_competitive_game_groups: int(summary?.['confirmed_competitive_game_groups']),
    rating_engine: str(summary?.['rating_engine'], 64),
    rating_engine_version: str(summary?.['rating_engine_version'], 32),
    rating_config_version: int(summary?.['rating_config_version'])
  };
  if (
    state === 'unavailable' ||
    !isComplete<Omit<RatingSummary, 'last_rating_at'>>(decoded) ||
    (summary?.['last_rating_at'] !== null && lastRatingAt === null)
  )
    return null;
  return { revision, state, summary: { ...decoded, last_rating_at: lastRatingAt } };
}

function historyItem(value: unknown): RatingHistoryItem | null {
  const item = rec(value);
  if (!item) return null;
  const decoded = {
    game_group_id: uuid(item['game_group_id']),
    match_event_id: uuid(item['match_event_id']),
    game_group_number: int(item['game_group_number']),
    played_at: instant(item['played_at']),
    classification: classificationOf(item['classification']),
    team: team(item['team']),
    outcome_value: num(item['outcome_value']),
    expected_score: num(item['expected_score']),
    before_display_level: num(item['before_display_level']),
    after_display_level: num(item['after_display_level']),
    applied_delta: num(item['applied_delta']),
    clamped: bool(item['clamped']),
    before_reliability_percent: int(item['before_reliability_percent']),
    after_reliability_percent: int(item['after_reliability_percent']),
    after_confirmed_groups: int(item['after_confirmed_groups']),
    calculation_revision: int(item['calculation_revision']),
    recalculated: bool(item['recalculated'])
  };
  return isComplete<RatingHistoryItem>(decoded) ? decoded : null;
}

export function parseRatingHistoryPage(value: unknown): RatingHistoryPage | null {
  const input = rec(value);
  const revision = int(input?.['revision']);
  const total = int(input?.['total_events']);
  const items = list(input?.['items'], historyItem);
  const state = input?.['state'];
  if (!input || revision === null || total === null || !items) return null;
  if (state !== 'empty' && state !== 'ready') return null;
  let nextCursor: RatingHistoryCursor | null = null;
  if (input['next_cursor'] !== null) {
    const cursor = rec(input['next_cursor']);
    const playedAt = instant(cursor?.['played_at']);
    const groupId = uuid(cursor?.['game_group_id']);
    if (!playedAt || !groupId) return null;
    nextCursor = { played_at: playedAt, game_group_id: groupId };
  }
  return { revision, state, total_events: total, items, next_cursor: nextCursor };
}

function progressPoint(value: unknown): RatingProgressPoint | null {
  const point = rec(value);
  const decoded = {
    ordinal: int(point?.['ordinal']),
    game_group_id: uuid(point?.['game_group_id']),
    played_at: instant(point?.['played_at']),
    display_level: num(point?.['display_level'])
  };
  return isComplete<RatingProgressPoint>(decoded) ? decoded : null;
}

export function parseRatingProgress(value: unknown): RatingProgress | null {
  const input = rec(value);
  const revision = int(input?.['revision']);
  const total = int(input?.['total_events']);
  const points = list(input?.['points'], progressPoint);
  const state = input?.['state'];
  const resolution = input?.['resolution'];
  const abbreviated = bool(input?.['abbreviated']);
  if (!input || revision === null || total === null || !points || abbreviated === null) return null;
  if (state !== 'unavailable' && state !== 'empty' && state !== 'ready') return null;
  if (resolution !== 'event' && resolution !== 'sampled') return null;
  if (input['scope'] !== 'lifetime') return null;
  let baseline: RatingProgress['baseline'] = null;
  if (input['baseline'] !== null) {
    const level = num(rec(input['baseline'])?.['display_level']);
    if (level === null) return null;
    baseline = { display_level: level };
  }
  let range: RatingProgress['range'] = null;
  if (input['range'] !== null) {
    const from = instant(rec(input['range'])?.['from']);
    const to = instant(rec(input['range'])?.['to']);
    if (!from || !to) return null;
    range = { from, to };
  }
  return {
    revision,
    state,
    scope: 'lifetime',
    resolution,
    abbreviated,
    total_events: total,
    baseline,
    range,
    points
  };
}

function explanationPlayer(value: unknown): RatingExplanationPlayer | null {
  const player = rec(value);
  const decoded = {
    user_id: uuid(player?.['user_id']),
    display_name: str(player?.['display_name'], 80),
    is_provisional: bool(player?.['is_provisional']),
    team: team(player?.['team']),
    calculation_revision: int(player?.['calculation_revision']),
    recalculated: bool(player?.['recalculated']),
    engine: str(player?.['engine'], 64),
    engine_version: str(player?.['engine_version'], 32),
    config_version: int(player?.['config_version']),
    before_display_level: num(player?.['before_display_level']),
    after_display_level: num(player?.['after_display_level']),
    before_reliability_percent: int(player?.['before_reliability_percent']),
    after_reliability_percent: int(player?.['after_reliability_percent']),
    before_confirmed_groups: int(player?.['before_confirmed_groups']),
    after_confirmed_groups: int(player?.['after_confirmed_groups']),
    own_team_strength: num(player?.['own_team_strength']),
    opponent_team_strength: num(player?.['opponent_team_strength']),
    expected_score: num(player?.['expected_score']),
    outcome_value: num(player?.['outcome_value']),
    reliability_factor: num(player?.['reliability_factor']),
    raw_delta: num(player?.['raw_delta']),
    rounded_delta: num(player?.['rounded_delta']),
    applied_delta: num(player?.['applied_delta']),
    clamped: bool(player?.['clamped'])
  };
  return isComplete<RatingExplanationPlayer>(decoded) ? decoded : null;
}

export function parseRatingGroupExplanation(value: unknown): RatingGroupExplanation | null {
  const input = rec(value);
  const revision = int(input?.['revision']);
  const groupId = uuid(input?.['game_group_id']);
  const eventId = uuid(input?.['match_event_id']);
  const groupNumber = int(input?.['game_group_number']);
  const playedAt = instant(input?.['played_at']);
  const players = list(input?.['players'], explanationPlayer);
  if (
    revision === null ||
    !groupId ||
    !eventId ||
    groupNumber === null ||
    !playedAt ||
    !players ||
    players.length !== 4
  )
    return null;
  return {
    revision,
    game_group_id: groupId,
    match_event_id: eventId,
    game_group_number: groupNumber,
    played_at: playedAt,
    players
  };
}

function changePlayer(value: unknown): RatingChangePlayer | null {
  const player = rec(value);
  const decoded = {
    user_id: uuid(player?.['user_id']),
    display_name: str(player?.['display_name'], 80),
    is_provisional: bool(player?.['is_provisional']),
    team: team(player?.['team']),
    before_display_level: num(player?.['before_display_level']),
    after_display_level: num(player?.['after_display_level']),
    before_reliability_percent: int(player?.['before_reliability_percent']),
    after_reliability_percent: int(player?.['after_reliability_percent']),
    applied_delta: num(player?.['applied_delta']),
    clamped: bool(player?.['clamped'])
  };
  return isComplete<RatingChangePlayer>(decoded) ? decoded : null;
}

function changeGroup(value: unknown): RatingChangeGroup | null {
  const group = rec(value);
  const groupId = uuid(group?.['game_group_id']);
  const groupNumber = int(group?.['game_group_number']);
  const playedAt = instant(group?.['played_at']);
  const players = list(group?.['players'], changePlayer);
  if (!groupId || groupNumber === null || !playedAt || players?.length !== 4) return null;
  return { game_group_id: groupId, game_group_number: groupNumber, played_at: playedAt, players };
}

export function parseMatchEventRatingChanges(value: unknown): MatchEventRatingChanges | null {
  const input = rec(value);
  const revision = int(input?.['revision']);
  const eventId = uuid(input?.['match_event_id']);
  const groups = list(input?.['groups'], changeGroup);
  if (revision === null || !eventId || !groups) return null;
  return { revision, match_event_id: eventId, groups };
}

/** Maps a PostgREST/Postgres failure to a stable code; the database message never travels. */
export function ratingErrorCode(error: { message?: string; code?: string }): RatingErrorCode {
  switch (error.message) {
    case 'RATING_UNAUTHENTICATED':
      return 'unauthenticated';
    case 'RATING_EXPLANATION_FORBIDDEN':
    case 'PROVISIONAL_PLAYER_RESTRICTED':
      return 'forbidden';
    case 'RATING_REVISION_STALE':
      return 'stale_revision';
    case 'RATING_HISTORY_INVALID_ARGUMENT':
    case 'RATING_PROGRESS_INVALID_ARGUMENT':
    case 'RATING_EXPLANATION_INVALID_ARGUMENT':
      return 'invalid_request';
    default:
      return 'unavailable';
  }
}
