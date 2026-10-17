/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';
import type { ComponentType } from 'react';

const mocks = vi.hoisted(() => ({
  targetV1: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  targetV2: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  matchContext: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  markRead: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  accept: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({
    children,
    params: _params,
    to
  }: {
    children: import('react').ReactNode;
    params?: object;
    to: string;
  }) => <a href={to}>{children}</a>
}));
vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyNotificationTarget: mocks.targetV1,
  getMyNotificationTargetV2: mocks.targetV2,
  getMyMatchNotificationContext: mocks.matchContext,
  markNotificationRead: mocks.markRead,
  acceptMyNotificationInvitation: mocks.accept
}));

import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import type {
  MatchNotificationContext,
  NotificationTarget
} from '../src/features/notifications/notification-target';
import { NotificationDetailPage } from '../src/features/notifications/NotificationDetailPage';
import { Route as NotificationDetailRoute } from '../src/routes/_protected.notifications.$notificationId';
import { Route as NotificationListRoute } from '../src/routes/_protected.notifications.index';

// Rendered strings are asserted against the REAL en locale resource below, so
// any hardcoded copy in the component breaks these expectations.
const copy = en.notifications;
const notificationId = '9f1c3b2a-7d4e-4c8a-9b2f-1e6d5a7c3b40';
const communityId = '11111111-1111-4111-8111-111111111111';
const invitationId = '22222222-2222-4222-8222-222222222222';
const communityName = 'Padel Norte';

const unavailable: NotificationTarget = {
  target_status: 'unavailable',
  community_id: null,
  community_name: null,
  invitation_id: null,
  membership_status: null
};
const invited: NotificationTarget = {
  target_status: 'invitation_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: invitationId,
  membership_status: null
};
const membership = (status: string): NotificationTarget => ({
  target_status: 'membership_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: null,
  membership_status: status
});
const availableMatch: NotificationTarget = {
  target_status: 'match_available',
  community_id: communityId,
  community_name: communityName,
  invitation_id: null,
  membership_status: null,
  match_event_id: '33333333-3333-4333-8333-333333333333',
  match_available: true
};
const matchContext = (venue: string): MatchNotificationContext => ({
  match_event_id: availableMatch.match_event_id!,
  creator_display_name: 'Alex',
  scheduled_at: '2026-10-20T10:00:00.000Z',
  timezone: 'UTC',
  venue,
  event_type: 'friendly',
  playing_count: 0,
  reserve_count: 1,
  price_minor: null,
  currency: null
});

function hasLoader(route: unknown): route is {
  options: { loader: (context: { params: { notificationId: string } }) => Promise<unknown> };
} {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  return (
    typeof options === 'object' &&
    options !== null &&
    typeof Reflect.get(options, 'loader') === 'function'
  );
}

function detailLoader(params: { notificationId: string }): Promise<unknown> {
  if (!hasLoader(NotificationDetailRoute))
    throw new Error('Notification detail route has no loader');
  return NotificationDetailRoute.options.loader({ params });
}

type RouteErrorProps = { error: Error; reset: () => void };

function isRouteErrorComponent(value: unknown): value is ComponentType<RouteErrorProps> {
  return typeof value === 'function';
}

function routeErrorComponent(route: unknown) {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  const errorComponent: unknown =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'errorComponent') : null;
  if (!isRouteErrorComponent(errorComponent)) throw new Error('Route has no error component');
  return errorComponent;
}

function isTarget(value: unknown): value is NotificationTarget {
  return typeof value === 'object' && value !== null && 'target_status' in value;
}

function mountPage(target: NotificationTarget, context?: MatchNotificationContext | null) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <NotificationDetailPage
        notificationId={notificationId}
        target={target}
        matchContext={context}
      />
    </I18nextProvider>
  );
}

function setOnline(online: boolean) {
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: online });
}

