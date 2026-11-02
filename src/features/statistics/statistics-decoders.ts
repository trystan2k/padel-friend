import { DEFAULT_STATISTICS_THRESHOLDS } from './statistics-config';
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
