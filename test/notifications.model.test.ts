import { describe, expect, it, vi } from 'vitest';
import {
  groupNotifications,
  notificationBadge
} from '../src/features/notifications/notification-model';

describe('notification display model', () => {
  it('groups dates in UTC and formats with the requested locale', () => {
    const grouped = groupNotifications(
      [
        {
          id: '1',
          kind: 'x',
          category: 'community',
          created_at: '2026-10-15T02:00:00Z',
          read_at: null
        },
        {
          id: '2',
          kind: 'x',
          category: 'community',
          created_at: '2026-10-14T23:00:00Z',
          read_at: null
        }
      ],
      new Date('2026-10-15T10:00:00Z'),
      'en'
    );
    expect(grouped.today).toHaveLength(1);
    expect(grouped.earlier).toHaveLength(1);
    expect(grouped.format('2026-10-15T02:00:00Z')).toContain('Oct');
  });

  it('constructs one UTC day formatter per grouping call regardless of item count', () => {
    const dateTimeFormat = vi.spyOn(Intl, 'DateTimeFormat');
    const items = Array.from({ length: 25 }, (_, index) => ({
      id: String(index),
      kind: 'x',
      category: 'community' as const,
      created_at: '2026-10-15T02:00:00Z',
      read_at: null
    }));

    try {
      groupNotifications(items, new Date('2026-10-15T10:00:00Z'), 'en');

      const dayFormatterCalls = dateTimeFormat.mock.calls.filter(
        ([, options]) =>
          options?.year === 'numeric' &&
          options.month === '2-digit' &&
          options.day === '2-digit' &&
          options.timeZone === 'UTC'
      );
      expect(dayFormatterCalls).toHaveLength(1);
    } finally {
      dateTimeFormat.mockRestore();
    }
  });

  it('caps only visual badge and preserves full count in label', () => {
    expect(notificationBadge(125, (key) => key)).toEqual({
      visual: '99+',
      label: 'notifications.badge_other'
    });
    expect(notificationBadge(null, (key) => key).visual).toBeNull();
  });
});
