import { describe, expect, it } from 'vitest';
import { validateStatisticsRelationshipInput } from '../src/features/statistics/statistics.validators';

const playerId = '11111111-1111-4111-8111-111111111111';
const otherId = '22222222-2222-4222-8222-222222222222';

describe('relationship meeting pagination', () => {
  it('defaults the recent offset to zero', () => {
    expect(validateStatisticsRelationshipInput({ playerId, otherId }).recentOffset).toBe(0);
  });
  it('accepts nonnegative integer offsets and rejects invalid offsets', () => {
    expect(
      validateStatisticsRelationshipInput({ playerId, otherId, recentOffset: 20 }).recentOffset
    ).toBe(20);
    for (const recentOffset of [-1, 1.5, '20'])
      expect(() =>
        validateStatisticsRelationshipInput({ playerId, otherId, recentOffset })
      ).toThrow('INVALID_STATISTICS_INPUT');
  });
});
