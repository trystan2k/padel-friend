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
import {
  matchRegistrationGroup,
  matchRegistrationReservePosition
} from '../matches/match-registration-model';
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

type RegistrationNotificationKind =
  | 'match_registration_requested'
  | 'match_registration_approved'
  | 'match_registration_rejected'
  | 'match_registration_playing'
  | 'match_registration_reserve'
  | 'match_registration_promoted'
  | 'match_registration_quartet_complete'
  | 'match_registration_expired'
  | 'match_registration_not_playing';

// Existing kinds keep their current invitation detail behaviour; the PAF-5.2
// request/decision kinds and the PAF-5.3 FIFO quartet kinds opt into their own
// typed heading and body through this single allowlist (F2).
const REGISTRATION_NOTIFICATION_KINDS: readonly RegistrationNotificationKind[] = [
  'match_registration_requested',
  'match_registration_approved',
  'match_registration_rejected',
  'match_registration_playing',
  'match_registration_reserve',
  'match_registration_promoted',
  'match_registration_quartet_complete',
  'match_registration_expired',
  'match_registration_not_playing'
];

function isRegistrationNotificationKind(kind: string): kind is RegistrationNotificationKind {
  return REGISTRATION_NOTIFICATION_KINDS.some((candidate) => candidate === kind);
}

function registrationNotificationKind(
  kind: string | null | undefined
): RegistrationNotificationKind | null {
  if (kind === null || kind === undefined) return null;
  return isRegistrationNotificationKind(kind) ? kind : null;
}

type TranslateFn = (key: string, options?: Record<string, unknown>) => string;

// The playing heading carries the quartet group; the other FIFO titles are
// static. When the immutable accepted ordinal is unavailable the heading degrades
// to the generic notification copy rather than rendering a literal placeholder.
function registrationHeading(
  t: TranslateFn,
  kind: RegistrationNotificationKind | null,
  group: number | null
): string {
  if (kind === null) return t('notifications.kinds.match_event_invitation');
  if (kind === 'match_registration_playing')
    return group === null
      ? t('notifications.kinds.match_registration_playing')
      : t('notifications.match.registrationPlayingTitle', { group });
  return t(`notifications.kinds.${kind}`);
}

type ApprovedPlacement =
  | { participation: 'playing'; group: number }
  | { participation: 'reserve'; position: number };

// The playing/reserve variant is chosen strictly from the projection's
// caller_participation; the numeric group/position derive from the immutable
// accepted ordinal so nothing is inferred from counts alone.
function approvedPlacement(context: MatchNotificationContext): ApprovedPlacement | null {
  if (context.caller_participation === 'playing') {
    const group = matchRegistrationGroup(context.caller_accepted_order);
    return group === null ? null : { participation: 'playing', group };
  }
  if (context.caller_participation === 'reserve') {
    const position = matchRegistrationReservePosition(
      context.caller_accepted_order,
      context.playing_count
    );
    return position === null ? null : { participation: 'reserve', position };
  }
  return null;
}

function formatMatchTime(
  value: string | null | undefined,
  timeZone: string,
  locale: string
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, { timeStyle: 'short', timeZone }).format(date);
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

  const registrationKind = registrationNotificationKind(target.kind);
  const approvedVariant =
    registrationKind === 'match_registration_approved' && currentMatchContext
      ? approvedPlacement(currentMatchContext)
      : null;
  const approvedAt =
    registrationKind === 'match_registration_approved' && currentMatchContext
      ? formatMatchTime(target.created_at, currentMatchContext.timezone, i18n.language)
      : null;
  // FIFO kinds derive their group/position from the caller's immutable accepted
  // ordinal (and the derived playing headcount) carried by the context.
  const fifoGroup =
    registrationKind && currentMatchContext
      ? matchRegistrationGroup(currentMatchContext.caller_accepted_order)
      : null;
  const fifoPosition =
    registrationKind && currentMatchContext
      ? matchRegistrationReservePosition(
          currentMatchContext.caller_accepted_order,
          currentMatchContext.playing_count
        )
      : null;
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
            <h1>{registrationHeading(t, registrationKind, fifoGroup)}</h1>
            {currentMatchContext ? (
              <>
                {registrationKind === null ? (
                  <p>
                    {t('notifications.match.invitedBy', {
                      name: currentMatchContext.creator_display_name
                    })}
                  </p>
                ) : registrationKind === 'match_registration_requested' ? (
                  <p>
                    {t('notifications.match.registrationRequestBody', {
                      name: currentMatchContext.requester_display_name ?? '',
                      event: currentMatchContext.venue
                    })}
                  </p>
                ) : registrationKind === 'match_registration_approved' ? (
                  approvedVariant && approvedAt ? (
                    <p>
                      {approvedVariant.participation === 'playing'
                        ? t('notifications.match.registrationApprovedPlayingBody', {
                            group: approvedVariant.group,
                            event: currentMatchContext.venue,
                            time: approvedAt
                          })
                        : t('notifications.match.registrationApprovedReserveBody', {
                            position: approvedVariant.position,
                            event: currentMatchContext.venue,
                            time: approvedAt
                          })}
                    </p>
                  ) : null
                ) : registrationKind === 'match_registration_playing' ? (
                  fifoGroup === null ? null : (
                    <p>
                      {t('notifications.match.registrationPlayingBody', {
                        group: fifoGroup,
                        event: currentMatchContext.venue
                      })}
                    </p>
                  )
                ) : registrationKind === 'match_registration_reserve' ? (
                  fifoPosition === null ? null : (
                    <p>
                      {t('notifications.match.registrationReserveBody', {
                        position: fifoPosition,
                        event: currentMatchContext.venue
                      })}
                    </p>
                  )
                ) : registrationKind === 'match_registration_promoted' ? (
                  fifoGroup === null ? null : (
                    <p>{t('notifications.match.registrationPromotedBody', { group: fifoGroup })}</p>
                  )
                ) : registrationKind === 'match_registration_quartet_complete' ? (
                  fifoGroup === null ? null : (
                    <p>
                      {t('notifications.match.registrationQuartetCompleteBody', {
                        group: fifoGroup,
                        event: currentMatchContext.venue
                      })}
                    </p>
                  )
                ) : registrationKind === 'match_registration_expired' ? (
                  <p>{t('notifications.match.registrationExpiredBody')}</p>
                ) : registrationKind === 'match_registration_not_playing' ? (
                  <p>{t('notifications.match.registrationNotPlayingBody')}</p>
                ) : (
                  <p>
                    {t('notifications.match.registrationRejectedBody', {
                      event: currentMatchContext.venue
                    })}
                  </p>
                )}
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
