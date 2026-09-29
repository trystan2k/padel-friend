import * as stylex from '@stylexjs/stylex';
import { createFileRoute, redirect } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { normalizeReturnPath } from '../features/auth/return-path';
import { getOnboardingStatus } from '../features/player/player.functions';
import { ui } from '../features/player/player-ui.styles';
import { getBrowserClient } from '../lib/supabase/client';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { next?: string; authError?: boolean } => ({
    ...(search.next !== undefined ? { next: normalizeReturnPath(search.next) } : {}),
    ...(search.authError === '1' ? { authError: true } : {})
  }),
  beforeLoad: async ({ search }) => {
    const status = await getOnboardingStatus();
    if (!status.authenticated) return;
    if (!status.complete) throw redirect({ to: '/onboarding' });
    throw redirect({ href: normalizeReturnPath(search.next) });
  },
  component: Login
});

function Login() {
  const { t } = useTranslation();
  const { next: returnPath, authError } = Route.useSearch();
  const next = normalizeReturnPath(returnPath);
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);

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
      // No error means navigation to the provider is in progress; keep the control disabled.
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
    const client = getBrowserClient();
    const { error, data } = register
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) {
      setMessage('auth.unauthorized');
      return;
    }
    if (register && !data.session) {
      setMessage('checkEmail');
      return;
    }
    window.location.assign(next);
  }

  return (
    <main {...stylex.props(ui.page, ui.loginPage)}>
      <div {...stylex.props(ui.topContent)}>
        <span {...stylex.props(ui.step)}>{t('auth.accountStep')}</span>
        <header {...stylex.props(ui.header)}>
          <h1 {...stylex.props(ui.title)}>
            {t(register ? 'auth.accountTitle' : 'auth.signInTitle')}
          </h1>
          <p {...stylex.props(ui.subtitle)}>{t('auth.accountSubtitle')}</p>
        </header>
      </div>
      <section {...stylex.props(ui.hero)}>
        <h2 {...stylex.props(ui.heroTitle, ui.loginHeroTitle)}>{t('auth.accountIntro')}</h2>
        <p {...stylex.props(ui.heroCopy, ui.loginHeroCopy)}>{t('auth.accountDescription')}</p>
      </section>
      <form onSubmit={(event) => void submit(event)} {...stylex.props(ui.stack, ui.loginForm)}>
        <div {...stylex.props(ui.card, ui.loginCard)}>
          <label htmlFor="login-email" {...stylex.props(ui.label, ui.loginLabel)}>
            {t('auth.emailAddress')}
          </label>
          <div {...stylex.props(ui.loginEmailField)}>
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              {...stylex.props(ui.loginEmailIcon)}
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m2 6 10 7 10-7" />
            </svg>
            <input
              id="login-email"
              name="email"
              type="email"
              placeholder={t('auth.emailPlaceholder')}
              required
              autoComplete="email"
              disabled={busy}
              {...stylex.props(ui.input, ui.loginEmailInput)}
            />
          </div>
          <label htmlFor="login-password" {...stylex.props(ui.label, ui.loginLabel)}>
            {t('password')}
          </label>
          <input
            id="login-password"
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete={register ? 'new-password' : 'current-password'}
            disabled={busy}
            {...stylex.props(ui.input)}
          />
          <p {...stylex.props(ui.muted)}>
            {t(register ? 'auth.registerPasswordHelp' : 'auth.passwordHelp')}
          </p>
        </div>
        <button type="submit" disabled={busy} {...stylex.props(ui.button)}>
          {register ? t('register') : t('signIn')}
        </button>
      </form>
      <div {...stylex.props(ui.divider)}>
        <span aria-hidden="true" {...stylex.props(ui.dividerRule)} />
        <span>{t('auth.or')}</span>
        <span aria-hidden="true" {...stylex.props(ui.dividerRule)} />
      </div>
      <button
        type="button"
        disabled={busy}
        onClick={() => void signInWithGoogle()}
        {...stylex.props(ui.button, ui.secondaryButton)}
      >
        <span aria-hidden="true" {...stylex.props(ui.googleMark)}>
          G
        </span>
        {t('signInWithGoogle')}
      </button>
      <p {...stylex.props(ui.muted)}>{t('auth.profileFollows')}</p>
      <div {...stylex.props(ui.accountPrompt)}>
        <span>{t(register ? 'auth.returnPrompt' : 'auth.accountPrompt')}</span>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setRegister(!register);
            setMessage('');
          }}
          {...stylex.props(ui.accountAction)}
        >
          {register ? t('signIn') : t('register')}
        </button>
      </div>
      {(message || authError) && (
        <p role="alert" {...stylex.props(ui.error)}>
          {message ? t(message) : t('googleSignInError')}
        </p>
      )}
    </main>
  );
}
