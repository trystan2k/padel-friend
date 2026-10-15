import * as stylex from '@stylexjs/stylex';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { markCommunityNotificationRead } from './community-request.functions';
import { inboxStyles } from './community-inbox.styles';

export type CommunityNotification = {
  notification_id: string;
  message_id: string;
  body: string;
  created_at: string;
  read_at: string | null;
};
export function CommunityInbox({
  initialItems,
  loadError
}: {
  initialItems: CommunityNotification[] | null;
  loadError: boolean;
}) {
  const { t } = useTranslation();
  const [items, setItems] = useState(initialItems);
  const [error, setError] = useState(loadError);
  async function markRead(id: string) {
    try {
      const result = await markCommunityNotificationRead({ data: { notification_id: id } });
      setItems(
        (current) =>
          current?.map((item) =>
            item.notification_id === id ? { ...item, read_at: result.read_at } : item
          ) ?? null
      );
      setError(false);
    } catch {
      setError(true);
    }
  }
  return (
    <section aria-labelledby="community-inbox-title" {...stylex.props(inboxStyles.section)}>
      <h2 id="community-inbox-title">{t('communityInbox.title')}</h2>
      <p {...stylex.props(inboxStyles.notice)}>{t('communityInbox.oneWayNotice')}</p>
      {items === null || error ? (
        <p role="alert">{t('communityInbox.error')}</p>
      ) : !items.length ? (
        <p>{t('communityInbox.empty')}</p>
      ) : (
        items.map((item) => (
          <article key={item.notification_id} {...stylex.props(inboxStyles.card)}>
            <p {...stylex.props(inboxStyles.body)}>{item.body}</p>
            <time dateTime={item.created_at}>{new Date(item.created_at).toLocaleString()}</time>
            {item.read_at ? (
              <span>{t('communityInbox.read')}</span>
            ) : (
              <Button onClick={() => void markRead(item.notification_id)}>
                {t('communityInbox.markRead')}
              </Button>
            )}
          </article>
        ))
      )}
    </section>
  );
}
