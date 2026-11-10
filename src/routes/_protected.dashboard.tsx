import * as stylex from '@stylexjs/stylex';
import { createFileRoute, useNavigate, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
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
import { ui } from '../features/player/player-ui.styles';
import { InvitationDiscoverability } from '../features/community/InvitationDiscoverability';
import { useRouteRefresh } from '../lib/use-route-refresh';
import { getHome } from '../features/home/home.functions';
import { HomeDashboard } from '../features/home/HomeDashboard';
import { HomeNavigation } from '../features/home/HomeNavigation';
import { parseHomeSearch } from '../features/home/home.validators';
import { homeStyles } from '../features/home/home.styles';

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
  errorComponent: ProfileError,
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
      <div aria-hidden="true" {...stylex.props(homeStyles.navClearance)} />
      <HomeNavigation />
    </main>
  );
}

function LoadingProfile() {
  const { t } = useTranslation();
  return (
    <main {...stylex.props(ui.page)}>
      <output {...stylex.props(ui.stateCard)}>
        <span aria-hidden="true" {...stylex.props(ui.stateIcon)}>
          ◌
        </span>
        <div {...stylex.props(ui.stateCopy)}>
          <p {...stylex.props(ui.stateTitle)}>{t('profile.loadingTitle')}</p>
          <p {...stylex.props(ui.stateDescription)}>{t('profile.loading')}</p>
        </div>
      </output>
    </main>
  );
}

function ProfileError({ error }: { error: unknown }) {
  const { t } = useTranslation();
  const router = useRouter();
  const expired = error instanceof Error && error.message === 'UNAUTHENTICATED';
  return (
    <main {...stylex.props(ui.page)}>
      <div role="alert" {...stylex.props(ui.stateCard)}>
        <span aria-hidden="true" {...stylex.props(ui.stateIcon, ui.stateErrorIcon)}>
          !
        </span>
        <div {...stylex.props(ui.stateCopy)}>
          <p {...stylex.props(ui.stateTitle)}>{t('profile.errorTitle')}</p>
          <p {...stylex.props(ui.stateDescription)}>
            {t(expired ? 'auth.sessionExpired' : 'error')}
          </p>
        </div>
      </div>
      <button
        type="button"
        onClick={() =>
          expired ? window.location.assign('/login?next=/dashboard') : void router.invalidate()
        }
        {...stylex.props(ui.button)}
      >
        {t('auth.retry')}
      </button>
    </main>
  );
}
