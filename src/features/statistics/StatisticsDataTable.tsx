import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { playerStyles as s } from './statistics-player.styles';
import { statisticsStyles as c } from './statistics.styles';

export type DataTableRow = { key: string; header: string; value: string };

/**
 * The textual equivalent of a chart: a real table with a caption, scoped headers and every plotted
 * value, zeros included. The scroll region is focusable so it stays operable by keyboard at zoom.
 */
export function StatisticsDataTable({
  caption,
  headerLabel,
  valueLabel,
  rows
}: {
  caption: string;
  headerLabel: string;
  valueLabel: string;
  rows: DataTableRow[];
}) {
  const { t } = useTranslation();
  return (
    <section
      // oxlint-disable-next-line jsx-a11y/no-noninteractive-tabindex -- a scrollable region must be keyboard reachable
      tabIndex={0}
      aria-label={t('statistics.charts.tableLabel', { title: caption })}
      {...stylex.props(c.tableRegion)}
    >
      <table {...stylex.props(s.table)}>
        <caption {...stylex.props(s.caption)}>{caption}</caption>
        <thead>
          <tr>
            <th scope="col" {...stylex.props(s.cell)}>
              {headerLabel}
            </th>
            <th scope="col" {...stylex.props(s.cell)}>
              {valueLabel}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.key}>
              <th scope="row" {...stylex.props(s.cell)}>
                {row.header}
              </th>
              <td {...stylex.props(s.cell)}>{row.value}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
