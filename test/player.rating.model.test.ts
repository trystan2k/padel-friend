import { describe, expect, it } from 'vitest';
import {
  compareReplayKey,
  isRatableResult,
  ratingChangeKind
} from '../src/features/player/rating-model';

describe('rating replay order', () => {
  const early = { playedAt: '2026-11-03T19:30:00.000Z', gameGroupId: 'b' };
  it('orders by instant before id', () => {
    expect(
      compareReplayKey(early, { playedAt: '2026-11-03T19:30:00.001Z', gameGroupId: 'a' })
    ).toBe(-1);
    expect(compareReplayKey({ ...early, playedAt: '2026-11-03T20:30:00+01:00' }, early)).toBe(0);
  });

  it('breaks identical instants by lowercase canonical uuid', () => {
    const low = { playedAt: early.playedAt, gameGroupId: '00000000-0000-4000-9000-000000000016' };
    const high = { playedAt: early.playedAt, gameGroupId: '00000000-0000-4000-9000-000000000017' };
    expect([high, low].sort(compareReplayKey)).toStrictEqual([low, high]);
    expect(compareReplayKey({ ...low, gameGroupId: low.gameGroupId.toUpperCase() }, low)).toBe(0);
  });
});

describe('rating eligibility', () => {
  it('rates only confirmed competitive decisive or drawn results', () => {
    expect(isRatableResult('competitive', 'team_a', 'confirmed')).toBe(true);
    expect(isRatableResult('competitive', 'team_b', 'confirmed')).toBe(true);
    expect(isRatableResult('competitive', 'draw', 'confirmed')).toBe(true);
    expect(isRatableResult('friendly', 'team_a', 'confirmed')).toBe(false);
    expect(isRatableResult('competitive', 'incomplete', 'confirmed')).toBe(false);
    expect(isRatableResult('competitive', null, 'confirmed')).toBe(false);
    expect(isRatableResult('competitive', 'team_a', 'pending')).toBe(false);
    expect(isRatableResult('competitive', 'team_a', 'disputed')).toBe(false);
  });
});

describe('rating change wording class', () => {
  it('distinguishes movement, rounded-to-zero and boundary clamps', () => {
    expect(ratingChangeKind({ appliedDelta: '0.07', clamped: false })).toBe('gain');
    expect(ratingChangeKind({ appliedDelta: '-0.11', clamped: false })).toBe('loss');
    expect(ratingChangeKind({ appliedDelta: '0.00', clamped: false })).toBe('unchanged_rounded');
    expect(ratingChangeKind({ appliedDelta: '0.00', clamped: true })).toBe('unchanged_boundary');
    expect(ratingChangeKind({ appliedDelta: '-0.05', clamped: true })).toBe('loss');
  });
});
