/** @vitest-environment jsdom */
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NotificationBadge } from '../src/features/notifications/NotificationBadge';

type GetCount = () => Promise<number>;

const mocks = vi.hoisted(() => ({ count: vi.fn<GetCount>() }));

vi.mock('../src/features/notifications/notifications.functions', () => ({
  getMyUnreadNotificationCount: mocks.count
}));
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) => {
      if (key === 'notifications.title' || key === 'notifications.badgeUnknown')
        return 'Notifications';
      if (key === 'notifications.badge_one')
        return `Notifications · ${options?.count} unread notification`;
      if (key === 'notifications.badge_other')
        return `Notifications · ${options?.count} unread notifications`;
      return key;
    }
  })
}));
vi.mock('@tanstack/react-router', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
      createElement('a', { ...props, href: to }, children)
  };
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function makeVisible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.count.mockResolvedValue(8);
});

afterEach(() => {
  cleanup();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
});

describe('notification badge', () => {
  it('caps the visible count while keeping the full count in the accessible name', async () => {
    const { rerender } = render(<NotificationBadge count={125} />);

    expect(
      screen.getByRole('link', { name: 'Notifications · 125 unread notifications' })
    ).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
    rerender(<NotificationBadge count={126} />);
    await waitFor(() =>
      expect(
        screen.getByText('Notifications · 126 unread notifications', {
          selector: '[aria-live="polite"]'
        })
      ).toBeTruthy()
    );
  });

  it('keeps the visible link and omits a misleading zero when the count is unknown', () => {
    render(<NotificationBadge count={null} />);

    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('Notifications')).toBeTruthy();
  });

  it('keeps the count unknown when a refresh fails', async () => {
    mocks.count.mockRejectedValueOnce(new Error('count unavailable'));
    render(<NotificationBadge count={null} />);

    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(1));

    expect(screen.getByRole('link', { name: 'Notifications' })).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
  });

  it('refreshes the count when the browser returns online', async () => {
    mocks.count.mockResolvedValueOnce(9);
    render(<NotificationBadge count={8} />);

    await act(async () => window.dispatchEvent(new Event('online')));

    await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Notifications · 9 unread notifications' })
      ).toBeTruthy()
    );
  });

  it('ignores visibility changes while the document is hidden', async () => {
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    render(<NotificationBadge count={8} />);

    await act(async () => document.dispatchEvent(new Event('visibilitychange')));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.count).not.toHaveBeenCalled();
  });

  it('coalesces event bursts to one in-flight refresh plus one trailing refresh', async () => {
    makeVisible();
    const first = deferred<number>();
    const trailing = deferred<number>();
    mocks.count
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => trailing.promise);
    render(<NotificationBadge count={1} />);

    await act(async () => window.dispatchEvent(new Event('focus')));
    await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(1));
    await act(async () => {
      window.dispatchEvent(new Event('focus'));
      document.dispatchEvent(new Event('visibilitychange'));
      window.dispatchEvent(new Event('online'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(mocks.count).toHaveBeenCalledTimes(1);

    await act(async () => first.resolve(2));
    await waitFor(() => expect(mocks.count).toHaveBeenCalledTimes(2));
    await act(async () => trailing.resolve(3));
    await waitFor(() =>
      expect(
        screen.getByRole('link', { name: 'Notifications · 3 unread notifications' })
      ).toBeTruthy()
    );
  });

  it('cleans up event listeners and pending timers on unmount', async () => {
    const { unmount } = render(<NotificationBadge count={1} />);
    unmount();

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(mocks.count).not.toHaveBeenCalled();
  });
});
