/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NotificationCategory,
  NotificationPage
} from '../src/features/notifications/notification-model';
import type { ResultNotificationContext } from '../src/features/notifications/notification-target';
import en from '../src/locales/en/translation.json';
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
  markOne: vi.fn<MarkOne>(),
  useEnglishResource: false
}));

vi.mock('../src/features/notifications/notifications.functions', () => ({
  listMyNotifications: mocks.list,
  markAllNotificationsRead: mocks.markAll,
  markNotificationRead: mocks.markOne
}));
vi.mock('react-i18next', async () => {
  const { default: resource } = await import('../src/locales/en/translation.json');
  return {
    useTranslation: () => ({
      t: (key: string, options?: { count?: number }) => {
        if (mocks.useEnglishResource) {
          if (key === 'notifications.today') return resource.notifications.today;
          if (key === 'notifications.earlier') return resource.notifications.earlier;
          if (key === 'notifications.mutationError') return resource.notifications.mutationError;
          if (key === 'notifications.kinds.match_registration_expired')
            return resource.notifications.kinds.match_registration_expired;
          if (key === 'notifications.kinds.match_registration_not_playing')
            return resource.notifications.kinds.match_registration_not_playing;
          if (key === 'notifications.unread_one' || key === 'notifications.unread_other') {
            const template =
              key === 'notifications.unread_one'
                ? resource.notifications.unread_one
                : resource.notifications.unread_other;
            return template.replace('{{count}}', String(options?.count ?? 0));
          }
        }
        return options?.count === undefined ? key : `${key}:${options.count}`;
      },
      i18n: { language: 'en' }
    })
  };
});
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
const resultContext: ResultNotificationContext = {
  notification_id: '00000000-0000-4000-8000-000000000002',
  notification_kind: 'result_added',
  match_event_id: '00000000-0000-4000-8000-000000000003',
  community_id: '00000000-0000-4000-8000-000000000004',
  proposal_id: '00000000-0000-4000-8000-000000000005',
  proposal_version: 1,
  group_number: 2,
  proposal_status: 'pending',
  current_version: 1,
  current_status: 'pending',
  is_current: true,
  classification: 'team_a',
  score: '6–4',
  submitted_by_name: 'Ari',
  review_deadline_at: '2026-10-17T12:00:00.000Z',
  venue: 'Central Court',
  starts_at: '2026-10-15T12:00:00.000Z',
  timezone: 'UTC',
  entry_ready: false
};
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
const seededNotification = initial.items[0];
if (!seededNotification) throw new Error('Fixture must seed one notification');

