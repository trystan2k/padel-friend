import * as stylex from '@stylexjs/stylex';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { MatchEditDialog } from './MatchEditDialog';
import { MatchReconfirmationPanel } from './MatchReconfirmationPanel';
import { useTranslation } from 'react-i18next';
import { MatchRegistrationPanel } from './MatchRegistrationPanel';
import { MatchInvitationPanel } from './MatchInvitationPanel';
import { MatchParticipantActions } from './MatchParticipantActions';
import { MatchOrganizerActions } from './MatchOrganizerActions';
import {
  MatchManagementUnavailable,
  managementUnavailableReason
} from './MatchManagementUnavailable';
import type { ManagementParticipant, MatchEventManagement } from './match-management-model';
import type { MatchInvitation } from './match-invitation-model';
import { MatchRequestQueue } from './MatchRequestQueue';
import type { MatchEventDetail } from './match-contracts';
import type {
  MatchRegistrationQueue,
  MatchRosterEntry,
  MyMatchRegistration
} from './match-registration-model';
import { matchesStyles as s } from './matches.styles';

export async function shareMatchLink(
  url: string,
  platform: Pick<Navigator, 'share' | 'clipboard'>
) {
  if (platform.share) {
    await platform.share({ url });
    return 'shared' as const;
  }
  if (!platform.clipboard) throw new Error('SHARE_UNAVAILABLE');
  await platform.clipboard.writeText(url);
  return 'copied' as const;
}

