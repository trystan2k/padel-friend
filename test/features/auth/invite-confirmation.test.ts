/** @vitest-environment jsdom */
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import { renderToStaticMarkup } from 'react-dom/server';
import { InviteConfirmation } from '../../../src/features/auth/InviteConfirmation';
import { createI18n, supportedLocales } from '../../../src/i18n/config';

afterEach(cleanup);

function view(locale: (typeof supportedLocales)[number], account = '') {
  return createElement(
    I18nextProvider,
    { i18n: createI18n(locale) },
    createElement(InviteConfirmation, {
      confirmation: {
        csrf: 'signed-confirmation',
        account,
        email: account ? 'current<&>@example.test' : null
      }
    })
  );
}

describe('invite confirmation', () => {
  it.each(supportedLocales)(
    'renders translated SSR confirmation and trusted account warning in %s',
    (locale) => {
      const i18n = createI18n(locale);
      const markup = renderToStaticMarkup(view(locale, 'current-user'));
      expect(markup).toContain(i18n.t('auth.inviteConfirmTitle'));
      expect(markup).toContain('current&lt;&amp;&gt;@example.test');
      expect(markup).toContain('role="alert"');
      expect(markup).toContain(i18n.t('auth.inviteSwitchConfirm'));
      expect(markup).toContain('method="post"');
      expect(markup).toContain('action="/auth/callback"');
      expect(markup).not.toContain('token_hash');
      expect(markup).not.toContain('auth.invite');
    }
  );

  it('requires an explicit accessible keyboard submission; no automatic session transition', async () => {
    const user = userEvent.setup();
    const i18n = createI18n('en');
    render(view('en'));
    expect(screen.queryByRole('alert')).toBeNull();
    const submit = screen.getByRole('button', { name: i18n.t('auth.inviteConfirm') });
    expect(submit.getAttribute('type')).toBe('submit');
    expect(submit.closest('form')?.getAttribute('method')).toBe('post');
    await user.tab();
    expect(document.activeElement).toBe(submit);
    expect(screen.getByText(i18n.t('auth.inviteCancel')).closest('a')?.getAttribute('href')).toBe(
      '/login'
    );
  });

  it('renders a localized expired-state alert without a confirmation action', () => {
    const i18n = createI18n('en');
    render(
      createElement(
        I18nextProvider,
        { i18n },
        createElement(InviteConfirmation, { confirmation: null })
      )
    );
    expect(screen.getByRole('alert').textContent).toBe(i18n.t('auth.inviteConfirmExpired'));
    expect(screen.queryByRole('button', { name: i18n.t('auth.inviteConfirm') })).toBeNull();
  });
});
