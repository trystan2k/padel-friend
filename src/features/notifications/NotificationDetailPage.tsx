import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { SurfaceCard } from '../../components/ui/SurfaceCard';
import { invitationStyles } from '../community/community-invitation.styles';
import { useEffect, useRef, useState } from 'react';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  notificationRepairDiagnosticsHref,
  notificationResultHref,
  notificationRosterPosition
} from './notification-target';
import {
  NotificationDetailActionIcon,
  NotificationDetailMeta,
  NotificationDetailRow,
  NotificationDetailTopBar
} from './NotificationDetailChrome';
import { NotificationLevelReviewOutcome } from './NotificationLevelReviewOutcome';
import { notificationGlyph } from './notification-presentation';
import { NotificationResultOutcome } from './NotificationResultOutcome';
import {
  acceptMyNotificationInvitation,
  getMyMatchNotificationContext,
  getMyNotificationTargetV3,
  markNotificationRead
} from './notifications.functions';
import type { NotificationTarget } from './notification-target';
import type { MatchNotificationContext } from './notification-target';
import {
  matchRegistrationGroup,
  matchRegistrationReservePosition
} from '../matches/match-registration-model';
import { useUpdateGuard } from '../pwa/update-guard';
import { detailStyles as detail } from './notification-detail.styles';
import { styles } from './notifications.styles';
import * as stylex from '@stylexjs/stylex';

// Correction notices carry no extra payload: the kind selects the explanatory body copy.
const correctionKinds: ReadonlySet<string> = new Set([
  'result_amendment_resolved',
  'result_repair_queued',
  'result_repair_applied',
  'result_repair_failed'
]);

async function resolveNotificationTarget(notificationId: string) {
  const target = await getMyNotificationTargetV3({ data: { notificationId } });
  const matchContext =
    target.target_status === 'match_available' &&
    target.match_available &&
    target.match_event_id &&
    !target.result_context
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
  | 'match_registration_not_playing'
  | 'match_invitation_accepted'
  | 'match_invitation_declined'
  | 'match_invitation_expired'
  | 'match_registration_withdrawn'
  | 'match_registration_removed'
  | 'match_registration_group_changed'
  | 'match_event_ownership_transferred'
  | 'match_event_cancelled'
  | 'match_event_updated'
  | 'match_reconfirmation_required'
  | 'match_registration_reconfirmed'
  | 'match_reconfirmation_expired';

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
  'match_registration_not_playing',
  'match_invitation_accepted',
  'match_invitation_declined',
  'match_invitation_expired',
  'match_registration_withdrawn',
  'match_registration_removed',
  'match_registration_group_changed',
  'match_event_ownership_transferred',
  'match_event_cancelled',
  'match_event_updated',
  'match_reconfirmation_required',
  'match_registration_reconfirmed',
  'match_reconfirmation_expired'
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
  notificationKind: string | null | undefined,
  group: number | null
): string {
  if (kind === 'match_event_cancelled') return t('notifications.kinds.match_event_cancelled');
  if (notificationKind === 'match_event_published')
    return t('notifications.kinds.match_event_published');
  if (notificationKind === 'match_event_invitation')
    return t('notifications.kinds.match_event_invitation');
  if (kind === null) return t('notifications.generic');
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
    const group = matchRegistrationGroup(notificationRosterPosition(context));
    return group === null ? null : { participation: 'playing', group };
  }
  if (context.caller_participation === 'reserve') {
    const position = matchRegistrationReservePosition(
      notificationRosterPosition(context),
      context.playing_count
    );
    return position === null ? null : { participation: 'reserve', position };
  }
  return null;
}

type ReserveBody = { key: string; values: Record<string, unknown> };

