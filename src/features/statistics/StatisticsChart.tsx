import { Collapsible } from '@base-ui/react/collapsible';
import * as stylex from '@stylexjs/stylex';
import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatisticsDataTable } from './StatisticsDataTable';
import { playerStyles as s } from './statistics-player.styles';
import { statisticsStyles as c } from './statistics.styles';

// Plot geometry is in SVG user units; the SVG scales fluidly with its container.
const WIDTH = 240;
const HEIGHT = 80;
const BAR_SHARE = 0.7;

export type ChartPoint = { key: string; label: string; value: number };

/**
 * A bar series with its textual equivalent. The figure has a heading and a numeric summary, the
 * SVG is decorative, and a Show data disclosure exposes a real table of EVERY value (not only the
 * plotted tail), so a sampled chart never claims to be the complete data.
 */
export function StatisticsChart({
  title,
  headerLabel,
  valueLabel,
  points,
  plotLimit,
  formatValue
}: {
  title: string;
  headerLabel: string;
  valueLabel: string;
  points: ChartPoint[];
  /** Newest points that are drawn; the table always keeps all of them. */
  plotLimit: number;
  formatValue: (value: number) => string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const headingId = useId();
  const plotted = points.slice(-plotLimit);
  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return null;
  const peak = points.reduce((best, point) => (point.value > best.value ? point : best), first);
  const total = points.reduce((sum, point) => sum + point.value, 0);
  const scale = Math.max(1, ...plotted.map((point) => point.value));
  const slot = WIDTH / plotted.length;
  return (
    <figure aria-labelledby={headingId} {...stylex.props(c.figure)}>
      <h3 id={headingId} {...stylex.props(s.subheading)}>
        {title}
      </h3>
      <p {...stylex.props(c.summary)}>
        {t('statistics.charts.summary', {
          count: points.length,
          from: first.label,
          to: last.label,
          total: formatValue(total),
          peak: formatValue(peak.value),
          peakLabel: peak.label
        })}
      </p>
      <svg
        aria-hidden="true"
        focusable="false"
        viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
        preserveAspectRatio="none"
        {...stylex.props(s.chart)}
      >
        <line x1={0} x2={WIDTH} y1={HEIGHT} y2={HEIGHT} {...stylex.props(c.baseline)} />
        {plotted.map((point, index) => {
          const height = (point.value / scale) * HEIGHT;
          return (
            <rect
              key={point.key}
              x={index * slot + (slot * (1 - BAR_SHARE)) / 2}
              y={HEIGHT - height}
              width={slot * BAR_SHARE}
              height={height}
              {...stylex.props(s.bar)}
            />
          );
        })}
      </svg>
      {points.length > plotted.length && (
        <p {...stylex.props(c.summary)}>
          {t('statistics.charts.sampled', {
            shown: formatValue(plotted.length),
            total: formatValue(points.length)
          })}
        </p>
      )}
      <Collapsible.Root open={open} onOpenChange={setOpen}>
        <Collapsible.Trigger {...stylex.props(c.disclosureTrigger)}>
          {t(open ? 'statistics.charts.hideData' : 'statistics.charts.showData')}
        </Collapsible.Trigger>
        <Collapsible.Panel keepMounted={false}>
          <StatisticsDataTable
            caption={title}
            headerLabel={headerLabel}
            valueLabel={valueLabel}
            rows={points.map((point) => ({
              key: point.key,
              header: point.label,
              value: formatValue(point.value)
            }))}
          />
        </Collapsible.Panel>
      </Collapsible.Root>
    </figure>
  );
}
