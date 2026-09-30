/**
 * @vitest-environment jsdom
 */
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import type { ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import en from '../src/locales/en/translation.json';
import { createI18n } from '../src/i18n/config';
import { LoginWelcome } from '../src/features/auth/LoginWelcome';

// The Welcome screen must never touch a Supabase signup path: /login is sign-in only and the
// only route into registration is the "Create account" LINK. The browser client double records
// every auth call so both the sign-in wiring and the signup absence stay asserted.
const supabaseBrowser = vi.hoisted(() => {
  const signInWithOAuth =
    vi.fn<
      (credentials: {
        provider: string;
        options: { redirectTo: string };
      }) => Promise<{ error: Error | null }>
    >();
  const signInWithPassword =
    vi.fn<(credentials: { email: string; password: string }) => Promise<{ error: Error | null }>>();
  const signUp = vi.fn<() => void>();
  return {
    signInWithOAuth,
    signInWithPassword,
    signUp,
    getBrowserClient: vi.fn<
      () => {
        auth: {
          signInWithOAuth: typeof signInWithOAuth;
          signInWithPassword: typeof signInWithPassword;
          signUp: typeof signUp;
        };
      }
    >(() => ({ auth: { signInWithOAuth, signInWithPassword, signUp } }))
  };
});
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: supabaseBrowser.getBrowserClient
}));

const locationAssign = vi.hoisted(() => vi.fn<(url: string) => void>());
vi.mock('../src/features/auth/navigate', () => ({ navigateAfterAuth: locationAssign }));

const i18n = createI18n('en');

function providers(node: ReactElement) {
  return createElement(I18nextProvider, { i18n }, node);
}

type WelcomeProps = { next?: string; authError?: boolean };

async function renderWelcome(props: WelcomeProps = {}) {
  const rootRoute = createRootRoute({
    component: () => providers(createElement(Outlet))
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => createElement(LoginWelcome, props)
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute]),
    history: createMemoryHistory({ initialEntries: ['/login'] })
  });
  await router.load();
  render(createElement(RouterProvider, { router }));
  return router;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Submitting through fireEvent.submit exercises the component's own onSubmit wiring without
// depending on the browser's native constraint validation before a submit-button click.
function submitSignInForm(): void {
  const form = document.querySelector('form');
  if (!form) throw new Error('expected the Welcome screen to render a sign-in form');
  fireEvent.submit(form);
}

function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

