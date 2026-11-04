import {
  LEVEL_REVIEW_RELIABILITY_MODES,
  LEVEL_REVIEW_STATUSES,
  type LevelReviewAccess,
  type LevelReviewAdminCommandResult,
  type LevelReviewAdminDetail,
  type LevelReviewAdjustmentDto,
  type LevelReviewAdminDto,
  type LevelReviewResolutionResult,
  type LevelReviewCommandResult,
  type LevelReviewCursor,
  type LevelReviewDetailResult,
  type LevelReviewDto,
  type LevelReviewListResult,
  type LevelReviewQueueItem,
  type LevelReviewQueueResult
} from './level-review-contracts';

type ObjectValue = Record<string, unknown>;

const fail = (): never => {
  throw new Error('INVALID_LEVEL_REVIEW_RESPONSE');
};
function exactObject(value: unknown, keys: readonly string[]): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  const row: ObjectValue = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return fail();
  return row;
}
function nullable<T>(value: unknown, decode: (input: unknown) => T): T | null {
  return value === null ? null : decode(value);
}
function text(value: unknown): string {
  return typeof value === 'string' && value ? value : fail();
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}
function finite(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fail();
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function uuid(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : fail();
}
function instant(value: unknown): string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : fail();
}
function status(value: unknown): LevelReviewDto['status'] {
  const matched = LEVEL_REVIEW_STATUSES.find((item) => item === value);
  return matched ?? fail();
}
function array<T>(value: unknown, decode: (item: unknown) => T): T[] {
  return Array.isArray(value) ? value.map(decode) : fail();
}

const OWNER_KEYS = [
  'id',
  'status',
  'snapshot_display_level',
  'snapshot_reliability_percent',
  'requested_min_level',
  'requested_max_level',
  'reason',
  'evidence',
  'created_at',
  'under_review_at',
  'canceled_at',
  'decided_at',
  'decision_note',
  'approved_level',
  'adjustment_id'
] as const;
const ADMIN_KEYS = [
  ...OWNER_KEYS,
  'owner_id',
  'owner_display_name',
  'snapshot_rating_revision',
  'under_review_by',
  'decision_actor_id'
] as const;
const QUEUE_ITEM_KEYS = [
  'id',
  'status',
  'owner_id',
  'owner_display_name',
  'snapshot_display_level',
  'snapshot_reliability_percent',
  'requested_min_level',
  'requested_max_level',
  'created_at',
  'under_review_at',
  'decided_at'
] as const;

function ownerFields(row: ObjectValue): LevelReviewDto {
  return {
    id: uuid(row.id),
    status: status(row.status),
    snapshot_display_level: finite(row.snapshot_display_level),
    snapshot_reliability_percent: count(row.snapshot_reliability_percent),
    requested_min_level: finite(row.requested_min_level),
    requested_max_level: finite(row.requested_max_level),
    reason: text(row.reason),
    evidence: nullable(row.evidence, text),
    created_at: instant(row.created_at),
    under_review_at: nullable(row.under_review_at, instant),
    canceled_at: nullable(row.canceled_at, instant),
    decided_at: nullable(row.decided_at, instant),
    decision_note: nullable(row.decision_note, text),
    approved_level: nullable(row.approved_level, finite),
    adjustment_id: nullable(row.adjustment_id, uuid)
  };
}

function decodeDto(value: unknown): LevelReviewDto {
  return ownerFields(exactObject(value, OWNER_KEYS));
}

function decodeAdminDto(value: unknown): LevelReviewAdminDto {
  const row = exactObject(value, ADMIN_KEYS);
  return {
    ...ownerFields(row),
    owner_id: uuid(row.owner_id),
    owner_display_name: nullable(row.owner_display_name, text),
    snapshot_rating_revision: count(row.snapshot_rating_revision),
    under_review_by: nullable(row.under_review_by, uuid),
    decision_actor_id: nullable(row.decision_actor_id, uuid)
  };
}

function decodeQueueItem(value: unknown): LevelReviewQueueItem {
  const row = exactObject(value, QUEUE_ITEM_KEYS);
  return {
    id: uuid(row.id),
    status: status(row.status),
    owner_id: uuid(row.owner_id),
    owner_display_name: nullable(row.owner_display_name, text),
    snapshot_display_level: finite(row.snapshot_display_level),
    snapshot_reliability_percent: count(row.snapshot_reliability_percent),
    requested_min_level: finite(row.requested_min_level),
    requested_max_level: finite(row.requested_max_level),
    created_at: instant(row.created_at),
    under_review_at: nullable(row.under_review_at, instant),
    decided_at: nullable(row.decided_at, instant)
  };
}

function decodeCursor(value: unknown): LevelReviewCursor {
  const row = exactObject(value, ['created_at', 'id']);
  return { created_at: instant(row.created_at), id: uuid(row.id) };
}

export function decodeLevelReviewAccess(value: unknown): LevelReviewAccess {
  return {
    is_platform_admin: boolean(exactObject(value, ['is_platform_admin']).is_platform_admin)
  };
}

export function decodeLevelReviewCommand(value: unknown): LevelReviewCommandResult {
  const row = exactObject(value, ['request', 'replayed']);
  return { request: decodeDto(row.request), replayed: boolean(row.replayed) };
}

export function decodeLevelReviewDetail(value: unknown): LevelReviewDetailResult {
  return { request: decodeDto(exactObject(value, ['request']).request) };
}

