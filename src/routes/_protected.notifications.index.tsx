import { createFileRoute } from '@tanstack/react-router';
import { NotificationsPage } from '../features/notifications/NotificationsPage';
import { listMyNotifications } from '../features/notifications/notifications.functions';
import { useTranslation } from 'react-i18next';

function Failed() {
  const { t } = useTranslation();
  return <p role="alert">{t('notifications.error')}</p>;
}
export const Route = createFileRoute('/_protected/notifications/')({
  loader: () => listMyNotifications({ data: { category: 'all', limit: 20 } }),
  errorComponent: Failed,
  component: () => <NotificationsPage initial={Route.useLoaderData()} />
});
