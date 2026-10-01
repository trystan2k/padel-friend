import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountPrompt } from '../../components/ui/AccountPrompt';
import { Button } from '../../components/ui/Button';
import { OrDivider } from '../../components/ui/OrDivider';
import { PasswordField } from '../../components/ui/PasswordField';
import { TextField } from '../../components/ui/TextField';
import { TextLink } from '../../components/ui/TextLink';
import { getBrowserClient } from '../../lib/supabase/client';
import { styles } from './login-welcome.styles';
import { navigateAfterAuth } from './navigate';
import { normalizeReturnPath } from './return-path';

type LoginWelcomeProps = { next?: string; authError?: boolean; resetSent?: boolean };

export function LoginWelcome({ next: returnPath, authError, resetSent }: LoginWelcomeProps) {
  const { t } = useTranslation();
  const next = normalizeReturnPath(returnPath);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => setReady(true), []);

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
    setBusy(true);
    setMessage('');
    try {
      const { error } = await getBrowserClient().auth.signInWithPassword({ email, password });
      if (error) {
        setMessage('auth.unauthorized');
        setBusy(false);
        return;
      }
      navigateAfterAuth(next);
    } catch {
      setMessage('auth.unauthorized');
      setBusy(false);
    }
  }

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.brand)}>{t('auth.welcomeBrand')}</span>
        <h1 {...stylex.props(styles.title)}>{t('auth.welcomeTitle')}</h1>
        <p {...stylex.props(styles.subtitle)}>{t('auth.welcomeSubtitle')}</p>
      </header>

      {resetSent && (
        <output aria-live="polite" {...stylex.props(styles.notice)}>
          <h2 {...stylex.props(styles.noticeTitle)}>{t('auth.inboxNoticeTitle')}</h2>
          <p {...stylex.props(styles.noticeCopy)}>{t('auth.inboxNoticeCopy')}</p>
        </output>
      )}

      <div {...stylex.props(styles.actions)}>
        <Button
          variant="secondary"
          size="large"
          busy={busy}
          onClick={() => void signInWithGoogle()}
        >
          <span aria-hidden="true" {...stylex.props(styles.googleMark)}>
            G
          </span>
          {t('signInWithGoogle')}
        </Button>
        <OrDivider label={t('auth.or')} />
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
            minLength={6}
            autoComplete="current-password"
            disabled={!ready || busy}
          />
          <div {...stylex.props(styles.forgotRow)}>
            <TextLink
              to="/forgot-password"
              search={returnPath ? { next } : undefined}
              xstyle={styles.forgotLink}
            >
              {t('auth.forgotLink')}
            </TextLink>
          </div>
          <Button type="submit" size="large" disabled={!ready} busy={busy}>
            {t('auth.loginSubmit')}
          </Button>
        </form>
        {(message || authError) && (
          <p role="alert" {...stylex.props(styles.error)}>
            {t(message || 'googleSignInError')}
          </p>
        )}
      </div>

      <div>
        <AccountPrompt
          text={t('auth.accountPrompt')}
          action={t('auth.signupLink')}
          to="/onboarding/account"
          search={{ next }}
          xstyle={styles.promptText}
        />
      </div>
    </main>
  );
}
