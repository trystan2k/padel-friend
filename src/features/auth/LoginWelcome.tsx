import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountPrompt } from '../../components/ui/AccountPrompt';
import { Button } from '../../components/ui/Button';
import { OrDivider } from '../../components/ui/OrDivider';
import { PasswordField } from '../../components/ui/PasswordField';
import { TextField } from '../../components/ui/TextField';
import { getBrowserClient } from '../../lib/supabase/client';
import { styles } from './login-welcome.styles';
import { navigateAfterAuth } from './navigate';
import { normalizeReturnPath } from './return-path';

type LoginWelcomeProps = { next?: string; authError?: boolean };

export function LoginWelcome({ next: returnPath, authError }: LoginWelcomeProps) {
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

      <div {...stylex.props(styles.actions)}>
        <Button
          variant="secondary"
          size="large"
          busy={busy}
          onClick={() => void signInWithGoogle()}
          xstyle={styles.googleButton}
        >
          <span aria-hidden="true" {...stylex.props(styles.googleMark)}>
            G
          </span>
          {t('signInWithGoogle')}
        </Button>
        <OrDivider label={<span {...stylex.props(styles.dividerLabel)}>{t('auth.or')}</span>} />
        <form onSubmit={(event) => void submit(event)} {...stylex.props(styles.form)}>
          <TextField
            id="login-email"
            name="email"
            type="email"
            label={<span {...stylex.props(styles.fieldLabel)}>{t('auth.loginEmailLabel')}</span>}
            placeholder={t('auth.loginEmailPlaceholder')}
            autoComplete="email"
            required
            disabled={!ready || busy}
            size="large"
            xstyle={styles.input}
          />
          <PasswordField
            id="login-password"
            name="password"
            label={<span {...stylex.props(styles.fieldLabel)}>{t('auth.loginPasswordLabel')}</span>}
            placeholder={t('auth.loginPasswordPlaceholder')}
            required
            minLength={6}
            autoComplete="current-password"
            disabled={!ready || busy}
            size="large"
            xstyle={styles.input}
          />
          <Button type="submit" size="large" disabled={!ready} busy={busy} xstyle={styles.submit}>
            {t('auth.loginSubmit')}
          </Button>
        </form>
        {(message || authError) && (
          <p role="alert" {...stylex.props(styles.error)}>
            {t(message || 'googleSignInError')}
          </p>
        )}
      </div>

      <div {...stylex.props(styles.prompt)}>
        <AccountPrompt
          text={<span {...stylex.props(styles.promptText)}>{t('auth.accountPrompt')}</span>}
          action={<span {...stylex.props(styles.promptText)}>{t('auth.signupLink')}</span>}
          to="/onboarding/account"
          search={{ next }}
        />
      </div>
    </main>
  );
}
