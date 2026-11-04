import { describe, expect, it } from 'vitest';
import {
  decodeLevelReviewAdminDetail,
  decodeLevelReviewResolution
} from '../src/features/level-reviews/level-review-decoders';
import {
  levelReviewErrorCode,
  levelReviewErrorFromDatabase
} from '../src/features/level-reviews/level-review-errors';
import { validateResolveLevelReview } from '../src/features/level-reviews/level-review-validators';
import {
  parseRatingHistoryPage,
  parseRatingProgress
} from '../src/features/player/rating-contracts';
import { historyPayload, progressPayload } from './helpers/rating-read-fixtures';

const ID = '11111111-1111-4111-8111-111111111111';
const CMD = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const ADMIN = '44444444-4444-4444-8444-444444444444';
const EVENT = '55555555-5555-4555-8555-555555555555';
const AT = '2026-11-03T10:00:00.123456Z';

const adminDto = {
  id: ID,
  status: 'approved',
  snapshot_display_level: 4,
  snapshot_reliability_percent: 16,
  requested_min_level: 4.5,
  requested_max_level: 5,
  reason: 'Reason',
  evidence: null,
  created_at: AT,
  under_review_at: null,
  canceled_at: null,
  decided_at: AT,
  decision_note: 'Checked.',
  approved_level: 4.75,
  adjustment_id: EVENT,
  owner_id: OWNER,
  owner_display_name: null,
  snapshot_rating_revision: 1,
  under_review_by: null,
  decision_actor_id: ADMIN
};

const adjustment = {
  id: EVENT,
  level_review_request_id: ID,
  user_id: OWNER,
  event_type: 'ADMIN_REVIEW_ADJUSTMENT',
  reason: 'Checked.',
  actor_id: ADMIN,
  decided_at: AT,
  effective_at: AT,
  projection_revision: 9,
  boundary_played_at: AT,
  boundary_group_id: 'ffffffff-ffff-4fff-8fff-ffffffffffff',
  boundary_basis: 'match_watermark',
  rating_engine: 'app-wide-level',
  rating_config_version: 1,
  before_engine_version: '1.0.0',
  after_engine_version: '1.1.0',
  before_display_level: 4,
  after_display_level: 4.75,
  before_reliability_percent: 16,
  after_reliability_percent: 10,
  before_confirmed_groups: 1,
  after_confirmed_groups: 1,
  before_highest_display_level: 4.1,
  after_highest_display_level: 4.75,
  before_sigma: 1,
  after_sigma: 1,
  last_rating_at: AT,
  reliability_mode: 'reset',
  reliability_target: 10,
  exception_justification: 'Long break'
};

describe('resolution decoder', () => {
  it('decodes the approval with its immutable audit event and a rejection without one', () => {
    const approved = decodeLevelReviewResolution({
      request: adminDto,
      replayed: false,
      adjustment
    });
    expect(approved.adjustment).toEqual(adjustment);
    expect(approved.request.adjustment_id).toBe(approved.adjustment!.id);
    const rejected = decodeLevelReviewResolution({
      request: { ...adminDto, status: 'rejected', approved_level: null, adjustment_id: null },
      replayed: true,
      adjustment: null
    });
    expect(rejected).toMatchObject({ replayed: true, adjustment: null });
  });

  it('fails closed on a missing, extra or malformed field of the event', () => {
    const decode = (patch: Record<string, unknown>) =>
      decodeLevelReviewResolution({
        request: adminDto,
        replayed: false,
        adjustment: { ...adjustment, ...patch }
      });
    expect(() => decode({ event_type: 'MATCH' })).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decode({ boundary_basis: 'wall_clock' })).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decode({ reliability_mode: 'boost' })).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decode({ actor_id: 'not-a-uuid' })).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decode({ leaked: 1 })).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decodeLevelReviewResolution({ request: adminDto, replayed: false })).toThrow(
      'INVALID_LEVEL_REVIEW_RESPONSE'
    );
    expect(() =>
      decodeLevelReviewResolution({ request: adminDto, replayed: false, adjustment, extra: 1 })
    ).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
  });

  it('carries the audit event on the admin detail', () => {
    const detail = decodeLevelReviewAdminDetail({
      request: adminDto,
      current: null,
      rating_changed: true,
      adjustment,
      recent_history: []
    });
    expect(detail.adjustment).toEqual(adjustment);
  });
});

