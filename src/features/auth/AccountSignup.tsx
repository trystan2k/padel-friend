import { Field } from '@base-ui/react/field';
import * as stylex from '@stylexjs/stylex';
import { useEffect, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { AccountPrompt } from '../../components/ui/AccountPrompt';
import { Button } from '../../components/ui/Button';
import { HeroCard } from '../../components/ui/HeroCard';
import { PasswordField } from '../../components/ui/PasswordField';
import { StepBadge } from '../../components/ui/StepBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
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
            <Field.Root {...stylex.props(styles.emailField)}>
              <Field.Label htmlFor="signup-email" {...stylex.props(styles.label)}>
                {t('auth.emailAddress')}
              </Field.Label>
              <label htmlFor="signup-email" {...stylex.props(styles.emailControl)}>
                <svg
                  aria-hidden="true"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  {...stylex.props(styles.mailIcon)}
                >
                  <rect x="2" y="4" width="20" height="16" rx="2" />
                  <path d="m22 7-10 6L2 7" />
                </svg>
                <Field.Control
                  id="signup-email"
                  name="email"
                  type="email"
                  required
                  autoComplete="email"
                  disabled={!ready || busy}
                  placeholder={t('auth.emailPlaceholder')}
                  {...stylex.props(styles.emailInput)}
                />
              </label>
            </Field.Root>
            <PasswordField
              id="signup-password"
              name="password"
              autoComplete="new-password"
              minLength={6}
              required
              disabled={!ready || busy}
              label={<span {...stylex.props(styles.label)}>{t('auth.signupPasswordLabel')}</span>}
              helper={t('auth.signupEmailHelp')}
              placeholder={t('auth.loginPasswordPlaceholder')}
              appearance="filled"
              xstyle={styles.passwordControl}
              controlFrameXstyle={styles.passwordFrame}
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
