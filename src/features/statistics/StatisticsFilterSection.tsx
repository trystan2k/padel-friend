import { useTranslation } from 'react-i18next';
import { Section } from './PlayerMetric';
import { StatisticsFilters } from './StatisticsFilters';
import type { StatisticsFilters as Filters } from './statistics-contracts';
import type { FilterOptions } from './statistics-filter-options';

export type FilterControls = { options: FilterOptions; onApply: (next: Filters) => void };

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
  return (
    <Section id={id} title={t('statistics.filters.title')}>
      <StatisticsFilters
        key={JSON.stringify(filters)}
        filters={filters}
        leagues={controls.options.leagues}
        activeLeagueId={controls.options.activeLeagueId}
        onApply={controls.onApply}
      />
    </Section>
  );
}
