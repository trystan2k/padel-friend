import { DEFAULT_STATISTICS_THRESHOLDS } from './statistics-config';
import {
  HISTORY_STATUSES,
  type DetailActor,
  type DetailPlayer,
  type DetailPlayerRating,
  type DetailTimelineEntry,
  type GroupDetail,
  type HistoryItem,
  type HistoryPage,
  type HistorySetRow
} from './statistics-history-contracts';
import {
  STATISTICS_EXTREMA_KEYS,
  STATISTICS_MATCH_TYPES,
  STATISTICS_SCOPE_KINDS,
  STATISTICS_SUBJECT_KINDS,
  type ExtremumCandidate,
  type JsonCounts,
  type RecentOutcome,
  type SequenceRun,
  type SequenceState,
  type StatisticsAggregate,
  type StatisticsConfig,
  type StatisticsDailyBucket,
  type StatisticsExtrema,
  type StatisticsOutcome,
  type StatisticsSummaryRow,
  type StatisticsThresholds
} from './statistics-contracts';

type ObjectValue = Record<string, unknown>;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const fail = (): never => {
  throw new Error('INVALID_STATISTICS_RESPONSE');
};
function object(value: unknown): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  return Object.fromEntries(Object.entries(value));
}
function exactObject(value: unknown, keys: readonly string[]): ObjectValue {
  const row = object(value);
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return fail();
  return row;
}
function uuid(value: unknown): string {
  return typeof value === 'string' && UUID.test(value) ? value : fail();
}
function nullableUuid(value: unknown): string | null {
  return value === null ? null : uuid(value);
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}
/** PostgreSQL numerics arrive as numbers (JSON) or decimal strings (wire text). */
function decimal(value: unknown): number {
  const parsed = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  return typeof parsed === 'number' && Number.isFinite(parsed) ? parsed : fail();
}
function instant(value: unknown): string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value)) ? value : fail();
}
function nullableInstant(value: unknown): string | null {
  return value === null ? null : instant(value);
}
function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T {
  return allowed.find((candidate) => candidate === value) ?? fail();
}
function outcome(value: unknown): StatisticsOutcome {
  return oneOf(value, ['W', 'L', 'D'] as const);
}
function run(value: unknown): SequenceRun | null {
  if (value === null) return null;
  const row = exactObject(value, ['k', 'len']);
  return { k: outcome(row.k), len: count(row.len) };
}

export function decodeSequence(value: unknown): SequenceState {
  const row = exactObject(value, ['n', 'prefix', 'suffix', 'best_win', 'best_loss']);
  const n = count(row.n);
  const prefix = run(row.prefix);
  const suffix = run(row.suffix);
  if ((n === 0) !== (prefix === null) || (n === 0) !== (suffix === null)) return fail();
  return { n, prefix, suffix, best_win: count(row.best_win), best_loss: count(row.best_loss) };
}

function recent(value: unknown): RecentOutcome[] {
  if (!Array.isArray(value) || value.length > 10) return fail();
  return value.map((item): RecentOutcome => {
    const row = exactObject(item, ['g', 'o', 'at']);
    return { g: uuid(row.g), o: outcome(row.o), at: instant(row.at) };
  });
}

function extremumCandidate(value: unknown): ExtremumCandidate {
  const row = exactObject(value, ['k', 'v', 'at', 'g']);
  return { k: decimal(row.k), v: decimal(row.v), at: instant(row.at), g: uuid(row.g) };
}
function extrema(value: unknown): StatisticsExtrema {
  const row = object(value);
  const decoded: StatisticsExtrema = {};
  for (const key of Object.keys(row)) {
    const known = STATISTICS_EXTREMA_KEYS.find((name) => name === key);
    if (!known) return fail();
    decoded[known] = extremumCandidate(row[key]);
  }
  return decoded;
}

function counts(value: unknown): JsonCounts {
  const row = object(value);
  const decoded: JsonCounts = {};
  for (const [key, item] of Object.entries(row))
    decoded[key] = typeof item === 'number' ? decimal(item) : counts(item);
  return decoded;
}

