/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/locales/en/translation.json';
import { createI18n } from '../src/i18n/config';
import type { getMyNotificationPreferences } from '../src/features/notifications/notifications.functions';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  save: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children, to }: { children: import('react').ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}));
vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyNotificationPreferences: mocks.get,
  saveMyNotificationPreferences: mocks.save
}));
import { NotificationPreferencesPage } from '../src/features/notifications/NotificationPreferencesPage';

const copy = en.notificationPreferences;
const defaults = {
  push_enabled: false,
  push_community: true,
  push_matches: true,
  push_results: true,
  push_rankings: true,
  push_leagues: true
};
const fullRow = {
  ...defaults,
  critical_in_app_enabled: true,
  updated_at: '2026-10-15T00:00:00.000Z'
} as Awaited<ReturnType<typeof getMyNotificationPreferences>>;
function mount(initial: Awaited<ReturnType<typeof getMyNotificationPreferences>> = null) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <NotificationPreferencesPage initial={initial} />
    </I18nextProvider>
  );
}
beforeEach(() => {
  mocks.get.mockReset();
  mocks.save.mockReset();
  mocks.save.mockResolvedValue(fullRow);
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(cleanup);

describe('notification preferences page', () => {
  it('renders fetched preferences and missing-row defaults', () => {
    mount(fullRow);
    expect(screen.getByRole('switch', { name: copy.pushTitle }).getAttribute('aria-checked')).toBe(
      'false'
    );
    expect(
      screen.getByRole('switch', { name: copy.categories.community }).getAttribute('aria-checked')
    ).toBe('true');
    cleanup();
    mount();
    expect(
      screen.getByRole('switch', { name: copy.categories.leagues }).getAttribute('aria-checked')
    ).toBe('true');
  });

  it('saves all six push booleans and keeps categories while master is off', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('switch', { name: copy.categories.matches }));
    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    expect(
      screen.getByRole('switch', { name: copy.categories.matches }).getAttribute('aria-checked')
    ).toBe('false');
    expect(
      screen.getByRole('switch', { name: copy.categories.matches }).getAttribute('aria-disabled')
    ).toBe('true');
    await user.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: {
          push_enabled: false,
          push_community: true,
          push_matches: false,
          push_results: true,
          push_rankings: true,
          push_leagues: true
        }
      })
    );
    expect(await screen.findByText(copy.saved)).toBeTruthy();
    expect(screen.getByText(copy.saved).getAttribute('aria-live')).toBe('polite');
  });

  it('shows critical notifications as static always-on copy without an off control', () => {
    mount();
    const panel = screen.getByRole('region', { name: copy.criticalTitle });
    expect(within(panel).getByText(copy.alwaysOn)).toBeTruthy();
    expect(within(panel).queryByRole('switch')).toBeNull();
    expect(within(panel).queryByRole('button')).toBeNull();
  });

  it('disables save and explains offline status', () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    mount();
    return waitFor(() => {
      expect(screen.getByRole('button', { name: copy.save }).hasAttribute('disabled')).toBe(true);
      expect(screen.getByText(copy.offline)).toBeTruthy();
    });
  });

  it('retains edits after save failure and retries', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fullRow);
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('button', { name: copy.save }));
    expect((await screen.findByRole('alert')).textContent).toBe(copy.error);
    expect(screen.getByRole('switch', { name: copy.pushTitle }).getAttribute('aria-checked')).toBe(
      'true'
    );
    await user.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
  });

  it('never requests browser notification permission', () => {
    const permission = vi.fn<() => Promise<PermissionState>>();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { requestPermission: permission }
    });
    mount();
    expect(permission).not.toHaveBeenCalled();
  });
});
