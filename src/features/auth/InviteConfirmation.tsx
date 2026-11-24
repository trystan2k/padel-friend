import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { textLinkProps } from '../../components/ui/TextLink';
import { PRIVACY_CONTACT_EMAIL } from '../privacy/privacy-content';
import { AuthActionBar, AuthTopBar } from './AuthChrome';
import { chromeStyles } from './auth-chrome.styles';
import { styles } from './invite-confirmation.styles';

type InviteConfirmationProps = {
  confirmation:
    | { csrf: string; account: string; email: string | null }
    | { error: 'verification_failed' }
    | null;
};

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width="26"
      height="26"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {children}
    </svg>
  );
}

const mailCheck = (
  <Icon>
    <path d="M22 13V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v12c0 1.1.9 2 2 2h8" />
    <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
    <path d="m16 19 2 2 4-4" />
  </Icon>
);
const triangleAlert = (
  <Icon>
    <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3" />
    <path d="M12 9v4" />
    <path d="M12 17h.01" />
  </Icon>
);
const loaderCircle = (
  <Icon>
    <path d="M21 12a9 9 0 1 1-6.219-8.56" />
  </Icon>
);

function StatusTile({ tone, children }: { tone: 'green' | 'red' | 'amber'; children: ReactNode }) {
  const toneStyle =
    tone === 'green' ? styles.tileGreen : tone === 'red' ? styles.tileRed : styles.tileAmber;
  return (
    <div {...stylex.props(styles.tileRow)}>
      <div {...stylex.props(styles.tile, toneStyle)}>{children}</div>
    </div>
  );
}

function BackToSignIn() {
  const { t } = useTranslation();
  return (
    <Button
      render={<a href="/login" aria-label={t('auth.inviteBackToSignIn')} />}
      nativeButton={false}
      variant="secondary"
    >
      {t('auth.inviteBackToSignIn')}
    </Button>
  );
}

export function InviteConfirmation({ confirmation }: InviteConfirmationProps) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);

  // The confirmation is a plain document POST: a bfcache restore must not stay stuck on "busy".
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => {
      if (event.persisted) setBusy(false);
    };
    window.addEventListener('pageshow', reset);
    return () => window.removeEventListener('pageshow', reset);
  }, []);

  if (!confirmation || !('csrf' in confirmation)) {
    const failed = confirmation !== null;
    return (
      <main {...stylex.props(chromeStyles.page)}>
        <AuthTopBar title={t('auth.inviteBarTitle')} />
        <div {...stylex.props(chromeStyles.content, chromeStyles.contentTight)}>
          <StatusTile tone={failed ? 'red' : 'amber'}>{triangleAlert}</StatusTile>
          <div {...stylex.props(chromeStyles.heading)}>
            <h1 {...stylex.props(chromeStyles.title)}>
              {t(failed ? 'auth.inviteFailedTitle' : 'auth.inviteExpiredTitle')}
            </h1>
            <p role="alert" {...stylex.props(chromeStyles.body)}>
              {t(failed ? 'auth.inviteConfirmVerificationFailed' : 'auth.inviteConfirmExpired')}
            </p>
          </div>
          <SurfaceCard xstyle={styles.helpCard}>
            <h2 {...stylex.props(styles.helpTitle)}>{t('auth.inviteHelpTitle')}</h2>
            <p {...stylex.props(styles.helpHint)}>{t('auth.inviteHelpHint')}</p>
            <a href={`mailto:${PRIVACY_CONTACT_EMAIL}`} {...textLinkProps(styles.helpLink)}>
              {t('auth.inviteHelpLink')}
            </a>
          </SurfaceCard>
        </div>
        <AuthActionBar>
          <BackToSignIn />
        </AuthActionBar>
      </main>
    );
  }

  return (
    <main {...stylex.props(chromeStyles.page)}>
      <AuthTopBar title={t('auth.inviteBarTitle')} />
      <form
        method="post"
        action="/auth/callback"
        aria-labelledby="invite-title"
        onSubmit={() => setBusy(true)}
        {...stylex.props(chromeStyles.form)}
      >
        <input type="hidden" name="csrf" value={confirmation.csrf} />
        <input type="hidden" name="account" value={confirmation.account} />
        <div {...stylex.props(chromeStyles.content, chromeStyles.contentTight)}>
          <StatusTile tone="green">{busy ? loaderCircle : mailCheck}</StatusTile>
          <div {...stylex.props(chromeStyles.heading)}>
            <h1 id="invite-title" {...stylex.props(chromeStyles.title)}>
              {t(busy ? 'auth.inviteBusyTitle' : 'auth.inviteConfirmTitle')}
            </h1>
            <p {...stylex.props(chromeStyles.body)}>
              {t(busy ? 'auth.inviteBusyDescription' : 'auth.inviteConfirmDescription')}
            </p>
          </div>
          {confirmation.account && !busy && (
            <p role="alert" {...stylex.props(styles.warning)}>
              {confirmation.email
                ? t('auth.inviteAccountWarning', { email: confirmation.email })
                : t('auth.inviteAccountWarningUnknown')}
            </p>
          )}
        </div>
        <AuthActionBar>
          <Button type="submit" busy={busy} xstyle={busy ? styles.busyButton : undefined}>
            {t(
              busy
                ? 'auth.inviteAccepting'
                : confirmation.account
                  ? 'auth.inviteSwitchConfirm'
                  : 'auth.inviteConfirm'
            )}
          </Button>
          {!busy && (
            <Button
              render={<a href="/login" aria-label={t('auth.inviteCancel')} />}
              nativeButton={false}
              variant="secondary"
            >
              {t('auth.inviteCancel')}
            </Button>
          )}
        </AuthActionBar>
      </form>
    </main>
  );
}
