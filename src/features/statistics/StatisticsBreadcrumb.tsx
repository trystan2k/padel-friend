import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { StatisticsFilters } from './statistics-contracts';
import { filterSearch } from './statistics-search';
import { statisticsStyles as c } from './statistics.styles';

/** Player statistics, then the relationship page being read; the player link keeps the filters. */
export function StatisticsBreadcrumb({
  playerId,
  filters,
  current
}: {
  playerId: string;
  filters: StatisticsFilters;
  current: 'pair' | 'opponent';
}) {
  const { t } = useTranslation();
  return (
    <nav aria-label={t('statistics.navigation.label')}>
      <ol {...stylex.props(c.breadcrumbList)}>
        <li>
          <Link
            to="/players/$playerId"
            params={{ playerId }}
            search={filterSearch(filters)}
            {...stylex.props(c.breadcrumbLink)}
          >
            {t('statistics.navigation.player')}
          </Link>
        </li>
        <li aria-hidden="true">/</li>
        <li aria-current="page" {...stylex.props(c.breadcrumbCurrent)}>
          {t(`statistics.navigation.${current}`)}
        </li>
      </ol>
    </nav>
  );
}
