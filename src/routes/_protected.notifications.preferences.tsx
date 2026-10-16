import { createFileRoute, Link, useRouter } from '@tanstack/react-router';
import * as stylex from '@stylexjs/stylex';
import { useTranslation } from 'react-i18next';
import { NotificationPreferencesPage } from '../features/notifications/NotificationPreferencesPage';
import { getMyNotificationPreferences } from '../features/notifications/notifications.functions';

function Pending() {
  const { t } = useTranslation();
  return <p>{t('notificationPreferences.loading')}</p>;
}
function Failed() {
  const { t } = useTranslation();
  const router = useRouter();
  return (
    <main>
      <p role="alert">{t('notifications.error')}</p>
      <button
        type="button"
        onClick={() => void router.invalidate()}
        {...stylex.props(routeStyles.retry)}
      >
        {t('notifications.retry')}
      </button>
      <Link to="/notifications">{t('notificationPreferences.back')}</Link>
    </main>
  );
}
const routeStyles = stylex.create({ retry: { minHeight: '44px' } });
export const Route = createFileRoute('/_protected/notifications/preferences')({
  loader: () => getMyNotificationPreferences(),
  pendingComponent: Pending,
  errorComponent: Failed,
  component: () => <NotificationPreferencesPage initial={Route.useLoaderData()} />
});
