import {
  STATISTICS_EXTREMA_KEYS,
  type ExtremumCandidate,
  type JsonCounts,
  type MetricState,
  type RecentOutcome,
  type SequenceRun,
  type SequenceState,
  type StatisticsAggregate,
  type StatisticsExtrema,
  type StatisticsOutcome,
  type StatisticsReason
} from './statistics-contracts';

export const RECENT_OUTCOME_LIMIT = 10;

export function emptySequence(): SequenceState {
  return { n: 0, prefix: null, suffix: null, best_win: 0, best_loss: 0 };
}

/** Sequence of one ordered outcome list; the same definition the database applies per bucket. */
export function sequenceFrom(outcomes: readonly StatisticsOutcome[]): SequenceState {
  return outcomes.reduce<SequenceState>(
    (state, outcome) => mergeSequences(state, singleOutcome(outcome)),
    emptySequence()
  );
}

function singleOutcome(outcome: StatisticsOutcome): SequenceState {
  const run: SequenceRun = { k: outcome, len: 1 };
  return {
    n: 1,
    prefix: run,
    suffix: run,
    best_win: outcome === 'W' ? 1 : 0,
    best_loss: outcome === 'L' ? 1 : 0
  };
}

/** Associative merge of two chronologically adjacent halves (left earlier than right). */
export function mergeSequences(left: SequenceState, right: SequenceState): SequenceState {
  if (left.n === 0) return right;
  if (right.n === 0) return left;
  const leftPrefix = left.prefix;
  const leftSuffix = left.suffix;
  const rightPrefix = right.prefix;
  const rightSuffix = right.suffix;
  if (!leftPrefix || !leftSuffix || !rightPrefix || !rightSuffix)
    return left.n === 0 ? right : left;
  const joins = leftSuffix.k === rightPrefix.k;
  const junction = joins ? leftSuffix.len + rightPrefix.len : 0;
  return {
    n: left.n + right.n,
    prefix:
      leftPrefix.len === left.n && leftPrefix.k === rightPrefix.k
        ? { k: leftPrefix.k, len: left.n + rightPrefix.len }
        : leftPrefix,
    suffix:
      rightSuffix.len === right.n && rightSuffix.k === leftSuffix.k
        ? { k: rightSuffix.k, len: right.n + leftSuffix.len }
        : rightSuffix,
    best_win: Math.max(left.best_win, right.best_win, joins && leftSuffix.k === 'W' ? junction : 0),
    best_loss: Math.max(
      left.best_loss,
      right.best_loss,
      joins && leftSuffix.k === 'L' ? junction : 0
    )
  };
}

/** Current streak: the trailing run when it is a win or loss; a Draw breaks both. */
export function currentStreak(sequence: SequenceState): { kind: 'W' | 'L' | null; length: number } {
  const run = sequence.suffix;
  if (!run || run.k === 'D') return { kind: null, length: 0 };
  return { kind: run.k, length: run.len };
}

export function mergeRecent(left: readonly RecentOutcome[], right: readonly RecentOutcome[]) {
  return [...left, ...right].slice(-RECENT_OUTCOME_LIMIT);
}

function compareCandidate(a: ExtremumCandidate, b: ExtremumCandidate): number {
  return a.k - b.k || a.at.localeCompare(b.at) || a.g.localeCompare(b.g);
}

export function mergeExtrema(left: StatisticsExtrema, right: StatisticsExtrema): StatisticsExtrema {
  const merged: StatisticsExtrema = {};
  for (const key of STATISTICS_EXTREMA_KEYS) {
    const a = left[key];
    const b = right[key];
    const winner = a && b ? (compareCandidate(a, b) <= 0 ? a : b) : (a ?? b);
    if (winner) merged[key] = winner;
  }
  return merged;
}

/** Additive nested counters: numbers add, objects merge by key. */
export function mergeCounts(left: JsonCounts, right: JsonCounts): JsonCounts {
  const merged: JsonCounts = { ...left };
  for (const [key, value] of Object.entries(right)) {
    const existing = merged[key];
    if (existing === undefined) merged[key] = value;
    else if (typeof existing === 'number' && typeof value === 'number')
      merged[key] = existing + value;
    else if (typeof existing === 'object' && typeof value === 'object')
      merged[key] = mergeCounts(existing, value);
  }
  return merged;
}

/** Distinct identities under one relation (partners, opponents, players...): never a sum of days. */
export function distinctRelationCount(relations: JsonCounts, name: string): number {
  const group = relations[name];
  return typeof group === 'object' ? Object.keys(group).length : 0;
}

export function emptyAggregate(): StatisticsAggregate {
  return {
    confirmed_groups: 0,
    wins: 0,
    losses: 0,
    draws: 0,
    incomplete_groups: 0,
    competitive_groups: 0,
    friendly_groups: 0,
    sets_won: 0,
    sets_lost: 0,
    games_won: 0,
    games_lost: 0,
    straight_set_wins: 0,
    straight_set_losses: 0,
    three_set_groups: 0,
    incomplete_decider_groups: 0,
    deciding_set_wins: 0,
    deciding_set_losses: 0,
    first_set_won_groups: 0,
    first_set_won_converted: 0,
    first_set_lost_groups: 0,
    first_set_lost_converted: 0,
    rated_groups: 0,
    rating_delta_sum: 0,
    opponent_strength_sum: 0,
    opponent_strength_groups: 0,
    upset_wins: 0,
    first_played_at: null,
    first_game_group_id: null,
    last_played_at: null,
    last_game_group_id: null,
    sequence: emptySequence(),
    recent: [],
    extrema: {},
    relations: {},
    activity: {}
  };
}