describe('resolve validator: reliability decision', () => {
  const base = {
    request_id: ID,
    command_id: CMD,
    decision: 'approve',
    note: 'ok',
    target_level: 4.75,
    expected_revision: 3
  };

  it('treats an absent decision as preserve and accepts the explicit forms', () => {
    expect(validateResolveLevelReview(base)).not.toHaveProperty('reliability');
    expect(
      validateResolveLevelReview({ ...base, reliability: { mode: 'preserve' } })
    ).toMatchObject({
      reliability: { mode: 'preserve' }
    });
    expect(
      validateResolveLevelReview({
        ...base,
        reliability: { mode: 'reset', justification: ' Break ' }
      })
    ).toMatchObject({ reliability: { mode: 'reset', justification: 'Break' } });
    expect(
      validateResolveLevelReview({
        ...base,
        reliability: { mode: 'reduce', target: 0, justification: 'Injury' }
      })
    ).toMatchObject({ reliability: { mode: 'reduce', target: 0 } });
  });

  it('requires a justification for exceptions and bounds the reduction target', () => {
    const attempt = (reliability: unknown) => () =>
      validateResolveLevelReview({ ...base, reliability });
    expect(attempt({ mode: 'reset' })).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    expect(attempt({ mode: 'reset', justification: '   ' })).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    expect(attempt({ mode: 'reset', justification: 'x', target: 10 })).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(attempt({ mode: 'reduce', justification: 'x' })).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    expect(attempt({ mode: 'reduce', target: 100, justification: 'x' })).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(attempt({ mode: 'reduce', target: -1, justification: 'x' })).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(attempt({ mode: 'reduce', target: 1.5, justification: 'x' })).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(attempt({ mode: 'preserve', justification: 'x' })).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    expect(attempt({ mode: 'boost', justification: 'x' })).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    expect(attempt({ mode: 'reset', justification: 'x', extra: 1 })).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
  });

  it('never accepts reliability on a rejection', () => {
    expect(() =>
      validateResolveLevelReview({
        request_id: ID,
        command_id: CMD,
        decision: 'reject',
        note: 'no',
        reliability: { mode: 'preserve' }
      })
    ).toThrow('INVALID_LEVEL_REVIEW_INPUT');
  });
});

describe('approval error codes', () => {
  it('maps the new database message and no longer knows the fail-closed one', () => {
    expect(levelReviewErrorFromDatabase({ message: 'LEVEL_REVIEW_RELIABILITY_INVALID' })).toBe(
      'LEVEL_REVIEW_RELIABILITY_INVALID'
    );
    expect(levelReviewErrorFromDatabase({ message: 'LEVEL_REVIEW_APPROVAL_UNAVAILABLE' })).toBe(
      'LEVEL_REVIEW_UNAVAILABLE'
    );
    expect(levelReviewErrorCode(new Error('LEVEL_REVIEW_STALE_RATING'))).toBe(
      'LEVEL_REVIEW_STALE_RATING'
    );
  });
});

describe('rating timeline contracts: discriminated match and adjustment items', () => {
  const adjustmentItem = {
    kind: 'adjustment',
    adjustment_id: EVENT,
    level_review_request_id: ID,
    event_type: 'ADMIN_REVIEW_ADJUSTMENT',
    effective_at: AT,
    reason: 'Checked.',
    outcome: 'approved',
    before_display_level: 4,
    after_display_level: 4.75,
    before_reliability_percent: 16,
    after_reliability_percent: 10,
    reliability_changed: true,
    after_confirmed_groups: 1,
    calculation_revision: 9
  };

  it('keeps match items and decodes adjustments from safe fields only', () => {
    const page = parseRatingHistoryPage({
      ...historyPayload,
      items: [adjustmentItem, ...historyPayload.items]
    })!;
    expect(page.items.map((item) => item.kind)).toEqual(['adjustment', 'match']);
    expect(page.total_events).toBe(1);
    expect(page.items[0]).toEqual(adjustmentItem);
  });

  it('rejects unknown kinds, a match without kind and malformed adjustments', () => {
    const decode = (item: unknown) => parseRatingHistoryPage({ ...historyPayload, items: [item] });
    expect(decode({ ...adjustmentItem, kind: 'other' })).toBeNull();
    expect(decode({ ...historyPayload.items[0], kind: undefined })).toBeNull();
    expect(decode({ ...adjustmentItem, outcome: 'rejected' })).toBeNull();
    expect(decode({ ...adjustmentItem, event_type: 'MATCH' })).toBeNull();
    expect(decode({ ...adjustmentItem, adjustment_id: 'nope' })).toBeNull();
    expect(decode({ ...adjustmentItem, reason: '' })).toBeNull();
  });

  it('decodes chart points of both kinds and keeps the match count separate', () => {
    const progress = parseRatingProgress({
      ...progressPayload,
      total_points: 2,
      points: [
        ...progressPayload.points,
        {
          ordinal: 2,
          kind: 'adjustment',
          event_id: EVENT,
          game_group_id: null,
          played_at: AT,
          display_level: 4.75
        }
      ]
    })!;
    expect(progress).toMatchObject({ total_events: 1, total_points: 2 });
    expect(progress.points.map((point) => [point.kind, point.game_group_id])).toEqual([
      ['match', progressPayload.points[0]!.game_group_id],
      ['adjustment', null]
    ]);
  });

  it('rejects inconsistent chart points', () => {
    const decode = (point: unknown) => parseRatingProgress({ ...progressPayload, points: [point] });
    const match = progressPayload.points[0]!;
    expect(decode({ ...match, kind: 'adjustment' })).toBeNull();
    expect(decode({ ...match, event_id: EVENT })).toBeNull();
    expect(decode({ ...match, game_group_id: null })).toBeNull();
    expect(decode({ ...match, kind: 'other' })).toBeNull();
    expect(
      decode({
        ordinal: 1,
        kind: 'adjustment',
        event_id: EVENT,
        game_group_id: EVENT,
        played_at: AT,
        display_level: 4
      })
    ).toBeNull();
    expect(parseRatingProgress({ ...progressPayload, total_points: undefined })).toBeNull();
  });
});
