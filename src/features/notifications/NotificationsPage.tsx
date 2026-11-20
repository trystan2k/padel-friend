import * as stylex from '@stylexjs/stylex';
import { Button } from '../../components/ui/Button';
import { controlStyles } from '../../components/ui/control.styles';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from '@tanstack/react-router';
import { StatusBadge } from '../../components/ui/StatusBadge';
import type { NotificationCategory, NotificationPage } from './notification-model';
import { groupNotifications } from './notification-model';
import { NotificationResultOutcome } from './NotificationResultOutcome';
import { notificationResultHref } from './notification-target';
import { centerStyles as styles } from './notification-center.styles';
import { notificationGlyph } from './notification-presentation';
import { styles as legacyStyles } from './notifications.styles';
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
  const unreadSummary = t(
    feed.unreadCount === 1 ? 'notifications.unread_one' : 'notifications.unread_other',
    { count: feed.unreadCount ?? 0 }
  );
  const list = (rows: typeof feed.rows) => (
    <ul {...stylex.props(styles.list)}>
      {rows.map((row) => {
        const glyph = notificationGlyph(row.kind, row.category);
        return (
          <li key={row.id} {...stylex.props(styles.row)}>
            <span
              aria-hidden="true"
              {...stylex.props(styles.glyph, glyph.tone !== 'neutral' && styles[glyph.tone])}
            >
              {glyph.symbol}
            </span>
            <div {...stylex.props(styles.body)}>
              {!row.read_at && (
                <span {...stylex.props(legacyStyles.visuallyHidden)}>
                  {t('notifications.unreadRow')}
                </span>
              )}
              <h3 {...stylex.props(styles.cardTitle)}>
                {t(`notifications.kinds.${row.kind}`, { defaultValue: t('notifications.generic') })}
              </h3>
              {row.matchContext ? (
                <div {...stylex.props(styles.meta)}>
                  <p>
                    {t('notifications.match.invitedBy', {
                      name: row.matchContext.creator_display_name
                    })}
                  </p>
                  <p>
                    {t('notifications.match.venue')}: {row.matchContext.venue}
                  </p>
                  <p>
                    {t('notifications.match.startsAt')}:{' '}
                    {new Intl.DateTimeFormat(i18n.language, {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                      timeZone: row.matchContext.timezone
                    }).format(new Date(row.matchContext.scheduled_at))}
                  </p>
                  <p>
                    {t(
                      row.matchContext.playing_count === 1
                        ? 'notifications.match.playing_one'
                        : 'notifications.match.playing_other',
                      { count: row.matchContext.playing_count }
                    )}
                  </p>
                  <p>
                    {t(
                      row.matchContext.reserve_count === 1
                        ? 'notifications.match.reserve_one'
                        : 'notifications.match.reserve_other',
                      { count: row.matchContext.reserve_count }
                    )}
                  </p>
                  {row.matchContext.price_minor !== null && row.matchContext.currency ? (
                    <p>
                      {t('notifications.match.pricePerPlayer')}:{' '}
                      {new Intl.NumberFormat(i18n.language, {
                        style: 'currency',
                        currency: row.matchContext.currency
                      }).format(row.matchContext.price_minor / 100)}
                    </p>
                  ) : null}
                </div>
              ) : row.resultContext ? (
                <div {...stylex.props(styles.meta)}>
                  {row.resultContext.entry_ready ? (
                    <p>
                      {t('notifications.result.entryReady', { venue: row.resultContext.venue })}
                    </p>
                  ) : (
                    <>
                      <p>
                        {t('notifications.result.group', {
                          number: row.resultContext.group_number
                        })}
                        {row.resultContext.score ? ` · ${row.resultContext.score}` : ''}
                      </p>
                      <NotificationResultOutcome context={row.resultContext} appearance="feed" />
                      <p>
                        {t('notifications.result.submittedBy', {
                          name:
                            row.resultContext.submitted_by_name ??
                            t('matches.results.unknownPlayer')
                        })}
                      </p>
                      {row.resultContext.review_deadline_at && (
                        <p>
                          {t('notifications.result.deadline', {
                            deadline: new Intl.DateTimeFormat(i18n.language, {
                              dateStyle: 'medium',
                              timeStyle: 'short',
                              timeZone: row.resultContext.timezone
                            }).format(new Date(row.resultContext.review_deadline_at))
                          })}
                        </p>
                      )}
                      {!row.resultContext.is_current && (
                        <p>
                          {t('notifications.result.historicalVersion', {
                            version: row.resultContext.proposal_version
                          })}
                        </p>
                      )}
                    </>
                  )}
                </div>
              ) : row.category === 'matches' ? (
                <p>{t('notifications.match.unavailable')}</p>
              ) : null}
              <p
                {...stylex.props(styles.meta)}
                aria-label={`${grouped.format(row.created_at)} ${t('notifications.dateUtc')}`}
              >
                {grouped.format(row.created_at)} {t('notifications.utc')}
              </p>
              <div {...stylex.props(styles.actions)}>
                {row.resultContext ? (
                  <a
                    href={notificationResultHref(row.resultContext)}
                    onClick={() => {
                      if (!row.read_at) void feed.markRead(row.id);
                    }}
                    {...stylex.props(legacyStyles.link)}
                  >
                    {t(
                      row.resultContext.entry_ready
                        ? 'notifications.result.openEvent'
                        : row.resultContext.is_current
                          ? 'notifications.result.openResult'
                          : 'notifications.result.reviewCurrent'
                    )}
                  </a>
                ) : row.matchContext ? (
                  <a
                    href={`/matches/${encodeURIComponent(row.matchContext.match_event_id)}`}
                    onClick={() => {
                      if (!row.read_at) void feed.markRead(row.id);
                    }}
                    {...stylex.props(legacyStyles.link)}
                  >
                    {t('notifications.match.openEvent')}
                  </a>
                ) : (
                  <Link
                    to="/notifications/$notificationId"
                    params={{ notificationId: row.id }}
                    {...stylex.props(legacyStyles.link)}
                  >
                    {t('notifications.view')}
                  </Link>
                )}
                {!row.read_at && (
                  <Button
                    variant="secondary"
                    size="large"
                    disabled={!feed.online || feed.mutating}
                    onClick={() => void feed.markRead(row.id)}
                  >
                    {t('notifications.markRead')}
                  </Button>
                )}
              </div>
            </div>
            {!row.read_at && (
              <span aria-hidden="true" data-unread-indicator {...stylex.props(styles.dot)} />
            )}
          </li>
        );
      })}
    </ul>
  );

  return (
    <main data-route-chrome="navigation" {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)}>
        <header {...stylex.props(styles.header)}>
          <Link
            to="/dashboard"
            aria-label={t('notifications.backHome')}
            {...stylex.props(legacyStyles.link, styles.back)}
          >
            <span aria-hidden="true">‹</span>
          </Link>
          <h1 {...stylex.props(styles.title)}>{t('notifications.title')}</h1>
          <Link
            to="/notifications/preferences"
            {...stylex.props(legacyStyles.link, styles.textAction)}
          >
            {t('notificationPreferences.preferencesLink')}
          </Link>
        </header>
        <output
          aria-live="polite"
          aria-atomic="true"
          {...stylex.props(legacyStyles.visuallyHidden)}
        >
          {countAnnouncement}
        </output>
        <nav aria-label={t('notifications.filters.label')} {...stylex.props(styles.filters)}>
          {categories.map((key) => (
            <button
              key={key}
              type="button"
              aria-current={category === key ? 'page' : undefined}
              onClick={() => setCategory(key)}
              {...stylex.props(
                styles.filter,
                category === key && styles.selected,
                controlStyles.focusRing
              )}
            >
              {category === key && <span aria-hidden="true">✓</span>}
              {t(`notifications.filters.${key}`)}
            </button>
          ))}
        </nav>
        <div {...stylex.props(styles.summary)}>
          {feed.unreadCount !== null && (
            <StatusBadge appearance="summary">{unreadSummary}</StatusBadge>
          )}
          <Button
            variant="secondary"
            xstyle={styles.textButton}
            disabled={!feed.online || feed.mutating || !feed.unreadCount}
            onClick={() => void feed.markAll()}
          >
            {t('notifications.markAllRead')}
          </Button>
        </div>
        {!feed.online && <output>{t('notifications.offline')}</output>}
        {feed.mutationError && <p role="alert">{t('notifications.mutationError')}</p>}
        {feed.error && (
          <p role="alert">
            {t('notifications.stale')}{' '}
            <Button variant="secondary" size="large" onClick={() => void feed.refresh()}>
              {t('notifications.retry')}
            </Button>
          </p>
        )}
        {feed.loading && !feed.rows.length && <p>{t('notifications.loading')}</p>}
        {feed.error && !feed.rows.length ? (
          <Button variant="secondary" size="large" onClick={() => void feed.refresh()}>
            {t('notifications.retry')}
          </Button>
        ) : feed.rows.length ? (
          <>
            {(['today', 'earlier'] as const).map((group) =>
              grouped[group].length > 0 ? (
                <section
                  key={group}
                  aria-labelledby={`notifications-${group}`}
                  {...stylex.props(styles.group)}
                >
                  <h2 id={`notifications-${group}`} {...stylex.props(styles.groupTitle)}>
                    {t(`notifications.${group}`)}
                  </h2>
                  {list(grouped[group])}
                </section>
              ) : null
            )}
            {feed.cursor && (
              <Button
                variant="secondary"
                size="large"
                disabled={!feed.online || feed.loading}
                onClick={() => void feed.loadMore()}
              >
                {t('notifications.loadMore')}
              </Button>
            )}
          </>
        ) : (
          !feed.loading && (
            <p {...stylex.props(styles.meta)}>{t(`notifications.empty.${category}`)}</p>
          )
        )}
      </section>
    </main>
  );
}
