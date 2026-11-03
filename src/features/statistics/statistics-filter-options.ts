import { listMyLeagueCommunities } from '../leagues/league.functions';
import type { CommunityLeagueOption } from './statistics-community-contracts';
import { getCommunityStatistics } from './statistics-community.functions';
import type { StatisticsFilters } from './statistics-contracts';

/** What the filter bar needs besides the filters themselves: the selectable Leagues of the community. */
export type FilterOptions = {
  leagues: CommunityLeagueOption[];
  activeLeagueId: string | null;
  communities?: { id: string; name: string }[];
  leagueLoadFailed?: boolean;
};

/** Switching scope must never retain a League from another community. */
export function selectCommunityScope(
  filters: StatisticsFilters,
  communityId: string | null
): StatisticsFilters {
  return { ...filters, communityId, leagueId: null };
}

export const NO_FILTER_OPTIONS: FilterOptions = { leagues: [], activeLeagueId: null };

/**
 * League choices for pages whose own payload carries none (player, partnership, head-to-head).
 * Only a selected community has Leagues; failed reads remain distinguishable from empty results.
 */
export async function readFilterOptions(filters: StatisticsFilters): Promise<FilterOptions> {
  const communities = await listMyLeagueCommunities().catch(() => []);
  if (filters.communityId === null) return { ...NO_FILTER_OPTIONS, communities };
  try {
    const result = await getCommunityStatistics({ data: { communityId: filters.communityId } });
    if (result?.status !== 'ok')
      return { ...NO_FILTER_OPTIONS, communities, leagueLoadFailed: true };
    return {
      leagues: result.value.leagues,
      activeLeagueId: result.value.activeLeagueId,
      communities
    };
  } catch {
    return { ...NO_FILTER_OPTIONS, communities, leagueLoadFailed: true };
  }
}
