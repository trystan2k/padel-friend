import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useEffect, useEffectEvent, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationBadge } from './notification-model';
import { getMyUnreadNotificationCount } from './notifications.functions';
import { styles } from './notifications.styles';

export function NotificationBadge({ count }: { count: number | null }) {
  const { t } = useTranslation();
  const previous = useRef(count);
  const [announcement, setAnnouncement] = useState('');
  const [refreshResult, setRefreshResult] = useState<{
    initialCount: number | null;
    count: number;
  } | null>(null);
  const liveCount = refreshResult?.initialCount === count ? refreshResult.count : count;
  const updateCount = useEffectEvent((next: number) => {
    setRefreshResult({ initialCount: count, count: next });
  });

  useEffect(() => {
    let mounted = true;
    let pending = false;
    let trailing = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const refresh = async () => {
      if (pending) {
        trailing = true;
        return;
      }
      pending = true;
      try {
        const next = await getMyUnreadNotificationCount();
        if (mounted) updateCount(next);
      } catch {
        // Keep unknown counts unknown; notification failures never affect the dashboard profile.
      } finally {
        pending = false;
        if (trailing && mounted) {
          trailing = false;
          void refresh();
        }
      }
    };

    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = undefined;
        void refresh();
      }, 30);
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') schedule();
    };

    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      mounted = false;
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, []);

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
        {badge.visual !== null && <span aria-hidden="true">{badge.visual}</span>}
      </Link>
      <span {...stylex.props(styles.visuallyHidden)} aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