function aggregate(row: ObjectValue): StatisticsAggregate {
  const result: StatisticsAggregate = {
    confirmed_groups: count(row.confirmed_groups),
    wins: count(row.wins),
    losses: count(row.losses),
    draws: count(row.draws),
    incomplete_groups: count(row.incomplete_groups),
    competitive_groups: count(row.competitive_groups),
    friendly_groups: count(row.friendly_groups),
    sets_won: count(row.sets_won),
    sets_lost: count(row.sets_lost),
    games_won: count(row.games_won),
    games_lost: count(row.games_lost),
    straight_set_wins: count(row.straight_set_wins),
    straight_set_losses: count(row.straight_set_losses),
    three_set_groups: count(row.three_set_groups),
    incomplete_decider_groups: count(row.incomplete_decider_groups),
    deciding_set_wins: count(row.deciding_set_wins),
    deciding_set_losses: count(row.deciding_set_losses),
    first_set_won_groups: count(row.first_set_won_groups),
    first_set_won_converted: count(row.first_set_won_converted),
    first_set_lost_groups: count(row.first_set_lost_groups),
    first_set_lost_converted: count(row.first_set_lost_converted),
    rated_groups: count(row.rated_groups),
    rating_delta_sum: decimal(row.rating_delta_sum),
    opponent_strength_sum: decimal(row.opponent_strength_sum),
    opponent_strength_groups: count(row.opponent_strength_groups),
    upset_wins: count(row.upset_wins),
    first_played_at: nullableInstant(row.first_played_at),
    first_game_group_id: nullableUuid(row.first_game_group_id),
    last_played_at: nullableInstant(row.last_played_at),
    last_game_group_id: nullableUuid(row.last_game_group_id),
    sequence: decodeSequence(row.sequence),
    recent: recent(row.recent),
    extrema: extrema(row.extrema),
    relations: counts(row.relations),
    activity: counts(row.activity)
  };
  if (
    result.confirmed_groups !==
      result.wins + result.losses + result.draws + result.incomplete_groups ||
    result.confirmed_groups !== result.competitive_groups + result.friendly_groups
  )
    return fail();
  return result;
}

function keyOf(row: ObjectValue) {
  return {
    subject_kind: oneOf(row.subject_kind, STATISTICS_SUBJECT_KINDS),
    subject_a: uuid(row.subject_a),
    subject_b: uuid(row.subject_b),
    scope_kind: oneOf(row.scope_kind, STATISTICS_SCOPE_KINDS),
    scope_id: uuid(row.scope_id),
    match_type: oneOf(row.match_type, STATISTICS_MATCH_TYPES),
    subject_players: Array.isArray(row.subject_players) ? row.subject_players.map(uuid) : fail()
  };
}

/** A lifetime summary row as stored (no played_day). */
export function decodeSummaryRow(value: unknown): StatisticsSummaryRow {
  const row = object(value);
  return { ...keyOf(row), ...aggregate(row) };
}

/** A daily bucket row as stored: a summary row plus its UTC played day. */
export function decodeDailyBucket(value: unknown): StatisticsDailyBucket {
  const row = object(value);
  const day = typeof row.played_day === 'string' ? row.played_day.slice(0, 10) : fail();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return fail();
  return { ...keyOf(row), ...aggregate(row), played_day: day };
}

const THRESHOLD_KEYS = Object.keys(DEFAULT_STATISTICS_THRESHOLDS);

function thresholds(value: unknown): StatisticsThresholds {
  const row = exactObject(value, THRESHOLD_KEYS);
  const positive = (item: unknown) => {
    const parsed = count(item);
    return parsed >= 1 ? parsed : fail();
  };
  const upset = decimal(row.upset_expected_score_max);
  if (upset <= 0 || upset >= 1) return fail();
  return {
    basic_min_denominator: positive(row.basic_min_denominator),
    best_opponent_min_meetings: positive(row.best_opponent_min_meetings),
    best_partnership_min_matches: positive(row.best_partnership_min_matches),
    closest_rivalry_min_meetings: positive(row.closest_rivalry_min_meetings),
    community_leader_min_matches: positive(row.community_leader_min_matches),
    extremum_min_facts: positive(row.extremum_min_facts),
    form_min_resolved: positive(row.form_min_resolved),
    lowest_established_min_states: positive(row.lowest_established_min_states),
    rank_min_states: positive(row.rank_min_states),
    rate_min_opportunities: positive(row.rate_min_opportunities),
    upset_expected_score_max: upset
  };
}

/** get_statistics_config payload: applied thresholds plus the revisions a reader must pin. */
export function decodeStatisticsConfig(value: unknown): StatisticsConfig {
  const row = exactObject(value, [
    'config_version',
    'thresholds',
    'statistics_revision',
    'rating_revision',
    'rating_aligned'
  ]);
  return {
    config_version: count(row.config_version),
    thresholds: thresholds(row.thresholds),
    statistics_revision: count(row.statistics_revision),
    rating_revision: count(row.rating_revision),
    rating_aligned: boolean(row.rating_aligned)
  };
}

