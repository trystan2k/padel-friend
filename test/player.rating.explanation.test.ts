import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  summary: vi.fn<() => Promise<unknown>>(),
  progress: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  history: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('../src/features/player/rating.functions', () => ({
  getMyRatingSummary: mocks.summary,
  getMyRatingProgress: mocks.progress,
  getMyRatingHistory: mocks.history
}));

import {
  formatAbsoluteDelta,
  formatFraction,
  formatLevel,
  formatPercentPoints,
  formatRatingDate,
  formatSignedDelta,
  formatTeamStrength
} from '../src/features/player/rating-format';
import {
  isReliabilityEstablished,
  ratingExplanationNote,
  ratingOutcome
} from '../src/features/player/rating-model';
import { loadRatingView, ratingFailureCode } from '../src/features/player/rating-view';

const stored = {
  expected_score: 0.62,
  outcome_value: 1,
  rounded_delta: 0.08,
  applied_delta: 0.08,
  clamped: false
};

describe('rating explanation wording classes', () => {
  it.each([
    ['gain', stored],
    ['loss', { ...stored, outcome_value: 0, rounded_delta: -0.11, applied_delta: -0.11 }],
    ['zero_rounded', { ...stored, rounded_delta: 0, applied_delta: 0 }],
    [
      'draw_equal',
      { ...stored, expected_score: 0.5, outcome_value: 0.5, rounded_delta: 0, applied_delta: 0 }
    ],
    ['boundary', { ...stored, rounded_delta: 0.04, applied_delta: 0, clamped: true }],
    ['clamped_gain', { ...stored, rounded_delta: 0.08, applied_delta: 0.03, clamped: true }],
    [
      'clamped_loss',
      { ...stored, outcome_value: 0, rounded_delta: -0.08, applied_delta: -0.03, clamped: true }
    ]
  ] as const)('classifies %s from stored fields only', (expected, input) => {
    expect(ratingExplanationNote(input)).toBe(expected);
  });

  it('keeps a draw between unevenly matched teams out of the equal-draw wording', () => {
    expect(
      ratingExplanationNote({
        ...stored,
        expected_score: 0.7,
        outcome_value: 0.5,
        rounded_delta: -0.04,
        applied_delta: -0.04
      })
    ).toBe('loss');
    expect(
      ratingExplanationNote({
        ...stored,
        expected_score: 0.7,
        outcome_value: 0.5,
        rounded_delta: 0,
        applied_delta: 0
      })
    ).toBe('zero_rounded');
  });

  it('maps the stored outcome value and the established-reliability threshold', () => {
    expect([1, 0.5, 0].map(ratingOutcome)).toEqual(['win', 'draw', 'loss']);
    expect(isReliabilityEstablished(94)).toBe(false);
    expect(isReliabilityEstablished(100)).toBe(true);
  });
});

describe('rating formatting', () => {
  it('uses locale decimals with exactly two places for levels and deltas', () => {
    expect(formatLevel(4.1, 'en')).toBe('4.10');
    expect(formatLevel(4.12, 'pt-BR')).toBe('4,12');
    expect(formatLevel(7, 'es')).toBe('7,00');
    expect(formatSignedDelta(0.12, 'en')).toBe('+0.12');
    expect(formatSignedDelta(-0.11, 'es')).toBe('-0,11');
    expect(formatSignedDelta(0, 'en')).toBe('0.00');
    expect(formatAbsoluteDelta(-0.03, 'pt-BR')).toBe('0,03');
  });

  it('formats strengths with three decimals and percentages without decimals', () => {
    expect(formatTeamStrength(4.25, 'pt-BR')).toBe('4,250');
    expect(formatFraction(0.524, 'en')).toBe('52%');
    expect(formatPercentPoints(16, 'en')).toBe('16%');
  });

  it('formats dates in UTC so server and hydration agree', () => {
    expect(formatRatingDate('2026-11-01T23:30:00.000000Z', 'en')).toBe('Nov 1, 2026');
    expect(formatRatingDate('2026-11-01T23:30:00.000000Z', 'pt-BR')).toBe('1 de nov. de 2026');
  });
});

const ok = (revision: number) => ({
  status: 'ok' as const,
  value: { revision, state: 'ready', items: [], points: [] }
});

describe('loadRatingView', () => {
  beforeEach(() => {
    mocks.summary.mockReset();
    mocks.progress.mockReset();
    mocks.history.mockReset();
  });

  it('returns the three reads of one revision together', async () => {
    mocks.summary.mockResolvedValue(ok(3));
    mocks.progress.mockResolvedValue(ok(3));
    mocks.history.mockResolvedValue(ok(3));
    await expect(loadRatingView()).resolves.toMatchObject({ status: 'ok', revision: 3 });
  });

  it('retries once when the projection moved between reads, then reports stale', async () => {
    mocks.summary.mockResolvedValue(ok(3));
    mocks.progress.mockResolvedValue(ok(4));
    mocks.history.mockResolvedValue(ok(3));
    await expect(loadRatingView()).resolves.toEqual({ status: 'error', code: 'stale_revision' });
    expect(mocks.summary).toHaveBeenCalledTimes(2);
  });

  it('recovers when the retry sees one consistent revision', async () => {
    mocks.summary.mockResolvedValueOnce(ok(3)).mockResolvedValueOnce(ok(4));
    mocks.progress.mockResolvedValueOnce(ok(4)).mockResolvedValueOnce(ok(4));
    mocks.history.mockResolvedValue(ok(4));
    await expect(loadRatingView()).resolves.toMatchObject({ status: 'ok', revision: 4 });
  });

  it('passes reader errors through and never turns them into an empty view', async () => {
    mocks.summary.mockResolvedValue({ status: 'error', code: 'forbidden' });
    mocks.progress.mockResolvedValue(ok(3));
    mocks.history.mockResolvedValue(ok(3));
    await expect(loadRatingView()).resolves.toEqual({ status: 'error', code: 'forbidden' });
  });

  it('maps thrown failures: lost session vs transport error', async () => {
    mocks.summary.mockRejectedValue(new Error('UNAUTHENTICATED'));
    mocks.progress.mockResolvedValue(ok(3));
    mocks.history.mockResolvedValue(ok(3));
    await expect(loadRatingView()).resolves.toEqual({ status: 'error', code: 'unauthenticated' });
    mocks.summary.mockRejectedValue(new Error('network'));
    await expect(loadRatingView()).resolves.toEqual({ status: 'error', code: 'unavailable' });
    expect(ratingFailureCode('x')).toBe('unavailable');
  });
});
