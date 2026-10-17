import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  acceptMyNotificationInvitation,
  getMyMatchNotificationContext,
  getMyNotificationTargetV2,
  markNotificationRead
} from './notifications.functions';
import type { NotificationTarget } from './notification-target';
import type { MatchNotificationContext } from './notification-target';
import { styles } from './notifications.styles';
import * as stylex from '@stylexjs/stylex';

async function resolveNotificationTarget(notificationId: string) {
  const target = await getMyNotificationTargetV2({ data: { notificationId } });
  const matchContext =
    target.target_status === 'match_available' && target.match_available && target.match_event_id
      ? await getMyMatchNotificationContext({ data: { notificationId } })
      : null;

  return { target, matchContext };
}

export function NotificationDetailPage({
  notificationId,
  target: initialTarget,
  matchContext
}: {
  notificationId: string;
  target: NotificationTarget;
  matchContext?: MatchNotificationContext | null;
}) {
  const { t, i18n } = useTranslation();
  const [target, setTarget] = useState(initialTarget);
  const [currentMatchContext, setCurrentMatchContext] = useState(matchContext ?? null);
  const [accepted, setAccepted] = useState(false);
  const [announcement, setAnnouncement] = useState<
    'accepted' | 'activeMembership' | 'pendingMembership' | null
  >(null);
  const [isOnline, setIsOnline] = useState<boolean | null>(null);
  const [pending, setPending] = useState(false);
  const [targetError, setTargetError] = useState(false);
  const [readError, setReadError] = useState(false);
  const previousOnline = useRef<boolean | null>(null);

  useEffect(() => {
    const updateConnectivity = () => setIsOnline(window.navigator.onLine);
    updateConnectivity();
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    return () => {
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
    };
  }, []);

  useEffect(() => {
    if (isOnline !== true) return undefined;
    let active = true;
    void markNotificationRead({ data: { notificationId } })
      .then(() => {
        if (active) setReadError(false);
      })
      .catch(() => {
        if (active) setReadError(true);
      });
    return () => {
      active = false;
    };
  }, [isOnline, notificationId]);

  useEffect(() => {
    if (isOnline === null) return undefined;
    const wasOffline = previousOnline.current === false;
    previousOnline.current = isOnline;
    if (!wasOffline || !isOnline) return undefined;

    let active = true;
    setTargetError(false);
    void resolveNotificationTarget(notificationId)
      .then(({ target: nextTarget, matchContext: nextMatchContext }) => {
        if (!active) return;
        setTarget(nextTarget);
        setCurrentMatchContext(nextMatchContext);
        if (accepted && nextTarget.target_status === 'membership_available')
          setAnnouncement(
            nextTarget.membership_status === 'active' ? 'activeMembership' : 'pendingMembership'
          );
      })
      .catch(() => {
        if (active) setTargetError(true);
      });
    return () => {
      active = false;
    };
  }, [accepted, isOnline, notificationId]);

  async function accept() {
    if (pending || isOnline !== true || accepted) return;
    setPending(true);
    setTargetError(false);
    try {
      await acceptMyNotificationInvitation({ data: { notificationId } });
      setAccepted(true);
      setAnnouncement('accepted');
      try {
        const next = await resolveNotificationTarget(notificationId);
        setTarget(next.target);
        setCurrentMatchContext(next.matchContext);
      } catch {
        setTargetError(true);
      }
    } catch {
      setTargetError(true);
    } finally {
      setPending(false);
    }
  }

  async function retry() {
    if (pending || isOnline !== true) return;
    setPending(true);
    if (readError) {
      try {
        await markNotificationRead({ data: { notificationId } });
        setReadError(false);
      } catch {
        setReadError(true);
      }
    }
    if (targetError) {
      try {
        const next = await resolveNotificationTarget(notificationId);
        setTarget(next.target);
        setCurrentMatchContext(next.matchContext);
        setTargetError(false);
        if (accepted && next.target.target_status === 'membership_available')
          setAnnouncement(
            next.target.membership_status === 'active' ? 'activeMembership' : 'pendingMembership'
          );
      } catch {
        setTargetError(true);
      }
    }
    setPending(false);
  }

  const hasError = targetError || readError;
  return (
    <main {...stylex.props(styles.page)}>
      <output aria-live="polite">
        {isOnline === false
          ? t('notifications.offline')
          : announcement
            ? t(`notifications.${announcement}`)
            : ''}
      </output>
      <section {...stylex.props(styles.panel)}>
        {target.target_status === 'match_available' &&
        target.match_available &&
        target.match_event_id ? (
          <>
            <h1>{t('notifications.kinds.match_event_invitation')}</h1>
            {currentMatchContext ? (
              <>
                <p>
                  {t('notifications.match.invitedBy', {
                    name: currentMatchContext.creator_display_name
                  })}
                </p>
                <p>
                  {t('notifications.match.venue')}: {currentMatchContext.venue}
                </p>
                <p>
                  {t('notifications.match.startsAt')}:{' '}
                  {new Intl.DateTimeFormat(i18n.language, {
                    dateStyle: 'medium',
                    timeStyle: 'short',
                    timeZone: currentMatchContext.timezone
                  }).format(new Date(currentMatchContext.scheduled_at))}
                </p>
              </>
            ) : (
              <p>{t('notifications.match.unavailable')}</p>
            )}
            {hasError && <p role="alert">{t('notifications.targetError')}</p>}
            {hasError && (
              <button
                {...stylex.props(styles.button)}
                disabled={pending || isOnline !== true}
                onClick={() => void retry()}
              >
                {t('notifications.retry')}
              </button>
            )}
            <a
              href={`/matches/${encodeURIComponent(target.match_event_id)}`}
              {...stylex.props(styles.link)}
            >
              {t('notifications.match.openEvent')}
            </a>
            <Link {...stylex.props(styles.link)} to="/notifications">
              {t('notifications.back')}
            </Link>
          </>
        ) : target.target_status === 'unavailable' ? (
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
                {!accepted && (
                  <button
                    {...stylex.props(styles.button)}
                    disabled={pending || isOnline !== true}
                    onClick={() => void accept()}
                  >
                    {pending ? t('notifications.accepting') : t('notifications.accept')}
                  </button>
                )}
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
            {hasError && <p role="alert">{t('notifications.targetError')}</p>}
            {hasError && (
              <button
                {...stylex.props(styles.button)}
                disabled={pending || isOnline !== true}
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
