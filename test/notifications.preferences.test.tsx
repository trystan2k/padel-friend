/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { I18nextProvider } from 'react-i18next';
import type { ComponentType } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import en from '../src/locales/en/translation.json';
import { createI18n } from '../src/i18n/config';
import type { getMyNotificationPreferences } from '../src/features/notifications/notifications.functions';

const mocks = vi.hoisted(() => ({
  get: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  save: vi.fn<
    (input: {
      data: {
        push_enabled: boolean;
        push_community: boolean;
        push_matches: boolean;
        push_results: boolean;
        push_rankings: boolean;
        push_leagues: boolean;
      };
    }) => Promise<unknown>
  >(),
  invalidate: vi.fn<() => Promise<void>>()
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({ children, to }: { children: import('react').ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  )
}));
vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyNotificationPreferences: mocks.get,
  saveMyNotificationPreferences: mocks.save
}));
import { NotificationPreferencesPage } from '../src/features/notifications/NotificationPreferencesPage';
import { Route as NotificationPreferencesRoute } from '../src/routes/_protected.notifications.preferences';

// Rendered strings are asserted against the REAL en locale resource below, so
// any hardcoded copy in the component breaks these expectations.
const copy = en.notificationPreferences;
const loadCopy = en.notifications;
const categoryNames = [
  copy.categories.community,
  copy.categories.matches,
  copy.categories.results,
  copy.categories.rankings,
  copy.categories.leagues
];
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

type RouteErrorProps = { error: Error; reset: () => void };

function isRouteErrorComponent(value: unknown): value is ComponentType<RouteErrorProps> {
  return typeof value === 'function';
}

function routeErrorComponent(route: unknown): ComponentType<RouteErrorProps> {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  const errorComponent: unknown =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'errorComponent') : null;
  if (!isRouteErrorComponent(errorComponent)) throw new Error('Route has no error component');
  return errorComponent;
}