describe('LoginWelcome', () => {
  it('renders the Welcome brand, title and subtitle from the i18n catalog', async () => {
    await renderWelcome();

    expect(screen.getByText(en.auth.welcomeBrand)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.auth.welcomeTitle);
    expect(screen.getByText(en.auth.welcomeSubtitle)).toBeTruthy();
  });

  it('orders Google sign-in first, then the OR divider, then the email/password form', async () => {
    await renderWelcome();

    const google = screen.getByRole('button', { name: en.signInWithGoogle });
    const or = screen.getByText(en.auth.or, { exact: true });
    const email = screen.getByLabelText(en.auth.loginEmailLabel);
    const password = screen.getByLabelText(en.auth.loginPasswordLabel);
    const submit = screen.getByRole('button', { name: en.auth.loginSubmit });

    expect(precedes(google, or)).toBe(true);
    expect(precedes(or, email)).toBe(true);
    expect(precedes(email, password)).toBe(true);
    expect(precedes(password, submit)).toBe(true);
  });

  it('keeps the correct autocomplete hints and placeholder copy on both fields', async () => {
    await renderWelcome();

    const email = screen.getByLabelText(en.auth.loginEmailLabel);
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(email.getAttribute('placeholder')).toBe(en.auth.loginEmailPlaceholder);
    expect(email.getAttribute('type')).toBe('email');

    const password = screen.getByLabelText(en.auth.loginPasswordLabel);
    expect(password.getAttribute('autocomplete')).toBe('current-password');
    expect(password.getAttribute('type')).toBe('password');
    expect(password.getAttribute('placeholder')).toBe(en.auth.loginPasswordPlaceholder);
  });

  it('offers registration only as a real link to /onboarding/account and never calls signUp', async () => {
    await renderWelcome({ next: '/matches?tab=history' });

    // No register toggle and no signup submit button anywhere on the Welcome screen.
    expect(screen.queryByRole('button', { name: en.auth.signupSubmit })).toBeNull();

    const link = screen.getByRole('link', { name: en.auth.signupLink });
    const href = link.getAttribute('href') ?? '';
    expect(href.startsWith('/onboarding/account?')).toBe(true);
    expect(new URL(href, 'http://localhost').searchParams.get('next')).toBe('/matches?tab=history');

    // Full-document navigation cannot run in jsdom; E2E exercises the click and destination.
    // This component must never initiate registration itself.
    expect(supabaseBrowser.signUp).not.toHaveBeenCalled();
  });

  it('falls back to /dashboard for a hostile next on both the link and the sign-in redirect', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithPassword.mockResolvedValueOnce({ error: null });
    await renderWelcome({ next: '//evil.com' });

    const link = screen.getByRole('link', { name: en.auth.signupLink });
    expect(
      new URL(link.getAttribute('href') ?? '', 'http://localhost').searchParams.get('next')
    ).toBe('/dashboard');

    await user.type(screen.getByLabelText(en.auth.loginEmailLabel), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.loginPasswordLabel), 'Password123!');
    submitSignInForm();

    await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));
    expect(locationAssign).toHaveBeenCalledWith('/dashboard');
  });

  it('submits email and password through signInWithPassword and navigates to the safe next', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithPassword.mockResolvedValueOnce({ error: null });
    await renderWelcome({ next: '/matches?tab=history' });

    await user.type(screen.getByLabelText(en.auth.loginEmailLabel), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.loginPasswordLabel), 'Password123!');
    submitSignInForm();

    await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));
    expect(locationAssign).toHaveBeenCalledWith('/matches?tab=history');
    expect(supabaseBrowser.signInWithPassword).toHaveBeenCalledWith({
      email: 'player@test.local',
      password: 'Password123!'
    });
    expect(supabaseBrowser.signUp).not.toHaveBeenCalled();
  });

  it('shows the localized unauthorized alert and re-enables the form when sign-in fails', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithPassword.mockResolvedValueOnce({ error: new Error('invalid') });
    await renderWelcome();

    await user.type(screen.getByLabelText(en.auth.loginEmailLabel), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.loginPasswordLabel), 'Password123!');
    submitSignInForm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.auth.unauthorized);
    expect(screen.getByRole('button', { name: en.auth.loginSubmit }).hasAttribute('disabled')).toBe(
      false
    );
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it('starts Google OAuth against /auth/callback preserving a non-default next', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithOAuth.mockResolvedValueOnce({ error: null });
    await renderWelcome({ next: '/matches?tab=history' });

    await user.click(screen.getByRole('button', { name: en.signInWithGoogle }));

    await waitFor(() => expect(supabaseBrowser.signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = supabaseBrowser.signInWithOAuth.mock.calls[0]?.[0];
    if (!call) throw new Error('expected Google OAuth credentials');
    expect(call.provider).toBe('google');
    const redirectTo = new URL(call.options.redirectTo);
    expect(redirectTo.pathname).toBe('/auth/callback');
    expect(redirectTo.searchParams.get('next')).toBe('/matches?tab=history');
  });

  it('omits the next parameter from the OAuth callback for the default /dashboard destination', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithOAuth.mockResolvedValueOnce({ error: null });
    await renderWelcome();

    await user.click(screen.getByRole('button', { name: en.signInWithGoogle }));

    await waitFor(() => expect(supabaseBrowser.signInWithOAuth).toHaveBeenCalledTimes(1));
    const call = supabaseBrowser.signInWithOAuth.mock.calls[0]?.[0];
    if (!call) throw new Error('expected Google OAuth credentials');
    expect(new URL(call.options.redirectTo).searchParams.has('next')).toBe(false);
  });

  it('keeps every control disabled while the OAuth navigation is in progress', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithOAuth.mockReturnValueOnce(new Promise(() => {}));
    await renderWelcome();

    await user.click(screen.getByRole('button', { name: en.signInWithGoogle }));

    expect(screen.getByRole('button', { name: en.signInWithGoogle }).hasAttribute('disabled')).toBe(
      true
    );
    expect(screen.getByLabelText(en.auth.loginEmailLabel).hasAttribute('disabled')).toBe(true);
    expect(screen.getByLabelText(en.auth.loginPasswordLabel).hasAttribute('disabled')).toBe(true);
    expect(screen.getByRole('button', { name: en.auth.loginSubmit }).hasAttribute('disabled')).toBe(
      true
    );
  });

  it('shows the localized Google error and re-enables controls when the provider call fails', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signInWithOAuth.mockResolvedValueOnce({ error: new Error('popup closed') });
    await renderWelcome();

    await user.click(screen.getByRole('button', { name: en.signInWithGoogle }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.googleSignInError);
    expect(screen.getByRole('button', { name: en.signInWithGoogle }).hasAttribute('disabled')).toBe(
      false
    );
  });

  it('surfaces the callback-failure alert passed from the route (authError search flag)', async () => {
    await renderWelcome({ authError: true });

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(en.googleSignInError);
  });
});