// PAF-5 review F29: the reserve notification was created when the caller joined
// the reserve queue, but the context carries their CURRENT participation. Only a
// caller still on reserve may read a present-tense queue position; a promoted or
// no-longer-playing caller gets explicit historical wording, and a promoted
// caller is never clamped to a fabricated #1 position. The venue and any number
// come from the existing context fields, never invented data.
function reserveBody(context: MatchNotificationContext): ReserveBody {
  const event = context.venue;
  if (context.caller_participation === 'reserve') {
    const position = matchRegistrationReservePosition(
      notificationRosterPosition(context),
      context.playing_count
    );
    if (position !== null)
      return {
        key: 'notifications.match.registrationReserveBody',
        values: { position, event }
      };
  }
  if (context.caller_participation === 'playing') {
    const group = matchRegistrationGroup(notificationRosterPosition(context));
    if (group !== null)
      return {
        key: 'notifications.match.registrationReservePromotedBody',
        values: { group, event }
      };
  }
  if (context.caller_participation === 'reserve_not_playing')
    return { key: 'notifications.match.registrationReserveNotPlayingBody', values: { event } };
  return { key: 'notifications.match.registrationReservePastBody', values: { event } };
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

// Received time: the feed shows UTC, so the detail does too (never the viewer's clock).
function formatReceived(
  value: string | null | undefined,
  locale: string,
  utc: string
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const text = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC'
  }).format(date);
  return `${text} ${utc}`;
}

