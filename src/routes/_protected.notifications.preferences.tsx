import { createFileRoute } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { NotificationPreferencesPage } from '../features/notifications/NotificationPreferencesPage';
import { getMyNotificationPreferences } from '../features/notifications/notifications.functions';

function Pending() {
  const { t } = useTranslation();
  return <p>{t('notificationPreferences.loading')}</p>;
}
function Failed() {
  const { t } = useTranslation();
  return <p role="alert">{t('notificationPreferences.error')}</p>;
}
export const Route = createFileRoute('/_protected/notifications/preferences')({
  loader: () => getMyNotificationPreferences(),
  pendingComponent: Pending,
  errorComponent: Failed,
  component: () => <NotificationPreferencesPage initial={Route.useLoaderData()} />
});
