import { describe, expect, it } from 'vitest';
import {
  decodeLevelReviewAccess,
  decodeLevelReviewAdminCommand,
  decodeLevelReviewAdminDetail,
  decodeLevelReviewCommand,
  decodeLevelReviewList,
  decodeLevelReviewQueue
} from '../src/features/level-reviews/level-review-decoders';
import {
  levelReviewErrorCode,
  levelReviewErrorFromDatabase
} from '../src/features/level-reviews/level-review-errors';

const ID = '11111111-1111-4111-8111-111111111111';
const OWNER = '33333333-3333-4333-8333-333333333333';
const AT = '2026-11-03T10:00:00.123456Z';

const dto = (overrides: Record<string, unknown> = {}) => ({
  id: ID,
  status: 'pending',
  snapshot_display_level: 4,
  snapshot_reliability_percent: 10,
  requested_min_level: 4.5,
  requested_max_level: 5,
  reason: 'Reason',
  evidence: null,
  created_at: AT,
  under_review_at: null,
  canceled_at: null,
  decided_at: null,
  decision_note: null,
  approved_level: null,
  adjustment_id: null,
  ...overrides
});
const adminDto = (overrides: Record<string, unknown> = {}) =>
  dto({
    owner_id: OWNER,
    owner_display_name: 'Ana',
    snapshot_rating_revision: 7,
    under_review_by: null,
    decision_actor_id: null,
    ...overrides
  });

describe('level review decoders', () => {
  it('decodes owner commands and lists with fixed keys', () => {
    expect(decodeLevelReviewCommand({ request: dto(), replayed: false }).request.id).toBe(ID);
    expect(
      decodeLevelReviewList({ items: [dto()], next_cursor: { created_at: AT, id: ID } })
    ).toEqual({ items: [dto()], next_cursor: { created_at: AT, id: ID } });
    expect(decodeLevelReviewList({ items: [], next_cursor: null }).next_cursor).toBeNull();
  });

  it('fails closed on unknown, missing or malformed fields', () => {
    for (const bad of [
      { request: dto({ owner_id: OWNER }), replayed: false },
      { request: { ...dto(), reason: undefined }, replayed: false },
      { request: dto({ status: 'reopened' }), replayed: false },
      { request: dto({ created_at: '2026-11-03' }), replayed: false },
      { request: dto({ snapshot_display_level: Number.NaN }), replayed: false },
      { request: dto(), replayed: 'no' },
      { request: dto() },
      null,
      []
    ])
      expect(() => decodeLevelReviewCommand(bad)).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decodeLevelReviewList({ items: 'x', next_cursor: null })).toThrow(
      'INVALID_LEVEL_REVIEW_RESPONSE'
    );
  });

  it('owner DTO never carries internal actors even when the database adds them', () => {
    expect(() => decodeLevelReviewCommand({ request: adminDto(), replayed: false })).toThrow(
      'INVALID_LEVEL_REVIEW_RESPONSE'
    );
  });

  it('decodes access, queue and admin payloads', () => {
    expect(decodeLevelReviewAccess({ is_platform_admin: true })).toEqual({
      is_platform_admin: true
    });
    expect(() => decodeLevelReviewAccess({ is_platform_admin: 'yes' })).toThrow(
      'INVALID_LEVEL_REVIEW_RESPONSE'
    );
    expect(() => decodeLevelReviewAccess({ is_platform_admin: true, members: [] })).toThrow(
      'INVALID_LEVEL_REVIEW_RESPONSE'
    );
    const item = {
      id: ID,
      status: 'pending',
      owner_id: OWNER,
      owner_display_name: null,
      snapshot_display_level: 4,
      snapshot_reliability_percent: 10,
      requested_min_level: 4.5,
      requested_max_level: 5,
      created_at: AT,
      under_review_at: null,
      decided_at: null
    };
    expect(
      decodeLevelReviewQueue({
        pending_count: 1,
        under_review_count: 0,
        items: [item],
        next_cursor: null
      }).items
    ).toEqual([item]);
    expect(() =>
      decodeLevelReviewQueue({
        pending_count: -1,
        under_review_count: 0,
        items: [],
        next_cursor: null
      })
    ).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(
      decodeLevelReviewAdminCommand({
        request: adminDto({ under_review_by: OWNER }),
        replayed: true
      }).request.under_review_by
    ).toBe(OWNER);
    const detail = {
      request: adminDto(),
      current: {
        revision: 7,
        mu: 4,
        display_level: 4,
        reliability_percent: 10,
        confirmed_competitive_game_groups: 0
      },
      rating_changed: false,
      adjustment: null,
      recent_history: [
        {
          played_at: AT,
          before_display_level: 4,
          after_display_level: 4.1,
          after_reliability_percent: 16
        }
      ]
    };
    expect(decodeLevelReviewAdminDetail(detail)).toEqual(detail);
    expect(decodeLevelReviewAdminDetail({ ...detail, current: null }).current).toBeNull();
    expect(() =>
      decodeLevelReviewAdminDetail({ ...detail, current: { ...detail.current, mu: NaN } })
    ).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() =>
      decodeLevelReviewAdminDetail({ ...detail, current: { ...detail.current, extra: 1 } })
    ).toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
    expect(() => decodeLevelReviewAdminDetail({ ...detail, extra: 1 })).toThrow(
      'INVALID_LEVEL_REVIEW_RESPONSE'
    );
  });
});

describe('level review error mapping', () => {
  it('maps stable database messages and hides everything else', () => {
    expect(levelReviewErrorFromDatabase({ message: 'LEVEL_REVIEW_RATE_LIMITED' })).toBe(
      'LEVEL_REVIEW_RATE_LIMITED'
    );
    expect(levelReviewErrorFromDatabase({ message: 'PROVISIONAL_PLAYER_RESTRICTED' })).toBe(
      'PROVISIONAL_PLAYER_RESTRICTED'
    );
    expect(levelReviewErrorFromDatabase({ message: 'LEVEL_REVIEW_RELIABILITY_INVALID' })).toBe(
      'LEVEL_REVIEW_RELIABILITY_INVALID'
    );
    expect(levelReviewErrorFromDatabase({ message: 'relation "x" does not exist' })).toBe(
      'LEVEL_REVIEW_UNAVAILABLE'
    );
    expect(levelReviewErrorFromDatabase({})).toBe('LEVEL_REVIEW_UNAVAILABLE');
  });

  it('decodes client-side server-function failures', () => {
    expect(levelReviewErrorCode(new Error('UNAUTHENTICATED'))).toBe('UNAUTHENTICATED');
    expect(levelReviewErrorCode(new Error('INVALID_LEVEL_REVIEW_INPUT'))).toBe(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(levelReviewErrorCode(new Error('LEVEL_REVIEW_DUPLICATE_ACTIVE'))).toBe(
      'LEVEL_REVIEW_DUPLICATE_ACTIVE'
    );
    expect(levelReviewErrorCode(new Error('boom'))).toBe('LEVEL_REVIEW_UNAVAILABLE');
    expect(levelReviewErrorCode('boom')).toBe('LEVEL_REVIEW_UNAVAILABLE');
  });
});