function text(value: unknown): string {
  return typeof value === 'string' && value ? value : fail();
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function nullableCount(value: unknown): number | null {
  return value === null ? null : count(value);
}
function nullableDecimal(value: unknown): number | null {
  return value === null ? null : decimal(value);
}
function positiveCount(value: unknown): number {
  const parsed = count(value);
  return parsed >= 1 ? parsed : fail();
}
const SIDES = ['team_a', 'team_b'] as const;
const MATCH_TYPES = ['competitive', 'friendly'] as const;

function setRows(value: unknown): HistorySetRow[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 3) return fail();
  return value.map((item) => {
    const row = exactObject(item, ['position', 'team_a_games', 'team_b_games', 'completed']);
    return {
      position: count(row.position),
      team_a_games: count(row.team_a_games),
      team_b_games: count(row.team_b_games),
      completed: boolean(row.completed)
    };
  });
}

const ITEM_KEYS = [
  'key',
  'kind',
  'event_id',
  'group_number',
  'game_group_id',
  'status',
  'match_type',
  'community_id',
  'community_name',
  'league_id',
  'league_name',
  'venue_name',
  'timezone',
  'sort_at',
  'played_at',
  'viewer_side',
  'outcome',
  'classification',
  'sets',
  'sets_a',
  'sets_b',
  'games_a',
  'games_b',
  'rating_delta'
] as const;

function historyItem(value: unknown): HistoryItem {
  const raw = object(value);
  const row = exactObject(
    value,
    Object.hasOwn(raw, 'opponents') ? [...ITEM_KEYS, 'opponents'] : ITEM_KEYS
  );
  const opponents =
    row.opponents === undefined
      ? []
      : Array.isArray(row.opponents)
        ? row.opponents.map(nullableText)
        : fail();
  const status = oneOf(row.status, HISTORY_STATUSES);
  const item: HistoryItem = {
    key: text(row.key),
    kind: oneOf(row.kind, ['group', 'event'] as const),
    event_id: uuid(row.event_id),
    group_number: nullableCount(row.group_number),
    game_group_id: nullableUuid(row.game_group_id),
    status,
    match_type: oneOf(row.match_type, MATCH_TYPES),
    community_id: uuid(row.community_id),
    community_name: text(row.community_name),
    league_id: nullableUuid(row.league_id),
    league_name: nullableText(row.league_name),
    venue_name: text(row.venue_name),
    timezone: text(row.timezone),
    sort_at: instant(row.sort_at),
    played_at: nullableInstant(row.played_at),
    viewer_side: row.viewer_side === null ? null : oneOf(row.viewer_side, SIDES),
    opponents,
    outcome: row.outcome === null ? null : oneOf(row.outcome, ['win', 'loss', 'draw'] as const),
    classification:
      row.classification === null
        ? null
        : oneOf(row.classification, ['team_a', 'team_b', 'draw', 'incomplete'] as const),
    sets: row.sets === null ? null : setRows(row.sets),
    sets_a: nullableCount(row.sets_a),
    sets_b: nullableCount(row.sets_b),
    games_a: nullableCount(row.games_a),
    games_b: nullableCount(row.games_b),
    rating_delta: nullableDecimal(row.rating_delta)
  };
  // Status decides which facts may exist: unresolved entries never carry a score or a rating.
  const confirmed = status === 'played' || status === 'incomplete';
  const proposal = confirmed || status === 'pending' || status === 'disputed';
  const identity =
    item.game_group_id === null
      ? 'e:' + item.event_id + ':' + String(item.group_number ?? 0)
      : 'g:' + item.game_group_id;
  const scored = [
    item.sets,
    item.classification,
    item.sets_a,
    item.sets_b,
    item.games_a,
    item.games_b
  ];
  const invalid =
    item.key !== identity ||
    proposal !== (item.game_group_id !== null) ||
    proposal !== (item.played_at !== null) ||
    proposal !== (item.viewer_side !== null) ||
    (status === 'awaiting_result') !== (item.kind === 'event' && item.group_number !== null) ||
    ((status === 'canceled' || status === 'reserve_not_playing') && item.group_number !== null) ||
    scored.some((fact) => (fact !== null) !== confirmed) ||
    (confirmed && (status === 'incomplete') !== (item.classification === 'incomplete')) ||
    (!confirmed && (item.outcome !== null || item.rating_delta !== null));
  return invalid ? fail() : item;
}

