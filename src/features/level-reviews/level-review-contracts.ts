export const LEVEL_REVIEW_STATUSES = [
  'pending',
  'under_review',
  'approved',
  'rejected',
  'canceled'
] as const;
export type LevelReviewStatus = (typeof LEVEL_REVIEW_STATUSES)[number];

export const LEVEL_REVIEW_DECISIONS = ['approve', 'reject'] as const;

export const LEVEL_REVIEW_LEVEL_MIN = 0;
export const LEVEL_REVIEW_LEVEL_MAX = 7;
export const LEVEL_REVIEW_TEXT_MAX = 2000;
export const LEVEL_REVIEW_EVIDENCE_MAX = 4000;
export const LEVEL_REVIEW_PAGE_DEFAULT = 20;
export const LEVEL_REVIEW_PAGE_MAX = 50;

export type LevelReviewCursor = { created_at: string; id: string };

/** What the request owner sees: no internal actors, command ids or fingerprints. */
export type LevelReviewDto = {
  id: string;
  status: LevelReviewStatus;
  snapshot_display_level: number;
  snapshot_reliability_percent: number;
  requested_min_level: number;
  requested_max_level: number;
  reason: string;
  evidence: string | null;
  created_at: string;
  under_review_at: string | null;
  canceled_at: string | null;
  decided_at: string | null;
  decision_note: string | null;
  approved_level: number | null;
  adjustment_id: string | null;
};

export type LevelReviewAdminDto = LevelReviewDto & {
  owner_id: string;
  owner_display_name: string | null;
  snapshot_rating_revision: number;
  under_review_by: string | null;
  decision_actor_id: string | null;
};

export type LevelReviewQueueItem = {
  id: string;
  status: LevelReviewStatus;
  owner_id: string;
  owner_display_name: string | null;
  snapshot_display_level: number;
  snapshot_reliability_percent: number;
  requested_min_level: number;
  requested_max_level: number;
  created_at: string;
  under_review_at: string | null;
  decided_at: string | null;
};

export type LevelReviewAccess = { is_platform_admin: boolean };
export type LevelReviewCommandResult = { request: LevelReviewDto; replayed: boolean };
export type LevelReviewDetailResult = { request: LevelReviewDto };
export type LevelReviewListResult = {
  items: LevelReviewDto[];
  next_cursor: LevelReviewCursor | null;
};
export type LevelReviewQueueResult = {
  pending_count: number;
  under_review_count: number;
  items: LevelReviewQueueItem[];
  next_cursor: LevelReviewCursor | null;
};
export type LevelReviewAdminCommandResult = { request: LevelReviewAdminDto; replayed: boolean };
export type LevelReviewAdminDetail = {
  request: LevelReviewAdminDto;
  current: {
    revision: number;
    display_level: number;
    reliability_percent: number;
    confirmed_competitive_game_groups: number;
  } | null;
  rating_changed: boolean;
  recent_history: {
    played_at: string;
    before_display_level: number;
    after_display_level: number;
    after_reliability_percent: number;
  }[];
};

export type SubmitLevelReviewInput = {
  command_id: string;
  requested_min_level: number;
  requested_max_level: number;
  reason: string;
  evidence: string | null;
};
export type LevelReviewListInput = { limit?: number; cursor?: LevelReviewCursor };
export type LevelReviewQueueInput = LevelReviewListInput & { status?: LevelReviewStatus };
export type LevelReviewRequestInput = { request_id: string };
export type ResolveLevelReviewInput =
  | { request_id: string; command_id: string; decision: 'reject'; note: string }
  | {
      request_id: string;
      command_id: string;
      decision: 'approve';
      note: string;
      target_level: number;
      expected_revision: number;
    };

/** Database messages travel as stable codes; raw database text never reaches the browser. */
export type LevelReviewErrorCode =
  | 'UNAUTHENTICATED'
  | 'PROVISIONAL_PLAYER_RESTRICTED'
  | 'LEVEL_REVIEW_UNAUTHENTICATED'
  | 'LEVEL_REVIEW_FORBIDDEN'
  | 'LEVEL_REVIEW_NOT_FOUND'
  | 'LEVEL_REVIEW_INVALID_ARGUMENT'
  | 'LEVEL_REVIEW_DUPLICATE_ACTIVE'
  | 'LEVEL_REVIEW_RATE_LIMITED'
  | 'LEVEL_REVIEW_RATING_UNAVAILABLE'
  | 'LEVEL_REVIEW_IDEMPOTENCY_CONFLICT'
  | 'LEVEL_REVIEW_INVALID_TRANSITION'
  | 'LEVEL_REVIEW_RESOLUTION_CONFLICT'
  | 'LEVEL_REVIEW_TARGET_OUT_OF_RANGE'
  | 'LEVEL_REVIEW_STALE_RATING'
  | 'LEVEL_REVIEW_APPROVAL_UNAVAILABLE'
  | 'INVALID_LEVEL_REVIEW_INPUT'
  | 'INVALID_LEVEL_REVIEW_RESPONSE'
  | 'LEVEL_REVIEW_UNAVAILABLE';
