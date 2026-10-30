import * as stylex from '@stylexjs/stylex';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { MatchEditDialog } from './MatchEditDialog';
import { MatchReconfirmationPanel } from './MatchReconfirmationPanel';
import { useTranslation } from 'react-i18next';
import { MatchRegistrationPanel } from './MatchRegistrationPanel';
import { MatchInvitationPanel } from './MatchInvitationPanel';
import { MatchRosterCard } from './MatchRosterCard';
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
import { matchDetailShellStyles as shell } from './match-detail-shell.styles';
import { matchManagementStyles as managementStyles } from './match-management.styles';
import { MatchStatusBanner } from './MatchStatusBanner';
import { MatchResultDetail } from './MatchResultDetail';
import type { ResultProposal } from './match-result-model';

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
  management = null,
  proposals = [],
  proposalsError = false,
  proposalsForbidden = false
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
  proposals?: ResultProposal[];
  proposalsError?: boolean;
  proposalsForbidden?: boolean;
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
  const unavailable =
    event.status === 'cancelled' ? 'cancelled' : managementUnavailableReason(management);
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
  if (
    (proposals.length > 0 || (event.result_summary.expected_group_count > 0 && event.is_past)) &&
    event.status !== 'cancelled' &&
    !proposalsForbidden
  )
    return (
      <MatchResultDetail
        event={event}
        proposals={proposals}
        canRecord={management?.correction.available === true}
        onRefresh={onRetry}
        proposalsError={proposalsError}
      />
    );
  const resultEntry =
    management?.correction.available && event.is_past && event.status !== 'cancelled';
  return (
    <main
      data-result-entry={resultEntry ? 'available' : undefined}
      {...stylex.props(stylex.defaultMarker(), s.page, shell.page)}
    >
      <header {...stylex.props(shell.header)}>
        <Link to="/matches" aria-label={t('matches.back')} {...stylex.props(shell.back)}>
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            aria-hidden="true"
            {...stylex.props(shell.icon)}
          >
            <path d="m14 6-6 6 6 6" />
          </svg>
        </Link>
        <div {...stylex.props(shell.heading)}>
          <h1
            id="match-detail-heading"
            tabIndex={-1}
            {...stylex.props(s.title, resultEntry && shell.resultEntryTitle)}
          >
            {t('matches.detail.title')}
          </h1>
          <p {...stylex.props(shell.subtitle)}>
            {venue} · {t(`matches.detail.visibility.${event.visibility}`)}
          </p>
        </div>
      </header>
      <div {...stylex.props(shell.groups)}>
        {resultEntry && management?.correction.available && (
          <Link
            to="/matches/$eventId/record"
            params={{ eventId: management.correction.event_id }}
            search={{ correctionProposalId: undefined, groupNumber: undefined }}
            {...stylex.props(s.primaryAction)}
          >
            {t('matches.results.title')}
          </Link>
        )}
        {proposalsError && (
          <section role="alert">
            <p>{t('matches.results.errors.unavailable')}</p>
            <button type="button" {...stylex.props(s.button)} onClick={onRetry}>
              {t('matches.results.reload')}
            </button>
          </section>
        )}
        {event.status === 'cancelled' && (
          <div {...stylex.props(shell.cancelledBadge)}>
            <StatusBadge>{t('matches.management.cancelled')}</StatusBadge>
          </div>
        )}
        {unavailable &&
          (!registration ||
            event.status === 'cancelled' ||
            unavailable === 'closed' ||
            (management && (unavailable === 'started' || unavailable === 'result_protected'))) &&
          (unavailable === 'closed' ||
          unavailable === 'started' ||
          unavailable === 'cancelled' ||
          unavailable === 'result_protected' ? (
            <MatchStatusBanner variant={unavailable} />
          ) : (
            <MatchManagementUnavailable reason={unavailable} />
          ))}
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
            {...stylex.props(s.button, managementStyles.editTrigger)}
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
        {invitation && event.status !== 'cancelled' && (
          <MatchInvitationPanel
            key={event.event_id}
            eventId={event.event_id}
            invitation={invitation}
            timezone={event.timezone}
            pendingApproval={registration?.state === 'pending'}
          />
        )}
        {event.status !== 'cancelled' && !unavailable && (
          <MatchReconfirmationPanel
            key={`${eventId}:${event.reconfirmation_generation ?? 0}`}
            event={event}
            registration={registration}
            participants={managementParticipants}
            isCreator={isCreator}
          />
        )}
        <section aria-labelledby="match-overview-heading" {...stylex.props(shell.card)}>
          <h2 id="match-overview-heading" {...stylex.props(shell.title, shell.venue)}>
            {venue}
          </h2>
          {event.photo_url !== null && (
            <img
              {...stylex.props(s.image, shell.image)}
              src={event.photo_url}
              alt={t('matches.card.photoAlt')}
            />
          )}
          <p {...stylex.props(shell.copy)}>
            {new Intl.DateTimeFormat(i18n.language, {
              dateStyle: 'full',
              timeStyle: 'short',
              timeZone: zone
            }).format(new Date(typeof event.starts_at === 'string' ? event.starts_at : ''))}{' '}
            ·<br />
            {t('matches.detail.timezone')}: {zone}
          </p>
          <a
            href={event.maps_url}
            target="_blank"
            rel="noopener noreferrer"
            {...stylex.props(s.link, s.cardLink, shell.maps)}
            aria-label={t('matches.detail.viewCourtLocationFor', { venue })}
          >
            {t('matches.detail.viewCourtLocation')}
          </a>
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
          <section
            aria-labelledby="match-participation-heading"
            {...stylex.props(shell.card, resultEntry && shell.resultParticipation)}
          >
            <h2 id="match-participation-heading" {...stylex.props(shell.title)}>
              {t('matches.detail.participation')}
            </h2>
            <h3 {...stylex.props(shell.participants, resultEntry && shell.resultCountLine)}>
              {t('matches.detail.participants')}
            </h3>
            {event.duration_minutes !== null && (
              <p {...stylex.props(shell.copy)}>
                {t('matches.detail.duration')}: {event.duration_minutes}
              </p>
            )}
            <p {...stylex.props(shell.accepted, resultEntry && shell.resultCountLine)}>
              {event.accepted_count} · {t('matches.detail.accepted')}
            </p>
            <p {...stylex.props(shell.copy)}>
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
              <p {...stylex.props(shell.copy)}>{t('matches.detail.creatorAccepted')}</p>
            )}
            {event.caller_is_invited && (
              <p {...stylex.props(shell.copy)}>{t('matches.detail.invitationInfo')}</p>
            )}
          </section>
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
            isOrganizer={isCreator}
            showRoster={!management?.actions.remove.allowed}
          />
        ) : null}
        {management?.actions.remove.allowed && event.status !== 'cancelled' && (
          <>
            {managementError && <p role="alert">{t('matches.management.errors.unavailable')}</p>}
            <MatchRosterCard
              eventId={eventId}
              roster={registration?.state === 'accepted' ? (roster ?? []) : []}
              participants={managementParticipants.filter(
                () =>
                  registration !== null &&
                  registration.state !== 'none' &&
                  (registration.state !== 'accepted' || registration.attempt_id !== undefined)
              )}
              callerOrder={
                registration && 'accepted_order' in registration
                  ? registration.accepted_order
                  : null
              }
              disabled={event.is_past || Date.parse(event.registration_cutoff_at) <= asOf}
              started={event.is_past}
            />
          </>
        )}
        {isCreator && event.status !== 'cancelled' && !unavailable && (
          <MatchRequestQueue
            eventId={eventId}
            queue={queue}
            minLevel={event.min_level}
            maxLevel={event.max_level}
            error={queueError}
            onRetry={onRetry}
          />
        )}
        <section aria-labelledby="match-eligibility-heading" {...stylex.props(shell.card)}>
          <h2 id="match-eligibility-heading" {...stylex.props(shell.title)}>
            {t('matches.detail.eligibilityVisibility')}
          </h2>
          <p {...stylex.props(shell.copy)}>
            {event.restriction_enabled && event.min_level !== null && event.max_level !== null
              ? `${t('matches.card.levelRange')}: ${event.min_level}–${event.max_level}`
              : t('matches.card.noLevelRestriction')}{' '}
            · {t(`matches.visibility.${event.visibility}`)}
          </p>
          <p {...stylex.props(shell.copy)}>
            {t(`matches.teamMode.${event.team_assignment_mode}`)} ·{' '}
            {event.maximum_registrations == null
              ? t('matches.detail.unlimitedRegistrations')
              : `${t('matches.card.maximum')}: ${event.maximum_registrations}`}
          </p>
          {!event.registration_open && (
            <p {...stylex.props(shell.copy)}>{t('matches.detail.registrationClosed')}</p>
          )}
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
            <p {...stylex.props(shell.copy)}>
              {t('matches.detail.pastScheduled')} · {t('matches.detail.outcomeUnavailable')}
            </p>
          )}
        </section>
        <button type="button" onClick={() => void share()} {...stylex.props(s.button, shell.share)}>
          {t('matches.detail.share')}
        </button>
        <label {...stylex.props(shell.shareField)}>
          {t('matches.detail.shareUrl')}
          <textarea
            {...stylex.props(s.input, shell.input)}
            readOnly
            rows={2}
            value={`/matches/${eventId}`}
            onFocus={(e) => e.currentTarget.select()}
            onCopy={(e) => {
              e.clipboardData.setData('text/plain', canonical);
              e.preventDefault();
            }}
          />
        </label>
        {copied && <output>{t('matches.detail.copied')}</output>}
        {shareError && <p role="alert">{t('matches.detail.copyFailed')}</p>}
      </div>
    </main>
  );
}