/** list_statistics_history payload: keyed entries, an optional cursor and the pinned revision. */
export function decodeHistoryPage(value: unknown): HistoryPage {
  const row = exactObject(value, ['items', 'next_cursor', 'statistics_revision', 'limit']);
  if (!Array.isArray(row.items)) return fail();
  const items = row.items.map(historyItem);
  if (new Set(items.map((item) => item.key)).size !== items.length) return fail();
  let nextCursor: HistoryPage['next_cursor'] = null;
  if (row.next_cursor !== null) {
    const cursor = exactObject(row.next_cursor, ['at', 'key']);
    nextCursor = { at: instant(cursor.at), key: text(cursor.key) };
  }
  return {
    items,
    next_cursor: nextCursor,
    statistics_revision: count(row.statistics_revision),
    limit: positiveCount(row.limit)
  };
}

function actor(value: unknown): DetailActor | null {
  if (value === null) return null;
  const row = exactObject(value, ['user_id', 'display_name']);
  return { user_id: uuid(row.user_id), display_name: nullableText(row.display_name) };
}

function playerRating(value: unknown): DetailPlayerRating {
  const row = exactObject(value, [
    'state',
    'reason',
    'before_level',
    'after_level',
    'delta',
    'before_reliability',
    'after_reliability',
    'expected_score'
  ]);
  const rating: DetailPlayerRating = {
    state: oneOf(row.state, ['applied', 'not_applied', 'unavailable'] as const),
    reason:
      row.reason === null
        ? null
        : oneOf(row.reason, ['friendly', 'incomplete', 'not_rated', 'missing_evidence'] as const),
    before_level: nullableDecimal(row.before_level),
    after_level: nullableDecimal(row.after_level),
    delta: nullableDecimal(row.delta),
    before_reliability: nullableCount(row.before_reliability),
    after_reliability: nullableCount(row.after_reliability),
    expected_score: nullableDecimal(row.expected_score)
  };
  // Absent evidence is explicit: an applied rating has every figure, anything else has none.
  const figures = [
    rating.before_level,
    rating.after_level,
    rating.delta,
    rating.before_reliability,
    rating.after_reliability,
    rating.expected_score
  ];
  const applied = rating.state === 'applied';
  if (applied !== figures.every((figure) => figure !== null)) return fail();
  if (applied !== (rating.reason === null)) return fail();
  if (!applied && figures.some((figure) => figure !== null)) return fail();
  return rating;
}

function players(value: unknown): DetailPlayer[] {
  if (!Array.isArray(value) || value.length !== 2) return fail();
  return value.map((item) => {
    const row = exactObject(item, ['user_id', 'display_name', 'is_provisional', 'rating']);
    return {
      user_id: uuid(row.user_id),
      display_name: nullableText(row.display_name),
      is_provisional: boolean(row.is_provisional),
      rating: playerRating(row.rating)
    };
  });
}

function timeline(value: unknown): DetailTimelineEntry[] {
  if (!Array.isArray(value)) return fail();
  return value.map((item) => {
    const row = exactObject(item, ['kind', 'version', 'occurred_at', 'actor', 'source']);
    return {
      kind: oneOf(row.kind, ['submitted', 'corrected', 'approved', 'confirmed'] as const),
      version: positiveCount(row.version),
      occurred_at: instant(row.occurred_at),
      actor: actor(row.actor),
      source:
        row.source === null
          ? null
          : oneOf(row.source, ['MANUAL', 'AUTO_48H', 'ADMIN_OVERRIDE'] as const)
    };
  });
}

