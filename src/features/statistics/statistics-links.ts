import type { StatisticsFilters } from './statistics-contracts';

export const FILTER_SEARCH_KEYS = ['communityId', 'leagueId', 'type', 'from', 'through'] as const;
export type FilterSearch = Partial<Record<(typeof FILTER_SEARCH_KEYS)[number], string>>;

/** Route search of a statistics page: only string filters survive; the server validator is the authority. */
export function parseFilterSearch(search: Record<string, unknown>): FilterSearch {
  return Object.fromEntries(
    FILTER_SEARCH_KEYS.flatMap((key) => {
      const value = search[key];
      return typeof value === 'string' && value !== '' ? [[key, value]] : [];
    })
  );
}

/** Normalized filters as route search, so player → pair → head-to-head links keep their scope. */
export function filterSearch(filters: StatisticsFilters): FilterSearch {
  return parseFilterSearch({ ...filters, type: filters.type === 'all' ? null : filters.type });
}
