import { describe, expect, it } from 'vitest';
import {
  decodeHistoryCursor,
  encodeHistoryCursor,
  validateStatisticsHistoryInput
} from '../src/features/statistics/statistics.validators';

const id = '11111111-1111-4111-8111-111111111111';
const instant = '2030-01-01T12:30:00.123456Z';

describe('history cursor validation', () => {
  it('round trips a revision and stable key', () => {
    const cursor = encodeHistoryCursor(3, { at: instant, key: id });
    expect(decodeHistoryCursor(cursor)).toEqual({ revision: 3, at: instant, key: id });
    expect(validateStatisticsHistoryInput({ cursor }).limit).toBe(20);
  });

  it.each([
    { at: instant, key: `g:${'-'.repeat(36)}` },
    { at: instant, key: `e:${'-'.repeat(36)}:1` },
    { at: '2030-02-31T12:30:00.123456Z', key: id }
  ])('rejects malformed keysets', (position) => {
    expect(() => decodeHistoryCursor(encodeHistoryCursor(3, position))).toThrow(
      'INVALID_STATISTICS_INPUT'
    );
  });
});
