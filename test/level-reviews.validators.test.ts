import { describe, expect, it } from 'vitest';
import {
  levelValue,
  validateLevelReviewList,
  validateLevelReviewQueue,
  validateLevelReviewRequest,
  validateResolveLevelReview,
  validateSubmitLevelReview
} from '../src/features/level-reviews/level-review-validators';

const ID = '11111111-1111-4111-8111-111111111111';
const CMD = '22222222-2222-4222-8222-222222222222';
const submit = (overrides: Record<string, unknown> = {}) => ({
  command_id: CMD,
  requested_min_level: 4.5,
  requested_max_level: 5,
  reason: 'Consistent results',
  ...overrides
});

describe('level review validators', () => {
  it.each([0, 7, 0.01, 4.35, 6.99, 3])('accepts level %s', (level) => {
    expect(levelValue(level)).toBe(level);
  });

  it.each([
    -0.01,
    7.01,
    7.001,
    1e-7,
    4.355,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    '4.5',
    null,
    undefined
  ])('rejects level %s before any rounding', (level) => {
    expect(() => levelValue(level)).toThrow('INVALID_LEVEL_REVIEW_INPUT');
  });

  it('accepts an exact level (min = max) and trims text', () => {
    expect(
      validateSubmitLevelReview(
        submit({ requested_min_level: 5, reason: '  because  ', evidence: ' https://x.test/a ' })
      )
    ).toEqual({
      command_id: CMD,
      requested_min_level: 5,
      requested_max_level: 5,
      reason: 'because',
      evidence: 'https://x.test/a'
    });
  });

  it('treats missing, null and blank evidence as none', () => {
    for (const evidence of [undefined, null, '', '   '])
      expect(validateSubmitLevelReview(submit({ evidence })).evidence).toBeNull();
  });

  it('rejects min > max, bad ids, unexpected keys and non-objects', () => {
    for (const bad of [
      submit({ requested_min_level: 5.5, requested_max_level: 5 }),
      submit({ command_id: 'nope' }),
      submit({ owner_id: ID }),
      submit({ status: 'approved' }),
      submit({ current_level: 4 }),
      submit({ requested_max_level: undefined }),
      null,
      [],
      'x'
    ])
      expect(() => validateSubmitLevelReview(bad)).toThrow('INVALID_LEVEL_REVIEW_INPUT');
  });

  it('bounds reason and evidence by Unicode code points', () => {
    const emoji = '😀';
    expect(validateSubmitLevelReview(submit({ reason: emoji.repeat(2000) })).reason).toHaveLength(
      4000
    );
    expect(() => validateSubmitLevelReview(submit({ reason: emoji.repeat(2001) }))).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(() => validateSubmitLevelReview(submit({ reason: '   ' }))).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(() => validateSubmitLevelReview(submit({ reason: 'a\u0000b' }))).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(validateSubmitLevelReview(submit({ evidence: 'e'.repeat(4000) })).evidence).toHaveLength(
      4000
    );
    expect(() => validateSubmitLevelReview(submit({ evidence: 'e'.repeat(4001) }))).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(() => validateSubmitLevelReview(submit({ evidence: 5 }))).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
  });

  it('validates list pagination bounds and keyset cursors', () => {
    const cursor = { created_at: '2026-11-03T10:00:00.123456Z', id: ID };
    expect(validateLevelReviewList(undefined)).toEqual({});
    expect(validateLevelReviewList({ limit: 50, cursor })).toEqual({ limit: 50, cursor });
    for (const bad of [
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { cursor: { created_at: '2026-11-03T10:00:00Z', id: ID } },
      { cursor: { created_at: cursor.created_at, id: 'x' } },
      { cursor: { ...cursor, extra: 1 } },
      { offset: 3 }
    ])
      expect(() => validateLevelReviewList(bad)).toThrow('INVALID_LEVEL_REVIEW_INPUT');
  });

  it('allowlists the admin queue status filter', () => {
    expect(validateLevelReviewQueue({ status: 'under_review', limit: 5 })).toEqual({
      status: 'under_review',
      limit: 5
    });
    expect(validateLevelReviewQueue(undefined)).toEqual({});
    for (const status of ['all', 'PENDING', '', null, 3])
      expect(() => validateLevelReviewQueue({ status })).toThrow('INVALID_LEVEL_REVIEW_INPUT');
  });

  it('requires an exact request id', () => {
    expect(validateLevelReviewRequest({ request_id: ID })).toEqual({ request_id: ID });
    expect(() => validateLevelReviewRequest({ request_id: ID, owner_id: ID })).toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(() => validateLevelReviewRequest({})).toThrow('INVALID_LEVEL_REVIEW_INPUT');
  });

  describe('resolution', () => {
    const base = { request_id: ID, command_id: CMD, note: ' Looks right ' };

    it('reject takes only a note', () => {
      expect(validateResolveLevelReview({ ...base, decision: 'reject' })).toEqual({
        ...base,
        note: 'Looks right',
        decision: 'reject'
      });
      expect(() =>
        validateResolveLevelReview({ ...base, decision: 'reject', target_level: 5 })
      ).toThrow('INVALID_LEVEL_REVIEW_INPUT');
      expect(() =>
        validateResolveLevelReview({ ...base, decision: 'reject', expected_revision: 1 })
      ).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    });

    it('approve needs a valid target and an expected revision', () => {
      expect(
        validateResolveLevelReview({
          ...base,
          decision: 'approve',
          target_level: 4.75,
          expected_revision: 3
        })
      ).toMatchObject({ decision: 'approve', target_level: 4.75, expected_revision: 3 });
      for (const bad of [
        { target_level: 4.751, expected_revision: 3 },
        { target_level: 8, expected_revision: 3 },
        { target_level: 4.5 },
        { expected_revision: 3 },
        { target_level: 4.5, expected_revision: -1 },
        { target_level: 4.5, expected_revision: 1.5 }
      ])
        expect(() => validateResolveLevelReview({ ...base, decision: 'approve', ...bad })).toThrow(
          'INVALID_LEVEL_REVIEW_INPUT'
        );
    });

    it('requires a nonempty note and a known decision, rejects forged fields', () => {
      expect(() => validateResolveLevelReview({ ...base, note: '  ', decision: 'reject' })).toThrow(
        'INVALID_LEVEL_REVIEW_INPUT'
      );
      expect(() => validateResolveLevelReview({ ...base, decision: 'approved' })).toThrow(
        'INVALID_LEVEL_REVIEW_INPUT'
      );
      expect(() =>
        validateResolveLevelReview({ ...base, decision: 'reject', decision_actor_id: ID })
      ).toThrow('INVALID_LEVEL_REVIEW_INPUT');
      expect(() =>
        validateResolveLevelReview({ ...base, note: 'x'.repeat(2001), decision: 'reject' })
      ).toThrow('INVALID_LEVEL_REVIEW_INPUT');
    });
  });
});