export function decodeLevelReviewList(value: unknown): LevelReviewListResult {
  const row = exactObject(value, ['items', 'next_cursor']);
  return {
    items: array(row.items, decodeDto),
    next_cursor: nullable(row.next_cursor, decodeCursor)
  };
}

export function decodeLevelReviewQueue(value: unknown): LevelReviewQueueResult {
  const row = exactObject(value, ['pending_count', 'under_review_count', 'items', 'next_cursor']);
  return {
    pending_count: count(row.pending_count),
    under_review_count: count(row.under_review_count),
    items: array(row.items, decodeQueueItem),
    next_cursor: nullable(row.next_cursor, decodeCursor)
  };
}

const ADJUSTMENT_KEYS = [
  'id',
  'level_review_request_id',
  'user_id',
  'event_type',
  'reason',
  'actor_id',
  'decided_at',
  'effective_at',
  'projection_revision',
  'boundary_played_at',
  'boundary_group_id',
  'boundary_basis',
  'rating_engine',
  'rating_config_version',
  'before_engine_version',
  'after_engine_version',
  'before_display_level',
  'after_display_level',
  'before_reliability_percent',
  'after_reliability_percent',
  'before_confirmed_groups',
  'after_confirmed_groups',
  'before_highest_display_level',
  'after_highest_display_level',
  'before_sigma',
  'after_sigma',
  'last_rating_at',
  'reliability_mode',
  'reliability_target',
  'exception_justification'
] as const;

const BOUNDARY_BASES = ['decision_clock', 'match_watermark', 'prior_checkpoint'] as const;
function decodeAdjustment(value: unknown): LevelReviewAdjustmentDto {
  const row = exactObject(value, ADJUSTMENT_KEYS);
  const basis = BOUNDARY_BASES.find((item) => item === row.boundary_basis);
  const mode = LEVEL_REVIEW_RELIABILITY_MODES.find((item) => item === row.reliability_mode);
  if (row.event_type !== 'ADMIN_REVIEW_ADJUSTMENT' || !basis || !mode) return fail();
  return {
    id: uuid(row.id),
    level_review_request_id: uuid(row.level_review_request_id),
    user_id: uuid(row.user_id),
    event_type: 'ADMIN_REVIEW_ADJUSTMENT',
    reason: text(row.reason),
    actor_id: uuid(row.actor_id),
    decided_at: instant(row.decided_at),
    effective_at: instant(row.effective_at),
    projection_revision: count(row.projection_revision),
    boundary_played_at: instant(row.boundary_played_at),
    boundary_group_id: uuid(row.boundary_group_id),
    boundary_basis: basis,
    rating_engine: text(row.rating_engine),
    rating_config_version: count(row.rating_config_version),
    before_engine_version: text(row.before_engine_version),
    after_engine_version: text(row.after_engine_version),
    before_display_level: finite(row.before_display_level),
    after_display_level: finite(row.after_display_level),
    before_reliability_percent: count(row.before_reliability_percent),
    after_reliability_percent: count(row.after_reliability_percent),
    before_confirmed_groups: count(row.before_confirmed_groups),
    after_confirmed_groups: count(row.after_confirmed_groups),
    before_highest_display_level: finite(row.before_highest_display_level),
    after_highest_display_level: finite(row.after_highest_display_level),
    before_sigma: finite(row.before_sigma),
    after_sigma: finite(row.after_sigma),
    last_rating_at: nullable(row.last_rating_at, instant),
    reliability_mode: mode,
    reliability_target: nullable(row.reliability_target, count),
    exception_justification: nullable(row.exception_justification, text)
  };
}

/** Resolution response: the request plus the committed audit event (null for a rejection). */
export function decodeLevelReviewResolution(value: unknown): LevelReviewResolutionResult {
  const row = exactObject(value, ['request', 'replayed', 'adjustment']);
  return {
    request: decodeAdminDto(row.request),
    replayed: boolean(row.replayed),
    adjustment: nullable(row.adjustment, decodeAdjustment)
  };
}

export function decodeLevelReviewAdminCommand(value: unknown): LevelReviewAdminCommandResult {
  const row = exactObject(value, ['request', 'replayed']);
  return { request: decodeAdminDto(row.request), replayed: boolean(row.replayed) };
}

export function decodeLevelReviewAdminDetail(value: unknown): LevelReviewAdminDetail {
  const row = exactObject(value, [
    'request',
    'current',
    'rating_changed',
    'adjustment',
    'recent_history'
  ]);
  return {
    request: decodeAdminDto(row.request),
    current: nullable(row.current, (current) => {
      const item = exactObject(current, [
        'revision',
        'display_level',
        'reliability_percent',
        'confirmed_competitive_game_groups'
      ]);
      return {
        revision: count(item.revision),
        display_level: finite(item.display_level),
        reliability_percent: count(item.reliability_percent),
        confirmed_competitive_game_groups: count(item.confirmed_competitive_game_groups)
      };
    }),
    rating_changed: boolean(row.rating_changed),
    adjustment: nullable(row.adjustment, decodeAdjustment),
    recent_history: array(row.recent_history, (entry) => {
      const item = exactObject(entry, [
        'played_at',
        'before_display_level',
        'after_display_level',
        'after_reliability_percent'
      ]);
      return {
        played_at: instant(item.played_at),
        before_display_level: finite(item.before_display_level),
        after_display_level: finite(item.after_display_level),
        after_reliability_percent: count(item.after_reliability_percent)
      };
    })
  };
}
