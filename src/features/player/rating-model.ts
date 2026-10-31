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

export type RatingChangeKind = 'gain' | 'loss' | 'unchanged_rounded' | 'unchanged_boundary';

/** Honest wording class for a stored calculation: zero movement never implies a promise. */
export function ratingChangeKind(change: {
  appliedDelta: string;
  clamped: boolean;
}): RatingChangeKind {
  const applied = Number(change.appliedDelta);
  if (applied > 0) return 'gain';
  if (applied < 0) return 'loss';
  return change.clamped ? 'unchanged_boundary' : 'unchanged_rounded';
}
