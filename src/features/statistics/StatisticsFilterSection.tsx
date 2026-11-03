import * as stylex from '@stylexjs/stylex';
import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { communityStyles as s } from './statistics-community.styles';
import { selectCommunityScope } from './statistics-filter-options';
import { Section } from './PlayerMetric';
import { StatisticsFilters } from './StatisticsFilters';
import { StatisticsError } from './StatisticsStates';
import type { StatisticsFilters as Filters } from './statistics-contracts';
import type { FilterOptions } from './statistics-filter-options';

export type FilterControls = {
  options: FilterOptions;
  onApply: (next: Filters) => void;
  onRetry?: () => void;
};

/** The filter bar as its own labelled section; applying writes the URL through the page's navigate. */
export function StatisticsFilterSection({
  id,
  filters,
  controls
}: {
  id: string;
  filters: Filters;
  controls: FilterControls;
}) {
  const { t } = useTranslation();
  const communityId = useId();
  return (
    <Section id={id} title={t('statistics.filters.title')}>
      <div {...stylex.props(s.field)}>
        <label htmlFor={communityId} {...stylex.props(s.label)}>
          {t('statistics.filters.community')}
        </label>
        <select
          id={communityId}
          value={filters.communityId ?? ''}
          onChange={(event) =>
            controls.onApply(selectCommunityScope(filters, event.target.value || null))
          }
          {...stylex.props(s.select)}
        >
          <option value="">{t('statistics.filters.allCommunities')}</option>
          {(controls.options.communities ?? []).map((community) => (
            <option key={community.id} value={community.id}>
              {community.name}
            </option>
          ))}
        </select>
      </div>
      {controls.options.leagueLoadFailed ? (
        <StatisticsError code="STATISTICS_UNAVAILABLE" onRetry={controls.onRetry} />
      ) : (
        <StatisticsFilters
          key={JSON.stringify(filters)}
          filters={filters}
          leagues={controls.options.leagues}
          activeLeagueId={controls.options.activeLeagueId}
          onApply={controls.onApply}
        />
      )}
    </Section>
  );
}
