import { describe, expect, it } from 'vitest';
import { buildLevelChart } from '../src/features/player/rating-chart';
import { parseRatingProgress } from '../src/features/player/rating-contracts';
import { progressPayload } from './helpers/rating-read-fixtures';

const point = (ordinal: number, playedAt: string, level: number) => ({
  ordinal,
  kind: 'match',
  event_id: `00000000-0000-4000-8000-00000000000${ordinal}`,
  game_group_id: `00000000-0000-4000-8000-00000000000${ordinal}`,
  played_at: playedAt,
  display_level: level
});
const progress = (points: ReturnType<typeof point>[], baseline = 3.5) => {
  const parsed = parseRatingProgress({
    ...progressPayload,
    baseline: { display_level: baseline },
    total_events: points.length,
    total_points: points.length,
    range: { from: points[0]!.played_at, to: points.at(-1)!.played_at },
    points
  });
  if (!parsed) throw new Error('invalid progress fixture');
  return parsed;
};

describe('buildLevelChart', () => {
  it('uses month-end levels, an early bar for the latest month and a highlighted latest bar', () => {
    const chart = buildLevelChart(
      progress([
        point(1, '2026-08-20T10:00:00.000000Z', 3.51),
        point(2, '2026-09-20T10:00:00.000000Z', 3.57),
        point(3, '2026-10-20T10:00:00.000000Z', 3.62),
        point(4, '2026-11-05T10:00:00.000000Z', 3.76),
        point(5, '2026-11-19T10:00:00.000000Z', 3.82)
      ])
    );
    expect(chart?.bars.map((bar) => [bar.key, bar.level, bar.latest])).toEqual([
      ['2026-08', 3.51, false],
      ['2026-09', 3.57, false],
      ['2026-10', 3.62, false],
      ['2026-11', 3.76, false],
      ['latest', 3.82, true]
    ]);
    expect(chart?.current).toBe(3.82);
    expect(chart?.change).toBeCloseTo(0.32, 5);
    // Frame axis: 4.00 down to 3.25 in 0.25 steps.
    expect(chart?.ticks).toEqual([4, 3.75, 3.5, 3.25]);
    expect([chart?.floor, chart?.ceiling]).toEqual([3.25, 4]);
  });

  it('keeps only the latest four month bars plus the latest level', () => {
    const chart = buildLevelChart(
      progress(
        Array.from({ length: 7 }, (_, index) =>
          point(index + 1, `2026-0${index + 1}-10T10:00:00.000000Z`, 3.5 + index * 0.1)
        )
      )
    );
    expect(chart?.bars).toHaveLength(5);
    expect(chart?.bars.at(-1)?.latest).toBe(true);
    expect(chart?.bars[0]?.key).toBe('2026-03');
  });

  it('starts from the starting level when there is no earlier month', () => {
    const chart = buildLevelChart(progress([point(1, '2026-11-01T10:00:00.000000Z', 4.12)], 4));
    expect(chart?.bars.map((bar) => bar.label.kind)).toEqual(['start', 'latest']);
    expect(chart?.bars[0]?.level).toBe(4);
    expect(chart?.change).toBeCloseTo(0.12, 5);
  });

  it('draws nothing without a confirmed point or when progress is unavailable', () => {
    expect(
      buildLevelChart(
        parseRatingProgress({ ...progressPayload, state: 'empty', range: null, points: [] })!
      )
    ).toBeNull();
    expect(
      buildLevelChart(
        parseRatingProgress({
          ...progressPayload,
          state: 'unavailable',
          baseline: null,
          range: null,
          points: []
        })!
      )
    ).toBeNull();
  });
});