const ADDITIVE_KEYS = [
  'confirmed_groups',
  'wins',
  'losses',
  'draws',
  'incomplete_groups',
  'competitive_groups',
  'friendly_groups',
  'sets_won',
  'sets_lost',
  'games_won',
  'games_lost',
  'straight_set_wins',
  'straight_set_losses',
  'three_set_groups',
  'incomplete_decider_groups',
  'deciding_set_wins',
  'deciding_set_losses',
  'first_set_won_groups',
  'first_set_won_converted',
  'first_set_lost_groups',
  'first_set_lost_converted',
  'rated_groups',
  'rating_delta_sum',
  'opponent_strength_sum',
  'opponent_strength_groups',
  'upset_wins'
] as const;

/** (played_at, game_group_id) ascending, the one chronology every reduction uses. */
function earlier(
  a: { at: string | null; g: string | null },
  b: { at: string | null; g: string | null }
): boolean {
  if (a.at === null) return false;
  if (b.at === null) return true;
  return a.at < b.at || (a.at === b.at && (a.g ?? '') <= (b.g ?? ''));
}

/** Associative merge of two chronologically adjacent aggregates (left strictly earlier). */
export function mergeAggregates(
  left: StatisticsAggregate,
  right: StatisticsAggregate
): StatisticsAggregate {
  const merged = emptyAggregate();
  for (const key of ADDITIVE_KEYS) merged[key] = left[key] + right[key];
  const leftFirst = { at: left.first_played_at, g: left.first_game_group_id };
  const rightFirst = { at: right.first_played_at, g: right.first_game_group_id };
  const first = earlier(leftFirst, rightFirst) ? leftFirst : rightFirst;
  merged.first_played_at = first.at;
  merged.first_game_group_id = first.g;
  const leftLast = { at: left.last_played_at, g: left.last_game_group_id };
  const rightLast = { at: right.last_played_at, g: right.last_game_group_id };
  const last =
    leftLast.at === null || (rightLast.at !== null && earlier(leftLast, rightLast))
      ? rightLast
      : leftLast;
  merged.last_played_at = last.at;
  merged.last_game_group_id = last.g;
  merged.sequence = mergeSequences(left.sequence, right.sequence);
  merged.recent = mergeRecent(left.recent, right.recent);
  merged.extrema = mergeExtrema(left.extrema, right.extrema);
  merged.relations = mergeCounts(left.relations, right.relations);
  merged.activity = mergeCounts(left.activity, right.activity);
  return merged;
}

/** Folds day buckets (any input order) in UTC day order into one aggregate. */
export function mergeDailyBuckets(
  buckets: ReadonlyArray<StatisticsAggregate & { played_day: string }>
): StatisticsAggregate {
  return [...buckets]
    .sort((a, b) => a.played_day.localeCompare(b.played_day))
    .reduce<StatisticsAggregate>((acc, bucket) => mergeAggregates(acc, bucket), emptyAggregate());
}

/** Buckets whose UTC day lies in [from, through] (both inclusive whole dates, either optional). */
export function selectBucketsInRange<T extends { played_day: string }>(
  buckets: readonly T[],
  from: string | null,
  through: string | null
): T[] {
  return buckets.filter(
    (bucket) =>
      (from === null || bucket.played_day >= from) &&
      (through === null || bucket.played_day <= through)
  );
}

/** Percentage-like ratio: a zero denominator is a typed reason, never 0%, NaN or Infinity. */
export function ratioMetric(
  numerator: number,
  denominator: number,
  options: { minimum?: number; reason?: StatisticsReason } = {}
): MetricState {
  const minimum = Math.max(1, options.minimum ?? 1);
  if (denominator < minimum) {
    return {
      state: 'insufficient',
      value: null,
      numerator,
      denominator,
      observed: denominator,
      required: minimum,
      reason: options.reason ?? (minimum > 1 ? 'minimum_opportunities' : 'no_denominator')
    };
  }
  return { state: 'ready', value: numerator / denominator, numerator, denominator };
}

/** Canonical pair: the two player ids ordered ascending; identical ids are not a pair. */
export function canonicalPair(first: string, second: string): [string, string] {
  const a = first.toLowerCase();
  const b = second.toLowerCase();
  if (a === b) throw new Error('INVALID_STATISTICS_PAIR');
  return a < b ? [a, b] : [b, a];
}

/** Canonical matchup: two canonical pairs, sorted; a pair cannot face itself. */
export function canonicalMatchup(
  first: readonly [string, string],
  second: readonly [string, string]
): [[string, string], [string, string]] {
  const a = canonicalPair(first[0], first[1]);
  const b = canonicalPair(second[0], second[1]);
  const key = (pair: [string, string]) => pair.join(':');
  if (key(a) === key(b)) throw new Error('INVALID_STATISTICS_MATCHUP');
  return key(a) < key(b) ? [a, b] : [b, a];
}

export function canonicalQuartet(players: readonly string[]): string[] {
  const sorted = players.map((player) => player.toLowerCase()).sort();
  if (sorted.length !== 4 || new Set(sorted).size !== 4)
    throw new Error('INVALID_STATISTICS_QUARTET');
  return sorted;
}
