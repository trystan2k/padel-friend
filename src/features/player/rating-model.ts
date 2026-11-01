// Presentation-side mirrors of the V1 rules. The only calculation implementation is the
// Postgres kernel (rating_v1_calculate_group); nothing here computes a rating.

export type ReplayKey = { playedAt: string; gameGroupId: string };

/** Ascending (played_at instant, lowercase game_group_id): ingestion order never matters. */
export function compareReplayKey(a: ReplayKey, b: ReplayKey): number {
  const byInstant = Date.parse(a.playedAt) - Date.parse(b.playedAt);
  if (byInstant !== 0) return byInstant < 0 ? -1 : 1;
  const left = a.gameGroupId.toLowerCase();
  const right = b.gameGroupId.toLowerCase();
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/** Mirrors rating_v1_is_ratable: competitive, confirmed, decisive or drawn. */
export function isRatableResult(
  matchType: string,
  classification: string | null,
  resultStatus: string
): boolean {
  return (
    matchType === 'competitive' &&
    resultStatus === 'confirmed' &&
    (classification === 'team_a' || classification === 'team_b' || classification === 'draw')
  );
}

const EXPECTED_SCORE_EPSILON = 1e-9;

export type RatingOutcome = 'win' | 'draw' | 'loss';

/** Stored own-team result: 1 win, 0.5 draw, 0 loss. */
export function ratingOutcome(outcomeValue: number): RatingOutcome {
  return outcomeValue === 1 ? 'win' : outcomeValue === 0.5 ? 'draw' : 'loss';
}

export type RatingExplanationNote =
  | 'gain'
  | 'loss'
  | 'zero_rounded'
  | 'draw_equal'
  | 'boundary'
  | 'clamped_gain'
  | 'clamped_loss';

/**
 * Wording class for one stored calculation. Only stored fields are read, so a historical
 * explanation never depends on today's teammate ratings. Zero movement is never described
 * as a promise: it is a rounded-away change, an equal draw, or the edge of the scale.
 */
export function ratingExplanationNote(stored: {
  expected_score: number;
  outcome_value: number;
  rounded_delta: number;
  applied_delta: number;
  clamped: boolean;
}): RatingExplanationNote {
  const { applied_delta: applied, rounded_delta: rounded } = stored;
  if (applied === 0) {
    if (stored.clamped) return 'boundary';
    if (
      stored.outcome_value === 0.5 &&
      Math.abs(stored.expected_score - 0.5) < EXPECTED_SCORE_EPSILON
    )
      return 'draw_equal';
    return 'zero_rounded';
  }
  if (stored.clamped && applied !== rounded) return applied > 0 ? 'clamped_gain' : 'clamped_loss';
  return applied > 0 ? 'gain' : 'loss';
}

/** Reliability is capped at 100%; from then on every game uses the smallest weight. */
export function isReliabilityEstablished(reliabilityPercent: number): boolean {
  return reliabilityPercent >= 100;
}