/** get_statistics_group_detail payload: every PRD §37 fact with explicit absent-rating evidence. */
export function decodeGroupDetail(value: unknown): GroupDetail {
  const row = exactObject(value, [
    'event_id',
    'game_group_id',
    'group_number',
    'statistics_revision',
    'community',
    'venue_name',
    'court_label',
    'timezone',
    'starts_at',
    'played_at',
    'played_at_local',
    'played_at_offset_seconds',
    'match_type',
    'league',
    'result',
    'teams',
    'rating_state',
    'matchup',
    'confirmation',
    'submitter',
    'correction',
    'timeline'
  ]);
  const community = exactObject(row.community, ['id', 'name']);
  const result = exactObject(row.result, [
    'classification',
    'winner',
    'sets',
    'sets_a',
    'sets_b',
    'games_a',
    'games_b'
  ]);
  const teams = exactObject(row.teams, ['team_a', 'team_b']);
  const matchup = exactObject(row.matchup, [
    'team_a_strength',
    'team_b_strength',
    'team_a_expected',
    'team_b_expected',
    'upset',
    'reason'
  ]);
  const confirmation = exactObject(row.confirmation, [
    'source',
    'automatic',
    'confirmed_at',
    'effective_at',
    'approver'
  ]);
  const submitter = exactObject(row.submitter, ['user_id', 'display_name', 'submitted_at']);
  const correction = exactObject(row.correction, ['corrected', 'version']);
  let league: GroupDetail['league'] = null;
  if (row.league !== null) {
    const parsed = exactObject(row.league, ['id', 'name', 'eligible']);
    league = { id: uuid(parsed.id), name: text(parsed.name), eligible: boolean(parsed.eligible) };
  }
  const detail: GroupDetail = {
    event_id: uuid(row.event_id),
    game_group_id: uuid(row.game_group_id),
    group_number: positiveCount(row.group_number),
    statistics_revision: count(row.statistics_revision),
    community: { id: uuid(community.id), name: text(community.name) },
    venue_name: text(row.venue_name),
    court_label: nullableText(row.court_label),
    timezone: text(row.timezone),
    starts_at: instant(row.starts_at),
    played_at: instant(row.played_at),
    played_at_local: text(row.played_at_local),
    played_at_offset_seconds: decimal(row.played_at_offset_seconds),
    match_type: oneOf(row.match_type, MATCH_TYPES),
    league,
    result: {
      classification: oneOf(result.classification, [
        'team_a',
        'team_b',
        'draw',
        'incomplete'
      ] as const),
      winner:
        result.winner === null ? null : oneOf(result.winner, ['team_a', 'team_b', 'draw'] as const),
      sets: setRows(result.sets),
      sets_a: count(result.sets_a),
      sets_b: count(result.sets_b),
      games_a: count(result.games_a),
      games_b: count(result.games_b)
    },
    teams: { team_a: players(teams.team_a), team_b: players(teams.team_b) },
    rating_state: oneOf(row.rating_state, [
      'applied',
      'friendly',
      'incomplete',
      'unavailable'
    ] as const),
    matchup: {
      team_a_strength: nullableDecimal(matchup.team_a_strength),
      team_b_strength: nullableDecimal(matchup.team_b_strength),
      team_a_expected: nullableDecimal(matchup.team_a_expected),
      team_b_expected: nullableDecimal(matchup.team_b_expected),
      upset: matchup.upset === null ? null : boolean(matchup.upset),
      reason:
        matchup.reason === null
          ? null
          : oneOf(matchup.reason, ['friendly', 'incomplete', 'missing_evidence'] as const)
    },
    confirmation: {
      source: oneOf(confirmation.source, ['MANUAL', 'AUTO_48H', 'ADMIN_OVERRIDE'] as const),
      automatic: boolean(confirmation.automatic),
      confirmed_at: instant(confirmation.confirmed_at),
      effective_at: instant(confirmation.effective_at),
      approver: actor(confirmation.approver)
    },
    submitter: {
      user_id: uuid(submitter.user_id),
      display_name: nullableText(submitter.display_name),
      submitted_at: instant(submitter.submitted_at)
    },
    correction: {
      corrected: boolean(correction.corrected),
      version: positiveCount(correction.version)
    },
    timeline: timeline(row.timeline)
  };
  // A decided result has a winner side or a draw; an incomplete one has neither. An automatic
  // confirmation has no approver, a manual one always does. A correction badge needs evidence.
  const incomplete = detail.result.classification === 'incomplete';
  const matchupValues = [
    detail.matchup.team_a_strength,
    detail.matchup.team_b_strength,
    detail.matchup.team_a_expected,
    detail.matchup.team_b_expected,
    detail.matchup.upset
  ];
  const invalid =
    (detail.matchup.reason === null
      ? matchupValues.some((item) => item === null)
      : matchupValues.some((item) => item !== null)) ||
    (detail.match_type === 'friendly' && detail.matchup.reason !== 'friendly') ||
    (detail.match_type === 'competitive' && incomplete && detail.matchup.reason !== 'incomplete') ||
    (detail.matchup.reason === null &&
      (detail.matchup.team_a_expected! < 0 ||
        detail.matchup.team_a_expected! > 1 ||
        detail.matchup.team_b_expected! < 0 ||
        detail.matchup.team_b_expected! > 1)) ||
    (detail.result.winner === 'draw' && detail.matchup.upset === true) ||
    incomplete !== (detail.result.winner === null) ||
    detail.confirmation.automatic !== (detail.confirmation.source === 'AUTO_48H') ||
    detail.confirmation.automatic !== (detail.confirmation.approver === null) ||
    detail.correction.corrected !== detail.correction.version > 1 ||
    detail.correction.corrected !== detail.timeline.some((entry) => entry.kind === 'corrected');
  return invalid ? fail() : detail;
}
