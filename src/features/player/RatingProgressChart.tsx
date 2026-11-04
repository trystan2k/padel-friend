import { Collapsible } from '@base-ui/react/collapsible';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { MAX_LEVEL, MIN_LEVEL } from './rating-config';
import type { RatingProgress } from './rating-contracts';
import { formatLevel, formatRatingDate } from './rating-format';
import { rating as s } from './rating.styles';

// Plot geometry is in SVG user units; the SVG scales fluidly with its container.
const WIDTH = 320;
const HEIGHT = 120;
const INSET = 8;
const MARKER_RADIUS = 4;

type PlotPoint = { key: string; level: number; baseline: boolean };

function plotX(index: number, count: number): number {
  return count === 1 ? WIDTH / 2 : INSET + (index * (WIDTH - 2 * INSET)) / (count - 1);
}

function plotY(level: number): number {
  const clamped = Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level));
  return INSET + (1 - (clamped - MIN_LEVEL) / (MAX_LEVEL - MIN_LEVEL)) * (HEIGHT - 2 * INSET);
}

/**
 * Lifetime progression: starting level, then one marker per confirmed game in played order.
 * Spacing follows game order (never time), so lines connect games without implying
 * interpolated levels. Every value is also available in the data table.
 */
export function RatingProgressChart({ progress }: { progress: RatingProgress }) {
  const { t, i18n } = useTranslation();
  const [tableOpen, setTableOpen] = useState(false);
  const locale = i18n.language;

  if (progress.state === 'unavailable' || !progress.baseline)
    return (
      <SurfaceCard xstyle={s.card}>
        <h3 {...stylex.props(s.subheading)}>{t('rating.progress.title')}</h3>
        <p {...stylex.props(s.copy)}>{t('rating.progress.unavailable')}</p>
      </SurfaceCard>
    );

  const baselineLevel = progress.baseline.display_level;
  if (progress.state === 'empty' || progress.points.length === 0 || !progress.range)
    return (
      <SurfaceCard xstyle={s.card}>
        <h3 {...stylex.props(s.subheading)}>{t('rating.progress.title')}</h3>
        <p {...stylex.props(s.copy)}>
          {t('rating.progress.empty', { level: formatLevel(baselineLevel, locale) })}
        </p>
      </SurfaceCard>
    );

  const points: PlotPoint[] = [
    { key: 'baseline', level: baselineLevel, baseline: true },
    ...progress.points.map((point) => ({
      key: point.event_id,
      level: point.display_level,
      baseline: false
    }))
  ];
  const last = progress.points[progress.points.length - 1];
  const from = formatRatingDate(progress.range.from, locale);
  const to = formatRatingDate(progress.range.to, locale);
  const summary = t('rating.progress.summary', {
    count: progress.total_events,
    from,
    to,
    start: formatLevel(baselineLevel, locale),
    end: formatLevel(last?.display_level ?? baselineLevel, locale)
  });
  const coordinates = points.map(
    (point, index) => [plotX(index, points.length), plotY(point.level)] as const
  );
  const line = coordinates.map(([x, y]) => `${x},${y}`).join(' ');
  const floor = plotY(MIN_LEVEL);
  const area = `${plotX(0, points.length)},${floor} ${line} ${plotX(points.length - 1, points.length)},${floor}`;

  return (
    <SurfaceCard xstyle={s.card}>
      <h3 {...stylex.props(s.subheading)}>{t('rating.progress.title')}</h3>
      <div {...stylex.props(s.plot)}>
        <div aria-hidden="true" {...stylex.props(s.axis)}>
          <span>{formatLevel(MAX_LEVEL, locale)}</span>
          <span>{formatLevel((MAX_LEVEL + MIN_LEVEL) / 2, locale)}</span>
          <span>{formatLevel(MIN_LEVEL, locale)}</span>
        </div>
        <svg aria-hidden="true" viewBox={`0 0 ${WIDTH} ${HEIGHT}`} {...stylex.props(s.svg)}>
          {[MAX_LEVEL, (MAX_LEVEL + MIN_LEVEL) / 2, MIN_LEVEL].map((level) => (
            <line
              key={level}
              x1={0}
              x2={WIDTH}
              y1={plotY(level)}
              y2={plotY(level)}
              {...stylex.props(s.gridLine)}
            />
          ))}
          <polygon points={area} {...stylex.props(s.area)} />
          <polyline points={line} {...stylex.props(s.trend)} />
          {points.map((point, index) => (
            <circle
              key={point.key}
              cx={coordinates[index]?.[0]}
              cy={coordinates[index]?.[1]}
              r={MARKER_RADIUS}
              {...stylex.props(point.baseline ? s.baselineMarker : s.point)}
            />
          ))}
        </svg>
      </div>
      <div {...stylex.props(s.rangeLabels)}>
        <span>{t('rating.progress.rangeStart', { date: from })}</span>
        <span>{t('rating.progress.rangeEnd', { date: to })}</span>
      </div>
      <p {...stylex.props(s.copy)}>{summary}</p>
      {progress.abbreviated && (
        <p {...stylex.props(s.copy)}>
          {t('rating.progress.abbreviated', {
            shown: progress.points.length,
            total: progress.total_points
          })}
        </p>
      )}
      <ul {...stylex.props(s.legend)}>
        <li {...stylex.props(s.legendItem)}>
          <svg aria-hidden="true" viewBox="0 0 12 12" {...stylex.props(s.legendGlyph)}>
            <circle cx="6" cy="6" r="4" {...stylex.props(s.baselineMarker)} />
          </svg>
          {t('rating.progress.legendBaseline')}
        </li>
        <li {...stylex.props(s.legendItem)}>
          <svg aria-hidden="true" viewBox="0 0 12 12" {...stylex.props(s.legendGlyph)}>
            <circle cx="6" cy="6" r="4" {...stylex.props(s.point)} />
          </svg>
          {t('rating.progress.legendPoint')}
        </li>
      </ul>
      <p {...stylex.props(s.copy)}>{t('rating.progress.order')}</p>
      <Collapsible.Root open={tableOpen} onOpenChange={setTableOpen}>
        <Collapsible.Trigger {...stylex.props(s.disclosureTrigger)}>
          {t(tableOpen ? 'rating.progress.hideTable' : 'rating.progress.showTable')}
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted={false}>
          <div {...stylex.props(s.tableWrap)}>
            <table {...stylex.props(s.table)}>
              <caption {...stylex.props(s.srOnly)}>{t('rating.progress.tableCaption')}</caption>
              <thead>
                <tr>
                  <th scope="col" {...stylex.props(s.th)}>
                    {t('rating.progress.columnGame')}
                  </th>
                  <th scope="col" {...stylex.props(s.th)}>
                    {t('rating.progress.columnDate')}
                  </th>
                  <th scope="col" {...stylex.props(s.th)}>
                    {t('rating.progress.columnLevel')}
                  </th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <th scope="row" {...stylex.props(s.td)}>
                    {t('rating.progress.baselineRow')}
                  </th>
                  <td {...stylex.props(s.td)}>—</td>
                  <td {...stylex.props(s.td)}>{formatLevel(baselineLevel, locale)}</td>
                </tr>
                {progress.points.map((point) => (
                  <tr key={point.event_id}>
                    <th scope="row" {...stylex.props(s.td)}>
                      {point.ordinal}
                    </th>
                    <td {...stylex.props(s.td)}>{formatRatingDate(point.played_at, locale)}</td>
                    <td {...stylex.props(s.td)}>{formatLevel(point.display_level, locale)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Collapsible.Panel>
      </Collapsible.Root>
    </SurfaceCard>
  );
}