beforeEach(() => {
  mocks.targetV1.mockReset();
  mocks.targetV2.mockReset();
  mocks.matchContext.mockReset();
  mocks.markRead.mockReset();
  mocks.accept.mockReset();
  mocks.invalidate.mockReset().mockResolvedValue(undefined);
  setOnline(true);
  mocks.targetV1.mockResolvedValue(unavailable);
  mocks.targetV2.mockResolvedValue(unavailable);
  mocks.matchContext.mockResolvedValue(null);
  mocks.markRead.mockResolvedValue('2026-10-15T00:00:00.000Z');
  mocks.accept.mockResolvedValue({ community_id: communityId, status: 'active' });
});
afterEach(cleanup);

describe('notification detail page', () => {
  it('renders the localized unavailable state with a back link to the notification center', async () => {
    mountPage(unavailable);

    expect(await screen.findByRole('heading', { name: copy.targetUnavailable })).toBeTruthy();
    const back = screen.getByRole('link', { name: copy.back });
    expect(back.getAttribute('href')).toBe('/notifications');
    expect(screen.queryByRole('button')).toBeNull();
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
  });

  it('renders the invited state and accepts through the server function using the notification id', async () => {
    let resolveAccept!: (result: unknown) => void;
    mocks.accept.mockReturnValueOnce(new Promise((resolve) => (resolveAccept = resolve)));
    mocks.targetV2.mockResolvedValueOnce(membership('active'));
    const user = userEvent.setup();
    mountPage(invited);

    expect(await screen.findByRole('heading', { name: communityName })).toBeTruthy();
    expect(screen.getByText(copy.invitationContext)).toBeTruthy();
    const acceptButton = screen.getByRole('button', { name: copy.accept });
    await user.click(acceptButton);
    expect(mocks.accept).toHaveBeenCalledWith({ data: { notificationId } });
    expect(await screen.findByRole('button', { name: copy.accepting })).toBeTruthy();
    resolveAccept({ community_id: communityId, status: 'active' });
    expect(await screen.findByText(copy.accepted)).toBeTruthy();
    expect(screen.getByRole('status').getAttribute('aria-live')).toBe('polite');
    expect(await screen.findByText(copy.activeMembership)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();
    expect(mocks.targetV2).toHaveBeenCalledWith({ data: { notificationId } });
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
  });

  it('renders the localized current membership status copy', async () => {
    mountPage(membership('active'));

    expect(await screen.findByText(copy.activeMembership)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();
    cleanup();

    mountPage(membership('pending'));
    expect(await screen.findByText(copy.pendingMembership)).toBeTruthy();
    expect(screen.queryByRole('button', { name: copy.accept })).toBeNull();
  });

  it('retries a failed mark-read mutation instead of only refreshing the target', async () => {
    mocks.markRead.mockRejectedValueOnce(new Error('read marking failed'));
    const user = userEvent.setup();
    mountPage(invited);

    expect(await screen.findByRole('heading', { name: communityName })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe(copy.targetError);
    expect(mocks.targetV2).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: copy.retry }));

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(2));
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mocks.targetV2).not.toHaveBeenCalled();
  });

  it('shows offline state, skips read writes, disables acceptance and reconciles on reconnect', async () => {
    setOnline(false);
    mocks.targetV2.mockResolvedValue(invited);
    mountPage(invited);

    expect(await screen.findByText(copy.offline)).toBeTruthy();
    expect(mocks.markRead).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: copy.accept })).toHaveProperty('disabled', true);

    setOnline(true);
    window.dispatchEvent(new Event('online'));
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(mocks.targetV2).toHaveBeenCalledTimes(1));
    expect(mocks.targetV1).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: copy.accept })).toHaveProperty('disabled', false);
  });

  it('refreshes the authorized match target and context together after reconnect', async () => {
    setOnline(false);
    mocks.targetV2.mockResolvedValue(availableMatch);
    mocks.matchContext.mockResolvedValue(matchContext('Updated club'));
    mountPage(availableMatch, matchContext('Stale club'));

    expect(await screen.findByText(/Stale club/)).toBeTruthy();
    setOnline(true);
    await act(async () => window.dispatchEvent(new Event('online')));

    expect(await screen.findByText(/Updated club/)).toBeTruthy();
    expect(screen.getByRole('link', { name: copy.match.openEvent }).getAttribute('href')).toBe(
      `/matches/${availableMatch.match_event_id}`
    );
    expect(mocks.targetV2).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.matchContext).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.targetV1).not.toHaveBeenCalled();
  });

  it('uses v2 target and refreshes match context when retrying a failed reconnect', async () => {
    setOnline(false);
    mocks.targetV2.mockRejectedValueOnce(new Error('offline refresh failed'));
    mountPage(availableMatch, matchContext('Stale club'));
    expect(await screen.findByText(copy.offline)).toBeTruthy();
    setOnline(true);
    await act(async () => window.dispatchEvent(new Event('online')));

    expect(await screen.findByRole('alert')).toBeTruthy();
    mocks.targetV2.mockResolvedValueOnce(availableMatch);
    mocks.matchContext.mockResolvedValueOnce(matchContext('Retried club'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: copy.retry }));

    expect(await screen.findByText(/Retried club/)).toBeTruthy();
    expect(mocks.targetV2).toHaveBeenCalledTimes(2);
    expect(mocks.matchContext).toHaveBeenCalledTimes(1);
    expect(mocks.targetV1).not.toHaveBeenCalled();
  });

  it('provides localized retry and safe back navigation for route loader errors', async () => {
    const user = userEvent.setup();
    const reset = vi.fn<() => void>();
    const ListError = routeErrorComponent(NotificationListRoute);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <ListError error={new Error('load failed')} reset={reset} />
      </I18nextProvider>
    );

    expect(screen.getByRole('alert').textContent).toBe(copy.error);
    expect(
      screen.getByRole('link', { name: en.communityAdmin.backToDashboard }).getAttribute('href')
    ).toBe('/dashboard');
    await user.click(screen.getByRole('button', { name: copy.retry }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(1));
    expect(reset).toHaveBeenCalledTimes(1);

    cleanup();
    const detailReset = vi.fn<() => void>();
    const DetailError = routeErrorComponent(NotificationDetailRoute);
    render(
      <I18nextProvider i18n={createI18n('en')}>
        <DetailError error={new Error('load failed')} reset={detailReset} />
      </I18nextProvider>
    );
    expect(screen.getByRole('alert').textContent).toBe(copy.error);
    expect(screen.getByRole('link', { name: copy.back }).getAttribute('href')).toBe(
      '/notifications'
    );
    await user.click(screen.getByRole('button', { name: copy.retry }));
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalledTimes(2));
    expect(detailReset).toHaveBeenCalledTimes(1);
  });

  it('marks unread notifications read after mount only, never inside the loader', async () => {
    const loaded = await detailLoader({ notificationId });

    expect(loaded).toEqual({ ...unavailable, matchContext: null });
    expect(mocks.targetV2).toHaveBeenCalledTimes(1);
    expect(mocks.targetV2).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.markRead).not.toHaveBeenCalled();

    if (!isTarget(loaded)) throw new Error('Loader returned no notification target');
    mountPage(loaded);

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    expect(mocks.markRead).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.targetV2).toHaveBeenCalledTimes(1);
  });

  it('loads authorized match details through v2 target and context resolvers', async () => {
    const context = matchContext('Authorized club');
    mocks.targetV2.mockResolvedValueOnce(availableMatch);
    mocks.matchContext.mockResolvedValueOnce(context);

    await expect(detailLoader({ notificationId })).resolves.toEqual({
      ...availableMatch,
      matchContext: context
    });
    expect(mocks.targetV2).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.matchContext).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.targetV1).not.toHaveBeenCalled();
  });
});
