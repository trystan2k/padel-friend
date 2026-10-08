import * as stylex from '@stylexjs/stylex';
import { createFileRoute, useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { PlayerProfile } from '../features/player/PlayerProfile';
import { CommunityAdminEntries } from '../features/community/CommunityAdmin';
import { listMyAdminCommunities } from '../features/community/community-admin.functions';
import { getMyPlayerProfile } from '../features/player/player.functions';
import { ui } from '../features/player/player-ui.styles';

export const Route = createFileRoute('/_protected/dashboard')({
  loader: async () => {
    const [profile, adminCommunities] = await Promise.all([
      getMyPlayerProfile(),
      listMyAdminCommunities()
    ]);
    return { profile, adminCommunities };
  },
  pendingComponent: LoadingProfile,
  errorComponent: ProfileError,
  component: Dashboard
});

function Dashboard() {
  const { profile, adminCommunities } = Route.useLoaderData();
  return (
    <>
      <PlayerProfile initialProfile={profile} />
      <CommunityAdminEntries communities={adminCommunities} />
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
