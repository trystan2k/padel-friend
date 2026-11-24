import * as stylex from '@stylexjs/stylex';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { TopBar, TopBarAction } from '../../components/ui/TopBar';
import { MatchCompetitionBadge } from './MatchCompetitionBadge';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { MatchEditPage } from './MatchEditPage';
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
import type { ResultCorrectionsData } from './MatchResultCorrections';

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
  proposalsForbidden = false,
  corrections
}: {
  event: MatchEventDetail | null;
  loadError?: boolean;
  onRetry?: () => void | Promise<void>;
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
  corrections?: ResultCorrectionsData;
}) {
  const { t, i18n } = useTranslation();
  const editTrigger = useRef<HTMLButtonElement>(null);
  const [editing, setEditing] = useState(false);
  const wasEditing = useRef(false);
  // Leaving the edit page returns focus to its trigger (or the page heading when it is gone).
  useEffect(() => {
    if (wasEditing.current && !editing)
      (editTrigger.current ?? document.getElementById('match-detail-heading'))?.focus();
    wasEditing.current = editing;
  }, [editing]);
  const [asOf] = useState(() => Date.now());
  const [feedback, setFeedback] = useState<{ id: string; copied: boolean; failed: boolean } | null>(
    null
  );
  // The sticky action bar's mount point: the invitation controller renders Accept / Decline there (Fyhbv).
  const [actionBarSlot, setActionBarSlot] = useState<HTMLElement | null>(null);
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
  // The edit flow is a page of its own: persistent actions, no modal over the detail.
  if (editing && management && !unavailable)
    return (
      <MatchEditPage event={event} version={management.version} onClose={() => setEditing(false)} />
    );
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
        corrections={corrections}
      />
    );
  const resultEntry =
    management?.correction.available && event.is_past && event.status !== 'cancelled';
  const cancelled = event.status === 'cancelled';
  const levelRange =
    event.restriction_enabled && event.min_level !== null && event.max_level !== null
      ? `${event.min_level}–${event.max_level}`
      : null;
  // Roster-adjacent and lower-priority content. It renders after the hero and the registration
  // status/roster, and before the sticky registration action, wherever the panel is mounted.
  const lowerPanels = (
    <>
      {!cancelled && (
        <div {...stylex.props(shell.reserveRow)}>
          <span {...stylex.props(shell.reserveText)}>
            <span {...stylex.props(shell.reserveTitle)}>
              {t('matches.detail.hero.reserveQueue')}
            </span>
            <span {...stylex.props(shell.reserveNote)}>
              {t('matches.detail.hero.reserveQueueNote')}
            </span>
          </span>
          <span {...stylex.props(shell.reserveCount)}>{event.reserve_count}</span>
        </div>
      )}
      {management?.actions.remove.allowed && !cancelled && (
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
              registration && 'accepted_order' in registration ? registration.accepted_order : null
            }
            disabled={event.is_past || Date.parse(event.registration_cutoff_at) <= asOf}
            started={event.is_past}
          />
        </>
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
          {...stylex.props(s.button, managementStyles.editTrigger)}
          onClick={() => setEditing(true)}
        >
          {t('matches.management.edit.title')}
        </button>
      )}
      {isCreator && !cancelled && !unavailable && (
        <MatchRequestQueue
          eventId={eventId}
          queue={queue}
          minLevel={event.min_level}
          maxLevel={event.max_level}
          error={queueError}
          onRetry={onRetry}
        />
      )}
      {!cancelled && (
        <section
          aria-labelledby="match-participation-heading"
          {...stylex.props(shell.card, resultEntry && shell.resultParticipation)}
        >
          <h2 id="match-participation-heading" {...stylex.props(shell.title)}>
            {t('matches.detail.participation')}
          </h2>
          <p {...stylex.props(shell.note)}>
            {t('matches.detail.timezone')}: {zone}
          </p>
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
        {!cancelled && !callerAccepted && event.caller_eligibility === 'nonmember' && (
          <p>{t('matches.detail.guestApprovalRequired')}</p>
        )}
        {!cancelled && !callerAccepted && event.caller_eligibility === 'ranked_members_only' && (
          <p>{t('matches.detail.rankedMembersOnly')}</p>
        )}
        {!cancelled &&
          event.caller_eligibility === 'out_of_range' &&
          event.caller_requires_approval &&
          !callerAccepted && <p>{t('matches.detail.outOfRangeApprovalRequired')}</p>}
        {!cancelled && event.is_past && (
          <p {...stylex.props(shell.copy)}>
            {t('matches.detail.pastScheduled')} · {t('matches.detail.outcomeUnavailable')}
          </p>
        )}
      </section>
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
    </>
  );
  // An invited caller answers the invitation in the sticky bar, so no Join / request action competes with it.
  const invitationPending =
    invitation !== null && !cancelled && invitation.effective_status === 'pending';
  return (
    <main
      data-route-chrome="navigation"
      data-result-entry={resultEntry ? 'available' : undefined}
      {...stylex.props(stylex.defaultMarker(), shell.page)}
    >
      <TopBar
        title={t('matches.detail.barTitle')}
        headingId="match-detail-heading"
        back={{ to: '/matches', label: t('matches.back') }}
        trailing={
          <TopBarAction aria-label={t('matches.detail.share')} onClick={() => void share()}>
            {t('matches.detail.hero.shareHeader')}
          </TopBarAction>
        }
      />
      {copied && <output {...stylex.props(shell.shareStatus)}>{t('matches.detail.copied')}</output>}
      {shareError && (
        <p role="alert" {...stylex.props(shell.shareStatus)}>
          {t('matches.detail.copyFailed')}
        </p>
      )}
      <div {...stylex.props(shell.groups, resultEntry && shell.resultEntryPage)}>
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
        {cancelled && (
          <div {...stylex.props(shell.cancelledBadge)}>
            <StatusBadge>{t('matches.management.cancelled')}</StatusBadge>
          </div>
        )}
        {unavailable &&
          (!registration ||
            cancelled ||
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
        {invitation && !cancelled && (
          <MatchInvitationPanel
            key={event.event_id}
            eventId={event.event_id}
            invitation={invitation}
            timezone={event.timezone}
            pendingApproval={registration?.state === 'pending'}
            actionSlot={actionBarSlot}
          />
        )}
        {!cancelled && !unavailable && (
          <MatchReconfirmationPanel
            key={`${eventId}:${event.reconfirmation_generation ?? 0}`}
            event={event}
            registration={registration}
            participants={managementParticipants}
            isCreator={isCreator}
            change={management?.consent_change ?? null}
          />
        )}
        {/* D3: the public-guest frame JLqMT is reused for signed-in states only; this route stays under _protected. */}
        <section aria-labelledby="match-overview-heading" {...stylex.props(shell.hero)}>
          {event.photo_url !== null && (
            <img
              {...stylex.props(shell.image)}
              src={event.photo_url}
              alt={t('matches.card.photoAlt')}
            />
          )}
          <div {...stylex.props(shell.chips)}>
            <StatusBadge tone={event.event_type === 'competitive' ? 'positive' : 'neutral'}>
              {t(`matches.type.${event.event_type}`)}
            </StatusBadge>
            <MatchCompetitionBadge event={event} />
            <StatusBadge>{t(`matches.detail.visibility.${event.visibility}`)}</StatusBadge>
          </div>
          <div {...stylex.props(shell.heroBody)}>
            <h2 id="match-overview-heading" {...stylex.props(shell.title, shell.venue)}>
              {venue}
            </h2>
            <p {...stylex.props(shell.schedule)}>
              {new Intl.DateTimeFormat(i18n.language, {
                dateStyle: 'full',
                timeStyle: 'short',
                timeZone: zone
              }).format(new Date(typeof event.starts_at === 'string' ? event.starts_at : ''))}
            </p>
            <a
              href={event.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              {...stylex.props(shell.maps)}
              aria-label={t('matches.detail.viewCourtLocationFor', { venue })}
            >
              {t('matches.detail.viewCourtLocation')}
            </a>
            {event.notes !== null && (
              <p {...stylex.props(shell.copy)}>
                {t('matches.card.notes')}: {event.notes}
              </p>
            )}
            {event.court_notes !== null && (
              <p {...stylex.props(shell.copy)}>
                {t('matches.detail.courtNotes')}: {event.court_notes}
              </p>
            )}
            {event.payment_note !== null && (
              <p {...stylex.props(shell.copy)}>
                {t('matches.detail.paymentNote')}: {event.payment_note}
              </p>
            )}
          </div>
        </section>
        {!cancelled && (
          <div {...stylex.props(shell.metrics)}>
            <div {...stylex.props(shell.metric)}>
              <p {...stylex.props(shell.metricValue)}>
                {event.maximum_registrations == null
                  ? event.playing_count
                  : `${event.playing_count}/${event.maximum_registrations}`}
              </p>
              <p {...stylex.props(shell.metricLabel)}>
                {t('matches.counts.playing', { count: event.playing_count })}
              </p>
            </div>
            <div {...stylex.props(shell.metric)}>
              <p {...stylex.props(shell.metricValue)}>
                {levelRange ?? t('matches.detail.hero.anyLevel')}
              </p>
              <p {...stylex.props(shell.metricLabel)}>{t('matches.detail.hero.level')}</p>
            </div>
            {price && (
              <div {...stylex.props(shell.metric)}>
                <p {...stylex.props(shell.metricValue)}>{price}</p>
                <p {...stylex.props(shell.metricLabel)}>{t('matches.detail.hero.perPlayer')}</p>
              </div>
            )}
          </div>
        )}
        {registrationError ? (
          <>
            <section
              role="alert"
              aria-labelledby="match-registration-error-heading"
              {...stylex.props(shell.card)}
            >
              <h2 id="match-registration-error-heading" {...stylex.props(shell.title)}>
                {t('matchRegistration.loadError.title')}
              </h2>
              <p {...stylex.props(shell.copy)}>{t('matchRegistration.loadError.body')}</p>
              <Button onClick={onRetry}>{t('matchRegistration.loadError.retry')}</Button>
            </section>
            {lowerPanels}
          </>
        ) : registration && !cancelled ? (
          <MatchRegistrationPanel
            event={event}
            registration={registration}
            callerLevel={callerLevel}
            roster={roster}
            unavailable={unavailable}
            isOrganizer={isCreator}
            showRoster={!management?.actions.remove.allowed}
            invitationPending={invitationPending}
          >
            {lowerPanels}
          </MatchRegistrationPanel>
        ) : (
          lowerPanels
        )}
        {invitationPending && <div ref={setActionBarSlot} {...stylex.props(shell.barSlot)} />}
      </div>
    </main>
  );
}
