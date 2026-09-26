import { Link, createFileRoute, useNavigate } from '@tanstack/react-router';
import { useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { getBrowserClient } from '../lib/supabase/client';

export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { authError?: boolean } =>
    search.authError === '1' ? { authError: true } : {},
  component: Login
});

function Login() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { authError } = Route.useSearch();
  const [register, setRegister] = useState(false);
  const [message, setMessage] = useState('');

  async function signInWithGoogle() {
    setMessage('');
    const { error } = await getBrowserClient().auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: new URL('/auth/callback', window.location.origin).toString() }
    });
    if (error) setMessage(t('googleSignInError'));
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const emailValue = form.get('email');
    const passwordValue = form.get('password');
    const email = typeof emailValue === 'string' ? emailValue : '';
    const password = typeof passwordValue === 'string' ? passwordValue : '';
    const client = getBrowserClient();
    const { error, data } = register
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (error) {
      setMessage(error.message);
      return;
    }
    if (register && !data.session) {
      setMessage(t('checkEmail'));
      return;
    }
    await navigate({ to: '/dashboard' });
  }

  return (
    <main>
      <h1>{t('login')}</h1>
      <form onSubmit={(event) => void submit(event)}>
        <label>
          {t('email')}
          <input name="email" type="email" required autoComplete="email" />
        </label>
        <label>
          {t('password')}
          <input
            name="password"
            type="password"
            required
            minLength={6}
            autoComplete={register ? 'new-password' : 'current-password'}
          />
        </label>
        <button type="submit">{register ? t('register') : t('signIn')}</button>
      </form>
      <button type="button" onClick={() => setRegister(!register)}>
        {register ? t('signIn') : t('register')}
      </button>
      <button type="button" onClick={() => void signInWithGoogle()}>
        {t('signInWithGoogle')}
      </button>
      {(message || authError) && <output>{message || t('googleSignInError')}</output>}
      <Link to="/">{t('title')}</Link>
    </main>
  );
}
