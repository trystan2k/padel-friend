import * as stylex from '@stylexjs/stylex';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import brandIcon from '../../../docs/design/padel-friends-app-icon.png';
import { AccountPrompt } from '../../components/ui/AccountPrompt';
import { Button } from '../../components/ui/Button';
import { OrDivider } from '../../components/ui/OrDivider';
import { PrivacyLink } from '../../components/ui/PrivacyLink';
import { PasswordField } from '../../components/ui/PasswordField';
import { TextField } from '../../components/ui/TextField';
import { TextLink } from '../../components/ui/TextLink';
import { TurnstileWidget } from '../../components/ui/TurnstileWidget';
import { useCaptcha } from '../../lib/captcha';
import { getBrowserClient } from '../../lib/supabase/client';
import { useHydrated } from '../../lib/use-hydrated';
import { chromeStyles } from './auth-chrome.styles';
import { styles } from './login-welcome.styles';
import { navigateAfterAuth } from './navigate';
import { PASSWORD_MIN_LENGTH, isPasswordValid } from './password-policy';
import { normalizeReturnPath } from './return-path';

type LoginWelcomeProps = {
  next?: string;
  authError?: boolean;
  expired?: boolean;
  resetSent?: boolean;
};

export function LoginWelcome({
  next: returnPath,
  authError,
  expired,
  resetSent
}: LoginWelcomeProps) {
  const { t } = useTranslation();
  const next = normalizeReturnPath(returnPath);
  const ready = useHydrated();
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  // Guidance only: legacy accounts may predate the policy, so it never blocks a sign-in attempt.
  const [legacyPassword, setLegacyPassword] = useState(false);
  const captcha = useCaptcha();

  async function signInWithGoogle() {
    setMessage('');
    setBusy(true);
    try {
      const callback = new URL('/auth/callback', window.location.origin);
      if (next !== '/dashboard') callback.searchParams.set('next', next);
      const { error } = await getBrowserClient().auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: callback.toString() }
      });
      if (error) {
        setMessage('googleSignInError');
        setBusy(false);
      }
      // No error means provider navigation is in progress; keep controls disabled.
    } catch {
      setMessage('googleSignInError');
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const emailValue = form.get('email');
    const passwordValue = form.get('password');
    const email = typeof emailValue === 'string' ? emailValue : '';
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    if (captcha.enabled && !captcha.token) {
      setMessage(captcha.failed ? 'auth.captchaError' : 'auth.captchaRequired');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { error } = await getBrowserClient().auth.signInWithPassword({
        email,
        password,
        ...(captcha.enabled ? { options: captcha.authOptions } : {})
      });
      captcha.reset();
      if (error) {
        setMessage('auth.unauthorized');
        setBusy(false);
        return;
      }
      navigateAfterAuth(next);
    } catch {
      captcha.reset();
      setMessage('auth.unauthorized');
      setBusy(false);
    }
  }

  return (
    <>
      <main {...stylex.props(styles.page)}>
        <div {...stylex.props(styles.brandBlock)}>
          <img src={brandIcon} alt="" aria-hidden="true" {...stylex.props(styles.logo)} />
          <span {...stylex.props(styles.brand)}>{t('auth.loginBrand')}</span>
        </div>
        <h1 {...stylex.props(chromeStyles.title)}>{t('auth.welcomeTitle')}</h1>
        <p {...stylex.props(chromeStyles.body)}>{t('auth.welcomeSubtitle')}</p>

        {resetSent && (
          <output aria-live="polite" {...stylex.props(styles.notice)}>
            <span aria-hidden="true" {...stylex.props(styles.noticeIcon)}>
              ✉
            </span>
            <p {...stylex.props(styles.noticeCopy)}>{t('auth.inboxNoticeCopy')}</p>
          </output>
        )}

        <form onSubmit={(event) => void submit(event)} {...stylex.props(styles.form)}>
          <TextField
            id="login-email"
            name="email"
            type="email"
            label={t('auth.loginEmailLabel')}
            placeholder={t('auth.loginEmailPlaceholder')}
            autoComplete="email"
            required
            disabled={!ready || busy}
          />
          <PasswordField
            id="login-password"
            name="password"
            label={t('auth.loginPasswordLabel')}
            placeholder={t('auth.loginPasswordPlaceholder')}
            required
            autoComplete="current-password"
            disabled={!ready || busy}
            helper={
              legacyPassword
                ? t('auth.passwordLegacyHint', { min: PASSWORD_MIN_LENGTH })
                : undefined
            }
            onChange={(event) =>
              setLegacyPassword(event.target.value !== '' && !isPasswordValid(event.target.value))
            }
          />
          <TurnstileWidget {...captcha.widgetProps} />
          <div {...stylex.props(styles.forgotRow, styles.targetRow)}>
            <TextLink
              to="/forgot-password"
              search={returnPath ? { next } : undefined}
              xstyle={styles.forgotLink}
            >
              {t('auth.forgotLink')}
            </TextLink>
          </div>
          <Button type="submit" disabled={!ready} busy={busy}>
            {t('auth.loginSubmit')}
          </Button>
        </form>
        {(message || authError || expired) && (
          <p role="alert" {...stylex.props(chromeStyles.error)}>
            {t(message || (expired ? 'auth.sessionExpired' : 'googleSignInError'))}
          </p>
        )}
        <OrDivider label={t('auth.or')} />
        <Button variant="secondary" busy={busy} onClick={() => void signInWithGoogle()}>
          <span aria-hidden="true" {...stylex.props(styles.googleMark)}>
            G
          </span>
          {t('signInWithGoogle')}
        </Button>

        <div {...stylex.props(styles.targetRow)}>
          <AccountPrompt
            text={t('auth.accountPrompt')}
            action={t('auth.signupLink')}
            to="/onboarding/account"
            search={{ next }}
            xstyle={styles.promptText}
          />
        </div>
      </main>
      <PrivacyLink />
    </>
  );
}
