import { getHome } from '../home/home.functions';
import { parseHomeSearch } from '../home/home.validators';
import type { HomeData } from '../home/home-contracts';
import { listMyLeagueCommunities } from '../leagues/league.functions';
import { getLevelReviewAccess } from '../level-reviews/level-review.functions';
import { getMyPlayerProfile } from '../player/player.functions';
import { loadRatingView } from '../player/rating-view';
import { getCommunityAdminContext, listMyAdminCommunities } from './community-admin.functions';
import { listMyCommunityNotifications } from './community-request.functions';
import { getPublicCommunity } from './community.functions';

export type CommunityView = 'overview' | 'ranking';
export type RankingKind = 'skill' | 'league';

export function parseRankingSearch(search: Record<string, unknown>): { by?: 'league' } {
  return search.by === 'league' ? { by: 'league' } : {};
}

function optional<T, F>(promise: Promise<T>, fallback: F): Promise<T | F> {
  return promise.catch((error: unknown) => {
    if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
    return fallback;
  });
}

/** Never show a fallback community's data under an explicit, unauthorized URL. */
export function resolveCommunitySurface(home: HomeData, requestedId: string | null) {
  if (home.communities.status === 'error') return { status: 'error' } as const;
  const communities = home.communities.status === 'ok' ? home.communities.value : [];
  const selected = communities.find(({ id }) => id === home.selection.selectedId);
  if (requestedId !== null && selected?.id !== requestedId)
    return { status: 'denied', communities } as const;
  return selected
    ? ({ status: 'ready', selected, communities } as const)
    : ({ status: 'empty' } as const);
}

export async function loadCommunitySurface(communityId: string | null, view: CommunityView) {
  const validId = parseHomeSearch({ community: communityId }).community ?? null;
  const [home, adminCommunities] = await Promise.all([
    getHome({ data: { community_id: validId } }),
    optional(listMyAdminCommunities(), [])
  ]);
  const selection = resolveCommunitySurface(home, validId ?? communityId);
  if (selection.status === 'error' || selection.status === 'denied') return selection;
  if (view === 'ranking') {
    if (selection.status !== 'ready') return selection;
    const [profile, rating] = await Promise.all([getMyPlayerProfile(), loadRatingView()]);
    return {
      ...selection,
      view,
      adminCommunities,
      level: (rating.status === 'ok' ? rating.summary.summary : null) ?? profile,
      profile,
      ranking: home.ranking
    } as const;
  }
  const adminId =
    selection.status === 'ready' && adminCommunities.some(({ id }) => id === selection.selected.id)
      ? selection.selected.id
      : null;
  const [metadata, adminContext, leagueCommunities, inbox, platformAdmin] = await Promise.all([
    selection.status === 'ready'
      ? optional(getPublicCommunity({ data: { community_id: selection.selected.id } }), undefined)
      : null,
    adminId ? optional(getCommunityAdminContext({ data: { community_id: adminId } }), null) : null,
    optional(listMyLeagueCommunities(), []),
    optional(
      listMyCommunityNotifications({ data: { offset: 0, limit: 20 } }).then((items) => ({
        items,
        error: false
      })),
      { items: null, error: true }
    ),
    optional(
      getLevelReviewAccess().then((access) => access.is_platform_admin),
      false
    )
  ]);
  return {
    ...selection,
    view,
    adminCommunities,
    metadata,
    adminContext,
    leagueCommunities,
    inbox,
    platformAdmin,
    matches: home.matches,
    activity: home.activity
  } as const;
}

export type CommunitySurfaceData = Awaited<ReturnType<typeof loadCommunitySurface>>;
