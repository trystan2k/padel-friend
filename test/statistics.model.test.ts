import { describe, expect, it } from 'vitest';
import {
  canonicalMatchup,
  canonicalPair,
  canonicalQuartet,
  currentStreak,
  distinctRelationCount,
  emptyAggregate,
  mergeAggregates,
  mergeCounts,
  mergeDailyBuckets,
  mergeExtrema,
  mergeRecent,
  mergeSequences,
  ratioMetric,
  selectBucketsInRange,
  sequenceFrom
} from '../src/features/statistics/statistics-model';
import type { StatisticsOutcome } from '../src/features/statistics/statistics-contracts';
import {
  aggregateOfLines,
  statsGroupId,
  statsInstant,
  type StatsGroupLine
} from './helpers/statistics-fixtures';

const OUTCOMES: readonly StatisticsOutcome[] = ['W', 'L', 'D'];
const seq = (text: string) =>
  sequenceFrom(text.split('').flatMap((char) => OUTCOMES.filter((outcome) => outcome === char)));

describe('streak monoid', () => {
  it('merges adjacent halves exactly like the concatenated sequence', () => {
    const samples = ['', 'W', 'WW', 'WLW', 'WWDLL', 'LLLW', 'DWWD', 'WWWW', 'LDLD', 'WLLWWW'];
    for (const left of samples)
      for (const right of samples)
        expect(mergeSequences(seq(left), seq(right))).toEqual(seq(left + right));
  });

  it('is associative over every triple of short sequences', () => {
    const samples = ['', 'W', 'L', 'D', 'WW', 'WL', 'LLW', 'WDW', 'DDD', 'WWLL'];
    for (const a of samples)
      for (const b of samples)
        for (const c of samples) {
          const left = mergeSequences(mergeSequences(seq(a), seq(b)), seq(c));
          const right = mergeSequences(seq(a), mergeSequences(seq(b), seq(c)));
          expect(left).toEqual(right);
          expect(left).toEqual(seq(a + b + c));
        }
  });

  it('counts a run that crosses a bucket boundary once', () => {
    const merged = mergeSequences(seq('LWW'), seq('WWL'));
    expect(merged.best_win).toBe(4);
    expect(merged.prefix).toEqual({ k: 'L', len: 1 });
    expect(merged.suffix).toEqual({ k: 'L', len: 1 });
    expect(currentStreak(merged)).toEqual({ kind: 'L', length: 1 });
  });

  it('lets a draw break both streaks and reports no current streak after it', () => {
    const merged = mergeSequences(seq('WW'), seq('DW'));
    expect(merged.best_win).toBe(2);
    expect(currentStreak(seq('WWD'))).toEqual({ kind: null, length: 0 });
    expect(currentStreak(seq('LLW'))).toEqual({ kind: 'W', length: 1 });
  });

  it('merges an all-one-kind half into the neighbouring prefix and suffix', () => {
    const merged = mergeSequences(seq('WW'), seq('WWL'));
    expect(merged.prefix).toEqual({ k: 'W', len: 4 });
    expect(mergeSequences(seq('LWW'), seq('WW')).suffix).toEqual({ k: 'W', len: 4 });
  });
});

