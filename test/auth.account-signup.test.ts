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
import { AccountSignup } from '../src/features/auth/AccountSignup';

// The account step owns the ONLY signUp call of the journey. The double records every auth
// interaction so pending/error/no-session/success wiring stays asserted without a network.
const supabaseBrowser = vi.hoisted(() => {
  const signUp = vi.fn<
    (credentials: { email: string; password: string }) => Promise<{
      data: { user: { id: string }; session: { access_token: string } | null } | null;
      error: Error | null;
    }>
  >();
  const signInWithPassword = vi.fn<() => void>();
  return {
    signUp,
    signInWithPassword,
    getBrowserClient: vi.fn<
      () => { auth: { signUp: typeof signUp; signInWithPassword: typeof signInWithPassword } }
    >(() => ({ auth: { signUp, signInWithPassword } }))
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

async function renderSignup(props: { next?: string } = {}) {
  const rootRoute = createRootRoute({
    component: () => providers(createElement(Outlet))
  });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => createElement('div', null, 'login-route-stub')
  });
  const accountRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/onboarding/account',
    component: () => createElement(AccountSignup, props)
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute, accountRoute]),
    history: createMemoryHistory({ initialEntries: ['/onboarding/account'] })
  });
  await router.load();
  render(createElement(RouterProvider, { router }));
  return router;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

// Submitting through fireEvent.submit exercises the component's own onSubmit guard without
// the browser's native constraint validation (user.click on a submit button would withhold
// the submit for invalid required fields, hiding the component-level invalid state).
function submitForm(): void {
  const form = document.querySelector('form');
  if (!form) throw new Error('expected the account screen to render a form');
  fireEvent.submit(form);
}

