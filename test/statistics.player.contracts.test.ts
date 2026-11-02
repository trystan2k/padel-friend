import { describe, expectTypeOf, it } from 'vitest';
import type { MetricState } from '../src/features/statistics/statistics-contracts';
import type {
  PlayerActivity,
  PlayerAdvancedStatistics,
  PlayerFormSample,
  PlayerRank,
  PlayerRankHistory,
  PlayerStatistics
} from '../src/features/statistics/statistics-player-contracts';

describe('player statistics transport contract', () => {
  it('keeps missing denominators, form and ranks as evidence-bearing states', () => {
    expectTypeOf<PlayerStatistics['matches']['winRate']>().toEqualTypeOf<MetricState>();
    expectTypeOf<
      PlayerStatistics['typeRates']['competitive']['setRate']
    >().toEqualTypeOf<MetricState>();
    expectTypeOf<PlayerStatistics['form']['last5']>().toEqualTypeOf<
      MetricState<PlayerFormSample>
    >();
    expectTypeOf<PlayerRankHistory['coverageFrom']>().toEqualTypeOf<string | null>();
    expectTypeOf<PlayerRankHistory['coverageUntil']>().toEqualTypeOf<string | null>();
    expectTypeOf<PlayerRankHistory['coverageReason']>().toEqualTypeOf<
      'missing_rating_evidence' | 'unpublished_league' | 'no_history' | null
    >();
    expectTypeOf<PlayerStatistics['rating']['communitySkillRank']>().toEqualTypeOf<
      MetricState<PlayerRank>
    >();
    expectTypeOf<
      PlayerStatistics['rating']['lowestEstablishedLevel']
    >().toEqualTypeOf<MetricState>();
    expectTypeOf<PlayerAdvancedStatistics['firstSetConversionRate']>().toEqualTypeOf<MetricState>();
    expectTypeOf<PlayerActivity['weeklyAverage']>().toEqualTypeOf<MetricState>();
  });
});
