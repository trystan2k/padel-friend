import * as stylex from '@stylexjs/stylex';
import { createFileRoute, useRouter, Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlayerProfile } from '../features/player/PlayerProfile';
import { CommunityAdminEntries } from '../features/community/CommunityAdmin';
import { listMyAdminCommunities } from '../features/community/community-admin.functions';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { listMyCommunityNotifications } from '../features/community/community-request.functions';
import { CommunityInbox } from '../features/community/CommunityInbox';
import { ui } from '../features/player/player-ui.styles';
import { InvitationDiscoverability } from '../features/community/InvitationDiscoverability';
import { getMyUnreadNotificationCount } from '../features/notifications/notifications.functions';
import { NotificationBadge } from '../features/notifications/NotificationBadge';

export async function loadDashboardData() {
  const [profile, adminCommunities, inbox, notificationCount] = await Promise.all([
    getMyPlayerProfile(),
    listMyAdminCommunities().catch(() => []),
    listMyCommunityNotifications({ data: { offset: 0, limit: 20 } })
      .then((items) => ({ items, error: false }))
      .catch(() => ({ items: null, error: true })),
    getMyUnreadNotificationCount().catch(() => null)
  ]);
  const dashboardData = { profile, adminCommunities, inbox };
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
  const { profile, adminCommunities, inbox, notificationCount } = Route.useLoaderData();
  return (
    <>
      <header>
        <NotificationBadge count={notificationCount ?? null} />
        <nav aria-label={t('matches.navigationLabel')}>
          <Link to="/matches">{t('matches.navigationLabel')}</Link>{' '}
          <Link to="/matches/create">{t('matches.create')}</Link>
        </nav>
      </header>
      <PlayerProfile initialProfile={profile} />
      <CommunityAdminEntries communities={adminCommunities} />
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