describe('AccountSignup', () => {
  it('renders the step 1 badge, signup form and back-link to the Welcome screen', async () => {
    await renderSignup({ next: '/matches' });

    expect(screen.getByText(en.auth.accountStep)).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe(en.auth.accountTitle);
    expect(screen.getByLabelText(en.auth.emailAddress)).toBeTruthy();
    expect(screen.getByLabelText(en.auth.signupPasswordLabel)).toBeTruthy();
    expect(screen.getByText(en.auth.signupEmailHelp)).toBeTruthy();
    expect(screen.getByRole('button', { name: en.auth.signupSubmit })).toBeTruthy();

    const backLink = screen.getByRole('link', { name: en.auth.signupSignIn });
    expect(backLink.getAttribute('href')?.startsWith('/login?')).toBe(true);
    expect(
      new URL(backLink.getAttribute('href') ?? '', 'http://localhost').searchParams.get('next')
    ).toBe('/matches');
  });

  it('keeps the signup autofill contract: email autocomplete and new-password on the password field', async () => {
    await renderSignup();

    const email = screen.getByLabelText(en.auth.emailAddress);
    expect(email.getAttribute('autocomplete')).toBe('email');
    expect(email.getAttribute('type')).toBe('email');
    expect(email.getAttribute('placeholder')).toBe(en.auth.emailPlaceholder);

    const password = screen.getByLabelText(en.auth.signupPasswordLabel);
    expect(password.getAttribute('autocomplete')).toBe('new-password');
    expect(password.getAttribute('type')).toBe('password');
    // The helper text is wired as the password field's description, not a second label.
    expect(password.getAttribute('aria-describedby')).toContain('-helper');
  });

  it('rejects an empty or too-short submission locally with the signupInvalid alert and no client call', async () => {
    const user = userEvent.setup();
    await renderSignup();

    submitForm();

    let alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.auth.signupInvalid);
    expect(supabaseBrowser.signUp).not.toHaveBeenCalled();

    // A password below the documented 6 characters is rejected by the same local guard.
    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'abc');
    submitForm();

    alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.auth.signupInvalid);
    expect(supabaseBrowser.signUp).not.toHaveBeenCalled();
  });

  it('trims the email before handing it to signUp', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null
    });
    await renderSignup();

    await user.type(screen.getByLabelText(en.auth.emailAddress), '  player@test.local  ');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'Password123!');
    submitForm();

    await waitFor(() => expect(supabaseBrowser.signUp).toHaveBeenCalledTimes(1));
    expect(supabaseBrowser.signUp).toHaveBeenCalledWith({
      email: 'player@test.local',
      password: 'Password123!'
    });
  });

  it('disables the form while signUp is pending and navigates to the safe next on success', async () => {
    const user = userEvent.setup();
    let releaseSignup: (
      value: Awaited<ReturnType<typeof supabaseBrowser.signUp>>
    ) => void = () => {};
    supabaseBrowser.signUp.mockReturnValueOnce(
      new Promise((resolve) => {
        releaseSignup = resolve;
      })
    );
    await renderSignup({ next: '/matches?tab=history' });

    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'Password123!');
    submitForm();

    expect(
      screen.getByRole('button', { name: en.auth.signupSubmit }).hasAttribute('disabled')
    ).toBe(true);
    expect(screen.getByLabelText(en.auth.emailAddress).hasAttribute('disabled')).toBe(true);

    releaseSignup({ data: { user: { id: 'u1' }, session: { access_token: 't' } }, error: null });
    await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));
    expect(locationAssign).toHaveBeenCalledWith('/matches?tab=history');
  });

  it('falls back to /dashboard for a hostile next on the success redirect', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null
    });
    await renderSignup({ next: '//evil.com' });

    const backLink = screen.getByRole('link', { name: en.auth.signupSignIn });
    expect(
      new URL(backLink.getAttribute('href') ?? '', 'http://localhost').searchParams.get('next')
    ).toBe('/dashboard');

    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'Password123!');
    submitForm();

    await waitFor(() => expect(locationAssign).toHaveBeenCalledTimes(1));
    expect(locationAssign).toHaveBeenCalledWith('/dashboard');
  });

  it('uses an enumeration-safe generic error for duplicate emails and keeps sign-in reachable', async () => {
    const user = userEvent.setup();
    const error = Object.assign(new Error('User already registered'), {
      code: 'user_already_exists'
    });
    supabaseBrowser.signUp.mockResolvedValueOnce({ data: null, error });
    await renderSignup();

    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'Password123!');
    submitForm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.auth.unauthorized);
    expect(alert.textContent).not.toMatch(
      /already registered|already exists|account with this email/i
    );
    const signInLink = screen.getByRole('link', { name: en.auth.signupSignIn });
    expect(signInLink).toBeTruthy();
    expect(new URL(signInLink.getAttribute('href') ?? '', 'http://localhost').pathname).toBe(
      '/login'
    );
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it('shows the same generic unauthorized alert and keeps the form when signUp fails', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signUp.mockResolvedValueOnce({ data: null, error: new Error('taken') });
    await renderSignup();

    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'Password123!');
    submitForm();

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.auth.unauthorized);
    expect(
      screen.getByRole('button', { name: en.auth.signupSubmit }).hasAttribute('disabled')
    ).toBe(false);
    expect(locationAssign).not.toHaveBeenCalled();
  });

  it('keeps the player on the account step with the check-email guidance when no session is returned', async () => {
    const user = userEvent.setup();
    supabaseBrowser.signUp.mockResolvedValueOnce({
      data: { user: { id: 'u1' }, session: null },
      error: null
    });
    await renderSignup();

    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@test.local');
    await user.type(screen.getByLabelText(en.auth.signupPasswordLabel), 'Password123!');
    submitForm();

    // Defensive confirmation-required state: guidance rendered, form withdrawn, no navigation.
    expect(await screen.findByText(en.checkEmail)).toBeTruthy();
    expect(screen.queryByRole('button', { name: en.auth.signupSubmit })).toBeNull();
    expect(locationAssign).not.toHaveBeenCalled();
  });
});
