import { createFileRoute } from '@tanstack/react-router';
import { NotificationDetailPage } from '../features/notifications/NotificationDetailPage';
import { getMyNotificationTarget } from '../features/notifications/notifications.functions';
import { useTranslation } from 'react-i18next';
function Pending() {
  const { t } = useTranslation();
  return <p>{t('notifications.loading')}</p>;
}
function Failed() {
  const { t } = useTranslation();
  return <p role="alert">{t('notifications.error')}</p>;
}
export const Route = createFileRoute('/_protected/notifications/$notificationId')({
  loader: ({ params }) =>
    getMyNotificationTarget({ data: { notificationId: params.notificationId } }),
  pendingComponent: Pending,
  errorComponent: Failed,
  component: () => {
    const target = Route.useLoaderData();
    const { notificationId } = Route.useParams();
    return <NotificationDetailPage notificationId={notificationId} target={target} />;
  }
});
