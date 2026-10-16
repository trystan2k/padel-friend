import { useState } from 'react';
import * as stylex from '@stylexjs/stylex';
import { Link, createFileRoute, useRouter, type ErrorComponentProps } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { listMyNotifications } from '../features/notifications/notifications.functions';
import { styles } from '../features/notifications/notifications.styles';

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
        <Link {...stylex.props(styles.link)} to="/dashboard">
          {t('communityAdmin.backToDashboard')}
        </Link>
      </section>
    </main>
  );
}

export const Route = createFileRoute('/_protected/notifications/')({
  loader: () => listMyNotifications({ data: { category: 'all', limit: 20 } }),
  errorComponent: Failed,
  component: () => <NotificationsPage initial={Route.useLoaderData()} />
});