describe('aggregate merge over daily buckets', () => {
  const day1: StatsGroupLine[] = [
    {
      group: statsGroupId(1),
      at: statsInstant(0, 1),
      outcome: 'W',
      setsWon: 2,
      gamesWon: 12,
      gamesLost: 7
    },
    {
      group: statsGroupId(2),
      at: statsInstant(1, 1),
      outcome: 'W',
      setsWon: 2,
      gamesWon: 12,
      gamesLost: 5
    }
  ];
  const day2: StatsGroupLine[] = [
    {
      group: statsGroupId(3),
      at: statsInstant(0, 2),
      outcome: 'I',
      gamesWon: 6,
      gamesLost: 4,
      type: 'friendly'
    },
    {
      group: statsGroupId(4),
      at: statsInstant(1, 2),
      outcome: 'W',
      setsWon: 2,
      gamesWon: 12,
      gamesLost: 1
    }
  ];
  const day3: StatsGroupLine[] = [
    {
      group: statsGroupId(5),
      at: statsInstant(0, 3),
      outcome: 'D',
      setsWon: 1,
      setsLost: 1,
      gamesWon: 11,
      gamesLost: 11
    },
    {
      group: statsGroupId(6),
      at: statsInstant(1, 3),
      outcome: 'L',
      setsLost: 2,
      gamesWon: 3,
      gamesLost: 12
    }
  ];
  const bucket = (lines: StatsGroupLine[], played_day: string) => ({
    ...aggregateOfLines(lines),
    played_day
  });
  const buckets = [
    bucket(day1, '2030-01-01'),
    bucket(day2, '2030-01-02'),
    bucket(day3, '2030-01-03')
  ];

  it('equals the aggregate built directly from every group, in any bucket input order', () => {
    const direct = aggregateOfLines([...day1, ...day2, ...day3]);
    expect(mergeDailyBuckets(buckets)).toEqual(direct);
    expect(mergeDailyBuckets([...buckets].reverse())).toEqual(direct);
  });

  it('is associative across bucket grouping', () => {
    const a = buckets[0]!;
    const b = buckets[1]!;
    const c = buckets[2]!;
    expect(mergeAggregates(mergeAggregates(a, b), c)).toEqual(
      mergeAggregates(a, mergeAggregates(b, c))
    );
  });

  it('keeps Incomplete out of outcome counters and the resolved sequence but in the partition', () => {
    const merged = mergeDailyBuckets(buckets);
    expect(merged.confirmed_groups).toBe(6);
    expect(merged.incomplete_groups).toBe(1);
    expect(merged.wins + merged.losses + merged.draws).toBe(5);
    expect(merged.competitive_groups + merged.friendly_groups).toBe(merged.confirmed_groups);
    expect(merged.sequence.n).toBe(5);
    expect(merged.games_won).toBe(12 + 12 + 6 + 12 + 11 + 3);
  });

  it('selects whole UTC days inclusively and merges only the selection', () => {
    const picked = selectBucketsInRange(buckets, '2030-01-02', '2030-01-02');
    expect(picked.map((item) => item.played_day)).toEqual(['2030-01-02']);
    expect(selectBucketsInRange(buckets, null, '2030-01-02')).toHaveLength(2);
    expect(selectBucketsInRange(buckets, '2030-01-03', null)).toHaveLength(1);
    expect(mergeDailyBuckets(picked).confirmed_groups).toBe(2);
  });

  it('keeps first/last play by (played_at, group id) when instants tie', () => {
    const tied = (group: string) =>
      aggregateOfLines([{ group, at: statsInstant(0, 1), outcome: 'W' }]);
    const merged = mergeAggregates(tied(statsGroupId(1)), tied(statsGroupId(2)));
    expect(merged.first_game_group_id).toBe(statsGroupId(1));
    expect(merged.last_game_group_id).toBe(statsGroupId(2));
    expect(mergeAggregates(emptyAggregate(), tied(statsGroupId(2))).first_game_group_id).toBe(
      statsGroupId(2)
    );
    expect(mergeAggregates(tied(statsGroupId(2)), emptyAggregate()).last_game_group_id).toBe(
      statsGroupId(2)
    );
  });

  it('keeps only the last ten keyed outcomes after a merge', () => {
    const items = (from: number, to: number) =>
      Array.from({ length: to - from }, (_, index) => ({
        g: statsGroupId(from + index),
        o: 'W' as const,
        at: statsInstant(from + index)
      }));
    const merged = mergeRecent(items(0, 8), items(8, 15));
    expect(merged).toHaveLength(10);
    expect(merged[0]?.g).toBe(statsGroupId(5));
    expect(merged.at(-1)?.g).toBe(statsGroupId(14));
  });
});

describe('cross-community chronology', () => {
  it('builds the all-communities streak in global order, not from concatenated community streaks', () => {
    // Community X: W(t1) W(t4). Community Y: L(t2) W(t3). Global order: W L W W.
    const lines: Array<StatsGroupLine & { community: 'x' | 'y' }> = [
      { community: 'x', group: statsGroupId(1), at: statsInstant(0), outcome: 'W' },
      { community: 'y', group: statsGroupId(2), at: statsInstant(1), outcome: 'L' },
      { community: 'y', group: statsGroupId(3), at: statsInstant(2), outcome: 'W' },
      { community: 'x', group: statsGroupId(4), at: statsInstant(3), outcome: 'W' }
    ];
    const inCommunity = (community: 'x' | 'y') =>
      aggregateOfLines(lines.filter((line) => line.community === community));
    const global = aggregateOfLines(lines);
    expect(global.sequence.best_win).toBe(2);
    expect(currentStreak(global.sequence)).toEqual({ kind: 'W', length: 2 });
    // Concatenating community streaks (x then y) fakes a longer or different run.
    const concatenated = mergeSequences(inCommunity('x').sequence, inCommunity('y').sequence);
    expect(concatenated).not.toEqual(global.sequence);
    expect(concatenated.best_win).toBe(2);
    expect(concatenated.suffix).toEqual({ k: 'W', len: 1 });
  });

  it('breaks equal-instant ties by the lowercase group id', () => {
    const same = statsInstant(0);
    const a = statsGroupId(10);
    const b = statsGroupId(11);
    const forward = aggregateOfLines([
      { group: b, at: same, outcome: 'L' },
      { group: a, at: same, outcome: 'W' }
    ]);
    expect(forward.recent.map((item) => item.g)).toEqual([a, b]);
    expect(forward.sequence.suffix).toEqual({ k: 'L', len: 1 });
  });
});

