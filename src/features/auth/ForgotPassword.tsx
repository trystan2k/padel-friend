import * as stylex from '@stylexjs/stylex';
import { useNavigate } from '@tanstack/react-router';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { TextField } from '../../components/ui/TextField';
import { TextLink } from '../../components/ui/TextLink';
import { getBrowserClient } from '../../lib/supabase/client';
import { styles } from './forgot-password.styles';
import { normalizeReturnPath } from './return-path';

type ForgotPasswordProps = { next?: string };

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function isRetryableFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  if (typeof error !== 'object' || error === null) return false;

  const name = 'name' in error && typeof error.name === 'string' ? error.name : '';
  const status = 'status' in error && typeof error.status === 'number' ? error.status : undefined;
  return (
    name === 'AuthRetryableFetchError' || status === 429 || (status !== undefined && status >= 500)
  );
}

export function ForgotPassword({ next: returnPath }: ForgotPasswordProps) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const next = normalizeReturnPath(returnPath);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [emailInvalid, setEmailInvalid] = useState(false);
  const [requestFailed, setRequestFailed] = useState(false);

  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const emailValue = new FormData(event.currentTarget).get('email');
    const email = typeof emailValue === 'string' ? emailValue.trim() : '';
    if (!EMAIL_PATTERN.test(email)) {
      setEmailInvalid(true);
      return;
    }

    setBusy(true);
    setEmailInvalid(false);
    setRequestFailed(false);
    try {
      // Add each production origin's /auth/callback URL to the Supabase Auth redirect allow-list.
      const redirectTo = new URL(
        '/auth/callback?next=/reset-password',
        window.location.origin
      ).toString();
      const { error } = await getBrowserClient().auth.resetPasswordForEmail(email, { redirectTo });
      if (error && isRetryableFailure(error)) {
        setRequestFailed(true);
        setBusy(false);
        return;
      }
    } catch (error) {
      if (isRetryableFailure(error)) {
        setRequestFailed(true);
        setBusy(false);
        return;
      }
    }

    await navigate({
      to: '/login',
      search: { reset: 'sent', ...(returnPath ? { next } : {}) }
    });
  }

  return (
    <main {...stylex.props(styles.page)}>
      <header {...stylex.props(styles.header)}>
        <span {...stylex.props(styles.brand)}>{t('auth.welcomeBrand')}</span>
        <h1 {...stylex.props(styles.title)}>{t('auth.forgotTitle')}</h1>
        <p {...stylex.props(styles.subtitle)}>{t('auth.forgotDescription')}</p>
      </header>

      <form onSubmit={(event) => void submit(event)} {...stylex.props(styles.form)}>
        <TextField
          id="forgot-email"
          name="email"
          type="email"
          label={t('auth.emailAddress')}
          placeholder={t('auth.loginEmailPlaceholder')}
          autoComplete="email"
          required
          disabled={!ready || busy}
          error={emailInvalid ? t('auth.forgotInvalidEmail') : undefined}
          onChange={() => setEmailInvalid(false)}
        />
        <p {...stylex.props(styles.note)}>{t('auth.forgotEmailNote')}</p>
        <Button type="submit" size="large" disabled={!ready} busy={busy}>
          {t('auth.forgotSubmit')}
        </Button>
        {requestFailed && (
          <p role="alert" {...stylex.props(styles.error)}>
            {t('auth.forgotFailed')}
          </p>
        )}
      </form>

      <footer {...stylex.props(styles.footer)}>
        <TextLink to="/login" search={returnPath ? { next } : undefined} xstyle={styles.backLink}>
          {t('auth.backToSignIn')}
        </TextLink>
      </footer>
    </main>
  );
}