function formatStart(
  value: string | null | undefined,
  timeZone: string,
  locale: string
): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(date);
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
  const [unconfirmed, setUnconfirmed] = useState(false);
  useUpdateGuard(pending || unconfirmed);
  const [targetError, setTargetError] = useState(false);
  const [readError, setReadError] = useState(false);
  // The chip reflects what the server confirmed: unread until the mark-read call succeeds.
  const [read, setRead] = useState(false);
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
        if (!active) return;
        setReadError(false);
        setRead(true);
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
    if (!navigator.onLine) {
      setIsOnline(false);
      return;
    }
    if (pending || isOnline !== true || accepted) return;
    setPending(true);
    setTargetError(false);
    try {
      await acceptMyNotificationInvitation({ data: { notificationId } });
      setAccepted(true);
      setUnconfirmed(false);
      setAnnouncement('accepted');
      try {
        const next = await resolveNotificationTarget(notificationId);
        setTarget(next.target);
        setCurrentMatchContext(next.matchContext);
      } catch {
        setTargetError(true);
      }
    } catch (error) {
      setUnconfirmed(
        !(error instanceof Error && error.message === 'NOTIFICATION_INVITATION_REJECTED')
      );
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
        setRead(true);
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
        setUnconfirmed(false);
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

  const registrationKind =
    currentMatchContext?.event_status === 'cancelled'
      ? 'match_event_cancelled'
      : registrationNotificationKind(target.kind);
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
      ? matchRegistrationGroup(notificationRosterPosition(currentMatchContext))
      : null;
  const reserveBodyCopy =
    registrationKind === 'match_registration_reserve' && currentMatchContext
      ? reserveBody(currentMatchContext)
      : null;
  const hasError = targetError || readError;
  const isCommunityInvitation =
    initialTarget.kind === 'community_invitation' ||
    initialTarget.target_status === 'invitation_available' ||
    target.kind === 'community_invitation';
  const invitationState =
    target.target_status === 'invitation_available'
      ? 'available'
      : isCommunityInvitation && target.target_status === 'unavailable'
        ? 'unavailable'
        : isCommunityInvitation && target.target_status === 'membership_available'
          ? target.membership_status === 'active'
            ? 'active'
            : 'pending'
          : null;
  // The body line for a match notification, chosen from the kind; null renders no paragraph.
  function matchBodyText(context: MatchNotificationContext): string | null {
    if (target.kind === 'match_event_published')
      return t('notifications.match.publishedBy', { name: context.creator_display_name });
    if (target.kind === 'match_event_invitation')
      return t('notifications.match.invitedBy', { name: context.creator_display_name });
    switch (registrationKind) {
      case null:
        return t('notifications.generic');
      case 'match_registration_requested':
        return t('notifications.match.registrationRequestBody', {
          name: context.requester_display_name ?? '',
          event: context.venue
        });
      case 'match_registration_approved':
        if (!approvedVariant || !approvedAt) return null;
        return approvedVariant.participation === 'playing'
          ? t('notifications.match.registrationApprovedPlayingBody', {
              group: approvedVariant.group,
              event: context.venue,
              time: approvedAt
            })
          : t('notifications.match.registrationApprovedReserveBody', {
              position: approvedVariant.position,
              event: context.venue,
              time: approvedAt
            });
      case 'match_registration_playing':
        return fifoGroup === null
          ? null
          : t('notifications.match.registrationPlayingBody', {
              group: fifoGroup,
              event: context.venue
            });
      case 'match_registration_reserve':
        return reserveBodyCopy ? t(reserveBodyCopy.key, reserveBodyCopy.values) : null;
      case 'match_registration_promoted':
        return fifoGroup === null
          ? null
          : t('notifications.match.registrationPromotedBody', { group: fifoGroup });
      case 'match_registration_quartet_complete':
        return fifoGroup === null
          ? null
          : t('notifications.match.registrationQuartetCompleteBody', {
              group: fifoGroup,
              event: context.venue
            });
      case 'match_invitation_accepted':
        return t('notifications.match.invitationAcceptedBody');
      case 'match_invitation_declined':
        return t('notifications.match.invitationDeclinedBody');
      case 'match_registration_withdrawn':
        return t('notifications.match.registrationWithdrawnBody');
      case 'match_registration_removed':
        return t('notifications.match.registrationRemovedBody');
      case 'match_registration_group_changed':
        return t('notifications.match.registrationGroupChangedBody');
      case 'match_event_ownership_transferred':
        return t('notifications.match.ownershipTransferredBody');
      case 'match_reconfirmation_required':
        return t('notifications.match.reconfirmationRequiredBody');
      case 'match_registration_reconfirmed':
        return t('notifications.match.reconfirmedBody');
      case 'match_reconfirmation_expired':
        return t('notifications.match.reconfirmationExpiredBody');
      case 'match_event_updated':
        return t('notifications.match.updatedBody');
      case 'match_event_cancelled':
        return t('notifications.match.cancelledBody');
      case 'match_invitation_expired':
        return t('notifications.match.invitationExpiredBody');
      case 'match_registration_expired':
        return t('notifications.match.registrationExpiredBody');
      case 'match_registration_not_playing':
        return t('notifications.match.registrationNotPlayingBody');
      default:
        return t('notifications.match.registrationRejectedBody', { event: context.venue });
    }
  }
  const matchBody = currentMatchContext ? matchBodyText(currentMatchContext) : null;
  const liveRegion = (
    <output aria-live="polite">
      {isOnline === false
        ? t('notifications.offline')
        : announcement
          ? t(`notifications.${announcement}`)
          : ''}
    </output>
  );
  const unconfirmedAlert = unconfirmed && <p role="alert">{t('pwa.offline.unconfirmed')}</p>;
  if (invitationState)
    return (
      <main
        {...stylex.props(styles.page, invitationStyles.page)}
        data-community-invitation={invitationState}
        data-route-chrome="navigation"
      >
        <header {...stylex.props(invitationStyles.header)}>
          {t('communityInvites.detailLabel')}
        </header>
        {liveRegion}
        {unconfirmedAlert}
        <section {...stylex.props(invitationStyles.content)}>
          {invitationState === 'unavailable' ? (
            <>
              <h1 {...stylex.props(invitationStyles.title)}>
                {t('notifications.targetUnavailable')}
              </h1>
              <SurfaceCard xstyle={invitationStyles.notice}>
                <p {...stylex.props(invitationStyles.body)}>
                  {t('communityInvites.unavailableHelp')}
                </p>
              </SurfaceCard>
            </>
          ) : (
            <>
              <span
                aria-hidden="true"
                {...stylex.props(
                  invitationStyles.glyph,
                  invitationState === 'pending' && invitationStyles.pendingGlyph
                )}
              >
                {invitationState === 'pending'
                  ? '◷'
                  : Array.from(target.community_name ?? '')[0]?.toLocaleUpperCase(i18n.language)}
              </span>
              <h1 {...stylex.props(invitationStyles.title)}>
                {invitationState === 'pending'
                  ? t('communityInvites.pendingTitle')
                  : target.community_name}
              </h1>
              {invitationState === 'available' && (
                <div>
                  <StatusBadge tone="muted">
                    {t('communityInvites.memberCountUnavailable')}
                  </StatusBadge>
                </div>
              )}
              <p {...stylex.props(invitationStyles.body)}>
                {t(
                  invitationState === 'available'
                    ? 'notifications.invitationContext'
                    : invitationState === 'active'
                      ? 'notifications.activeMembership'
                      : 'notifications.pendingMembership'
                )}
              </p>
              {(invitationState === 'available' || invitationState === 'pending') && (
                <SurfaceCard xstyle={invitationStyles.notice}>
                  <p {...stylex.props(invitationStyles.body)}>
                    {t(
                      invitationState === 'pending'
                        ? 'communityInvites.pendingHelp'
                        : 'communityInvites.approvalNotice'
                    )}
                  </p>
                </SurfaceCard>
              )}
            </>
          )}
          {invitationState !== 'unavailable' && hasError && !unconfirmed && (
            <p role="alert">{t('notifications.targetError')}</p>
          )}
          <footer {...stylex.props(invitationStyles.actions)}>
            {invitationState === 'available' && !accepted && (
              <Button
                busy={pending}
                disabled={pending || isOnline !== true}
                onClick={() => void accept()}
              >
                {pending ? t('notifications.accepting') : t('notifications.accept')}
              </Button>
            )}
            {target.target_status === 'membership_available' && target.community_id && (
              <a href={'/community/' + target.community_id} {...stylex.props(styles.link)}>
                {t('notifications.openTarget')}
              </a>
            )}
            {invitationState !== 'unavailable' && hasError && (
              <Button
                variant="secondary"
                busy={pending}
                disabled={pending || isOnline !== true}
                onClick={() => void retry()}
              >
                {t('notifications.retry')}
              </Button>
            )}
            <Link {...stylex.props(styles.link)} to="/notifications">
              {t('notifications.back')}
            </Link>
          </footer>
        </section>
      </main>
    );

  const glyph = notificationGlyph(
    target.level_review_context
      ? `level_review_${target.level_review_context.outcome}`
      : (target.result_context?.notification_kind ?? target.kind ?? ''),
    target.target_status === 'result_available'
      ? 'results'
      : target.target_status === 'match_available'
        ? 'matches'
        : target.target_status === 'level_review_available'
          ? 'rankings'
          : 'community'
  );
  const feedback = (
    <>
      {hasError && !unconfirmed && (
        <p role="alert" {...stylex.props(detail.alert)}>
          {t('notifications.targetError')}
        </p>
      )}
      {hasError && (
        <Button
          variant="secondary"
          busy={pending}
          disabled={pending || isOnline !== true}
          onClick={() => void retry()}
        >
          {t('notifications.retry')}
        </Button>
      )}
    </>
  );
  return (
    <main {...stylex.props(detail.page)} data-route-chrome="navigation">
      <NotificationDetailTopBar />
      {liveRegion}
      {unconfirmedAlert}
      <section {...stylex.props(detail.content)}>
        <NotificationDetailMeta
          symbol={glyph.symbol}
          receivedAt={formatReceived(target.created_at, i18n.language, t('notifications.utc'))}
          read={read}
        />
        {target.target_status === 'destination_available' && target.destination_href ? (
          <>
            <h1 {...stylex.props(detail.title)}>{t('notifications.generic')}</h1>
            <a href={target.destination_href} {...stylex.props(detail.action)}>
              <NotificationDetailActionIcon />
              {t('notifications.openTarget')}
            </a>
          </>
        ) : target.target_status === 'level_review_available' && target.level_review_context ? (
          <>
            <NotificationLevelReviewOutcome context={target.level_review_context} />
            {feedback}
          </>
        ) : target.target_status === 'result_available' && target.result_context ? (
          <>
            <h1 {...stylex.props(detail.title)}>
              {t(`notifications.kinds.${target.result_context.notification_kind}`)}
            </h1>
            {correctionKinds.has(target.result_context.notification_kind) && (
              <p {...stylex.props(detail.body)}>
                {t(`notifications.result.kindBody.${target.result_context.notification_kind}`)}
              </p>
            )}
            {target.result_context.entry_ready ? (
              <p {...stylex.props(detail.body)}>
                {t('notifications.result.entryReady', { venue: target.result_context.venue })}
              </p>
            ) : (
              <SurfaceCard xstyle={detail.card}>
                <div {...stylex.props(detail.cardHeader)}>
                  <h2 {...stylex.props(detail.cardTitle)}>{t('notifications.result.cardTitle')}</h2>
                  <NotificationResultOutcome context={target.result_context} />
                </div>
                <p {...stylex.props(detail.note)}>
                  {[
                    target.result_context.venue,
                    formatStart(
                      target.result_context.starts_at,
                      target.result_context.timezone,
                      i18n.language
                    )
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <hr {...stylex.props(detail.divider)} />
                <p {...stylex.props(detail.note)}>
                  {t('notifications.result.group', {
                    number: target.result_context.group_number
                  })}{' '}
                  ·{' '}
                  {t('matches.results.versionLabel', {
                    version: target.result_context.proposal_version
                  })}
                </p>
                {target.result_context.score && (
                  <p {...stylex.props(detail.value)}>
                    {t('notifications.result.score', { score: target.result_context.score })}
                  </p>
                )}
                <p {...stylex.props(detail.note)}>
                  {t('notifications.result.submittedBy', {
                    name:
                      target.result_context.submitted_by_name ?? t('matches.results.unknownPlayer')
                  })}
                </p>
                {target.result_context.review_deadline_at && (
                  <p {...stylex.props(detail.note)}>
                    {t('notifications.result.deadline', {
                      deadline: new Intl.DateTimeFormat(i18n.language, {
                        dateStyle: 'medium',
                        timeStyle: 'short',
                        timeZone: target.result_context.timezone
                      }).format(new Date(target.result_context.review_deadline_at))
                    })}
                  </p>
                )}
                {!target.result_context.is_current && (
                  <p {...stylex.props(detail.note)}>
                    {t('notifications.result.historicalVersion', {
                      version: target.result_context.proposal_version
                    })}
                  </p>
                )}
              </SurfaceCard>
            )}
            {feedback}
            <a
              href={notificationResultHref(target.result_context)}
              {...stylex.props(detail.action)}
            >
              <NotificationDetailActionIcon />
              {t(
                target.result_context.entry_ready
                  ? 'notifications.result.openEvent'
                  : target.result_context.is_current
                    ? 'notifications.result.openResult'
                    : 'notifications.result.reviewCurrent'
              )}
            </a>
            {notificationRepairDiagnosticsHref(target.result_context) && (
              <a
                href={notificationRepairDiagnosticsHref(target.result_context) ?? undefined}
                {...stylex.props(detail.action)}
              >
                <NotificationDetailActionIcon />
                {t('notifications.result.openRepairs')}
              </a>
            )}
          </>
        ) : target.target_status === 'match_available' &&
          target.match_available &&
          target.match_event_id ? (
          <>
            <h1 {...stylex.props(detail.title)}>
              {registrationHeading(t, registrationKind, target.kind, fifoGroup)}
            </h1>
            {currentMatchContext ? (
              <>
                {matchBody && <p {...stylex.props(detail.body)}>{matchBody}</p>}
                <SurfaceCard xstyle={detail.card}>
                  <NotificationDetailRow
                    label={t('notifications.match.venue')}
                    value={currentMatchContext.venue}
                  />
                  <NotificationDetailRow
                    label={t('notifications.match.startsAt')}
                    value={formatStart(
                      currentMatchContext.scheduled_at,
                      currentMatchContext.timezone,
                      i18n.language
                    )}
                  />
                </SurfaceCard>
              </>
            ) : (
              <p {...stylex.props(detail.body)}>{t('notifications.match.unavailable')}</p>
            )}
            {feedback}
            <a
              href={`/matches/${encodeURIComponent(target.match_event_id)}`}
              {...stylex.props(detail.action)}
            >
              <NotificationDetailActionIcon />
              {t('notifications.match.openEvent')}
            </a>
          </>
        ) : target.target_status === 'unavailable' ? (
          <h1 {...stylex.props(detail.title)}>{t('notifications.targetUnavailable')}</h1>
        ) : (
          <>
            <h1 {...stylex.props(detail.title)}>{target.community_name}</h1>
            <p {...stylex.props(detail.body)}>
              {t(
                target.membership_status === 'active'
                  ? 'notifications.activeMembership'
                  : 'notifications.pendingMembership'
              )}
            </p>
            {feedback}
            {target.target_status === 'membership_available' && target.community_id && (
              <a href={'/community/' + target.community_id} {...stylex.props(detail.action)}>
                <NotificationDetailActionIcon />
                {t('notifications.openTarget')}
              </a>
            )}
          </>
        )}
      </section>
    </main>
  );
}
