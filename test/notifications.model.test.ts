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

  it('partitions the sequence-ordered feed without reordering or splitting a transaction', () => {
    const transactionTimestamp = '2026-10-15T10:00:00Z';
    const items = [
      {
        id: 'same-transaction-z',
        kind: 'x',
        category: 'community' as const,
        created_at: transactionTimestamp,
        read_at: null
      },
      {
        id: 'earlier-newer-date',
        kind: 'x',
        category: 'community' as const,
        created_at: '2026-10-14T20:00:00Z',
        read_at: null
      },
      {
        id: 'today-older-date',
        kind: 'x',
        category: 'community' as const,
        created_at: '2026-10-15T09:00:00Z',
        read_at: null
      },
      {
        id: 'same-transaction-a',
        kind: 'x',
        category: 'community' as const,
        created_at: transactionTimestamp,
        read_at: null
      },
      {
        id: 'earlier-older-date',
        kind: 'x',
        category: 'community' as const,
        created_at: '2026-10-13T20:00:00Z',
        read_at: null
      }
    ];

    const grouped = groupNotifications(items, new Date('2026-10-15T12:00:00Z'), 'en');

    expect(grouped.today.map(({ id }) => id)).toEqual([
      'same-transaction-z',
      'today-older-date',
      'same-transaction-a'
    ]);
    expect(grouped.earlier.map(({ id }) => id)).toEqual([
      'earlier-newer-date',
      'earlier-older-date'
    ]);
    const transactionSections = items
      .filter(({ created_at }) => created_at === transactionTimestamp)
      .map(({ id }) =>
        grouped.today.some((item) => item.id === id)
          ? 'today'
          : grouped.earlier.some((item) => item.id === id)
            ? 'earlier'
            : 'missing'
      );
    expect(transactionSections).toEqual(['today', 'today']);
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
