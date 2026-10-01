/**
 * @vitest-environment jsdom
 */
import userEvent from '@testing-library/user-event';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import {
  Outlet,
  RouterProvider,
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter
} from '@tanstack/react-router';
import { ForgotPassword } from '../src/features/auth/ForgotPassword';
import { ResetPassword } from '../src/features/auth/ResetPassword';
import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';

const supabaseBrowser = vi.hoisted(() => {
  const resetPasswordForEmail =
    vi.fn<(email: string, options: { redirectTo: string }) => Promise<{ error: unknown }>>();
  const updateUser = vi.fn<(attributes: { password: string }) => Promise<{ error: unknown }>>();
  const getBrowserClient = vi.fn<
    () => {
      auth: {
        resetPasswordForEmail: typeof resetPasswordForEmail;
        updateUser: typeof updateUser;
      };
    }
  >();
  return { resetPasswordForEmail, updateUser, getBrowserClient };
});
supabaseBrowser.getBrowserClient.mockImplementation(() => ({
  auth: {
    resetPasswordForEmail: supabaseBrowser.resetPasswordForEmail,
    updateUser: supabaseBrowser.updateUser
  }
}));
vi.mock('../src/lib/supabase/client', () => ({
  getBrowserClient: supabaseBrowser.getBrowserClient
}));

const i18n = createI18n('en');

function providers(node: ReactElement) {
  return createElement(I18nextProvider, { i18n }, node);
}

async function renderAuthForm(path: '/forgot-password' | '/reset-password', next?: string) {
  const rootRoute = createRootRoute({ component: () => providers(createElement(Outlet)) });
  const loginRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/login',
    component: () => createElement('p', null, en.auth.inboxNoticeTitle)
  });
  const dashboardRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/dashboard',
    component: () => createElement('p', null, en.profile.title)
  });
  const forgotRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/forgot-password',
    component: () => createElement(ForgotPassword, { next })
  });
  const resetRoute = createRoute({
    getParentRoute: () => rootRoute,
    path: '/reset-password',
    component: () => createElement(ResetPassword)
  });
  const router = createRouter({
    routeTree: rootRoute.addChildren([loginRoute, dashboardRoute, forgotRoute, resetRoute]),
    history: createMemoryHistory({ initialEntries: [path] })
  });
  await router.load();
  render(createElement(RouterProvider, { router }));
  return router;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function submitForm(): void {
  const form = document.querySelector('form');
  if (!form) throw new Error('expected an auth form');
  fireEvent.submit(form);
}

async function waitForEnabled(selector: string): Promise<void> {
  await waitFor(() => {
    const element = document.querySelector(selector);
    expect(element instanceof HTMLInputElement && !element.disabled).toBe(true);
  });
}

describe('ForgotPassword', () => {
  it('sends a reset request to the callback route and uses an enumeration-safe result', async () => {
    const user = userEvent.setup();
    supabaseBrowser.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    const router = await renderAuthForm('/forgot-password');
    await waitForEnabled('#forgot-email');
    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@example.test');
    submitForm();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ reset: 'sent' });
    expect(supabaseBrowser.resetPasswordForEmail).toHaveBeenCalledWith('player@example.test', {
      redirectTo: 'http://localhost:3000/auth/callback?next=/reset-password'
    });
  });

  it('navigates to the same success state when Supabase returns a non-rate-limit error', async () => {
    const user = userEvent.setup();
    supabaseBrowser.resetPasswordForEmail.mockResolvedValueOnce({
      error: Object.assign(new Error('account not found'), { status: 400, code: 'user_not_found' })
    });
    const router = await renderAuthForm('/forgot-password');
    await waitForEnabled('#forgot-email');
    await user.type(screen.getByLabelText(en.auth.emailAddress), 'unknown@example.test');
    submitForm();

    await waitFor(() => expect(router.state.location.pathname).toBe('/login'));
    expect(router.state.location.search).toEqual({ reset: 'sent' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('rejects malformed email before calling Supabase and announces field feedback', async () => {
    const user = userEvent.setup();
    await renderAuthForm('/forgot-password');
    await waitForEnabled('#forgot-email');
    await user.type(screen.getByLabelText(en.auth.emailAddress), 'not-an-email');
    submitForm();

    expect((await screen.findByRole('alert')).textContent).toBe(en.auth.forgotInvalidEmail);
    expect(supabaseBrowser.resetPasswordForEmail).not.toHaveBeenCalled();
  });

  it('shows a translated generic error for transport and rate-limit failures', async () => {
    const user = userEvent.setup();
    supabaseBrowser.resetPasswordForEmail.mockResolvedValueOnce({
      error: Object.assign(new Error('rate limited'), { status: 429 })
    });
    const router = await renderAuthForm('/forgot-password');
    await waitForEnabled('#forgot-email');
    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@example.test');
    submitForm();

    expect((await screen.findByRole('alert')).textContent).toBe(en.auth.forgotFailed);
    expect(router.state.location.pathname).toBe('/forgot-password');
  });

  it('preserves a validated next path on the back link and success navigation', async () => {
    const user = userEvent.setup();
    supabaseBrowser.resetPasswordForEmail.mockResolvedValueOnce({ error: null });
    const router = await renderAuthForm('/forgot-password', '/matches');
    await waitForEnabled('#forgot-email');
    const backLink = screen.getByRole('link', { name: en.auth.backToSignIn });
    expect(
      new URL(backLink.getAttribute('href') ?? '', 'http://localhost').searchParams.get('next')
    ).toBe('/matches');
    await user.type(screen.getByLabelText(en.auth.emailAddress), 'player@example.test');
    submitForm();

    await waitFor(() =>
      expect(router.state.location.search).toEqual({ reset: 'sent', next: '/matches' })
    );
  });
});

describe('ResetPassword', () => {
  it('rejects passwords shorter than eight characters', async () => {
    const user = userEvent.setup();
    await renderAuthForm('/reset-password');
    await waitForEnabled('#reset-password');
    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'short12');
    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'short12');
    submitForm();

    expect((await screen.findByRole('alert')).textContent).toBe(en.auth.resetInvalid);
    expect(supabaseBrowser.updateUser).not.toHaveBeenCalled();
  });

  it('marks the confirmation field when password entries do not match', async () => {
    const user = userEvent.setup();
    await renderAuthForm('/reset-password');
    await waitForEnabled('#reset-password');
    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'Password123');
    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'short12');
    submitForm();

    expect((await screen.findByRole('alert')).textContent).toBe(en.auth.resetMismatch);
    expect(
      screen.getByLabelText(en.auth.resetConfirmPasswordLabel).getAttribute('aria-invalid')
    ).toBe('true');
    expect(supabaseBrowser.updateUser).not.toHaveBeenCalled();
  });

  it('updates the password and navigates to the dashboard when both entries match', async () => {
    const user = userEvent.setup();
    supabaseBrowser.updateUser.mockResolvedValueOnce({ error: null });
    const router = await renderAuthForm('/reset-password');
    await waitForEnabled('#reset-password');
    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'NewPassword123');
    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'NewPassword123');
    submitForm();

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(supabaseBrowser.updateUser).toHaveBeenCalledWith({ password: 'NewPassword123' });
  });
});
