import * as stylex from '@stylexjs/stylex';
import { rootStyles } from '../root.styles';
import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
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
import { getMyUnreadNotificationCount } from '../features/notifications/notifications.functions';
import { NotificationBadge } from '../features/notifications/NotificationBadge';

export async function loadDashboardData() {
  const [
    profile,
    rating,
    adminCommunities,
    leagueCommunities,
    inbox,
    notificationCount,
    platformAdmin
  ] = await Promise.all([
    getMyPlayerProfile(),
    loadRatingView(),
    listMyAdminCommunities().catch(() => []),
    listMyLeagueCommunities().catch(() => []),
    listMyCommunityNotifications({ data: { offset: 0, limit: 20 } })
      .then((items) => ({ items, error: false }))
      .catch(() => ({ items: null, error: true })),
    getMyUnreadNotificationCount().catch(() => null),
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
    platformAdmin
  };
  return { ...dashboardData, notificationCount: notificationCount ?? undefined };
}

export const Route = createFileRoute('/_protected/dashboard')({
  loader: loadDashboardData,
  pendingComponent: LoadingProfile,
  errorComponent: ProfileError,
  component: Dashboard
});

function Dashboard() {
  const { t } = useTranslation();
  const router = useRouter();
  const {
    profile,
    rating,
    adminCommunities,
    leagueCommunities,
    inbox,
    notificationCount,
    platformAdmin
  } = Route.useLoaderData();
  return (
    <>
      <header {...stylex.props(rootStyles.pageHeader)}>
        <NotificationBadge count={notificationCount ?? null} />
        <nav aria-label={t('matches.navigationLabel')}>
          <Link to="/matches">{t('matches.navigationLabel')}</Link>{' '}
          <Link to="/matches/create">{t('matches.create')}</Link>{' '}
          <Link to="/players/$playerId" params={{ playerId: profile.user_id }}>
            {t('statistics.player.myStatistics')}
          </Link>
        </nav>
      </header>
      <PlayerProfile
        initialProfile={profile}
        initialRating={rating}
        onRatingReload={() => void router.invalidate()}
      />
      <PlatformAdminEntry allowed={platformAdmin} />
      <CommunityAdminEntries communities={adminCommunities} />
      <LeagueEntries communities={leagueCommunities} />
      <CommunityInbox initialItems={inbox.items} loadError={inbox.error} />
      <InvitationDiscoverability />
    </>
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
