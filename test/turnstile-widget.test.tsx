/** @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, expect, it, vi } from 'vitest';
import { TurnstileWidget } from '../src/components/ui/TurnstileWidget';
import { createI18n } from '../src/i18n/config';

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  delete window.turnstile;
  document.querySelectorAll('script[src*="turnstile"]').forEach((script) => script.remove());
  vi.resetModules();
});

it.each(['en', 'pt-BR', 'es'] as const)(
  'announces loading, provider error and expiry immediately (%s)',
  async (locale) => {
    vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
    const i18n = createI18n(locale);
    let callbacks: Parameters<NonNullable<Window['turnstile']>['render']>[1] | undefined;
    window.turnstile = {
      render: vi.fn<NonNullable<Window['turnstile']>['render']>((_container, options) => {
        callbacks = options;
        return 'widget';
      }),
      remove: vi.fn<NonNullable<Window['turnstile']>['remove']>()
    };
    // Isolate the script-loader singleton between cases.
    const { TurnstileWidget: Widget } = await import('../src/components/ui/TurnstileWidget');
    const onToken = vi.fn<(token: string | null) => void>();
    const onError = vi.fn<() => void>();
    render(
      <I18nextProvider i18n={i18n}>
        <Widget resetCount={0} onToken={onToken} onError={onError} />
      </I18nextProvider>
    );
    const status = screen.getByRole('status');
    expect(status.getAttribute('aria-live')).toBe('polite');
    expect(status.textContent).toBe(i18n.t('auth.captchaLoading'));
    expect(status.textContent).not.toBe('auth.captchaLoading');
    const script = document.querySelector('script[src*="turnstile"]');
    if (!script) throw new Error('missing provider script');
    fireEvent.load(script);
    await waitFor(() => expect(callbacks).toBeDefined());
    act(() => callbacks?.['error-callback']());
    expect(status.textContent).toBe(i18n.t('auth.captchaError'));
    expect(onError).toHaveBeenCalledOnce();
    act(() => callbacks?.callback('token'));
    expect(status.textContent).toBe('');
    act(() => callbacks?.['expired-callback']());
    expect(status.textContent).toBe(i18n.t('auth.captchaExpired'));
    expect(status.textContent).not.toBe('auth.captchaExpired');
    expect(onToken).toHaveBeenLastCalledWith(null);
  }
);

it('keeps the reserved-space status class in idle, loading, error and expired states', async () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
  const i18n = createI18n('en');
  let callbacks: Parameters<NonNullable<Window['turnstile']>['render']>[1] | undefined;
  window.turnstile = {
    render: vi.fn<NonNullable<Window['turnstile']>['render']>((_container, options) => {
      callbacks = options;
      return 'widget';
    }),
    remove: vi.fn<NonNullable<Window['turnstile']>['remove']>()
  };
  const { TurnstileWidget: Widget } = await import('../src/components/ui/TurnstileWidget');
  render(
    <I18nextProvider i18n={i18n}>
      <Widget
        resetCount={0}
        onToken={vi.fn<(token: string | null) => void>()}
        onError={vi.fn<() => void>()}
      />
    </I18nextProvider>
  );
  const status = screen.getByRole('status');
  const base = [...status.classList].filter((name) => name.length > 0);
  expect(base.length).toBeGreaterThan(0);
  const script = document.querySelector('script[src*="turnstile"]');
  if (!script) throw new Error('missing provider script');
  fireEvent.load(script);
  await waitFor(() => expect(callbacks).toBeDefined());
  // The error variant may only swap the colour class; every layout class stays.
  const keepsLayout = () =>
    base.filter((name) => status.classList.contains(name)).length >= base.length - 1 &&
    status.classList.length === base.length;
  act(() => callbacks?.callback('token'));
  expect(status.textContent).toBe('');
  expect(keepsLayout()).toBe(true);
  act(() => callbacks?.['expired-callback']());
  expect(keepsLayout()).toBe(true);
  act(() => callbacks?.['error-callback']());
  expect(keepsLayout()).toBe(true);
});

it('reserves two status lines from design tokens so a wrapped translation cannot shift layout', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync('src/components/ui/TurnstileWidget.tsx', 'utf8')
  );
  expect(source).toContain(
    "minHeight: 'calc(var(--font-size-12) * var(--font-line-height-body) * 2)'"
  );
  expect(source).not.toMatch(/minHeight: '[0-9]+px'/);
});

it('renders no widget or status when disabled', () => {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', '');
  const view = render(
    <TurnstileWidget
      resetCount={0}
      onToken={vi.fn<(token: string | null) => void>()}
      onError={vi.fn<() => void>()}
    />
  );
  expect(view.container.childElementCount).toBe(0);
});
