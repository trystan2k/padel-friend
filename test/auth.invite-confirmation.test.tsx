/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { InviteConfirmation } from '../src/features/auth/InviteConfirmation';
import { createI18n } from '../src/i18n/config';
import { PRIVACY_CONTACT_EMAIL } from '../src/features/privacy/privacy-content';
import en from '../src/locales/en/translation.json';
import es from '../src/locales/es/translation.json';
import ptBR from '../src/locales/pt-BR/translation.json';

type Confirmation = Parameters<typeof InviteConfirmation>[0]['confirmation'];

function mount(confirmation: Confirmation, locale: 'en' | 'es' | 'pt-BR' = 'en') {
  return render(
    <I18nextProvider i18n={createI18n(locale)}>
      <InviteConfirmation confirmation={confirmation} />
    </I18nextProvider>
  );
}

afterEach(cleanup);

// Clubhouse invitation frames b7ymtm (default), syxBk (invalid), wdEqM (expired), KZhFq (busy).
describe('invite confirmation (Clubhouse frames)', () => {
  it('default: one-use POST form with the explicit accept and a cancel to sign in', () => {
    const { container } = mount({ csrf: 'token-1', account: '', email: null });
    const form = container.querySelector('form')!;
    expect(form.getAttribute('method')).toBe('post');
    expect(form.getAttribute('action')).toBe('/auth/callback');
    expect(form.querySelector<HTMLInputElement>('input[name="csrf"]')!.value).toBe('token-1');
    expect(form.querySelector<HTMLInputElement>('input[name="account"]')!.value).toBe('');
    expect(screen.getByText(en.auth.inviteBarTitle)).toBeTruthy();
    expect(
      screen.getByRole('heading', { level: 1, name: en.auth.inviteConfirmTitle })
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: en.auth.inviteConfirm }).getAttribute('type')).toBe(
      'submit'
    );
    expect(screen.getByRole('button', { name: en.auth.inviteCancel }).getAttribute('href')).toBe(
      '/login'
    );
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByText(en.auth.inviteHelpTitle)).toBeNull();
  });

  it('names the signed-in account before it can be replaced and relabels the action', () => {
    mount({ csrf: 'token-2', account: 'user-1', email: 'sam@example.com' });
    expect(screen.getByRole('alert').textContent).toContain('sam@example.com');
    expect(screen.getByRole('button', { name: en.auth.inviteSwitchConfirm })).toBeTruthy();
    cleanup();
    mount({ csrf: 'token-3', account: 'user-1', email: null });
    expect(screen.getByRole('alert').textContent).toBe(en.auth.inviteAccountWarningUnknown);
  });

  it('busy: submit keeps the form posting but shows the pending state and disables the action', () => {
    const { container } = mount({ csrf: 'token-4', account: '', email: null });
    const form = container.querySelector('form')!;
    // jsdom does not implement form navigation; the React handler is what is under test.
    form.addEventListener('submit', (event) => event.preventDefault());
    fireEvent.submit(form);
    expect(screen.getByRole('heading', { level: 1, name: en.auth.inviteBusyTitle })).toBeTruthy();
    const busy = screen.getByRole('button', { name: en.auth.inviteAccepting });
    expect(busy.hasAttribute('disabled')).toBe(true);
    expect(busy.getAttribute('aria-busy')).toBe('true');
    expect(screen.queryByRole('button', { name: en.auth.inviteCancel })).toBeNull();
    // The one-use confirmation fields stay mounted while the POST is in flight.
    expect(form.querySelector('input[name="csrf"]')).toBeTruthy();
  });

  it('invalid: could not verify the current account, help card and a way back', () => {
    mount({ error: 'verification_failed' });
    expect(screen.getByRole('heading', { level: 1, name: en.auth.inviteFailedTitle })).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(en.auth.inviteConfirmVerificationFailed);
    expect(screen.queryByRole('form')).toBeNull();
    expect(screen.getByRole('heading', { level: 2, name: en.auth.inviteHelpTitle })).toBeTruthy();
    expect(screen.getByRole('link', { name: en.auth.inviteHelpLink }).getAttribute('href')).toBe(
      `mailto:${PRIVACY_CONTACT_EMAIL}`
    );
    expect(
      screen.getByRole('button', { name: en.auth.inviteBackToSignIn }).getAttribute('href')
    ).toBe('/login');
  });

  it('expired: no pending confirmation, same help card and way back', () => {
    mount(null);
    expect(
      screen.getByRole('heading', { level: 1, name: en.auth.inviteExpiredTitle })
    ).toBeTruthy();
    expect(screen.getByRole('alert').textContent).toBe(en.auth.inviteConfirmExpired);
    expect(document.querySelector('form')).toBeNull();
    expect(screen.getByRole('button', { name: en.auth.inviteBackToSignIn })).toBeTruthy();
  });

  it.each([
    ['es', es],
    ['pt-BR', ptBR]
  ] as const)('renders every new state in %s without falling back to English', (locale, copy) => {
    mount(null, locale);
    expect(
      screen.getByRole('heading', { level: 1, name: copy.auth.inviteExpiredTitle })
    ).toBeTruthy();
    expect(copy.auth.inviteExpiredTitle).not.toBe(en.auth.inviteExpiredTitle);
    for (const key of [
      'inviteBarTitle',
      'inviteAccepting',
      'inviteBusyTitle',
      'inviteBusyDescription',
      'inviteFailedTitle',
      'inviteHelpTitle',
      'inviteHelpHint',
      'inviteHelpLink',
      'inviteBackToSignIn',
      'passwordStrengthLabel',
      'passwordStrengthEmpty',
      'passwordStrengthWeak',
      'passwordStrengthFair',
      'passwordStrengthGood',
      'passwordStrengthStrong'
    ] as const)
      expect(copy.auth[key]).toBeTruthy();
  });

  it('writes the invitation actions in sentence case, not uppercase', () => {
    for (const copy of [en, es, ptBR])
      for (const key of ['inviteConfirm', 'inviteSwitchConfirm', 'inviteCancel'] as const)
        expect(copy.auth[key]).not.toBe(copy.auth[key].toUpperCase());
  });
});
