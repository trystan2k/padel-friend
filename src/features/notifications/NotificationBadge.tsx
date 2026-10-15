import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { notificationBadge } from './notification-model';
import { styles } from './notifications.styles';

export function NotificationBadge({ count }: { count: number | null }) {
  const { t } = useTranslation();
  const previous = useRef(count);
  const [announcement, setAnnouncement] = useState('');
  useEffect(() => {
    if (previous.current !== count && count !== null)
      setAnnouncement(
        t(count === 1 ? 'notifications.badge_one' : 'notifications.badge_other', { count })
      );
    previous.current = count;
  }, [count, t]);
  const badge = notificationBadge(count, t);
  return (
    <>
      <Link to="/notifications" aria-label={badge.label} {...stylex.props(styles.badgeLink)}>
        {t('notifications.title')}
        {badge.visual !== null && <span aria-hidden="true">{badge.visual}</span>}
      </Link>
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
    </>
  );
}
