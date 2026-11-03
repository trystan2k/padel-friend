import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { Stat } from './PlayerMetric';
import { ReasonText, StatisticsEmpty } from './StatisticsStates';
import { useRelationshipFormat } from './RelationshipRecordView';
import type { MetricState, StatisticsFilters } from './statistics-contracts';
import { filterSearch } from './statistics-search';
import { playerStyles as s } from './statistics-player.styles';
import type {
  RelationshipLeader,
  RelationshipListItem,
  RelationshipMostFrequent
} from './statistics-relationship-contracts';

/** A leader claim, or the typed reason why none is made yet (record stays visible below). */
export function LeaderStat<T extends RelationshipLeader | RelationshipMostFrequent>({
  id,
  label,
  metric,
  helpValues,
  detail
}: {
  id: string;
  label: string;
  metric: MetricState<T>;
  helpValues?: Record<string, string>;
  detail: (value: T) => string;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  if (metric.state !== 'ready') {
    return (
      <Stat id={id} label={label} {...(helpValues ? { helpValues } : {})}>
        <strong {...stylex.props(s.value, s.valueMuted)}>{t('statistics.player.noValue')}</strong>
        <ReasonText metric={metric} />
      </Stat>
    );
  }
  const names = metric.value.players.map((player) => f.name(player.displayName));
  return (
    <Stat id={id} label={label} {...(helpValues ? { helpValues } : {})}>
      <strong {...stylex.props(s.value)}>{f.list(names)}</strong>
      <span {...stylex.props(s.detail)}>{detail(metric.value)}</span>
      {names.length > 1 && (
        <span {...stylex.props(s.detail)}>
          {t('statistics.relationships.records.tied', { players: f.count(names.length) })}
        </span>
      )}
    </Stat>
  );
}

/** Every partner or opponent, most matches first; each row opens the pair or head-to-head view. */
export function RelationshipTable({
  kind,
  playerId,
  filters,
  items,
  total
}: {
  kind: 'partners' | 'opponents';
  playerId: string;
  filters: StatisticsFilters;
  items: RelationshipListItem[];
  total: number;
}) {
  const { t } = useTranslation();
  const f = useRelationshipFormat();
  const search = filterSearch(filters);
  if (items.length === 0) {
    return <StatisticsEmpty>{t(`statistics.relationships.records.${kind}.empty`)}</StatisticsEmpty>;
  }
  return (
    <div {...stylex.props(s.section)}>
      <div {...stylex.props(s.tableScroll)}>
        <table {...stylex.props(s.table)}>
          <caption {...stylex.props(s.caption)}>
            {t(`statistics.relationships.records.${kind}.caption`)}
          </caption>
          <thead>
            <tr>
              <th scope="col" {...stylex.props(s.cell)}>
                {t('statistics.relationships.columns.player')}
              </th>
              <th scope="col" {...stylex.props(s.cell)}>
                {t('statistics.relationships.columns.played')}
              </th>
              <th scope="col" {...stylex.props(s.cell)}>
                {t('statistics.relationships.columns.record')}
              </th>
              <th scope="col" {...stylex.props(s.cell)}>
                {t('statistics.relationships.columns.winRate')}
              </th>
              <th scope="col" {...stylex.props(s.cell)}>
                {t('statistics.relationships.columns.details')}
              </th>
            </tr>
          </thead>
          <tbody>
            {items.map((item) => {
              const name = f.name(item.displayName);
              const label = t(`statistics.relationships.records.${kind}.viewLabel`, { name });
              return (
                <tr key={item.playerId}>
                  <th scope="row" {...stylex.props(s.cell)}>
                    {name}
                  </th>
                  <td {...stylex.props(s.cell)}>{f.count(item.played)}</td>
                  <td {...stylex.props(s.cell)}>
                    {t('statistics.player.form.record', {
                      wins: f.count(item.wins),
                      losses: f.count(item.losses),
                      draws: f.count(item.draws)
                    })}
                  </td>
                  <td {...stylex.props(s.cell)}>
                    {item.winRate.state === 'ready'
                      ? f.ratio(item.winRate.value)
                      : t('statistics.player.noValue')}
                  </td>
                  <td {...stylex.props(s.cell)}>
                    {kind === 'partners' ? (
                      <Link
                        to="/players/$playerId/partners/$partnerId"
                        params={{ playerId, partnerId: item.playerId }}
                        search={search}
                        aria-label={label}
                        {...stylex.props(s.link)}
                      >
                        {t('statistics.relationships.records.view')}
                      </Link>
                    ) : (
                      <Link
                        to="/players/$playerId/opponents/$opponentId"
                        params={{ playerId, opponentId: item.playerId }}
                        search={search}
                        aria-label={label}
                        {...stylex.props(s.link)}
                      >
                        {t('statistics.relationships.records.view')}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {total > items.length && (
        <p {...stylex.props(s.copy)}>
          {t('statistics.relationships.records.showing', {
            shown: f.count(items.length),
            total: f.count(total)
          })}
        </p>
      )}
    </div>
  );
}
