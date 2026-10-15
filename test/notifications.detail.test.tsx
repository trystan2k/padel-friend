/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nextProvider } from 'react-i18next';

const mocks = vi.hoisted(() => ({
  target: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  markRead: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>(),
  accept: vi.fn<(input: { data: { notificationId: string } }) => Promise<unknown>>()
}));

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
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
  getMyNotificationTarget: mocks.target,
  markNotificationRead: mocks.markRead,
  acceptMyNotificationInvitation: mocks.accept
}));

import { createI18n } from '../src/i18n/config';
import en from '../src/locales/en/translation.json';
import type { NotificationTarget } from '../src/features/notifications/notification-target';
import { NotificationDetailPage } from '../src/features/notifications/NotificationDetailPage';
import { Route as NotificationDetailRoute } from '../src/routes/_protected.notifications.$notificationId';

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

function hasLoader(
  route: unknown
): route is {
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

function isTarget(value: unknown): value is NotificationTarget {
  return typeof value === 'object' && value !== null && 'target_status' in value;
}

function mountPage(target: NotificationTarget) {
  return render(
    <I18nextProvider i18n={createI18n('en')}>
      <NotificationDetailPage notificationId={notificationId} target={target} />
    </I18nextProvider>
  );
}

beforeEach(() => {
  mocks.target.mockReset();
  mocks.markRead.mockReset();
  mocks.accept.mockReset();
  mocks.target.mockResolvedValue(unavailable);
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
    const user = userEvent.setup();
    mountPage(invited);

    expect(await screen.findByRole('heading', { name: communityName })).toBeTruthy();
    expect(screen.getByText(copy.invitationContext)).toBeTruthy();
    const acceptButton = screen.getByRole('button', { name: copy.accept });
    await user.click(acceptButton);
    expect(mocks.accept).toHaveBeenCalledWith({ data: { notificationId } });
    expect(await screen.findByRole('button', { name: copy.accepting })).toBeTruthy();
    resolveAccept({ community_id: communityId, status: 'active' });
    expect(await screen.findByRole('button', { name: copy.accepted })).toBeTruthy();
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

  it('offers a retry affordance on error and re-invokes the target fetch', async () => {
    // The page itself never fetches on mount; the first target call is the retry.
    mocks.target.mockResolvedValueOnce(membership('active'));
    mocks.markRead.mockRejectedValueOnce(new Error('read marking failed'));
    const user = userEvent.setup();
    mountPage(invited);

    expect(await screen.findByRole('heading', { name: communityName })).toBeTruthy();
    expect((await screen.findByRole('alert')).textContent).toBe(copy.targetError);
    expect(mocks.target).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: copy.retry }));

    await waitFor(() => expect(mocks.target).toHaveBeenCalledTimes(1));
    expect(mocks.target).toHaveBeenCalledWith({ data: { notificationId } });
    expect(await screen.findByText(copy.activeMembership)).toBeTruthy();
    expect(screen.queryByRole('alert')).toBeNull();
    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
  });

  it('marks unread notifications read after mount only, never inside the loader', async () => {
    const loaded = await detailLoader({ notificationId });

    expect(loaded).toEqual(unavailable);
    expect(mocks.target).toHaveBeenCalledTimes(1);
    expect(mocks.target).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.markRead).not.toHaveBeenCalled();

    if (!isTarget(loaded)) throw new Error('Loader returned no notification target');
    mountPage(loaded);

    await waitFor(() => expect(mocks.markRead).toHaveBeenCalledTimes(1));
    expect(mocks.markRead).toHaveBeenCalledWith({ data: { notificationId } });
    expect(mocks.target).toHaveBeenCalledTimes(1);
  });
});
