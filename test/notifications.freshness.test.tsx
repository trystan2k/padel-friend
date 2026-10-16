/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  NotificationCategory,
  NotificationDto,
  NotificationPage
} from '../src/features/notifications/notification-model';
import { useNotifications } from '../src/features/notifications/use-notifications';

type ListNotifications = (options: {
  data: {
    category: NotificationCategory;
    cursor?: { createdAt: string; id: string };
    limit: number;
  };
}) => Promise<NotificationPage | undefined>;
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

const cutoff = '2026-10-15T12:00:00.000Z';
const unreadId = '00000000-0000-4000-8000-000000000001';
const readId = '00000000-0000-4000-8000-000000000002';

function notification(
  id: string,
  createdAt = cutoff,
  readAt: string | null = null,
  category: NotificationDto['category'] = 'community'
): NotificationDto {
  return {
    id,
    kind: 'community_invitation',
    category,
    created_at: createdAt,
    read_at: readAt
  };
}

function page(
  items: NotificationDto[],
  unreadCount = items.filter((item) => !item.read_at).length
): NotificationPage {
  return { items, nextCursor: null, unreadCount, asOf: cutoff };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function makeVisible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.list.mockResolvedValue(page([]));
  mocks.markAll.mockResolvedValue(0);
  mocks.markOne.mockResolvedValue(cutoff);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('notification freshness', () => {
  it('starts with loader rows and coalesces focus plus visible events into one request', async () => {
    makeVisible();
    const initial = page([notification(unreadId)], 2);
    const { result } = renderHook(() => useNotifications(initial));

    expect(result.current.rows).toEqual(initial.items);
    expect(result.current.unreadCount).toBe(2);
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
    });

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    expect(mocks.list).toHaveBeenCalledWith({ data: { category: 'all', limit: 20 } });
  });

  it('turns a missing notification page into an explicit fetch error', async () => {
    mocks.list.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useNotifications(page([]), 'all', true));

    await waitFor(() => expect(result.current.error).toBe(true));
    expect(result.current.loading).toBe(false);
  });

  it('allows at most one trailing refresh for events during an in-flight request', async () => {
    makeVisible();
    const first = deferred<NotificationPage>();
    mocks.list.mockImplementationOnce(() => first.promise);
    const { result } = renderHook(() => useNotifications(page([])));
    await act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));
    act(() => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('focus'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    first.resolve(page([]));

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    expect(result.current.loading).toBe(false);
  });

  it('does not let an older fetch restore unread state after a read mutation', async () => {
    const stale = deferred<NotificationPage>();
    mocks.list
      .mockImplementationOnce(() => stale.promise)
      .mockResolvedValue(page([notification(unreadId, cutoff, cutoff)], 0));
    const { result } = renderHook(() => useNotifications(page([notification(unreadId)], 1)));
    await act(() => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(1));

    await act(async () => result.current.markRead(unreadId));
    stale.resolve(page([notification(unreadId)], 1));

    await waitFor(() => expect(mocks.list).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(result.current.rows[0]?.read_at).toBe(cutoff));
    expect(result.current.unreadCount).toBe(0);
  });

  it('marks only currently-unread rows optimistically and refreshes authoritative count', async () => {
    mocks.list.mockResolvedValue(
      page([notification(unreadId, cutoff, cutoff), notification(readId, cutoff, cutoff)], 4)
    );
    const initial = page([notification(unreadId), notification(readId, cutoff, cutoff)], 5);
    const { result } = renderHook(() => useNotifications(initial));

    await act(async () => result.current.markRead(readId));
    expect(mocks.markOne).not.toHaveBeenCalled();
    await act(async () => result.current.markRead(unreadId));

    expect(mocks.markOne).toHaveBeenCalledTimes(1);
    expect(mocks.markOne).toHaveBeenCalledWith({ data: { notificationId: unreadId } });
    expect(result.current.unreadCount).toBe(4);
    expect(result.current.rows.find((row) => row.id === unreadId)?.read_at).toBe(cutoff);
  });

  it('rolls back its own failed mark-one patch and retains an explicit error when reconciliation fails', async () => {
    mocks.markOne.mockRejectedValue(new Error('mutation failed'));
    mocks.list.mockRejectedValue(new Error('refresh failed'));
    const { result } = renderHook(() => useNotifications(page([notification(unreadId)], 1)));

    await act(async () => result.current.markRead(unreadId));
    await waitFor(() => expect(result.current.error).toBe(true));

    expect(result.current.rows[0]?.read_at).toBeNull();
    expect(result.current.unreadCount).toBe(1);
    expect(result.current.mutationError).toBe(true);

    mocks.list.mockResolvedValue(page([notification(unreadId)], 1));
    await act(async () => result.current.refresh());
    await waitFor(() => expect(result.current.error).toBe(false));
    expect(result.current.mutationError).toBe(true);
  });

  it('loads the latest category after mark-read finishes and discards its old-category refresh', async () => {
    const mutation = deferred<string>();
    const matchesRow = notification(readId, cutoff, null, 'matches');
    mocks.markOne.mockReturnValue(mutation.promise);
    mocks.list.mockImplementation(async ({ data }) =>
      data.category === 'matches' ? page([matchesRow]) : page([notification(unreadId)])
    );
    const initial = page([notification(unreadId)]);
    const { result, rerender } = renderHook(
      ({ category }: { category: NotificationCategory }) => useNotifications(initial, category),
      { initialProps: { category: 'community' as NotificationCategory } }
    );

    act(() => {
      void result.current.markRead(unreadId);
    });
    await waitFor(() => expect(mocks.markOne).toHaveBeenCalledTimes(1));
    rerender({ category: 'matches' });
    expect(result.current.rows).toEqual([]);

    await act(async () => {
      mutation.resolve(cutoff);
      await mutation.promise;
    });

    await waitFor(() => expect(result.current.rows).toEqual([matchesRow]));
    expect(mocks.list).toHaveBeenCalledWith({ data: { category: 'matches', limit: 20 } });
    expect(result.current.loading).toBe(false);
  });

  it('loads the latest category after mark-all finishes without leaving the feed empty', async () => {
    const mutation = deferred<number>();
    const matchesRow = notification(readId, cutoff, null, 'matches');
    mocks.markAll.mockReturnValue(mutation.promise);
    mocks.list.mockImplementation(async ({ data }) =>
      data.category === 'matches' ? page([matchesRow]) : page([notification(unreadId)])
    );
    const initial = page([notification(unreadId)]);
    const { result, rerender } = renderHook(
      ({ category }: { category: NotificationCategory }) => useNotifications(initial, category),
      { initialProps: { category: 'community' as NotificationCategory } }
    );

    act(() => {
      void result.current.markAll();
    });
    await waitFor(() => expect(mocks.markAll).toHaveBeenCalledTimes(1));
    rerender({ category: 'matches' });
    expect(result.current.rows).toEqual([]);

    await act(async () => {
      mutation.resolve(1);
      await mutation.promise;
    });

    await waitFor(() => expect(result.current.rows).toEqual([matchesRow]));
    expect(mocks.list).toHaveBeenCalledWith({ data: { category: 'matches', limit: 20 } });
    expect(result.current.loading).toBe(false);
  });

  it('shows mark-all failure after a category change without overwriting the new feed', async () => {
    const mutation = deferred<number>();
    const matchesRow = notification(readId, cutoff, null, 'matches');
    mocks.markAll.mockReturnValue(mutation.promise);
    mocks.list.mockImplementation(async ({ data }) =>
      data.category === 'matches' ? page([matchesRow]) : page([notification(unreadId)])
    );
    const initial = page([notification(unreadId)]);
    const { result, rerender } = renderHook(
      ({ category }: { category: NotificationCategory }) => useNotifications(initial, category),
      { initialProps: { category: 'community' as NotificationCategory } }
    );

    act(() => {
      void result.current.markAll();
    });
    await waitFor(() => expect(mocks.markAll).toHaveBeenCalledTimes(1));
    rerender({ category: 'matches' });

    await act(async () => {
      mutation.reject(new Error('mark-all failed'));
      await mutation.promise.catch(() => undefined);
    });

    await waitFor(() => expect(result.current.rows).toEqual([matchesRow]));
    expect(result.current.mutationError).toBe(true);
    expect(result.current.loading).toBe(false);
  });

  it('uses the last successful cutoff for mark-all and keeps newer notifications unread', async () => {
    const newer = '2026-10-15T12:00:01.000Z';
    const initial = page([notification(unreadId), notification(readId, newer)], 6);
    mocks.list.mockResolvedValue(
      page([notification(unreadId, cutoff, cutoff), notification(readId, newer)], 5)
    );
    const { result } = renderHook(() => useNotifications(initial));

    await act(async () => result.current.markAll());

    expect(mocks.markAll).toHaveBeenCalledWith({ data: { before: cutoff } });
    expect(result.current.unreadCount).toBe(5);
    expect(result.current.rows.find((row) => row.id === readId)?.read_at).toBeNull();
  });

  it('blocks mutations offline and removes lifecycle listeners on unmount', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result, unmount } = renderHook(() =>
      useNotifications(page([notification(unreadId)], 1))
    );
    await waitFor(() => expect(result.current.online).toBe(false));

    await act(async () => result.current.markRead(unreadId));
    expect(mocks.markOne).not.toHaveBeenCalled();
    unmount();
    await act(() => window.dispatchEvent(new Event('focus')));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.list).not.toHaveBeenCalled();
  });
});
