import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { loadRatingView } from '../features/player/rating-view';
import { LoadingProfile, ProfileError } from '../features/player/ProfileStates';
import { useRouteRefresh } from '../lib/use-route-refresh';
import { getHome } from '../features/home/home.functions';
import { HomeDashboard } from '../features/home/HomeDashboard';
import { parseHomeSearch } from '../features/home/home.validators';

export async function loadDashboardData(deps: { community?: string } = {}) {
  const [profile, rating, home] = await Promise.all([
    getMyPlayerProfile(),
    loadRatingView(),
    getHome({ data: { community_id: deps.community ?? null } }).catch((error: unknown) => {
      if (error instanceof Error && error.message === 'UNAUTHENTICATED') throw error;
      return null;
    })
  ]);
  return { profile, rating, home, notificationCount: home?.unread ?? undefined };
}

export const Route = createFileRoute('/_protected/dashboard')({
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
  const { profile, rating, home } = Route.useLoaderData();
  useRouteRefresh({ scope: `home:${profile.user_id}:${home?.selection.selectedId ?? 'none'}` });
  return (
    <main>
      <HomeDashboard
        home={home}
        playerId={profile.user_id}
        displayName={profile.display_name}
        level={(rating.status === 'ok' ? rating.summary.summary : null) ?? profile}
        onSelect={(community) => void navigate({ to: '/dashboard', search: { community } })}
        onRetry={() => void router.invalidate()}
      />
    </main>
  );
}
