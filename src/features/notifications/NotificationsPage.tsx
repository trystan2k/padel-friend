import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { NotificationCategory, NotificationPage } from './notification-model';
import { groupNotifications } from './notification-model';
import { styles } from './notifications.styles';
import { useNotifications } from './use-notifications';

const categories: NotificationCategory[] = ['all', 'matches', 'results', 'community', 'rankings'];

export function NotificationsPage({ initial }: { initial: NotificationPage }) {
  const { t } = useTranslation();
  const [category, setCategory] = useState<NotificationCategory>('all');
  const filteredInitial =
    category === 'all' ? initial : { ...initial, items: [], nextCursor: null };

  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)}>
        <header>
          <div>
            <h1>{t('notifications.title')}</h1>
            <p>{t('notifications.subtitle')}</p>
          </div>
        </header>
        <nav aria-label={t('notifications.filters.label')} {...stylex.props(styles.filters)}>
          {categories.map((key) => (
            <button
              key={key}
              type="button"
              aria-current={category === key ? 'page' : undefined}
              onClick={() => setCategory(key)}
              {...stylex.props(styles.button)}
            >
              {t(`notifications.filters.${key}`)}
            </button>
          ))}
        </nav>
        <NotificationFeed
          key={category}
          category={category}
          initial={filteredInitial}
          loadOnMount={category !== 'all'}
        />
      </section>
    </main>
  );
}

function NotificationFeed({
  category,
  initial,
  loadOnMount
}: {
  category: NotificationCategory;
  initial: NotificationPage;
  loadOnMount: boolean;
}) {
  const { t, i18n } = useTranslation();
  const feed = useNotifications(initial, category, loadOnMount);
  const grouped = groupNotifications(feed.rows, new Date(feed.asOf), i18n.language);
  const list = (rows: typeof feed.rows) => (
    <ul>
      {rows.map((row) => (
        <li key={row.id} {...stylex.props(styles.row, !row.read_at && styles.unread)}>
          <h3>
            {t(`notifications.kinds.${row.kind}`, { defaultValue: t('notifications.generic') })}
          </h3>
          <p aria-label={`${grouped.format(row.created_at)} ${t('notifications.dateUtc')}`}>
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
    <>
      <header>
        <p>
          {t(feed.unreadCount === 1 ? 'notifications.unread_one' : 'notifications.unread_other', {
            count: feed.unreadCount
          })}
        </p>
        <button
          type="button"
          disabled={!feed.online || feed.mutating || !feed.unreadCount}
          onClick={() => void feed.markAll()}
          {...stylex.props(styles.button)}
        >
          {t('notifications.markAllRead')}
        </button>
      </header>
      {!feed.online && <output>{t('notifications.offline')}</output>}
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
          <h2>{t('notifications.today')}</h2>
          {list(grouped.today)}
          {grouped.earlier.length > 0 && (
            <>
              <h2>{t('notifications.earlier')}</h2>
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
    </>
  );
}
