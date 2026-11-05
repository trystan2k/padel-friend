import {
  LEVEL_REVIEW_EVIDENCE_MAX,
  LEVEL_REVIEW_LEVEL_MAX,
  LEVEL_REVIEW_LEVEL_MIN,
  LEVEL_REVIEW_TEXT_MAX,
  type LevelReviewDto,
  type LevelReviewErrorCode,
  type LevelReviewStatus,
  type SubmitLevelReviewInput
} from './level-review-contracts';
import { stripEdgeWhitespace } from '../../lib/edge-whitespace';

// Client-side mirror of the SQL/validator bounds. The server validators and the database
// stay the authority; this only gives the player field-level feedback before a round trip.

export type LevelMode = 'exact' | 'range';
export type LevelFieldError = 'required' | 'format' | 'precision' | 'range';
export type LevelParse = { ok: true; value: number } | { ok: false; error: LevelFieldError };

export type LevelReviewFormValues = {
  mode: LevelMode;
  exact: string;
  min: string;
  max: string;
  reason: string;
  evidence: string;
};
export type LevelReviewFormField = 'exact' | 'min' | 'max' | 'reason' | 'evidence';
export type LevelReviewFormError = {
  field: LevelReviewFormField;
  key:
    | 'levelRequired'
    | 'levelFormat'
    | 'levelPrecision'
    | 'levelRange'
    | 'rangeOrder'
    | 'reasonRequired'
    | 'reasonTooLong'
    | 'evidenceTooLong';
};

const ACTIVE_STATUSES: readonly LevelReviewStatus[] = ['pending', 'under_review'];
export function isActiveLevelReview(status: LevelReviewStatus): boolean {
  return ACTIVE_STATUSES.includes(status);
}

export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/** The decimal separator a locale uses when it prints a level, e.g. "." for en and "," for pt-BR. */
export function decimalSeparator(locale: string): string {
  return (
    new Intl.NumberFormat(locale).formatToParts(1.1).find((part) => part.type === 'decimal')
      ?.value ?? '.'
  );
}

/**
 * Parses what a player typed. Only digits and the locale decimal separator are accepted, so a
 * thousands separator is never guessed ("3.800" is rejected in pt-BR instead of read as 3800).
 * The result is a canonical number; precision is checked on the text, before any rounding.
 */
export function parseLevelInput(text: string, locale: string): LevelParse {
  const value = stripEdgeWhitespace(text);
  if (!value) return { ok: false, error: 'required' };
  const separator = decimalSeparator(locale);
  const escaped = separator.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const shape = new RegExp(`^(\\d+)(?:${escaped}(\\d*))?$`).exec(value);
  if (!shape) return { ok: false, error: 'format' };
  const fraction = shape[2] ?? '';
  if (fraction.length > 2) return { ok: false, error: 'precision' };
  const parsed = Number(`${shape[1]}.${fraction || '0'}`);
  if (
    !Number.isFinite(parsed) ||
    parsed < LEVEL_REVIEW_LEVEL_MIN ||
    parsed > LEVEL_REVIEW_LEVEL_MAX
  )
    return { ok: false, error: 'range' };
  return { ok: true, value: parsed };
}

/** An example in the viewer's own convention, used by helper and format error text. */
export function exampleLevel(locale: string): string {
  return new Intl.NumberFormat(locale, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  }).format(3.8);
}

const LEVEL_ERROR_KEY = {
  required: 'levelRequired',
  format: 'levelFormat',
  precision: 'levelPrecision',
  range: 'levelRange'
} as const;

export type LevelReviewValidation =
  | { ok: true; input: Omit<SubmitLevelReviewInput, 'command_id'> }
  | { ok: false; errors: LevelReviewFormError[] };

/** Field errors in form order (so the first one can take focus), or a canonical payload. */
export function validateLevelReviewForm(
  values: LevelReviewFormValues,
  locale: string
): LevelReviewValidation {
  const errors: LevelReviewFormError[] = [];
  const levels: number[] = [];
  const fields: LevelReviewFormField[] = values.mode === 'exact' ? ['exact'] : ['min', 'max'];
  for (const field of fields) {
    const parsed = parseLevelInput(values[field], locale);
    if (parsed.ok) levels.push(parsed.value);
    else errors.push({ field, key: LEVEL_ERROR_KEY[parsed.error] });
  }
  if (values.mode === 'range' && levels.length === 2 && (levels[0] ?? 0) > (levels[1] ?? 0))
    errors.push({ field: 'min', key: 'rangeOrder' });
  const reason = stripEdgeWhitespace(values.reason);
  if (!reason) errors.push({ field: 'reason', key: 'reasonRequired' });
  else if (codePointLength(reason) > LEVEL_REVIEW_TEXT_MAX)
    errors.push({ field: 'reason', key: 'reasonTooLong' });
  const evidence = stripEdgeWhitespace(values.evidence);
  if (codePointLength(evidence) > LEVEL_REVIEW_EVIDENCE_MAX)
    errors.push({ field: 'evidence', key: 'evidenceTooLong' });
  const min = levels[0];
  const max = levels[1] ?? min;
  if (errors.length > 0 || min === undefined || max === undefined) return { ok: false, errors };
  return {
    ok: true,
    input: {
      requested_min_level: min,
      requested_max_level: max,
      reason,
      evidence: evidence || null
    }
  };
}

/** Same payload, same fingerprint: a retry reuses its command id, an edit gets a new one. */
export function levelReviewFingerprint(input: Omit<SubmitLevelReviewInput, 'command_id'>): string {
  return JSON.stringify([
    input.requested_min_level,
    input.requested_max_level,
    input.reason,
    input.evidence
  ]);
}

export type LevelReviewErrorKind =
  | 'unauthenticated'
  | 'forbidden'
  | 'notFound'
  | 'invalid'
  | 'duplicate'
  | 'rateLimited'
  | 'ratingUnavailable'
  | 'conflict'
  | 'invalidTransition'
  | 'unavailable';

/** Groups the stable server codes into the player-facing messages. */
export function levelReviewErrorKind(code: LevelReviewErrorCode): LevelReviewErrorKind {
  switch (code) {
    case 'UNAUTHENTICATED':
    case 'LEVEL_REVIEW_UNAUTHENTICATED':
      return 'unauthenticated';
    case 'PROVISIONAL_PLAYER_RESTRICTED':
    case 'LEVEL_REVIEW_FORBIDDEN':
      return 'forbidden';
    case 'LEVEL_REVIEW_NOT_FOUND':
      return 'notFound';
    case 'LEVEL_REVIEW_INVALID_ARGUMENT':
    case 'INVALID_LEVEL_REVIEW_INPUT':
      return 'invalid';
    case 'LEVEL_REVIEW_DUPLICATE_ACTIVE':
      return 'duplicate';
    case 'LEVEL_REVIEW_RATE_LIMITED':
      return 'rateLimited';
    case 'LEVEL_REVIEW_RATING_UNAVAILABLE':
      return 'ratingUnavailable';
    case 'LEVEL_REVIEW_IDEMPOTENCY_CONFLICT':
      return 'conflict';
    case 'LEVEL_REVIEW_INVALID_TRANSITION':
      return 'invalidTransition';
    default:
      return 'unavailable';
  }
}

/** Short, stable request label shown to the owner. */
export function levelReviewShortId(request: Pick<LevelReviewDto, 'id'>): string {
  return request.id.slice(0, 8).toUpperCase();
}
