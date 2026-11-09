import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { useAuthoritativeRefresh } from '../../lib/use-authoritative-refresh';
import { notificationBadge } from './notification-model';
import { getMyUnreadNotificationCount } from './notifications.functions';
import { styles } from './notifications.styles';

export function NotificationBadge({ count }: { count: number | null }) {
  const { t } = useTranslation();
  const previous = useRef(count);
  const [announcement, setAnnouncement] = useState('');
  const [refreshResult, setRefreshResult] = useState<{
    initialCount: number | null;
    count: number | null;
  } | null>(null);
  const liveCount = refreshResult?.initialCount === count ? refreshResult.count : count;
  const updateCount = useEffectEvent((next: number) => {
    setRefreshResult({ initialCount: count, count: next });
  });

  // Account-wide unread count: re-read on the shared authoritative cadence. A failed read keeps
  // the last known count (unknown stays unknown); an expired session clears it instead of retrying.
  useAuthoritativeRefresh({
    scope: 'notification-badge',
    refresh: async ({ isCurrent }) => {
      const next = await getMyUnreadNotificationCount();
      if (isCurrent()) updateCount(next);
    },
    onFatal: () => setRefreshResult({ initialCount: count, count: null })
  });

  useEffect(() => {
    if (previous.current !== liveCount && liveCount !== null) {
      setAnnouncement(
        t(liveCount === 1 ? 'notifications.badge_one' : 'notifications.badge_other', {
          count: liveCount
        })
      );
    }
    previous.current = liveCount;
  }, [liveCount, t]);

  const badge = notificationBadge(liveCount, t);
  return (
    <>
      <Link to="/notifications" aria-label={badge.label} {...stylex.props(styles.badgeLink)}>
        {t('notifications.title')}
        {badge.visual !== null && (
          <StatusBadge appearance="count" aria-hidden="true">
            {badge.visual}
          </StatusBadge>
        )}
      </Link>
      <span {...stylex.props(styles.visuallyHidden)} aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
