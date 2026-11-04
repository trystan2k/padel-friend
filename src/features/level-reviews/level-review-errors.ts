import type { LevelReviewErrorCode } from './level-review-contracts';

const DATABASE_ERRORS: readonly LevelReviewErrorCode[] = [
  'PROVISIONAL_PLAYER_RESTRICTED',
  'LEVEL_REVIEW_UNAUTHENTICATED',
  'LEVEL_REVIEW_FORBIDDEN',
  'LEVEL_REVIEW_NOT_FOUND',
  'LEVEL_REVIEW_INVALID_ARGUMENT',
  'LEVEL_REVIEW_DUPLICATE_ACTIVE',
  'LEVEL_REVIEW_RATE_LIMITED',
  'LEVEL_REVIEW_RATING_UNAVAILABLE',
  'LEVEL_REVIEW_IDEMPOTENCY_CONFLICT',
  'LEVEL_REVIEW_INVALID_TRANSITION',
  'LEVEL_REVIEW_RESOLUTION_CONFLICT',
  'LEVEL_REVIEW_TARGET_OUT_OF_RANGE',
  'LEVEL_REVIEW_STALE_RATING',
  'LEVEL_REVIEW_APPROVAL_UNAVAILABLE'
];

/** Server-side: maps a PostgREST error to a stable code (never raw database text). */
export function levelReviewErrorFromDatabase(error: { message?: string }): LevelReviewErrorCode {
  return DATABASE_ERRORS.find((code) => code === error.message) ?? 'LEVEL_REVIEW_UNAVAILABLE';
}

/** Client-side: server function failures arrive as Error(message=code). */
export function levelReviewErrorCode(error: unknown): LevelReviewErrorCode {
  if (!(error instanceof Error)) return 'LEVEL_REVIEW_UNAVAILABLE';
  const matched = [
    ...DATABASE_ERRORS,
    'UNAUTHENTICATED' as const,
    'INVALID_LEVEL_REVIEW_INPUT' as const,
    'INVALID_LEVEL_REVIEW_RESPONSE' as const
  ].find((code) => code === error.message);
  return matched ?? 'LEVEL_REVIEW_UNAVAILABLE';
}
