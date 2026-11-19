import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { PlayerProfile } from '../features/player/PlayerProfile';
import { CommunityAdminEntries } from '../features/community/CommunityAdmin';
import { listMyAdminCommunities } from '../features/community/community-admin.functions';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { LeagueEntries } from '../features/leagues/LeagueEntries';
import { PlatformAdminEntry } from '../features/level-reviews/PlatformAdminEntry';
import { getLevelReviewAccess } from '../features/level-reviews/level-review.functions';
import { listMyLeagueCommunities } from '../features/leagues/league.functions';
import { loadRatingView } from '../features/player/rating-view';
import { listMyCommunityNotifications } from '../features/community/community-request.functions';
import { CommunityInbox } from '../features/community/CommunityInbox';
import { LoadingProfile, ProfileError } from '../features/player/ProfileStates';
import { InvitationDiscoverability } from '../features/community/InvitationDiscoverability';
import { useRouteRefresh } from '../lib/use-route-refresh';
import { getHome } from '../features/home/home.functions';
import { HomeDashboard } from '../features/home/HomeDashboard';
import { parseHomeSearch } from '../features/home/home.validators';

export async function loadDashboardData(deps: { community?: string } = {}) {
  const [profile, rating, adminCommunities, leagueCommunities, inbox, home, platformAdmin] =
    await Promise.all([
      getMyPlayerProfile(),
      loadRatingView(),
      listMyAdminCommunities().catch(() => []),
      listMyLeagueCommunities().catch(() => []),
      listMyCommunityNotifications({ data: { offset: 0, limit: 20 } })
        .then((items) => ({ items, error: false }))
        .catch(() => ({ items: null, error: true })),
      // An expired session invalidates the whole private view; any other failure is an explicit
      // Home error, never an empty Home.
      getHome({ data: { community_id: deps.community ?? null } }).catch((error: unknown) => {
        if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
        return null;
      }),
      getLevelReviewAccess()
        .then((access) => access.is_platform_admin)
        .catch(() => false)
    ]);
  const dashboardData = {
    profile,
    rating,
    adminCommunities,
    leagueCommunities,
    inbox,
    home,
    platformAdmin
  };
  return { ...dashboardData, notificationCount: home?.unread ?? undefined };
}

export const Route = createFileRoute('/_protected/dashboard')({
  // The selected community is navigable context in the URL; membership is re-verified server-side.
  validateSearch: parseHomeSearch,
  loaderDeps: ({ search }) => ({ community: search.community }),
  loader: ({ deps }) => loadDashboardData(deps),
  pendingComponent: LoadingProfile,
  errorComponent: ({ error }) => <ProfileError error={error} next="/dashboard" />,
  component: Dashboard
});

function Dashboard() {
  const router = useRouter();
  const navigate = useNavigate();
  const { profile, rating, adminCommunities, leagueCommunities, inbox, home, platformAdmin } =
    Route.useLoaderData();
  // Home converges with other clients through the authorized loaders; the scope pins the refresh
  // to this account and selected community so a switch never reuses another view's loop.
  useRouteRefresh({ scope: `home:${profile.user_id}:${home?.selection.selectedId ?? 'none'}` });
  return (
    <main>
      <HomeDashboard
        home={home}
        playerId={profile.user_id}
        displayName={profile.display_name}
        level={(rating.status === 'ok' ? rating.summary.summary : null) ?? profile}
        onSelect={(community) =>
          void navigate({ to: '/dashboard', search: { community }, replace: false })
        }
        onRetry={() => void router.invalidate()}
      />
      <div id="home-profile">
        <PlayerProfile
          embedded
          initialProfile={profile}
          initialRating={rating}
          onRatingReload={() => void router.invalidate()}
        />
      </div>
      <PlatformAdminEntry allowed={platformAdmin} />
      <div id="home-community">
        <CommunityAdminEntries communities={adminCommunities} />
        <LeagueEntries communities={leagueCommunities} />
        <CommunityInbox initialItems={inbox.items} loadError={inbox.error} />
        <InvitationDiscoverability />
      </div>
    </main>
  );
}
