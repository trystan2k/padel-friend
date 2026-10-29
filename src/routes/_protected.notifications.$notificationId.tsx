import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Link, createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NotificationDetailPage } from '../features/notifications/NotificationDetailPage';
import {
  getMyMatchNotificationContext,
  getMyNotificationTargetV3
} from '../features/notifications/notifications.functions';
import { styles } from '../features/notifications/notifications.styles';

function Pending() {
  const { t } = useTranslation();
  return <p>{t('notifications.loading')}</p>;
}

function Failed({ reset }: ErrorComponentProps) {
  const { t } = useTranslation();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  async function retry() {
    if (pending) return;
    setPending(true);
    try {
      await router.invalidate();
      reset();
    } catch {
      // Keep the failed loader state visible when invalidation fails.
    } finally {
      setPending(false);
    }
  }
  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)}>
        <p role="alert">{t('notifications.error')}</p>
        <button
          type="button"
          {...stylex.props(styles.button)}
          disabled={pending}
          onClick={() => void retry()}
        >
          {t('notifications.retry')}
        </button>
        <Link {...stylex.props(styles.link)} to="/notifications">
          {t('notifications.back')}
        </Link>
      </section>
    </main>
  );
}

export const Route = createFileRoute('/_protected/notifications/$notificationId')({
  loader: async ({ params }) => {
    const target = await getMyNotificationTargetV3({
      data: { notificationId: params.notificationId }
    });
    if (!target.match_event_id || target.result_context) return { ...target, matchContext: null };
    const matchContext = await getMyMatchNotificationContext({
      data: { notificationId: params.notificationId }
    });
    return { ...target, matchContext };
  },
  pendingComponent: Pending,
  errorComponent: Failed,
  component: () => {
    const { matchContext, ...target } = Route.useLoaderData();
    const { notificationId } = Route.useParams();
    return (
      <NotificationDetailPage
        notificationId={notificationId}
        target={target}
        matchContext={matchContext}
      />
    );
  }
});
