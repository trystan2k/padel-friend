import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { styles } from './reset-password.styles';

type InviteConfirmationProps = {
  confirmation:
    | { csrf: string; account: string; email: string | null }
    | { error: 'verification_failed' }
    | null;
};

export function InviteConfirmation({ confirmation }: InviteConfirmationProps) {
  const { t } = useTranslation();
  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.brand)}>{t('auth.welcomeBrand')}</span>
        <h1 id="invite-title" {...stylex.props(styles.title)}>
          {t('auth.inviteConfirmTitle')}
        </h1>
        <p {...stylex.props(styles.subtitle)}>{t('auth.inviteConfirmDescription')}</p>
      </header>
      {confirmation && 'csrf' in confirmation ? (
        <form
          method="post"
          action="/auth/callback"
          aria-labelledby="invite-title"
          {...stylex.props(styles.form)}
        >
          <input type="hidden" name="csrf" value={confirmation.csrf} />
          <input type="hidden" name="account" value={confirmation.account} />
          {confirmation.account && (
            <p role="alert" {...stylex.props(styles.warning)}>
              {confirmation.email
                ? t('auth.inviteAccountWarning', { email: confirmation.email })
                : t('auth.inviteAccountWarningUnknown')}
            </p>
          )}
          <Button type="submit" size="large">
            {t(confirmation.account ? 'auth.inviteSwitchConfirm' : 'auth.inviteConfirm')}
          </Button>
          <Button
            render={<a href="/login" aria-label={t('auth.inviteCancel')} />}
            nativeButton={false}
            variant="secondary"
            size="large"
          >
            {t('auth.inviteCancel')}
          </Button>
        </form>
      ) : (
        <div {...stylex.props(styles.form)}>
          <p role="alert" {...stylex.props(styles.error)}>
            {t(confirmation ? 'auth.inviteConfirmVerificationFailed' : 'auth.inviteConfirmExpired')}
          </p>
          <Button
            render={<a href="/login" aria-label={t('auth.inviteCancel')} />}
            nativeButton={false}
            size="large"
          >
            {t('auth.inviteCancel')}
          </Button>
        </div>
      )}
    </main>
  );
}
