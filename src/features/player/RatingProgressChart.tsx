import { Collapsible } from '@base-ui/react/collapsible';
import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { buildLevelChart, type LevelBar } from './rating-chart';
import type { RatingProgress } from './rating-contracts';
import { formatAbsoluteDelta, formatLevel, formatRatingDate } from './rating-format';
import { journey as j } from './rating-journey.styles';
import { rating as s } from './rating.styles';

/** Chart glyph of the empty state tile (lucide chart-column). */
function ChartIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...stylex.props(j.tileIcon)}
    >
      <path d="M3 3v16a2 2 0 0 0 2 2h16M18 17V9M13 17V5M8 17v-3" />
    </svg>
  );
}

/**
 * Lifetime progression (frames lNj83 / PYxIz): the latest level and its all-time change, one bar
 * per month plus the latest level, and the full data table behind a disclosure. The plot is
 * decorative; the screen-reader summary and the table carry every value.
 */
export function RatingProgressChart({ progress }: { progress: RatingProgress }) {
  const { t, i18n } = useTranslation();
  const [tableOpen, setTableOpen] = useState(false);
  const locale = i18n.language;

  if (progress.state === 'unavailable' || !progress.baseline)
    return (
      <SurfaceCard xstyle={j.card}>
        <h3 {...stylex.props(j.emptyTitle)}>{t('rating.progress.title')}</h3>
        <p {...stylex.props(j.emptyBody)}>{t('rating.progress.unavailable')}</p>
      </SurfaceCard>
    );

  const baselineLevel = progress.baseline.display_level;
  const chart = buildLevelChart(progress);
  if (!chart || !progress.range)
    return (
      <SurfaceCard xstyle={j.card}>
        <span aria-hidden="true" {...stylex.props(j.tile)}>
          <ChartIcon />
        </span>
        <h3 {...stylex.props(j.emptyTitle)}>{t('rating.history.emptyTitle')}</h3>
        <p {...stylex.props(j.emptyBody)}>{t('rating.progress.emptyBody')}</p>
        <hr {...stylex.props(j.divider)} />
        <div {...stylex.props(j.rowLine)}>
          <span {...stylex.props(j.rowTitle)}>{t('rating.progress.startingLevel')}</span>
          <strong {...stylex.props(j.rowValue)}>{formatLevel(baselineLevel, locale)}</strong>
        </div>
      </SurfaceCard>
    );

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
  const change = Math.round(chart.change * 100);
  const barLabel = (bar: LevelBar) =>
    bar.label.kind === 'latest'
      ? t('rating.progress.latest')
      : bar.label.kind === 'start'
        ? t('rating.progress.start')
        : new Intl.DateTimeFormat(locale, { month: 'short', timeZone: 'UTC' }).format(
            new Date(bar.label.instant)
          );
  const span = chart.ceiling - chart.floor;

  return (
    <SurfaceCard xstyle={j.card}>
      <h3 {...stylex.props(s.srOnly)}>{t('rating.progress.title')}</h3>
      <div {...stylex.props(j.headline)}>
        <p {...stylex.props(j.level)}>{formatLevel(chart.current, locale)}</p>
        <p
          {...stylex.props(
            j.change,
            change > 0 ? j.changeUp : change < 0 ? j.changeDown : j.changeFlat
          )}
        >
          {change === 0
            ? t('rating.progress.changeFlat')
            : t(change > 0 ? 'rating.progress.changeUp' : 'rating.progress.changeDown', {
                value: formatAbsoluteDelta(chart.change, locale)
              })}
        </p>
      </div>
      <p {...stylex.props(j.caption)}>{t('rating.progress.scopeCaption')}</p>
      <div aria-hidden="true" {...stylex.props(j.chart)}>
        <div {...stylex.props(j.axis)}>
          {chart.ticks.map((tick) => (
            <span key={tick}>{formatLevel(tick, locale)}</span>
          ))}
        </div>
        <div {...stylex.props(j.plot)}>
          <div {...stylex.props(j.bars)}>
            {chart.bars.map((bar) => (
              <div
                key={bar.key}
                {...stylex.props(j.bar, bar.latest && j.barLatest)}
                style={{ height: `${((bar.level - chart.floor) / span) * 100}%` }}
              />
            ))}
          </div>
          <div {...stylex.props(j.dates)}>
            {chart.bars.map((bar) => (
              <span key={bar.key} {...stylex.props(j.date)}>
                {barLabel(bar)}
              </span>
            ))}
          </div>
        </div>
      </div>
      <div {...stylex.props(j.legend)}>
        <span aria-hidden="true" {...stylex.props(j.swatch)} />
        <span {...stylex.props(j.caption)}>
          {t('rating.progress.legendLatest', { date: formatRatingDate(chart.latestAt, locale) })}
        </span>
      </div>
      <p {...stylex.props(s.srOnly)}>{summary}</p>
      {progress.abbreviated && (
        <p {...stylex.props(j.caption)}>
          {t('rating.progress.abbreviated', {
            shown: progress.points.filter((point) => point.kind === 'match').length,
            total: progress.total_events
          })}
        </p>
      )}
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
                      {point.kind === 'adjustment'
                        ? t('rating.progress.adjustmentRow')
                        : point.ordinal}
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