describe('extrema and relations merge', () => {
  it('prefers the smaller key, then the earlier instant, then the smaller group id', () => {
    const base = { v: 3, at: statsInstant(0), g: statsGroupId(2) };
    expect(
      mergeExtrema(
        { cleanest_win: { ...base, k: -3 } },
        { cleanest_win: { ...base, k: -5, g: statsGroupId(9) } }
      ).cleanest_win?.k
    ).toBe(-5);
    const tie = mergeExtrema(
      { closest_win: { k: 1, v: 1, at: statsInstant(1), g: statsGroupId(1) } },
      { closest_win: { k: 1, v: 1, at: statsInstant(0), g: statsGroupId(5) } }
    );
    expect(tie.closest_win?.g).toBe(statsGroupId(5));
    expect(mergeExtrema({}, {})).toEqual({});
  });

  it('adds nested counters and counts DISTINCT identities, never summed daily distincts', () => {
    const dayOne = { partners: { p1: { g: 1 }, p2: { g: 1 } } };
    const dayTwo = { partners: { p2: { g: 2 }, p3: { g: 1 } } };
    const merged = mergeCounts(dayOne, dayTwo);
    expect(merged).toEqual({ partners: { p1: { g: 1 }, p2: { g: 3 }, p3: { g: 1 } } });
    expect(distinctRelationCount(merged, 'partners')).toBe(3);
    expect(
      distinctRelationCount(dayOne, 'partners') + distinctRelationCount(dayTwo, 'partners')
    ).toBe(4);
    expect(distinctRelationCount(merged, 'missing')).toBe(0);
  });
});

describe('metric states and canonical identities', () => {
  it('returns a typed insufficient reason for a zero denominator, never 0%, NaN or Infinity', () => {
    const zero = ratioMetric(0, 0);
    expect(zero).toMatchObject({ state: 'insufficient', value: null, reason: 'no_denominator' });
    expect(ratioMetric(0, 4)).toMatchObject({ state: 'ready', value: 0 });
    expect(ratioMetric(3, 4)).toMatchObject({
      state: 'ready',
      value: 0.75,
      numerator: 3,
      denominator: 4
    });
  });

  it.each([0, 1, 2])(
    'is insufficient below the minimum-opportunity boundary at %i observed',
    (observed) => {
      expect(ratioMetric(observed > 0 ? 1 : 0, observed, { minimum: 3 })).toMatchObject({
        state: 'insufficient',
        value: null,
        observed,
        required: 3,
        reason: 'minimum_opportunities'
      });
    }
  );

  it.each([3, 4, 5, 6])('is ready at and above the boundary with %i observed', (observed) => {
    expect(ratioMetric(1, observed, { minimum: 3 })).toMatchObject({
      state: 'ready',
      denominator: observed
    });
  });

  it('canonicalizes pairs and matchups independent of order and side', () => {
    const [a, b, c, d] = [
      '11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222',
      '33333333-3333-4333-8333-333333333333',
      '44444444-4444-4444-8444-444444444444'
    ] as const;
    expect(canonicalPair(a, b)).toEqual(canonicalPair(b.toUpperCase(), a));
    expect(() => canonicalPair(a, a)).toThrow('INVALID_STATISTICS_PAIR');
    expect(canonicalMatchup([a, b], [c, d])).toEqual(canonicalMatchup([d, c], [b, a]));
    expect(() => canonicalMatchup([a, b], [b, a])).toThrow('INVALID_STATISTICS_MATCHUP');
    expect(canonicalQuartet([d, c, b, a])).toEqual([a, b, c, d]);
    expect(() => canonicalQuartet([a, b, c])).toThrow('INVALID_STATISTICS_QUARTET');
  });
});
