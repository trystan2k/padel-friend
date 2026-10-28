import type { Database } from '../../lib/supabase/database.types';
import type { MatchNotificationContext } from './notification-target';
export type NotificationRow = Database['public']['Tables']['notifications']['Row'];
export type NotificationDto = Pick<
  NotificationRow,
  'id' | 'kind' | 'category' | 'created_at' | 'read_at'
> & { matchContext?: MatchNotificationContext };
export function toNotificationDto(
  row: Pick<NotificationRow, 'id' | 'kind' | 'category' | 'created_at' | 'read_at'>
): NotificationDto {
  return {
    id: row.id,
    kind: row.kind,
    category: row.category,
    created_at: row.created_at,
    read_at: row.read_at
  };
}

export type NotificationCategory = 'all' | 'matches' | 'results' | 'community' | 'rankings';
export type NotificationPage = {
  items: NotificationDto[];
  nextCursor: { sequence: number; createdAt: string; id: string } | null;
  unreadCount: number;
  asOf: string;
};

export function groupNotifications(items: NotificationDto[], now: Date, locale: string) {
  const dayFormatter = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  });
  const today = dayFormatter.format(now);
  const format = new Intl.DateTimeFormat(locale, {
    timeZone: 'UTC',
    dateStyle: 'medium',
    timeStyle: 'short'
  });
  // sequence = authoritative order; sections are partitions, never re-sorted.
  return {
    today: items.filter((item) => dayFormatter.format(new Date(item.created_at)) === today),
    earlier: items.filter((item) => dayFormatter.format(new Date(item.created_at)) !== today),
    format: (value: string) => format.format(new Date(value))
  };
}

export function notificationBadge(
  count: number | null,
  t: (key: string, options?: Record<string, unknown>) => string
) {
  if (count === null) return { visual: null, label: t('notifications.badgeUnknown') };
  return {
    visual: count > 99 ? '99+' : String(count),
    label: t(count === 1 ? 'notifications.badge_one' : 'notifications.badge_other', { count })
  };
}
