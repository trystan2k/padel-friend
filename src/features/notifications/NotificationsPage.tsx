import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import type { NotificationCategory, NotificationPage } from './notification-model';
import { groupNotifications } from './notification-model';
import { styles } from './notifications.styles';
import { useNotifications } from './use-notifications';

const categories: NotificationCategory[] = ['all', 'matches', 'results', 'community', 'rankings'];

export function NotificationsPage({ initial }: { initial: NotificationPage }) {
  const { t, i18n } = useTranslation();
  const [category, setCategory] = useState<NotificationCategory>('all');
  const feed = useNotifications(initial, category, true);
  const previousCount = useRef(feed.unreadCount);
  const [countAnnouncement, setCountAnnouncement] = useState('');

  useEffect(() => {
    if (feed.unreadCount !== null && previousCount.current !== feed.unreadCount) {
      setCountAnnouncement(
        t(feed.unreadCount === 1 ? 'notifications.unread_one' : 'notifications.unread_other', {
          count: feed.unreadCount
        })
      );
      previousCount.current = feed.unreadCount;
    }
  }, [feed.unreadCount, t]);

  const grouped = groupNotifications(feed.rows, new Date(feed.asOf), i18n.language);
  const list = (rows: typeof feed.rows) => (
    <ul {...stylex.props(styles.list)}>
      {rows.map((row) => (
        <li key={row.id} {...stylex.props(styles.row, !row.read_at && styles.unread)}>
          <h3 {...stylex.props(styles.cardTitle)}>
            {t(`notifications.kinds.${row.kind}`, { defaultValue: t('notifications.generic') })}
          </h3>
          <p
            {...stylex.props(styles.cardMeta)}
            aria-label={`${grouped.format(row.created_at)} ${t('notifications.dateUtc')}`}
          >
            {grouped.format(row.created_at)} {t('notifications.utc')}
          </p>
          <div {...stylex.props(styles.actions)}>
            <Link
              to="/notifications/$notificationId"
              params={{ notificationId: row.id }}
              {...stylex.props(styles.link)}
            >
              {t('notifications.view')}
            </Link>
            {!row.read_at && (
              <button
                type="button"
                disabled={!feed.online || feed.mutating}
                onClick={() => void feed.markRead(row.id)}
                {...stylex.props(styles.button)}
              >
                {t('notifications.markRead')}
              </button>
            )}
          </div>
        </li>
      ))}
    </ul>
  );

  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)}>
        <header {...stylex.props(styles.pageHeader)}>
          <div>
            <h1 {...stylex.props(styles.pageTitle)}>{t('notifications.title')}</h1>
            <p {...stylex.props(styles.subtitle)}>{t('notifications.subtitle')}</p>
          </div>
          <div {...stylex.props(styles.headerActions)}>
            <button
              type="button"
              disabled={!feed.online || feed.mutating || !feed.unreadCount}
              onClick={() => void feed.markAll()}
              {...stylex.props(styles.button)}
            >
              {t('notifications.markAllRead')}
            </button>
            <Link to="/notifications/preferences" {...stylex.props(styles.link)}>
              {t('notificationPreferences.preferencesLink')}
            </Link>
          </div>
        </header>
        <output aria-live="polite" aria-atomic="true" {...stylex.props(styles.visuallyHidden)}>
          {countAnnouncement}
        </output>
        <nav aria-label={t('notifications.filters.label')} {...stylex.props(styles.filters)}>
          {categories.map((key) => (
            <button
              key={key}
              type="button"
              aria-current={category === key ? 'page' : undefined}
              onClick={() => setCategory(key)}
              {...stylex.props(styles.filterButton, category === key && styles.selectedFilter)}
            >
              {t(`notifications.filters.${key}`)}
            </button>
          ))}
        </nav>
        {!feed.online && <output>{t('notifications.offline')}</output>}
        {feed.mutationError && <p role="alert">{t('notifications.mutationError')}</p>}
        {feed.error && (
          <p role="alert">
            {t('notifications.stale')}{' '}
            <button type="button" onClick={() => void feed.refresh()}>
              {t('notifications.retry')}
            </button>
          </p>
        )}
        {feed.loading && !feed.rows.length && <p>{t('notifications.loading')}</p>}
        {feed.error && !feed.rows.length ? (
          <button type="button" onClick={() => void feed.refresh()}>
            {t('notifications.retry')}
          </button>
        ) : feed.rows.length ? (
          <>
            <header {...stylex.props(styles.sectionHeader)}>
              <h2 {...stylex.props(styles.sectionTitle)}>{t('notifications.today')}</h2>
              <span {...stylex.props(styles.unreadSummary)}>
                {t(
                  feed.unreadCount === 1
                    ? 'notifications.unread_one'
                    : 'notifications.unread_other',
                  { count: feed.unreadCount ?? 0 }
                )}
              </span>
            </header>
            {list(grouped.today)}
            {grouped.earlier.length > 0 && (
              <>
                <h2 {...stylex.props(styles.sectionTitle)}>{t('notifications.earlier')}</h2>
                {list(grouped.earlier)}
              </>
            )}
            {feed.cursor && (
              <button
                type="button"
                disabled={!feed.online || feed.loading}
                onClick={() => void feed.loadMore()}
                {...stylex.props(styles.button)}
              >
                {t('notifications.loadMore')}
              </button>
            )}
          </>
        ) : (
          !feed.loading && <p>{t(`notifications.empty.${category}`)}</p>
        )}
      </section>
    </main>
  );
}