function mountErrorState() {
  const ErrorState = routeErrorComponent(NotificationPreferencesRoute);
  render(
    <I18nextProvider i18n={createI18n('en')}>
      <ErrorState error={new Error('load failed')} reset={vi.fn<() => void>()} />
    </I18nextProvider>
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

function switchState(name: string) {
  const element = screen.getByRole('switch', { name });
  return {
    checked: element.getAttribute('aria-checked'),
    disabled: element.getAttribute('aria-disabled')
  };
}

beforeEach(() => {
  mocks.get.mockReset();
  mocks.save.mockReset();
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  mocks.save.mockResolvedValue(fullRow);
  setOnline(true);
});
afterEach(cleanup);

describe('notification preferences page', () => {
  it('renders the full grouped structure with localized copy after the rework', () => {
    mount(fullRow);

    expect(screen.getByRole('heading', { name: copy.title })).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.back }).getAttribute('href')).toBe(
      '/notifications'
    );
    expect(screen.getByText(copy.context)).toBeTruthy();
    expect(screen.getByText(copy.pushUnavailable)).toBeTruthy();

    const group = screen.getByText(copy.pushTitle).closest('fieldset');
    if (!(group instanceof HTMLFieldSetElement)) throw new Error('push group is not a fieldset');
    expect(within(group).getByText(copy.pushHelper)).toBeTruthy();
    expect(within(group).getByRole('switch', { name: copy.pushTitle })).toBeTruthy();
    for (const name of categoryNames) {
      expect(screen.getByRole('switch', { name })).toBeTruthy();
    }
    expect(screen.getAllByRole('switch')).toHaveLength(6);

    const critical = screen.getByRole('region', { name: copy.criticalTitle });
    expect(within(critical).getByText(copy.criticalHelper)).toBeTruthy();
    expect(within(critical).getByText(copy.alwaysOn)).toBeTruthy();
  });

  it('loads server values into every switch and falls back to defaults without a row', () => {
    const loaded = {
      ...fullRow,
      push_enabled: true,
      push_community: false,
      push_matches: true,
      push_results: false,
      push_rankings: true,
      push_leagues: false
    };
    mount(loaded);
    expect(switchState(copy.pushTitle).checked).toBe('true');
    expect(switchState(categoryNames[0]).checked).toBe('false');
    expect(switchState(categoryNames[1]).checked).toBe('true');
    expect(switchState(categoryNames[2]).checked).toBe('false');
    expect(switchState(categoryNames[3]).checked).toBe('true');
    expect(switchState(categoryNames[4]).checked).toBe('false');
    cleanup();

    mount(null);
    expect(switchState(copy.pushTitle).checked).toBe('false');
    for (const name of categoryNames) {
      expect(switchState(name).checked).toBe('true');
    }
  });

  it('shows critical notifications as static always-on copy without any off affordance', () => {
    mount();
    const panel = screen.getByRole('region', { name: copy.criticalTitle });
    expect(within(panel).getByText(copy.alwaysOn)).toBeTruthy();
    expect(within(panel).queryByRole('switch')).toBeNull();
    expect(within(panel).queryByRole('checkbox')).toBeNull();
    expect(within(panel).queryByRole('button')).toBeNull();
    expect(within(panel).queryByRole('radio')).toBeNull();
    expect(within(panel).queryAllByRole('textbox')).toHaveLength(0);
  });

  it('round-trips exactly the six push booleans through save', async () => {
    const user = userEvent.setup();
    const loaded = {
      ...fullRow,
      push_enabled: true,
      push_community: false,
      push_matches: true,
      push_results: false,
      push_rankings: true,
      push_leagues: false
    };
    mount(loaded);

    await user.click(screen.getByRole('switch', { name: categoryNames[0] }));
    await user.click(screen.getByRole('switch', { name: categoryNames[2] }));
    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('button', { name: copy.save }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(1));
    const call = mocks.save.mock.calls[0][0];
    expect(Object.keys(call.data).sort()).toEqual(
      [
        'push_enabled',
        'push_community',
        'push_matches',
        'push_results',
        'push_rankings',
        'push_leagues'
      ].sort()
    );
    expect(call.data).toEqual({
      push_enabled: false,
      push_community: true,
      push_matches: true,
      push_results: true,
      push_rankings: true,
      push_leagues: false
    });
    expect(await screen.findByText(copy.saved)).toBeTruthy();
  });

  it('retains category values while the master switch is off', async () => {
    const user = userEvent.setup();
    mount();

    // Categories start disabled with retained values when push is off.
    expect(switchState(categoryNames[0]).disabled).toBe('true');
    expect(switchState(categoryNames[0]).checked).toBe('true');

    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('switch', { name: categoryNames[0] }));
    expect(switchState(categoryNames[0]).checked).toBe('false');

    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    expect(switchState(copy.pushTitle).checked).toBe('false');
    expect(switchState(categoryNames[0]).disabled).toBe('true');
    expect(switchState(categoryNames[0]).checked).toBe('false');
    expect(switchState(categoryNames[1]).checked).toBe('true');

    // Re-enabling must not reset the retained category values.
    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    expect(switchState(categoryNames[0]).checked).toBe('false');

    await user.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith({
        data: { ...defaults, push_enabled: true, push_community: false }
      })
    );
  });

  it('renders the save-in-progress label while a save is pending', async () => {
    let resolveSave!: (value: unknown) => void;
    mocks.save.mockReturnValueOnce(new Promise((resolve) => (resolveSave = resolve)));
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('button', { name: copy.save }));
    expect(await screen.findByRole('button', { name: copy.saving })).toHaveProperty(
      'disabled',
      true
    );
    resolveSave(fullRow);
    expect(await screen.findByRole('button', { name: copy.save })).toHaveProperty(
      'disabled',
      false
    );
  });

  it('announces save success politely without an alert role', async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('button', { name: copy.save }));
    const saved = await screen.findByText(copy.saved);
    expect(saved.getAttribute('aria-live')).toBe('polite');
    expect(saved.getAttribute('role')).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('retains edits after a save failure and retry re-invokes save', async () => {
    mocks.save.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(fullRow);
    const user = userEvent.setup();
    mount();

    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('switch', { name: categoryNames[4] }));
    await user.click(screen.getByRole('button', { name: copy.save }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(copy.error);
    expect(alert.getAttribute('aria-live')).toBe('assertive');
    expect(switchState(copy.pushTitle).checked).toBe('true');
    expect(switchState(categoryNames[4]).checked).toBe('false');

    await user.click(screen.getByRole('button', { name: copy.save }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][0]).toEqual(mocks.save.mock.calls[0][0]);
    expect(await screen.findByText(copy.saved)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('disables save with localized copy while offline and recovers on reconnect', async () => {
    setOnline(false);
    mount();

    const saveButton = screen.getByRole('button', { name: copy.save });
    expect(saveButton).toHaveProperty('disabled', true);
    expect(screen.getByText(copy.offline)).toBeTruthy();
    await userEvent.setup().click(saveButton);
    expect(mocks.save).not.toHaveBeenCalled();

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: copy.save })).toHaveProperty('disabled', false)
    );
    expect(screen.queryByText(copy.offline)).toBeNull();
  });

  it('load errors report a load failure with retry that refetches the loader, never a save failure', async () => {
    const user = userEvent.setup();
    mountErrorState();

    const alert = screen.getByRole('alert');
    expect(alert.textContent).toBe(loadCopy.error);
    expect(alert.textContent).not.toBe(copy.error);
    expect(screen.getByRole('link', { name: copy.back }).getAttribute('href')).toBe(
      '/notifications'
    );

    await user.click(screen.getByRole('button', { name: loadCopy.retry }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
    expect(mocks.save).not.toHaveBeenCalled();
    expect(mocks.get).not.toHaveBeenCalled();
  });

  it('never requests browser notification permission or a push subscription', async () => {
    const requestPermission = vi.fn<() => Promise<PermissionState>>();
    const subscribe = vi.fn<() => Promise<unknown>>();
    Object.defineProperty(window, 'Notification', {
      configurable: true,
      value: { requestPermission }
    });
    Object.defineProperty(navigator, 'serviceWorker', {
      configurable: true,
      value: { ready: Promise.resolve({ pushManager: { subscribe } }) }
    });
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByRole('switch', { name: copy.pushTitle }));
    await user.click(screen.getByRole('button', { name: copy.save }));
    await screen.findByText(copy.saved);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(subscribe).not.toHaveBeenCalled();
  });
});
