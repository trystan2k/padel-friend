/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  NotificationCategory,
  NotificationPage
} from '../src/features/notifications/notification-model';
import { NotificationsPage } from '../src/features/notifications/NotificationsPage';

type ListNotifications = (options: {
  data: {
    category: NotificationCategory;
    cursor?: { createdAt: string; id: string };
    limit: number;
  };
}) => Promise<NotificationPage>;
type MarkAll = (options: { data: { before: string } }) => Promise<number>;
type MarkOne = (options: { data: { notificationId: string } }) => Promise<string>;

const mocks = vi.hoisted(() => ({
  list: vi.fn<ListNotifications>(),
  markAll: vi.fn<MarkAll>(),
  markOne: vi.fn<MarkOne>()
}));

vi.mock('../src/features/notifications/notifications.functions', () => ({
  listMyNotifications: mocks.list,
  markAllNotificationsRead: mocks.markAll,
  markNotificationRead: mocks.markOne
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`,
    i18n: { language: 'en' }
  })
}));
vi.mock('@tanstack/react-router', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({
      to,
      params,
      children,
      ...props
    }: {
      to: string;
      params?: Record<string, string>;
      children: React.ReactNode;
    }) =>
      createElement(
        'a',
        {
          ...props,
          href: params ? to.replace('$notificationId', params.notificationId ?? '') : to
        },
        children
      )
  };
});

const asOf = '2026-10-15T12:00:00.000Z';
const invitationId = '00000000-0000-4000-8000-000000000001';
const initial: NotificationPage = {
  items: [
    {
      id: invitationId,
      kind: 'community_invitation',
      category: 'community',
      created_at: asOf,
      read_at: null
    }
  ],
  nextCursor: null,
  unreadCount: 3,
  asOf
};

describe('notification center', () => {
  it('renders the initial feed, unread count, categories and safe detail link', () => {
    render(<NotificationsPage initial={initial} />);

    expect(screen.getByRole('heading', { name: 'notifications.title' })).toBeTruthy();
    expect(screen.getByText('notifications.unread_other:3')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'notifications.filters.label' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'notifications.view' }).getAttribute('href')).toBe(
      `/notifications/${invitationId}`
    );
    expect(screen.getByRole('button', { name: 'notifications.markRead' })).toBeTruthy();
    expect(mocks.list).not.toHaveBeenCalled();
  });

  it('loads selected category and renders the translated empty state when no rows match', async () => {
    mocks.list.mockResolvedValue({ ...initial, items: [], unreadCount: 3 });
    render(<NotificationsPage initial={initial} />);

    fireEvent.click(screen.getByRole('button', { name: 'notifications.filters.matches' }));

    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith({
        data: { category: 'matches', limit: 20 }
      })
    );
    expect(await screen.findByText('notifications.empty.matches')).toBeTruthy();
    expect(screen.queryByRole('link', { name: 'notifications.view' })).toBeNull();
  });
});

afterEach(cleanup);