describe('notification center', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.useEnglishResource = false;
    mocks.list.mockResolvedValue(initial);
    mocks.markAll.mockResolvedValue(0);
    mocks.markOne.mockResolvedValue(asOf);
  });

  it('renders the initial feed, unread count, categories and safe detail link', async () => {
    render(<NotificationsPage initial={initial} />);

    expect(screen.getByRole('heading', { name: 'notifications.title' })).toBeTruthy();
    expect(screen.getByText('notifications.unread_other:3')).toBeTruthy();
    expect(screen.getByRole('navigation', { name: 'notifications.filters.label' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'notifications.view' }).getAttribute('href')).toBe(
      `/notifications/${invitationId}`
    );
    expect(screen.getByRole('button', { name: 'notifications.markRead' })).toBeTruthy();
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith({ data: { category: 'all', limit: 20 } })
    );
  });

  it('links result alerts to their event and preserves the validated group/version locator', () => {
    const alert: NotificationPage = {
      ...initial,
      items: [
        {
          id: resultContext.notification_id,
          kind: resultContext.notification_kind,
          category: 'results',
          created_at: asOf,
          read_at: null,
          resultContext
        }
      ]
    };
    render(<NotificationsPage initial={alert} />);

    const link = screen.getByRole('link', { name: 'notifications.result.openResult' });
    const url = new URL(link.getAttribute('href') ?? '', 'https://example.test');
    expect(url.pathname).toBe(`/matches/${resultContext.match_event_id}`);
    expect(url.searchParams.get('result_proposal')).toBe(resultContext.proposal_id);
    expect(url.searchParams.get('result_version')).toBe('1');
    expect(url.hash).toBe('#result-group-2');
    expect(
      screen.getByText(
        (_content, element) => element?.textContent === 'notifications.result.group · 6–4'
      )
    ).toBeTruthy();
    expect(screen.getByText('notifications.result.submittedBy')).toBeTruthy();
  });

  it('keeps a superseded result alert historical and links to review the current group', () => {
    const historicalContext: ResultNotificationContext = {
      ...resultContext,
      proposal_version: 1,
      proposal_status: 'superseded',
      current_version: 2,
      current_status: 'pending',
      is_current: false
    };
    const alert: NotificationPage = {
      ...initial,
      items: [
        {
          id: historicalContext.notification_id,
          kind: historicalContext.notification_kind,
          category: 'results',
          created_at: asOf,
          read_at: null,
          resultContext: historicalContext
        }
      ]
    };
    render(<NotificationsPage initial={alert} />);

    const link = screen.getByRole('link', { name: 'notifications.result.reviewCurrent' });
    expect(link.getAttribute('href')).toContain('result_version=1');
    expect(link.getAttribute('href')).toContain('#result-group-2');
    expect(screen.getByText('notifications.result.historicalVersion')).toBeTruthy();
  });

  it('renders the cutoff kinds with their own translated titles and the split reserve count', () => {
    mocks.useEnglishResource = true;
    const cutoffPage: NotificationPage = {
      ...initial,
      items: [
        {
          id: '00000000-0000-4000-8000-000000000003',
          kind: 'match_registration_expired',
          category: 'matches',
          created_at: asOf,
          read_at: null,
          matchContext: {
            match_event_id: '00000000-0000-4000-8000-000000000005',
            creator_display_name: 'Alex',
            scheduled_at: '2026-10-20T10:00:00.000Z',
            timezone: 'UTC',
            venue: 'Cutoff court',
            event_type: 'friendly',
            playing_count: 4,
            reserve_count: 0,
            reserve_not_playing_count: 1,
            price_minor: null,
            currency: null
          }
        },
        {
          id: '00000000-0000-4000-8000-000000000004',
          kind: 'match_registration_not_playing',
          category: 'matches',
          created_at: asOf,
          read_at: null
        }
      ]
    };
    render(<NotificationsPage initial={cutoffPage} />);

    // Each cutoff kind renders its own title, never the invitation heading.
    expect(
      screen.getByRole('heading', { name: en.notifications.kinds.match_registration_expired })
    ).toBeTruthy();
    expect(
      screen.getByRole('heading', { name: en.notifications.kinds.match_registration_not_playing })
    ).toBeTruthy();
    // The context counts keep not-playing out of the ordinary reserve figure.
    expect(screen.getByText('notifications.match.playing_other:4')).toBeTruthy();
    expect(screen.getByText('notifications.match.reserve_other:0')).toBeTruthy();
    expect(screen.queryByText('notifications.match.reserve_other:1')).toBeNull();
  });

  it('shows earlier-only notifications without an empty Today section and keeps the unread summary', () => {
    mocks.useEnglishResource = true;
    const earlierPage: NotificationPage = {
      ...initial,
      items: [{ ...seededNotification, created_at: '2026-10-14T23:00:00.000Z' }]
    };
    mocks.list.mockResolvedValue(earlierPage);
    const { container } = render(<NotificationsPage initial={earlierPage} />);

    expect(screen.queryByRole('heading', { name: en.notifications.today })).toBeNull();
    const earlierHeading = screen.getByRole('heading', { name: en.notifications.earlier });
    const earlierHeader = earlierHeading.closest('header');
    const unreadSummary = en.notifications.unread_other.replace('{{count}}', '3');
    expect(earlierHeader?.textContent).toContain(unreadSummary);
    expect(screen.getAllByText(unreadSummary)).toHaveLength(1);
    expect(earlierHeader?.nextElementSibling?.tagName).toBe('UL');
    expect(container.querySelectorAll('header').length).toBeGreaterThan(0);
    expect(screen.getByRole('link', { name: 'notifications.view' })).toBeTruthy();
  });

  it('renders Today and Earlier sections with the unread summary in the Today header', () => {
    mocks.useEnglishResource = true;
    const mixedPage: NotificationPage = {
      ...initial,
      items: [
        seededNotification,
        {
          ...seededNotification,
          id: '00000000-0000-4000-8000-000000000002',
          created_at: '2026-10-14T23:00:00.000Z'
        }
      ]
    };
    mocks.list.mockResolvedValue(mixedPage);
    const { container } = render(<NotificationsPage initial={mixedPage} />);

    const todayHeading = screen.getByRole('heading', { name: en.notifications.today });
    const todayHeader = todayHeading.closest('header');
    const earlierHeading = screen.getByRole('heading', { name: en.notifications.earlier });
    const unreadSummary = en.notifications.unread_other.replace('{{count}}', '3');
    expect(todayHeader?.textContent).toContain(unreadSummary);
    expect(screen.getAllByText(unreadSummary)).toHaveLength(1);
    expect(todayHeader?.nextElementSibling?.tagName).toBe('UL');
    expect(earlierHeading.closest('header')?.nextElementSibling?.tagName).toBe('UL');
    expect(container.querySelectorAll('ul')).toHaveLength(2);
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
    expect(screen.queryByRole('heading', { name: 'notifications.today' })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'notifications.earlier' })).toBeNull();
  });

  it('keeps a read notification read after switching filters and returning to All', async () => {
    const readPage: NotificationPage = {
      ...initial,
      items: [{ ...seededNotification, read_at: asOf }],
      unreadCount: 2
    };
    let allRequests = 0;
    mocks.list.mockImplementation(async ({ data }) => {
      if (data.category === 'matches') return { ...initial, items: [], unreadCount: 2 };
      allRequests += 1;
      return allRequests === 1 ? initial : readPage;
    });
    render(<NotificationsPage initial={initial} />);

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    fireEvent.click(screen.getByRole('button', { name: 'notifications.markRead' }));
    await waitFor(() =>
      expect(mocks.markOne).toHaveBeenCalledWith({ data: { notificationId: invitationId } })
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'notifications.markRead' })).toBeNull()
    );
    expect(screen.getAllByText('notifications.unread_other:2').length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: 'notifications.filters.matches' }));
    await waitFor(() =>
      expect(mocks.list).toHaveBeenCalledWith({ data: { category: 'matches', limit: 20 } })
    );
    fireEvent.click(screen.getByRole('button', { name: 'notifications.filters.all' }));

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(4));
    expect((await screen.findAllByText('notifications.unread_other:2')).length).toBeGreaterThan(0);
    expect(screen.queryByRole('button', { name: 'notifications.markRead' })).toBeNull();
  });

  it('places mark-all in the page header before category filters', () => {
    const { container } = render(<NotificationsPage initial={initial} />);
    const header = container.querySelector('section > header');
    const markAll = screen.getByRole('button', { name: 'notifications.markAllRead' });
    const filters = screen.getByRole('navigation', { name: 'notifications.filters.label' });

    expect(header?.contains(markAll)).toBe(true);
    const headerPosition = header?.compareDocumentPosition(filters) ?? 0;
    expect(headerPosition & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('renders the English locale resource when a read mutation fails', async () => {
    mocks.useEnglishResource = true;
    mocks.markOne.mockRejectedValue(new Error('mark-read failed'));
    render(<NotificationsPage initial={initial} />);

    fireEvent.click(await screen.findByRole('button', { name: 'notifications.markRead' }));

    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe(en.notifications.mutationError);
    expect(alert.textContent).toMatch(/again|retry/i);
  });
});

afterEach(cleanup);
