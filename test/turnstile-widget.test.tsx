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

it('keeps one constant visually-hidden status class set in every state', async () => {
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
  const keepsLayout = () =>
    base.every((name) => status.classList.contains(name)) &&
    status.classList.length === base.length;
  act(() => callbacks?.callback('token'));
  expect(status.textContent).toBe('');
  expect(keepsLayout()).toBe(true);
  act(() => callbacks?.['expired-callback']());
  expect(keepsLayout()).toBe(true);
  act(() => callbacks?.['error-callback']());
  expect(keepsLayout()).toBe(true);
});

function renderWidget(onError = vi.fn<() => void>()) {
  vi.stubEnv('VITE_TURNSTILE_SITE_KEY', 'site-key');
  const i18n = createI18n('en');
  return import('../src/components/ui/TurnstileWidget').then(({ TurnstileWidget: Widget }) => {
    render(
      <I18nextProvider i18n={i18n}>
        <Widget
          resetCount={0}
          onToken={vi.fn<(token: string | null) => void>()}
          onError={onError}
        />
      </I18nextProvider>
    );
    return { i18n, onError, status: screen.getByRole('status') };
  });
}

it('shows a visible translated fallback when the provider script fails to load', async () => {
  const { i18n, onError, status } = await renderWidget();
  const hidden = [...status.classList];
  expect(status.textContent).toBe(i18n.t('auth.captchaLoading'));
  const script = document.querySelector('script[src*="turnstile"]');
  if (!script) throw new Error('missing provider script');
  fireEvent.error(script);
  await waitFor(() => expect(status.textContent).toBe(i18n.t('auth.captchaError')));
  expect(status.getAttribute('aria-live')).toBe('polite');
  expect(status.classList.length).toBeGreaterThan(0);
  expect(hidden.every((name) => status.classList.contains(name))).toBe(false);
  expect(onError).toHaveBeenCalledOnce();
});

it('shows the visible fallback when the provider script stalls past the timeout', async () => {
  vi.useFakeTimers();
  try {
    const { i18n, status } = await renderWidget();
    const hidden = [...status.classList];
    act(() => {
      vi.advanceTimersByTime(15000);
    });
    expect(status.textContent).toBe(i18n.t('auth.captchaError'));
    expect(hidden.every((name) => status.classList.contains(name))).toBe(false);
  } finally {
    vi.useRealTimers();
  }
});

it('keeps the status visually hidden once the widget has rendered', async () => {
  let callbacks: Parameters<NonNullable<Window['turnstile']>['render']>[1] | undefined;
  window.turnstile = {
    render: vi.fn<NonNullable<Window['turnstile']>['render']>((_container, options) => {
      callbacks = options;
      return 'widget';
    }),
    remove: vi.fn<NonNullable<Window['turnstile']>['remove']>()
  };
  const { status } = await renderWidget();
  const hidden = [...status.classList];
  const script = document.querySelector('script[src*="turnstile"]');
  if (!script) throw new Error('missing provider script');
  fireEvent.load(script);
  await waitFor(() => expect(callbacks).toBeDefined());
  act(() => callbacks?.['error-callback']());
  expect([...status.classList]).toEqual(hidden);
  act(() => callbacks?.['expired-callback']());
  expect([...status.classList]).toEqual(hidden);
});

it('styles the fallback with a reserved box and the status visually hidden and reserves no layout space', async () => {
  const source = await import('node:fs').then((fs) =>
    fs.readFileSync('src/components/ui/TurnstileWidget.tsx', 'utf8')
  );
  expect(source).toContain("position: 'absolute'");
  expect(source).toContain("clip: 'rect(0, 0, 0, 0)'");
  expect(source).toContain("overflow: 'hidden'");
  expect(source).not.toMatch(/minHeight/);
  expect(source).toContain('minBlockSize');
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
