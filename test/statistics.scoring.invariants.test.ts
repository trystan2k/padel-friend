import { describe, expect, it } from 'vitest';
import { ratioMetric } from '../src/features/statistics/statistics-model';

describe('threshold evidence boundaries', () => {
  it.each([0, 1, 2, 3, 4, 5])('requires five matches at sample size %i', (sample) => {
    const result = ratioMetric(sample, sample, { minimum: 5, reason: 'minimum_matches' });
    expect(result).toMatchObject(
      sample < 5
        ? {
            state: 'insufficient',
            value: null,
            observed: sample,
            required: 5,
            reason: 'minimum_matches'
          }
        : { state: 'ready', value: 1, denominator: 5 }
    );
  });
  it.each([0, 1, 2, 3, 4, 5])(
    'requires three conversion opportunities at sample size %i',
    (sample) => {
      const result = ratioMetric(sample, sample, { minimum: 3 });
      expect(result.state).toBe(sample < 3 ? 'insufficient' : 'ready');
    }
  );
  it('honors a configurable threshold', () => {
    expect(ratioMetric(6, 6, { minimum: 7 })).toMatchObject({
      state: 'insufficient',
      observed: 6,
      required: 7
    });
    expect(ratioMetric(7, 7, { minimum: 7 })).toMatchObject({ state: 'ready', value: 1 });
  });
});
