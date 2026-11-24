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
    component: () => createElement('p', null, en.auth.inboxNoticeCopy)
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

function precedes(first: Element, second: Element): boolean {
  return (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
}

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
  it('follows frame ieoni: back bar, title, body, email with note, then sticky actions', async () => {
    await renderAuthForm('/forgot-password', '/matches');
    const main = screen.getByRole('main');
    const form = main.querySelector('form');
    const heading = screen.getByRole('heading', { level: 1 });
    const email = screen.getByLabelText(en.auth.emailAddress);
    const submit = screen.getByRole('button', { name: en.auth.forgotSubmit });
    const back = screen.getByRole('link', { name: en.auth.backToSignIn });
    const barBack = screen.getByRole('link', { name: en.auth.back });

    expect(heading.textContent).toBe(en.auth.forgotTitle);
    expect(screen.getByText(en.auth.forgotBarTitle)).toBeTruthy();
    expect(new URL(barBack.getAttribute('href') ?? '', 'http://localhost').pathname).toBe('/login');
    expect(precedes(barBack, heading)).toBe(true);
    expect(precedes(heading, email)).toBe(true);
    expect(precedes(email, submit)).toBe(true);
    expect(precedes(submit, back)).toBe(true);
    // CTAs live inside the form so the sticky submit still submits it.
    expect(form?.contains(submit)).toBe(true);
    expect(form?.contains(back)).toBe(true);
    // The enumeration-safe note is the field's description, not a detached paragraph.
    const note = screen.getByText(en.auth.forgotEmailNote);
    expect(email.getAttribute('aria-describedby')?.split(' ')).toContain(note.id);
  });

  it('links to the public privacy policy', async () => {
    await renderAuthForm('/forgot-password');

    const link = screen.getByRole('link', { name: en.auth.privacyLink });
    expect(link.getAttribute('href')).toBe('/privacy');
    // Outside <main>: the Pencil frame inside it keeps its exact geometry.
    expect(link.closest('main')).toBeNull();
  });

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

  it.each(['player@example.test', 'unknown@example.test'])(
    'keeps captcha rejection on form without disclosure (%s)',
    async (email) => {
      supabaseBrowser.resetPasswordForEmail.mockResolvedValueOnce({
        error: { code: 'captcha_failed', status: 400 }
      });
      const router = await renderAuthForm('/forgot-password');
      await waitForEnabled('#forgot-email');
      await userEvent.type(screen.getByLabelText(en.auth.emailAddress), email);
      submitForm();
      const alert = await screen.findByRole('alert');
      expect(alert.textContent).toBe(en.auth.captchaRetry);
      expect(alert.textContent).not.toMatch(/reload/i);
      expect(router.state.location.pathname).toBe('/forgot-password');
      expect(screen.getByLabelText<HTMLInputElement>(en.auth.emailAddress).disabled).toBe(false);
    }
  );

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
  it('follows frame ZthyR: bar, title, two fields, rules, then the sticky save action', async () => {
    await renderAuthForm('/reset-password');
    const heading = screen.getByRole('heading', { level: 1 });
    const fields = [
      screen.getByLabelText(en.auth.resetNewPasswordLabel),
      screen.getByLabelText(en.auth.resetConfirmPasswordLabel)
    ];
    const rules = document.querySelector('#reset-password-rules');
    const save = screen.getByRole('button', { name: en.auth.resetSubmit });

    expect(heading.textContent).toBe(en.auth.resetTitle);
    // Frame ZthyR repeats "New password" as bar title and first field label.
    expect(screen.getByRole('main').firstElementChild?.textContent).toBe(en.auth.resetBarTitle);
    // No safe back destination from a recovery session: the bar carries only its title.
    expect(screen.queryByRole('link')).toBeNull();
    expect(rules).not.toBeNull();
    expect(precedes(heading, fields[0]!)).toBe(true);
    expect(precedes(fields[1]!, rules!)).toBe(true);
    expect(precedes(rules!, save)).toBe(true);
    for (const field of fields) expect(field.getAttribute('aria-describedby')).toBe(rules!.id);
    expect(rules!.textContent).toContain(en.auth.resetRuleMatch);
  });

  it('marks each password rule as met only while it holds, announced to assistive tech', async () => {
    const user = userEvent.setup();
    await renderAuthForm('/reset-password');
    await waitForEnabled('#reset-password');
    const items = () => [...document.querySelectorAll('#reset-password-rules li')];
    const state = (item: Element) => item.querySelector('span[aria-hidden="true"]')?.textContent;

    expect(items().map(state)).toEqual(['○', '○']);
    expect(items()[0]?.textContent).toContain(en.auth.ruleUnmet);

    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'NewPassword123!');
    expect(items().map(state)).toEqual(['✓', '○']);
    expect(items()[0]?.textContent).toContain(en.auth.ruleMet);

    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'NewPassword123!');
    expect(items().map(state)).toEqual(['✓', '✓']);

    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'x');
    expect(items().map(state)).toEqual(['✓', '○']);
  });

  it('rejects passwords that miss the shared policy', async () => {
    const user = userEvent.setup();
    await renderAuthForm('/reset-password');
    await waitForEnabled('#reset-password');
    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'short12');
    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'short12');
    submitForm();

    expect((await screen.findByRole('alert')).textContent).toBe(
      en.auth.passwordInvalid.replace('{{min}}', '10')
    );
    expect(supabaseBrowser.updateUser).not.toHaveBeenCalled();
  });

  it('marks the confirmation field when password entries do not match', async () => {
    const user = userEvent.setup();
    await renderAuthForm('/reset-password');
    await waitForEnabled('#reset-password');
    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'Password123!');
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
    await user.type(screen.getByLabelText(en.auth.resetNewPasswordLabel), 'NewPassword123!');
    await user.type(screen.getByLabelText(en.auth.resetConfirmPasswordLabel), 'NewPassword123!');
    submitForm();

    await waitFor(() => expect(router.state.location.pathname).toBe('/dashboard'));
    expect(supabaseBrowser.updateUser).toHaveBeenCalledWith({ password: 'NewPassword123!' });
  });
});
