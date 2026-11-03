import type { CommunityLeagueOption } from './statistics-community-contracts';
import { getCommunityStatistics } from './statistics-community.functions';
import type { StatisticsFilters } from './statistics-contracts';

/** What the filter bar needs besides the filters themselves: the selectable Leagues of the community. */
export type FilterOptions = { leagues: CommunityLeagueOption[]; activeLeagueId: string | null };

export const NO_FILTER_OPTIONS: FilterOptions = { leagues: [], activeLeagueId: null };

/**
 * League choices for pages whose own payload carries none (player, partnership, head-to-head).
 * Only a selected community has Leagues; a failed read leaves the bar usable without the League field.
 */
export async function readFilterOptions(filters: StatisticsFilters): Promise<FilterOptions> {
  if (filters.communityId === null) return NO_FILTER_OPTIONS;
  try {
    const result = await getCommunityStatistics({ data: { communityId: filters.communityId } });
    if (result?.status !== 'ok') return NO_FILTER_OPTIONS;
    return { leagues: result.value.leagues, activeLeagueId: result.value.activeLeagueId };
  } catch {
    return NO_FILTER_OPTIONS;
  }
}
