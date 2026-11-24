import * as stylex from '@stylexjs/stylex';
import { useRouter } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { ui } from './player-ui.styles';

export function LoadingProfile() {
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

/** `next` is the private route to return to after signing in again when the session expired. */
export function ProfileError({ error, next }: { error: unknown; next: string }) {
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
          expired ? window.location.assign(`/login?next=${next}`) : void router.invalidate()
        }
        {...stylex.props(ui.button)}
      >
        {t('auth.retry')}
      </button>
    </main>
  );
}
