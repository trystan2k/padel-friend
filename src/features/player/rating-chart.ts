import { MAX_LEVEL, MIN_LEVEL } from './rating-config';
import type { RatingProgress } from './rating-contracts';

// Level chart of the Clubhouse rating journey frames (lNj83 / PYxIz): one bar per month with the
// level the player held at the end of that month, then a highlighted bar for the latest level.
// Everything is derived from the committed projection points; no value is invented.

/** Four month bars plus the latest bar, as in the frames. */
export const MAX_LEVEL_BARS = 5;

export type LevelBar = {
  key: string;
  level: number;
  /** Axis label: the month of `instant`, the starting level, or the latest bar. */
  label: { kind: 'month'; instant: string } | { kind: 'start' } | { kind: 'latest' };
  latest: boolean;
};

export type LevelChart = {
  /** Level after the most recent point (the headline figure). */
  current: number;
  /** Latest level minus the starting level. */
  change: number;
  latestAt: string;
  bars: LevelBar[];
  /** Axis ticks from the top of the plot to its floor. */
  ticks: number[];
  floor: number;
  ceiling: number;
};

const hundredths = (value: number) => Math.round(value * 100);

function tickStep(span: number): number {
  if (span <= 100) return 25;
  if (span <= 250) return 50;
  return 100;
}

/** Null when there is nothing to chart (unavailable, or no confirmed point yet). */
export function buildLevelChart(progress: RatingProgress): LevelChart | null {
  const { baseline, points } = progress;
  const last = points[points.length - 1];
  if (progress.state !== 'ready' || !baseline || !last) return null;

  // Last point of each earlier month; the latest point only ever feeds the highlighted bar.
  const months = new Map<string, LevelBar>();
  for (const point of points.slice(0, -1))
    months.set(point.played_at.slice(0, 7), {
      key: point.played_at.slice(0, 7),
      level: point.display_level,
      label: { kind: 'month', instant: point.played_at },
      latest: false
    });
  const earlier = [...months.values()].slice(-(MAX_LEVEL_BARS - 1));
  const first: LevelBar[] =
    earlier.length > 0
      ? earlier
      : [{ key: 'start', level: baseline.display_level, label: { kind: 'start' }, latest: false }];
  const bars: LevelBar[] = [
    ...first,
    { key: 'latest', level: last.display_level, label: { kind: 'latest' }, latest: true }
  ];

  const levels = bars.map((bar) => hundredths(bar.level));
  const low = Math.min(...levels) - 25;
  const high = Math.max(...levels);
  const step = tickStep(high - low);
  const floor = Math.max(hundredths(MIN_LEVEL), Math.floor(low / step) * step);
  const ceiling = Math.min(
    hundredths(MAX_LEVEL),
    Math.max(Math.ceil(high / step) * step, floor + step)
  );
  const ticks: number[] = [];
  for (let tick = ceiling; tick >= floor; tick -= step) ticks.push(tick / 100);

  return {
    current: last.display_level,
    change: last.display_level - baseline.display_level,
    latestAt: last.played_at,
    bars,
    ticks,
    floor: floor / 100,
    ceiling: ceiling / 100
  };
}
