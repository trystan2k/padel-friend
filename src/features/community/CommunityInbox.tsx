import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import {
  listMyCommunityNotifications,
  markCommunityNotificationRead
} from './community-request.functions';
import { formatCommunityRequestTimestamp, type CommunityTimezone } from './community-settings';
import { inboxStyles } from './community-inbox.styles';

export type CommunityNotification = {
  notification_id: string;
  message_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
  time_zone: CommunityTimezone;
};
export function CommunityInbox({
  initialItems,
  loadError
}: {
  initialItems: CommunityNotification[] | null;
  loadError: boolean;
}) {
  const { t, i18n } = useTranslation();
  const locale = i18n.resolvedLanguage ?? 'en';
  const [items, setItems] = useState(initialItems ?? []);
  const [loadFailed, setLoadFailed] = useState(loadError);
  const [mutationErrors, setMutationErrors] = useState<string[]>([]);
  const [pageError, setPageError] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState((initialItems?.length ?? 0) === 20);
  const [page, setPage] = useState(1);
  const generation = useRef(0);
  const loadingPage = useRef(false);
  const [pending, setPending] = useState<string[]>([]);
  async function markRead(id: string) {
    if (pending.includes(id)) return;
    setPending((current) => [...current, id]);
    try {
      const result = await markCommunityNotificationRead({ data: { notification_id: id } });
      setItems(
        (current) =>
          current?.map((item) =>
            item.notification_id === id ? { ...item, read_at: result.read_at } : item
          ) ?? null
      );
      setMutationErrors((current) => current.filter((notificationId) => notificationId !== id));
    } catch {
      setMutationErrors((current) => [...new Set([...current, id])]);
    } finally {
      setPending((current) => current.filter((notificationId) => notificationId !== id));
    }
  }
  async function loadInitial() {
    const nextGeneration = ++generation.current;
    try {
      const result = await listMyCommunityNotifications({ data: { offset: 0, limit: 20 } });
      if (nextGeneration !== generation.current) return;
      setItems(result);
      setPage(1);
      setHasMore(result.length === 20);
      setLoadFailed(false);
    } catch {
      setLoadFailed(true);
    }
  }
  async function loadMore() {
    if (loadingMore || !hasMore || loadingPage.current) return;
    setLoadingMore(true);
    loadingPage.current = true;
    setPageError(false);
    const requestedPage = page;
    try {
      const result = await listMyCommunityNotifications({
        data: { offset: requestedPage * 20, limit: 20 }
      });
      setItems((current) => {
        const seen = new Set(current.map((item) => item.notification_id));
        const additions = result.filter((item) => {
          if (seen.has(item.notification_id)) return false;
          seen.add(item.notification_id);
          return true;
        });
        return [...current, ...additions];
      });
      setPage(requestedPage + 1);
      setHasMore(result.length === 20);
    } catch {
      setPageError(true);
    } finally {
      loadingPage.current = false;
      setLoadingMore(false);
    }
  }
  return (
    <section aria-labelledby="community-inbox-title" {...stylex.props(inboxStyles.section)}>
      <h2 id="community-inbox-title">{t('communityInbox.title')}</h2>
      <p {...stylex.props(inboxStyles.notice)}>{t('communityInbox.oneWayNotice')}</p>
      {loadFailed ? (
        <div role="alert">
          <p>{t('communityInbox.error')}</p>
          <Button onClick={() => void loadInitial()}>{t('communityInbox.retry')}</Button>
        </div>
      ) : !items.length ? (
        <p>{t('communityInbox.empty')}</p>
      ) : (
        items.map((item) => (
          <article key={item.notification_id} {...stylex.props(inboxStyles.card)}>
            <p {...stylex.props(inboxStyles.body)}>{item.body}</p>
            <time dateTime={item.created_at}>
              {formatCommunityRequestTimestamp(item.created_at, locale, item.time_zone)}
            </time>
            {mutationErrors.includes(item.notification_id) && (
              <div role="alert">
                <p>{t('communityInbox.mutationError')}</p>
                <Button onClick={() => void markRead(item.notification_id)}>
                  {t('communityInbox.retry')}
                </Button>
              </div>
            )}
            {item.read_at ? (
              <span>{t('communityInbox.read')}</span>
            ) : (
              <Button
                disabled={pending.includes(item.notification_id)}
                onClick={() => void markRead(item.notification_id)}
              >
                {t('communityInbox.markRead')}
              </Button>
            )}
          </article>
        ))
      )}
      {!loadFailed && hasMore && (
        <div>
          {pageError && <p role="alert">{t('communityInbox.pageError')}</p>}
          <Button disabled={loadingMore} onClick={() => void loadMore()}>
            {loadingMore
              ? t('communityInbox.loading')
              : pageError
                ? t('communityInbox.retry')
                : t('communityInbox.loadMore')}
          </Button>
        </div>
      )}
    </section>
  );
}
