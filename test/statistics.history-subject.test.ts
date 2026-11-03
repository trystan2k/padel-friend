import { describe, expect, it } from 'vitest';
import { validateStatisticsHistoryInput } from '../src/features/statistics/statistics.validators';

describe('statistics history subject', () => {
  it('defaults to the caller and accepts a subject UUID', () => {
    expect(validateStatisticsHistoryInput({}).subjectPlayerId).toBeNull();
    expect(
      validateStatisticsHistoryInput({ subjectPlayerId: '11111111-1111-4111-8111-111111111111' })
        .subjectPlayerId
    ).toBe('11111111-1111-4111-8111-111111111111');
  });
  it('rejects malformed subjects', () => {
    expect(() => validateStatisticsHistoryInput({ subjectPlayerId: 'invalid' })).toThrow(
      'INVALID_STATISTICS_INPUT'
    );
  });
});
