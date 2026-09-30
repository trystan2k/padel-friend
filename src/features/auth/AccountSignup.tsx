import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountPrompt } from '../../components/ui/AccountPrompt';
import { Button } from '../../components/ui/Button';
import { HeroCard } from '../../components/ui/HeroCard';
import { PasswordField } from '../../components/ui/PasswordField';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { TextField } from '../../components/ui/TextField';
import { getBrowserClient } from '../../lib/supabase/client';
import { styles } from './account-signup.styles';
import { navigateAfterAuth } from './navigate';
import { normalizeReturnPath } from './return-path';

export function AccountSignup({ next: returnPath }: { next?: string }) {
  const { t } = useTranslation();
  const next = normalizeReturnPath(returnPath);
  const [ready, setReady] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmationRequired, setConfirmationRequired] = useState(false);

  // Server-rendered controls stay inert until React can handle submissions.
  useEffect(() => setReady(true), []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget);
    const emailValue = form.get('email');
    const passwordValue = form.get('password');
    const email = typeof emailValue === 'string' ? emailValue.trim() : '';
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    if (!email || password.length < 6) {
      setMessage('auth.signupInvalid');
      return;
    }
    setBusy(true);
    setMessage('');
    try {
      const { data, error } = await getBrowserClient().auth.signUp({ email, password });
      if (error) {
        setMessage('auth.unauthorized');
        setBusy(false);
        return;
      }
      if (!data.session) {
        setConfirmationRequired(true);
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
      <StepBadge>{t('auth.accountStep')}</StepBadge>
      <header {...stylex.props(styles.header)}>
        <h1 {...stylex.props(styles.title)}>{t('auth.accountTitle')}</h1>
        <p {...stylex.props(styles.subtitle)}>{t('auth.accountSubtitle')}</p>
      </header>

      <HeroCard xstyle={styles.hero}>
        <h2 {...stylex.props(styles.heroTitle)}>{t('auth.accountIntro')}</h2>
        <p {...stylex.props(styles.heroCopy)}>{t('auth.accountDescription')}</p>
      </HeroCard>

      {confirmationRequired ? (
        <SurfaceCard>
          <output>{t('checkEmail')}</output>
        </SurfaceCard>
      ) : (
        <form onSubmit={(event) => void submit(event)} {...stylex.props(styles.form)}>
          <SurfaceCard xstyle={styles.card}>
            <TextField
              id="signup-email"
              name="email"
              type="email"
              required
              autoComplete="email"
              disabled={!ready || busy}
              label={t('auth.emailAddress')}
              placeholder={t('auth.emailPlaceholder')}
            />
            <PasswordField
              id="signup-password"
              name="password"
              autoComplete="new-password"
              minLength={6}
              required
              disabled={!ready || busy}
              label={t('auth.signupPasswordLabel')}
              helper={t('auth.signupEmailHelp')}
              placeholder={t('auth.signupPasswordPlaceholder')}
            />
          </SurfaceCard>
          <Button type="submit" disabled={!ready} busy={busy} xstyle={styles.submit}>
            {t('auth.signupSubmit')}
          </Button>
        </form>
      )}
      {message && (
        <p role="alert" {...stylex.props(styles.error)}>
          {t(message)}
        </p>
      )}
      <p {...stylex.props(styles.note)}>{t('auth.profileFollows')}</p>
      <div {...stylex.props(styles.prompt)}>
        <AccountPrompt
          text={t('auth.returnPrompt')}
          action={t('auth.signupSignIn')}
          to="/login"
          search={{ next }}
        />
      </div>
    </main>
  );
}
