import {
  LEVEL_REVIEW_DECISIONS,
  LEVEL_REVIEW_EVIDENCE_MAX,
  LEVEL_REVIEW_LEVEL_MAX,
  LEVEL_REVIEW_LEVEL_MIN,
  LEVEL_REVIEW_PAGE_MAX,
  LEVEL_REVIEW_STATUSES,
  LEVEL_REVIEW_TEXT_MAX,
  type LevelReviewCursor,
  type LevelReviewListInput,
  type LevelReviewPreviewInput,
  type LevelReviewReliabilityDecision,
  type LevelReviewQueueInput,
  type LevelReviewRequestInput,
  type ResolveLevelReviewInput,
  type SubmitLevelReviewInput
} from './level-review-contracts';

function invalid(): never {
  throw new Error('INVALID_LEVEL_REVIEW_INPUT');
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) return invalid();
  return data;
}
function uuid(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : invalid();
}

/**
 * Finite level in [0, 7] at hundredth precision. The raw number is checked before any
 * coercion so 7.001 is rejected, never silently rounded to 7.
 */
export function levelValue(value: unknown): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < LEVEL_REVIEW_LEVEL_MIN ||
    value > LEVEL_REVIEW_LEVEL_MAX ||
    Number(value.toFixed(2)) !== value
  )
    return invalid();
  return value;
}

/** Trimmed text of 1..max Unicode code points. */
function requiredText(value: unknown, max: number): string {
  if (typeof value !== 'string') return invalid();
  const text = value.trim();
  const length = Array.from(text).length;
  if (length < 1 || length > max || text.includes('\u0000')) return invalid();
  return text;
}

/** Evidence is optional: absent, null or blank means none. */
function optionalEvidence(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') return invalid();
  const text = value.trim();
  if (!text) return null;
  return requiredText(text, LEVEL_REVIEW_EVIDENCE_MAX);
}

function integerValue(value: unknown, min: number, max: number): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
    ? value
    : invalid();
}

function cursorValue(value: unknown): LevelReviewCursor {
  const cursor = record(value, ['created_at', 'id']);
  const createdAt = cursor.created_at;
  if (
    typeof createdAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(createdAt) ||
    !Number.isFinite(Date.parse(createdAt))
  )
    return invalid();
  return { created_at: createdAt, id: uuid(cursor.id) };
}

function pageFields(data: Record<string, unknown>): LevelReviewListInput {
  return {
    ...(data.limit === undefined
      ? {}
      : { limit: integerValue(data.limit, 1, LEVEL_REVIEW_PAGE_MAX) }),
    ...(data.cursor === undefined ? {} : { cursor: cursorValue(data.cursor) })
  };
}

export function validateSubmitLevelReview(value: unknown): SubmitLevelReviewInput {
  const data = record(value, [
    'command_id',
    'requested_min_level',
    'requested_max_level',
    'reason',
    'evidence'
  ]);
  const min = levelValue(data.requested_min_level);
  const max = levelValue(data.requested_max_level);
  if (min > max) return invalid();
  return {
    command_id: uuid(data.command_id),
    requested_min_level: min,
    requested_max_level: max,
    reason: requiredText(data.reason, LEVEL_REVIEW_TEXT_MAX),
    evidence: optionalEvidence(data.evidence)
  };
}

export function validateLevelReviewList(value: unknown): LevelReviewListInput {
  return pageFields(record(value ?? {}, ['limit', 'cursor']));
}

export function validateLevelReviewQueue(value: unknown): LevelReviewQueueInput {
  const data = record(value ?? {}, ['status', 'limit', 'cursor']);
  const status = LEVEL_REVIEW_STATUSES.find((item) => item === data.status);
  if (data.status !== undefined && !status) return invalid();
  return { ...pageFields(data), ...(status ? { status } : {}) };
}

export function validateLevelReviewRequest(value: unknown): LevelReviewRequestInput {
  return { request_id: uuid(record(value, ['request_id']).request_id) };
}

/** Preserve is the default; reset/reduce are recorded exceptions that need a justification. */
function reliabilityDecision(value: unknown): LevelReviewReliabilityDecision {
  const data = record(value, ['mode', 'target', 'justification']);
  if (data.mode === 'preserve') {
    if (data.target !== undefined || data.justification !== undefined) return invalid();
    return { mode: 'preserve' };
  }
  const justification = requiredText(data.justification, LEVEL_REVIEW_TEXT_MAX);
  if (data.mode === 'reset') {
    if (data.target !== undefined) return invalid();
    return { mode: 'reset', justification };
  }
  if (data.mode === 'reduce') {
    return { mode: 'reduce', target: integerValue(data.target, 0, 99), justification };
  }
  return invalid();
}

/** Preview inputs carry no justification: it only matters to the committed decision. */
export function validateLevelReviewPreview(value: unknown): LevelReviewPreviewInput {
  const data = record(value, ['request_id', 'target_level', 'reliability']);
  const base = { request_id: uuid(data.request_id), target_level: levelValue(data.target_level) };
  if (data.reliability === undefined) return base;
  const reliability = record(data.reliability, ['mode', 'target']);
  if (reliability.mode === 'preserve' || reliability.mode === 'reset') {
    if (reliability.target !== undefined) return invalid();
    return { ...base, reliability: { mode: reliability.mode } };
  }
  if (reliability.mode === 'reduce')
    return {
      ...base,
      reliability: { mode: 'reduce', target: integerValue(reliability.target, 0, 99) }
    };
  return invalid();
}

export function validateResolveLevelReview(value: unknown): ResolveLevelReviewInput {
  const data = record(value, [
    'request_id',
    'command_id',
    'decision',
    'note',
    'target_level',
    'expected_revision',
    'reliability'
  ]);
  const decision = LEVEL_REVIEW_DECISIONS.find((item) => item === data.decision);
  if (!decision) return invalid();
  const base = {
    request_id: uuid(data.request_id),
    command_id: uuid(data.command_id),
    note: requiredText(data.note, LEVEL_REVIEW_TEXT_MAX)
  };
  if (decision === 'reject') {
    if (
      data.target_level !== undefined ||
      data.expected_revision !== undefined ||
      data.reliability !== undefined
    )
      return invalid();
    return { ...base, decision };
  }
  return {
    ...base,
    decision,
    target_level: levelValue(data.target_level),
    expected_revision: integerValue(data.expected_revision, 0, Number.MAX_SAFE_INTEGER),
    ...(data.reliability === undefined
      ? {}
      : { reliability: reliabilityDecision(data.reliability) })
  };
}
