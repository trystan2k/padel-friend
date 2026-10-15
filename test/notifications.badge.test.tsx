/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { NotificationBadge } from '../src/features/notifications/NotificationBadge';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, options?: { count?: number }) =>
      options?.count === undefined ? key : `${key}:${options.count}`
  })
}));
vi.mock('@tanstack/react-router', async () => {
  const { createElement } = await import('react');
  return {
    Link: ({ to, children, ...props }: { to: string; children: React.ReactNode }) =>
      createElement('a', { ...props, href: to }, children)
  };
});

describe('notification badge', () => {
  it('caps the visible count while keeping the full accessible count', async () => {
    const { rerender } = render(<NotificationBadge count={125} />);

    expect(screen.getByRole('link', { name: 'notifications.badge_other:125' })).toBeTruthy();
    expect(screen.getByText('99+')).toBeTruthy();
    rerender(<NotificationBadge count={126} />);
    await waitFor(() =>
      expect(
        screen.getByText('notifications.badge_other:126', { selector: '[aria-live="polite"]' })
      ).toBeTruthy()
    );
  });

  it('keeps the link available without showing a misleading zero when count is unknown', () => {
    render(<NotificationBadge count={null} />);

    expect(screen.getByRole('link', { name: 'notifications.badgeUnknown' })).toBeTruthy();
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByText('notifications.title')).toBeTruthy();
  });
});

afterEach(cleanup);
