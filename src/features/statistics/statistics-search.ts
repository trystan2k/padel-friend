import type { StatisticsFilters } from './statistics-contracts';
import { validateStatisticsFilters } from './statistics.validators';

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

/** Relationship pages retain a page boundary in the URL; invalid offsets reset safely. */
export function parseRelationshipSearch(
  search: Record<string, unknown>
): FilterSearch & { recentOffset?: number } {
  const offset = search.recentOffset;
  return {
    ...parseFilterSearch(search),
    ...(typeof offset === 'number' &&
    Number.isSafeInteger(offset) &&
    offset > 0 &&
    offset <= 2147483640 &&
    offset % 20 === 0
      ? { recentOffset: offset }
      : {})
  };
}

/** Normalized filters as route search, so player → pair → head-to-head links keep their scope. */
export function filterSearch(filters: StatisticsFilters): FilterSearch {
  return parseFilterSearch({ ...filters, type: filters.type === 'all' ? null : filters.type });
}

/** Community statistics keep the community in the path, so its search never carries communityId. */
export function parseCommunitySearch(search: Record<string, unknown>): FilterSearch {
  const { communityId: _path, ...rest } = parseFilterSearch(search);
  return rest;
}

/**
 * Path community plus search → server input; community statistics require a concrete UUID.
 * Null when the combination is invalid, so the page shows a typed error instead of guessing.
 */
export function communityScopeFilters(
  communityId: string,
  search: FilterSearch
): StatisticsFilters | null {
  try {
    return validateStatisticsFilters({
      ...search,
      communityId
    });
  } catch {
    return null;
  }
}