export function MatchDetailPage({
  event,
  loadError = false,
  onRetry = () => undefined,
  sharePlatform,
  registration = null,
  registrationError = false,
  callerLevel = null,
  isCreator = false,
  queue = null,
  queueError = false,
  roster = null,
  invitation = null,
  managementParticipants = [],
  managementError = false,
  management = null
}: {
  event: MatchEventDetail | null;
  loadError?: boolean;
  onRetry?: () => void;
  sharePlatform?: Pick<Navigator, 'share' | 'clipboard'>;
  registration?: MyMatchRegistration | null;
  registrationError?: boolean;
  callerLevel?: number | null;
  isCreator?: boolean;
  queue?: MatchRegistrationQueue | null;
  queueError?: boolean;
  roster?: MatchRosterEntry[] | null;
  invitation?: MatchInvitation | null;
  managementParticipants?: ManagementParticipant[];
  managementError?: boolean;
  management?: MatchEventManagement | null;
}) {
  const { t, i18n } = useTranslation();
  const editTrigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const [asOf] = useState(() => Date.now());
  const [feedback, setFeedback] = useState<{ id: string; copied: boolean; failed: boolean } | null>(
    null
  );
  const eventId = event?.event_id ?? '';
  const callerAccepted =
    registration?.state === 'accepted' || registration?.state === 'reconfirmation_required';
  const canonical =
    typeof window === 'undefined'
      ? `/matches/${eventId}`
      : new URL(`/matches/${eventId}`, window.location.origin).toString();
  const copied = feedback?.id === eventId && feedback.copied;
  const shareError = feedback?.id === eventId && feedback.failed;
  if (!event)
    return (
      <main {...stylex.props(s.page)}>
        {loadError ? (
          <section role="alert">
            <p>{t('matches.error')}</p>
            <button type="button" onClick={onRetry} {...stylex.props(s.button)}>
              {t('matches.retry')}
            </button>
          </section>
        ) : (
          <output>{t('matches.unavailable')}</output>
        )}
        <Link to="/matches" {...stylex.props(s.backLink)}>
          {t('matches.back')}
        </Link>
      </main>
    );
  const zone = event.timezone;
  const unavailable = managementUnavailableReason(management);
  const venue = event.venue_name;
  async function share() {
    setFeedback({ id: eventId, copied: false, failed: false });
    try {
      const platform = sharePlatform ?? (typeof window === 'undefined' ? null : window.navigator);
      if (!platform) throw new Error('SHARE_UNAVAILABLE');
      const result = await shareMatchLink(canonical, platform);
      setFeedback({ id: eventId, copied: result === 'copied', failed: false });
    } catch {
      setFeedback({ id: eventId, copied: false, failed: true });
    }
  }
  const price =
    event.price_minor !== null && event.currency !== null
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: event.currency
        }).format(event.price_minor / 100)
      : null;
  return (
    <main {...stylex.props(s.page)}>
      <Link to="/matches" {...stylex.props(s.link)}>
        {t('matches.back')}
      </Link>
      <h1 id="match-detail-heading" tabIndex={-1} {...stylex.props(s.title)}>
        {t('matches.detail.title')}: {venue}
      </h1>
      {event.status === 'cancelled' && (
        <StatusBadge>{t('matches.management.cancelled')}</StatusBadge>
      )}
      {unavailable && (!registration || event.status === 'cancelled') && (
        <MatchManagementUnavailable reason={unavailable} />
      )}
      {management && (!unavailable || unavailable === 'closed') && (
        <MatchOrganizerActions
          eventId={eventId}
          management={management}
          participants={managementParticipants}
        />
      )}
      {management?.actions.edit.allowed && (
        <button
          ref={editTrigger}
          type="button"
          {...stylex.props(s.button)}
          onClick={() => setEditing(true)}
        >
          {t('matches.management.edit.title')}
        </button>
      )}
      {editing && management && !unavailable && (
        <MatchEditDialog
          event={event}
          version={management.version}
          onClose={() => setEditing(false)}
          returnFocus={editTrigger}
        />
      )}
      <div {...stylex.props(s.detailGroups)}>
        {event.status !== 'cancelled' && !unavailable && (
          <MatchReconfirmationPanel
            key={`${eventId}:${event.reconfirmation_generation ?? 0}`}
            event={event}
            registration={registration}
            participants={managementParticipants}
            isCreator={isCreator}
          />
        )}
        <section aria-labelledby="match-overview-heading" {...stylex.props(s.detailGroup)}>
          <h2 id="match-overview-heading" {...stylex.props(s.sectionTitle)}>
            {t('matches.detail.overview')}
          </h2>
          {event.photo_url !== null && (
            <img
              {...stylex.props(s.image)}
              src={event.photo_url}
              alt={t('matches.card.photoAlt')}
            />
          )}
          <p>
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'full',
              timeStyle: 'short',
              timeZone: zone
            }).format(new Date(typeof event.starts_at === 'string' ? event.starts_at : ''))}{' '}
            · {t('matches.detail.timezone')}: {zone}
          </p>
          <p>
            <a
              href={event.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              {...stylex.props(s.cardLink)}
              aria-label={t('matches.card.openMaps', { venue })}
            >
              {venue}
            </a>
          </p>
          {price && (
            <p>
              {t('matches.card.pricePerPlayer')}: {price}
            </p>
          )}
          {event.notes !== null && (
            <p>
              {t('matches.card.notes')}: {event.notes}
            </p>
          )}
          {event.court_notes !== null && (
            <p>
              {t('matches.detail.courtNotes')}: {event.court_notes}
            </p>
          )}
          {event.payment_note !== null && (
            <p>
              {t('matches.detail.paymentNote')}: {event.payment_note}
            </p>
          )}
        </section>
        {event.status !== 'cancelled' && (
          <section aria-labelledby="match-participation-heading" {...stylex.props(s.detailGroup)}>
            <h2 id="match-participation-heading" {...stylex.props(s.sectionTitle)}>
              {t('matches.detail.participation')}
            </h2>
            <h3 {...stylex.props(s.sectionTitle)}>{t('matches.detail.participants')}</h3>
            {event.duration_minutes !== null && (
              <p>
                {t('matches.detail.duration')}: {event.duration_minutes}
              </p>
            )}
            <p>
              {event.accepted_count} · {t('matches.detail.accepted')}
            </p>
            <p>
              {event.playing_count}{' '}
              {t('matches.counts.playing', {
                count: event.playing_count
              })}{' '}
              · {event.reserve_count}{' '}
              {t('matches.counts.reserve', {
                count: event.reserve_count
              })}{' '}
              · {event.group_count}{' '}
              {t('matches.counts.groups', {
                count: event.group_count
              })}{' '}
              · {event.more_needed}{' '}
              {t('matches.counts.moreNeeded', {
                count: event.more_needed
              })}
            </p>
            {event.caller_badge === 'creator' && callerAccepted && (
              <p>{t('matches.detail.creatorAccepted')}</p>
            )}
            {event.caller_is_invited && <p>{t('matches.detail.invitationInfo')}</p>}
          </section>
        )}
        {management?.actions.remove.allowed && event.status !== 'cancelled' && (
          <section
            {...stylex.props(s.detailGroup)}
            aria-labelledby="match-participants-management-heading"
          >
            <h2 id="match-participants-management-heading" tabIndex={-1}>
              {t('matches.management.participants')}
            </h2>
            {managementError && <p role="alert">{t('matches.management.errors.unavailable')}</p>}
            {managementParticipants
              .filter(
                (participant) =>
                  registration !== null &&
                  registration.state !== 'none' &&
                  (registration.state !== 'accepted' || registration.attempt_id !== undefined) &&
                  participant.attempt_id !==
                    (registration?.state === 'accepted' ? registration.attempt_id : null)
              )
              .map((participant) => (
                <div key={participant.registration_id}>
                  <span>
                    {participant.display_name ?? t('matchRegistration.roster.playerFallback')}
                  </span>
                  <MatchParticipantActions
                    eventId={event.event_id}
                    attemptId={participant.attempt_id}
                    targetUserId={participant.user_id}
                    name={participant.display_name ?? undefined}
                    disabled={event.is_past || Date.parse(event.registration_cutoff_at) <= asOf}
                  />
                </div>
              ))}
          </section>
        )}
        {invitation && !unavailable && (
          <MatchInvitationPanel
            key={event.event_id}
            eventId={event.event_id}
            invitation={invitation}
            timezone={event.timezone}
            pendingApproval={registration?.state === 'pending'}
          />
        )}
        {registrationError ? (
          <section
            role="alert"
            aria-labelledby="match-registration-error-heading"
            {...stylex.props(s.detailGroup)}
          >
            <h2 id="match-registration-error-heading" {...stylex.props(s.sectionTitle)}>
              {t('matchRegistration.loadError.title')}
            </h2>
            <p>{t('matchRegistration.loadError.body')}</p>
            <button type="button" onClick={onRetry} {...stylex.props(s.button)}>
              {t('matchRegistration.loadError.retry')}
            </button>
          </section>
        ) : registration && event.status !== 'cancelled' ? (
          <MatchRegistrationPanel
            event={event}
            registration={registration}
            callerLevel={callerLevel}
            roster={roster}
            unavailable={unavailable}
          />
        ) : null}
        {isCreator && event.status !== 'cancelled' && !unavailable && (
          <MatchRequestQueue
            eventId={eventId}
            eventName={venue}
            queue={queue}
            minLevel={event.min_level}
            maxLevel={event.max_level}
            error={queueError}
            onRetry={onRetry}
          />
        )}
        <section aria-labelledby="match-eligibility-heading" {...stylex.props(s.detailGroup)}>
          <h2 id="match-eligibility-heading" {...stylex.props(s.sectionTitle)}>
            {t('matches.detail.eligibilityVisibility')}
          </h2>
          <p>
            {event.restriction_enabled && event.min_level !== null && event.max_level !== null
              ? `${t('matches.card.levelRange')}: ${event.min_level}–${event.max_level}`
              : t('matches.card.noLevelRestriction')}
          </p>
          <p>{t(`matches.teamMode.${event.team_assignment_mode}`)}</p>
          <p>
            {event.maximum_registrations == null
              ? t('matches.card.unlimited')
              : `${t('matches.card.maximum')}: ${event.maximum_registrations}`}
          </p>
          {!event.registration_open && <p>{t('matches.detail.registrationClosed')}</p>}
          <p>{t(`matches.visibility.${event.visibility}`)}</p>
          {event.status !== 'cancelled' &&
            !callerAccepted &&
            event.caller_eligibility === 'nonmember' && (
              <p>{t('matches.detail.guestApprovalRequired')}</p>
            )}
          {event.status !== 'cancelled' &&
            event.caller_eligibility === 'out_of_range' &&
            event.caller_requires_approval &&
            !callerAccepted && <p>{t('matches.detail.outOfRangeApprovalRequired')}</p>}
          {event.status !== 'cancelled' && event.is_past && (
            <>
              <p>{t('matches.detail.pastScheduled')}</p>
              <p>{t('matches.detail.outcomeUnavailable')}</p>
            </>
          )}
        </section>
      </div>
      <button type="button" onClick={() => void share()} {...stylex.props(s.button)}>
        {t('matches.detail.share')}
      </button>
      <label>
        {t('matches.detail.shareUrl')}
        <input
          {...stylex.props(s.input)}
          readOnly
          value={canonical}
          onFocus={(e) => e.currentTarget.select()}
        />
      </label>
      {copied && <output>{t('matches.detail.copied')}</output>}
      {shareError && <p role="alert">{t('matches.detail.copyFailed')}</p>}
    </main>
  );
}
