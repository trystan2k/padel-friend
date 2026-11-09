/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshStatusProvider } from '../src/components/RefreshStatusProvider';
import { SkipLink } from '../src/components/SkipLink';
import { useAuthoritativeRefresh } from '../src/lib/use-authoritative-refresh';
import { createI18n } from '../src/i18n/config';

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

function Reader({ scope, read }: { scope: string; read: () => Promise<void> }) {
  useAuthoritativeRefresh({ scope, refresh: read });
  return <button type="button">{scope}</button>;
}

describe('release accessibility', () => {
  it.each(['en', 'pt-BR', 'es'] as const)(
    'names and operates the content bypass in %s',
    async (locale) => {
      const user = userEvent.setup();
      render(
        <I18nextProvider i18n={createI18n(locale)}>
          <SkipLink />
          <button type="button">Navigation</button>
          <div id="main-content" tabIndex={-1}>
            <main>
              <h1>Content</h1>
              <button type="button">Action</button>
            </main>
          </div>
        </I18nextProvider>
      );
      await user.tab();
      const link = screen.getByRole('link', {
        name: createI18n(locale).t('accessibility.skipToContent')
      });
      expect(document.activeElement).toBe(link);
      await user.keyboard('{Enter}');
      expect(document.activeElement?.id).toBe('main-content');
      await user.tab();
      expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Action' }));
    }
  );

  it('announces failure once across readers and repeated polls, clears on recovery, preserves focus', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('NETWORK'));
    const i18n = createI18n('en');
    const ui = (mounted: boolean) => (
      <I18nextProvider i18n={i18n}>
        <RefreshStatusProvider>
          {mounted && (
            <>
              <Reader scope="match" read={read} />
              <Reader scope="badge" read={read} />
            </>
          )}
        </RefreshStatusProvider>
      </I18nextProvider>
    );
    const { rerender } = render(ui(true));
    const status = screen.getByRole('status');
    expect(status.textContent).toBe('');
    const button = screen.getByRole('button', { name: 'match' });
    button.focus();
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(status.textContent).toBe(i18n.t('accessibility.stale'));
    expect(document.activeElement).toBe(button);
    const changes = vi.fn<MutationCallback>();
    const observer = new MutationObserver(changes);
    observer.observe(status, { subtree: true, childList: true, characterData: true });
    await act(async () => vi.advanceTimersByTimeAsync(18000));
    expect(changes).not.toHaveBeenCalled();
    read.mockResolvedValue();
    await act(async () => vi.advanceTimersByTimeAsync(30000));
    expect(status.textContent).toBe('');
    expect(document.activeElement).toBe(button);
    observer.disconnect();
    rerender(ui(false));
    expect(status.textContent).toBe('');
  });

  it('retires failed readers on scope replacement and unmount', async () => {
    vi.useFakeTimers();
    const read = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('NETWORK'));
    const ui = (scope: string | null) => (
      <I18nextProvider i18n={createI18n('es')}>
        <RefreshStatusProvider>
          {scope && <Reader scope={scope} read={read} />}
        </RefreshStatusProvider>
      </I18nextProvider>
    );
    const { rerender } = render(ui('old-account'));
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('status').textContent).not.toBe('');
    rerender(ui('new-account'));
    expect(screen.getByRole('status').textContent).toBe('');
    await act(async () => vi.advanceTimersByTimeAsync(3000));
    expect(screen.getByRole('status').textContent).not.toBe('');
    rerender(ui(null));
    expect(screen.getByRole('status').textContent).toBe('');
  });
});
