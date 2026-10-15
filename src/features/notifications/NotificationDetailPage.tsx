import { useEffect, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  acceptMyNotificationInvitation,
  getMyNotificationTarget,
  markNotificationRead
} from './notifications.functions';
import type { NotificationTarget } from './notification-target';
import { styles } from './notifications.styles';
import * as stylex from '@stylexjs/stylex';
export function NotificationDetailPage({
  notificationId,
  target: initialTarget
}: {
  notificationId: string;
  target: NotificationTarget;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState(initialTarget);
  const [accepted, setAccepted] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState(false);
  useEffect(() => {
    void markNotificationRead({ data: { notificationId } }).catch(() => setError(true));
  }, [notificationId]);
  async function accept() {
    setPending(true);
    setError(false);
    try {
      await acceptMyNotificationInvitation({ data: { notificationId } });
      setAccepted(true);
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  async function retry() {
    setPending(true);
    setError(false);
    try {
      setTarget(await getMyNotificationTarget({ data: { notificationId } }));
    } catch {
      setError(true);
    } finally {
      setPending(false);
    }
  }
  return (
    <main {...stylex.props(styles.page)}>
      <section {...stylex.props(styles.panel)}>
        {target.target_status === 'unavailable' ? (
          <>
            <h1>{t('notifications.targetUnavailable')}</h1>
            <Link {...stylex.props(styles.link)} to="/notifications">
              {t('notifications.back')}
            </Link>
          </>
        ) : (
          <>
            <h1>{target.community_name}</h1>
            {target.target_status === 'invitation_available' ? (
              <>
                <p>{t('notifications.invitationContext')}</p>
                <button
                  {...stylex.props(styles.button)}
                  disabled={pending}
                  onClick={() => void accept()}
                >
                  {accepted
                    ? t('notifications.accepted')
                    : pending
                      ? t('notifications.accepting')
                      : t('notifications.accept')}
                </button>
              </>
            ) : (
              <p>
                {t(
                  target.membership_status === 'active'
                    ? 'notifications.activeMembership'
                    : 'notifications.pendingMembership'
                )}
              </p>
            )}
            {error && <p role="alert">{t('notifications.targetError')}</p>}
            {error && (
              <button
                {...stylex.props(styles.button)}
                disabled={pending}
                onClick={() => void retry()}
              >
                {t('notifications.retry')}
              </button>
            )}
            <Link {...stylex.props(styles.link)} to="/notifications">
              {t('notifications.back')}
            </Link>
          </>
        )}
      </section>
    </main>
  );
}
