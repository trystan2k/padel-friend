import * as stylex from '@stylexjs/stylex';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { RosterRow } from '../../components/ui/RosterRow';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { matchEventCounts } from './match-model';
import type { MatchEventDetail } from './match-contracts';
import {
  matchRegistrationGroup,
  matchRegistrationReservePosition,
  type MatchRegistrationSource,
  type MatchRegistrationAction,
  type MatchRosterEntry,
  type MyMatchRegistration
} from './match-registration-model';
import { matchRegistrationErrorKey } from './match-registration-error-copy';
import { matchRegistrationStyles as s } from './match-registration.styles';
import {
  participationTone,
  registrationActionTone,
  registrationSourceTone,
  registrationStateTone
} from './match-status-tone';
import { useMatchRegistration } from './use-match-registration';
import { MatchParticipantActions } from './MatchParticipantActions';

// PAF-5.5: the player's own registration area on the match detail screen.
// States: direct join, request, pending / approved / declined / expired, full
// capacity, closed and invited; plus the safe roster (the caller's own
// placement) and the authoritative counts. Full capacity and the closed state
// are explicit, separate states.

export type MatchRegistrationEvent = Pick<
  MatchEventDetail,
  | 'event_id'
  | 'registration_cutoff_at'
  | 'starts_at'
  | 'timezone'
  | 'accepted_count'
  | 'playing_count'
  | 'reserve_count'
  | 'reserve_not_playing_count'
  | 'group_count'
  | 'more_needed'
  | 'maximum_registrations'
  | 'is_past'
  | 'caller_eligibility'
  | 'caller_requires_approval'
  | 'caller_is_invited'
  | 'restriction_enabled'
  | 'min_level'
  | 'max_level'
  | 'visibility'
>;

export function matchRegistrationCutoffPassed(
  event: Pick<MatchRegistrationEvent, 'registration_cutoff_at'>,
  now: number
): boolean {
  const target = Date.parse(event.registration_cutoff_at);
  return Number.isFinite(target) && target <= now;
}

function eventCounts(event: MatchRegistrationEvent) {
  return matchEventCounts(event);
}

export function matchRegistrationIsFull(
  event: Pick<MatchRegistrationEvent, 'maximum_registrations' | 'accepted_count'>
): boolean {
  return (
    event.maximum_registrations !== null && event.accepted_count >= event.maximum_registrations
  );
}

// Smallest defensible eligibility gate: the server stays authoritative, this
// only chooses which CTA (or explicit blocked state) to present.
export function matchRegistrationAction(
  event: MatchRegistrationEvent,
  now: number
): MatchRegistrationAction {
  if (event.is_past || matchRegistrationCutoffPassed(event, now)) return 'closed';
  if (matchRegistrationIsFull(event)) return 'full';
  if (event.caller_is_invited && event.visibility === 'invite_only') return 'invited';
  const eligibility = event.caller_eligibility;
  if (event.caller_requires_approval) return 'request';
  if (eligibility === 'out_of_range' || eligibility === 'nonmember') return 'request';
  if (eligibility === 'member') return 'join';
  return 'none';
}

function sourceBadgeKey(source: MatchRegistrationSource): string {
  if (source === 'guest') return 'matchRegistration.badges.guest';
  if (source === 'creator') return 'matchRegistration.badges.creator';
  return 'matchRegistration.badges.member';
}

function relativeWhen(language: string, iso: string | null, now: number): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  const formatter = new Intl.RelativeTimeFormat(language, { numeric: 'auto' });
  const minutes = Math.round((target - now) / 60000);
  if (Math.abs(minutes) < 60) return formatter.format(minutes, 'minute');
  const hours = Math.round(minutes / 60);
  if (Math.abs(hours) < 24) return formatter.format(hours, 'hour');
  return formatter.format(Math.round(hours / 24), 'day');
}

function clockTime(language: string, iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  return new Intl.DateTimeFormat(language, { timeStyle: 'short', timeZone }).format(
    new Date(target)
  );
}

function cutoffLabel(language: string, iso: string | null, timeZone: string): string | null {
  if (!iso) return null;
  const target = Date.parse(iso);
  if (!Number.isFinite(target)) return null;
  return new Intl.DateTimeFormat(language, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone
  }).format(new Date(target));
}

function FeedbackOutput({ message }: { message: string | null }) {
  return (
    <output aria-live="polite" {...stylex.props(s.status)}>
      {message}
    </output>
  );
}

export function MatchRegistrationPanel({
  event,
  registration,
  callerLevel = null,
  roster = null
}: {
  event: MatchRegistrationEvent;
  registration: MyMatchRegistration;
  callerLevel?: number | null;
  roster?: MatchRosterEntry[] | null;
}) {
  const { t, i18n } = useTranslation();
  const eventId = event.event_id;
  const cutoffAt = event.registration_cutoff_at;
  const controller = useMatchRegistration({
    eventId,
    initialRegistration: registration,
    cutoffAt
  });
  const now = useState(() => Date.now())[0];
  const counts = eventCounts(event);
  const maximum = event.maximum_registrations;
  const timeZone = event.timezone;

  const feedbackMessage = (() => {
    const feedback = controller.feedback;
    if (!feedback) return null;
    if (feedback.kind === 'accepted') return t('matchRegistration.feedback.accepted');
    if (feedback.kind === 'pending') return t('matchRegistration.feedback.pending');
    if (feedback.kind === 'offline') return t('matchRegistration.feedback.offline');
    return t(matchRegistrationErrorKey(feedback.code));
  })();

  const remaining = maximum === null ? null : Math.max(0, maximum - counts.accepted);
  const capacity =
    remaining !== null && maximum !== null
      ? t('matchRegistration.join.capacity', { count: remaining, remaining, maximum })
      : null;

  const levelRange = (() => {
    if (!event.restriction_enabled) return null;
    const min = event.min_level;
    const max = event.max_level;
    if (min === null || max === null) return null;
    return callerLevel === null
      ? t('matchRegistration.join.levelRangeNoLevel', { min, max })
      : t('matchRegistration.join.levelRange', { min, max, level: callerLevel });
  })();

  const registrationAction = controller.cutoffReached
    ? 'closed'
    : matchRegistrationAction(event, now);
  // An active member may be eligible by level but still needs an invite for an
  // invite-only event. An invited caller requiring approval cannot submit a
  // request to an invite-only event, so preserve the invitation-only state there too.
  const invitedWithoutRegistration =
    registration.state === 'none' &&
    event.caller_is_invited &&
    event.visibility === 'invite_only' &&
    (registrationAction === 'join' ||
      (registrationAction === 'request' && event.caller_requires_approval));
  const action = invitedWithoutRegistration ? 'invited' : registrationAction;

  // An invited caller has no registration row yet, so this panel has no place to
  // show. The invitation sentence is owned by the detail page's participation
  // section (matches.detail.invitationInfo); repeating it here would render the
  // same user-facing paragraph twice on one screen. Render nothing instead.
  if (registration.state === 'none' && action === 'invited') return null;

  const submitButton = (label: string, disabled: boolean) => (
    <button
      type="button"
      onClick={controller.submit}
      disabled={disabled}
      aria-busy={controller.pending || undefined}
      {...stylex.props(s.primaryButton, disabled && s.disabledButton)}
    >
      {label}
    </button>
  );

  const rosterCount = (value: number) => t('matchRegistration.roster.count', { count: value });

  const rosterBlock = (() => {
    if (registration.state !== 'accepted') return null;

    // Real accepted roster (frame xC04T): the ordered accepted players grouped
    // by quartet, then the reserve queue, then the not-playing tail. The caller
    // is highlighted by matching the immutable accepted_order, so no user id is
    // ever needed on the wire.
    if (roster && roster.length > 0) {
      const callerOrder = registration.accepted_order;
      const playingGroups = new Map<number, MatchRosterEntry[]>();
      const reserveEntries: MatchRosterEntry[] = [];
      const notPlayingEntries: MatchRosterEntry[] = [];
      for (const entry of roster) {
        if (entry.participation === 'playing') {
          const group = entry.group_number ?? 1;
          const list = playingGroups.get(group) ?? [];
          list.push(entry);
          playingGroups.set(group, list);
        } else if (entry.participation === 'reserve') {
          reserveEntries.push(entry);
        } else {
          notPlayingEntries.push(entry);
        }
      }

      const renderEntry = (entry: MatchRosterEntry) => {
        const isCaller = entry.accepted_order === callerOrder;
        const tone = participationTone[entry.participation];
        const participationBadge =
          entry.participation === 'playing'
            ? t('matchRegistration.badges.playing')
            : entry.participation === 'reserve'
              ? t('matchRegistration.badges.reserve')
              : t('matchRegistration.badges.reserveNotPlaying');
        const name = isCaller
          ? t('matchRegistration.roster.you')
          : (entry.display_name ?? t('matchRegistration.roster.playerFallback'));
        return (
          <RosterRow key={entry.accepted_order} name={name} highlighted={isCaller}>
            {entry.display_level !== null && (
              <span {...stylex.props(s.meta)}>
                {t('matchRegistration.roster.level', { level: entry.display_level })}
              </span>
            )}
            <StatusBadge tone={tone}>{participationBadge}</StatusBadge>
            {(isCaller || entry.registration_source === 'guest') && (
              <StatusBadge tone={registrationSourceTone[entry.registration_source]}>
                {t(sourceBadgeKey(entry.registration_source))}
              </StatusBadge>
            )}
            {entry.participation !== 'playing' && entry.reserve_position !== null && (
              <span {...stylex.props(s.meta)}>
                {t('matchRegistration.roster.position', { position: entry.reserve_position })}
              </span>
            )}
          </RosterRow>
        );
      };

      return (
        <section aria-label={t('matchRegistration.aria.roster')} {...stylex.props(s.roster)}>
          {[...playingGroups.entries()].map(([group, list]) => (
            <div key={`group-${group}`} {...stylex.props(s.rosterSection)}>
              <h3 {...stylex.props(s.rosterTitle)}>
                {t('matchRegistration.roster.groupTitle', { group })}
              </h3>
              <p {...stylex.props(s.meta)}>{rosterCount(list.length)}</p>
              {list.map(renderEntry)}
            </div>
          ))}
          {reserveEntries.length > 0 && (
            <div {...stylex.props(s.rosterSection)}>
              <h3 {...stylex.props(s.rosterTitle)}>{t('matchRegistration.roster.reserveTitle')}</h3>
              <p {...stylex.props(s.meta)}>{t('matchRegistration.roster.fifo')}</p>
              <p {...stylex.props(s.meta)}>{rosterCount(reserveEntries.length)}</p>
              {reserveEntries.map(renderEntry)}
            </div>
          )}
          {notPlayingEntries.length > 0 && (
            <div {...stylex.props(s.rosterSection)}>
              <h3 {...stylex.props(s.rosterTitle)}>
                {t('matchRegistration.roster.notPlayingTitle')}
              </h3>
              <p {...stylex.props(s.meta)}>{rosterCount(notPlayingEntries.length)}</p>
              {notPlayingEntries.map(renderEntry)}
            </div>
          )}
          <p {...stylex.props(s.note)}>{t('matchRegistration.roster.orderNote')}</p>
          <p {...stylex.props(s.note)}>{t('matchRegistration.roster.authoritativeNote')}</p>
        </section>
      );
    }

    // Fallback: the caller's own placement row when the roster read is empty or
    // unavailable. This is the pre-roster behaviour, preserved.
    const participation = registration.participation;
    const group = matchRegistrationGroup(registration.position);
    const reservePosition = matchRegistrationReservePosition(registration.position, counts.playing);
    const title =
      participation === 'playing'
        ? t('matchRegistration.roster.groupTitle', { group })
        : participation === 'reserve'
          ? t('matchRegistration.roster.reserveTitle')
          : t('matchRegistration.roster.notPlayingTitle');
    const participationBadge =
      participation === 'playing'
        ? t('matchRegistration.badges.playing')
        : participation === 'reserve'
          ? t('matchRegistration.badges.reserve')
          : t('matchRegistration.badges.reserveNotPlaying');
    const tone = participationTone[participation];
    const sectionCount =
      participation === 'playing'
        ? counts.playing
        : participation === 'reserve'
          ? counts.reserve
          : counts.reserveNotPlaying;
    return (
      <section aria-label={t('matchRegistration.aria.roster')} {...stylex.props(s.roster)}>
        <div {...stylex.props(s.rosterSection)}>
          <h3 {...stylex.props(s.rosterTitle)}>{title}</h3>
          {participation === 'reserve' && (
            <p {...stylex.props(s.meta)}>{t('matchRegistration.roster.fifo')}</p>
          )}
          <p {...stylex.props(s.meta)}>{rosterCount(sectionCount)}</p>
          <RosterRow name={t('matchRegistration.roster.you')} highlighted>
            <StatusBadge tone={tone}>{participationBadge}</StatusBadge>
            <StatusBadge tone={registrationSourceTone[registration.registration_source]}>
              {t(sourceBadgeKey(registration.registration_source))}
            </StatusBadge>
            {participation === 'reserve' && reservePosition !== null && (
              <span {...stylex.props(s.meta)}>
                {t('matchRegistration.roster.position', { position: reservePosition })}
              </span>
            )}
          </RosterRow>
        </div>
        <p {...stylex.props(s.note)}>{t('matchRegistration.roster.orderNote')}</p>
        <p {...stylex.props(s.note)}>{t('matchRegistration.roster.authoritativeNote')}</p>
      </section>
    );
  })();

  let body: ReactNode;
  if (registration.state === 'accepted') {
    const participation = registration.participation;
    const group = matchRegistrationGroup(registration.position);
    const reservePosition = matchRegistrationReservePosition(registration.position, counts.playing);
    // PAF-5 review F27: only an organizer decision carries `approved_at`. A
    // direct join (or the creator's own slot) must not borrow the approval badge
    // or an "Approved at …" sentence with a timestamp that does not exist.
    const approvedWhen = clockTime(i18n.language, registration.approved_at, timeZone);
    const isCreatorSlot = registration.registration_source === 'creator';
    const isApproved = !isCreatorSlot && approvedWhen !== null;
    const joinedWhen = clockTime(i18n.language, registration.accepted_at, timeZone) ?? '';
    const badgeLabel =
      participation === 'playing'
        ? isCreatorSlot
          ? t('matchRegistration.request.createdPlayingBadge', { group })
          : isApproved
            ? t('matchRegistration.request.approvedPlayingBadge', { group })
            : t('matchRegistration.request.joinedPlayingBadge', { group })
        : participation === 'reserve'
          ? isCreatorSlot
            ? t('matchRegistration.request.createdReserveBadge', { position: reservePosition })
            : isApproved
              ? t('matchRegistration.request.approvedReserveBadge', { position: reservePosition })
              : t('matchRegistration.request.joinedReserveBadge', { position: reservePosition })
          : t('matchRegistration.badges.reserveNotPlaying');
    const tone = participationTone[participation];
    const copy =
      participation === 'playing'
        ? isCreatorSlot
          ? t('matchRegistration.request.createdPlayingCopy')
          : isApproved
            ? t('matchRegistration.request.approvedPlayingCopy', { when: approvedWhen })
            : t('matchRegistration.request.joinedPlayingCopy', { when: joinedWhen })
        : participation === 'reserve'
          ? isCreatorSlot
            ? t('matchRegistration.request.createdReserveCopy')
            : isApproved
              ? t('matchRegistration.request.approvedReserveCopy', { when: approvedWhen })
              : t('matchRegistration.request.joinedReserveCopy', { when: joinedWhen })
          : t('matchRegistration.closed.detail');
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <StatusBadge tone={tone}>{badgeLabel}</StatusBadge>
        </div>
        <p {...stylex.props(s.copy)}>{copy}</p>
        <div {...stylex.props(s.actions)}>
          <Link to="/matches/$eventId" params={{ eventId }} {...stylex.props(s.link)}>
            {participation === 'playing'
              ? t('matchRegistration.request.viewGroup')
              : t('matchRegistration.request.viewMatch')}
          </Link>
        </div>
        <FeedbackOutput message={feedbackMessage} />
        {registration.attempt_id && (
          <MatchParticipantActions
            key={`${eventId}:${registration.attempt_id}`}
            eventId={eventId}
            attemptId={registration.attempt_id}
            disabled={controller.cutoffReached || action === 'closed'}
          />
        )}
        {rosterBlock}
      </div>
    );
  } else if (registration.state === 'reconfirmation_required') {
    body = (
      <div {...stylex.props(s.body)}>
        <StatusBadge>{t('matches.reconfirmation.requiredBadge')}</StatusBadge>
        <p>
          {t('matches.reconfirmation.deadline', {
            deadline: cutoffLabel(i18n.language, registration.registration_cutoff_at, timeZone)
          })}
        </p>
        <MatchParticipantActions
          eventId={eventId}
          attemptId={registration.attempt_id}
          disabled={controller.cutoffReached || action === 'closed'}
        />
      </div>
    );
  } else if (registration.state === 'withdrawn' || registration.state === 'removed_by_creator') {
    body = (
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(s.copy)}>
          {t(
            registration.state === 'withdrawn'
              ? 'matches.management.withdrawn'
              : 'matches.management.removed'
          )}
        </p>
        {registration.removal_reason && (
          <p {...stylex.props(s.copy)}>
            {t('matches.management.removalReason', { reason: registration.removal_reason })}
          </p>
        )}
        {(action === 'join' || action === 'request' || action === 'invited') &&
          submitButton(t('matches.management.reenter'), controller.pending || !controller.online)}
        {action === 'closed' && <p>{t('matches.management.errors.closed')}</p>}
        {action === 'full' && <p>{t('matchRegistration.full.copy', { maximum })}</p>}
        <FeedbackOutput message={feedbackMessage} />
      </div>
    );
  } else if (registration.state === 'pending') {
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <StatusBadge tone={registrationStateTone.pending}>
            {t('matchRegistration.request.pendingBadge')}
          </StatusBadge>
        </div>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.request.pendingCopy')}</p>
        <p {...stylex.props(s.meta)}>
          {t('matchRegistration.request.pendingMeta', {
            when: relativeWhen(i18n.language, registration.requested_at, now)
          })}
        </p>
        <div {...stylex.props(s.actions)}>
          <Link to="/matches/$eventId" params={{ eventId }} {...stylex.props(s.link)}>
            {t('matchRegistration.request.viewMatch')}
          </Link>
        </div>
        <FeedbackOutput message={feedbackMessage} />
        <p {...stylex.props(s.note)}>{t('matchRegistration.request.note')}</p>
      </div>
    );
  } else if (registration.state === 'rejected') {
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <StatusBadge tone={registrationStateTone.rejected}>
            {t('matchRegistration.request.declinedBadge')}
          </StatusBadge>
        </div>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.request.declinedCopy')}</p>
        <div {...stylex.props(s.actions)}>
          {action === 'request' || action === 'join'
            ? submitButton(
                t('matchRegistration.request.requestAgain'),
                controller.pending || !controller.online
              )
            : null}
          <Link to="/matches/$eventId" params={{ eventId }} {...stylex.props(s.link)}>
            {t('matchRegistration.request.viewMatch')}
          </Link>
        </div>
        <FeedbackOutput message={feedbackMessage} />
        <p {...stylex.props(s.note)}>{t('matchRegistration.request.note')}</p>
      </div>
    );
  } else if (registration.state === 'expired') {
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <StatusBadge tone={registrationStateTone.expired}>
            {t('matchRegistration.request.expiredBadge')}
          </StatusBadge>
        </div>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.request.expiredCopy')}</p>
        <div {...stylex.props(s.actions)}>
          <Link to="/matches/$eventId" params={{ eventId }} {...stylex.props(s.link)}>
            {t('matchRegistration.request.viewMatchHistory')}
          </Link>
        </div>
        <FeedbackOutput message={feedbackMessage} />
        <p {...stylex.props(s.note)}>{t('matchRegistration.request.note')}</p>
      </div>
    );
  } else if (action === 'closed') {
    const cutoff = cutoffLabel(i18n.language, cutoffAt, timeZone);
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <StatusBadge tone={registrationActionTone.closed}>
            {t('matchRegistration.closed.badge')}
          </StatusBadge>
        </div>
        <p {...stylex.props(s.meta)}>{t('matchRegistration.closed.detail')}</p>
        <p {...stylex.props(s.counts)}>
          {t('matchRegistration.closed.rosterCount', {
            playing: counts.playing,
            reserveNotPlaying: counts.reserveNotPlaying
          })}
        </p>
        <section
          aria-label={t('matchRegistration.closed.sectionTitle')}
          {...stylex.props(s.rosterSection)}
        >
          <h3 {...stylex.props(s.rosterTitle)}>{t('matchRegistration.closed.sectionTitle')}</h3>
          <p {...stylex.props(s.meta)}>{rosterCount(counts.reserveNotPlaying)}</p>
        </section>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.closed.copy', { cutoff })}</p>
        <div {...stylex.props(s.actions)}>
          {submitButton(t('matchRegistration.closed.button'), true)}
        </div>
        <p {...stylex.props(s.note)}>{t('matchRegistration.closed.note')}</p>
      </div>
    );
  } else if (action === 'full') {
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <StatusBadge tone={registrationActionTone.full}>
            {t('matchRegistration.full.badge')}
          </StatusBadge>
        </div>
        <p {...stylex.props(s.meta)}>
          {t('matchRegistration.full.detail', { accepted: counts.accepted, maximum })}
        </p>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.full.copy', { maximum })}</p>
        <div {...stylex.props(s.actions)}>
          {submitButton(t('matchRegistration.full.button'), true)}
        </div>
        <FeedbackOutput message={feedbackMessage} />
        <p {...stylex.props(s.note)}>{t('matchRegistration.full.note')}</p>
      </div>
    );
  } else if (action === 'request') {
    body = (
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(s.copy)}>
          {event.caller_eligibility === 'nonmember'
            ? t('matches.detail.guestApprovalRequired')
            : t('matches.detail.outOfRangeApprovalRequired')}
        </p>
        <div {...stylex.props(s.actions)}>
          {submitButton(
            t('matchRegistration.join.requestButton'),
            controller.pending || !controller.online
          )}
        </div>
        {capacity && <p {...stylex.props(s.meta)}>{capacity}</p>}
        {levelRange && <p {...stylex.props(s.meta)}>{levelRange}</p>}
        <FeedbackOutput message={feedbackMessage} />
        <p {...stylex.props(s.note)}>{t('matchRegistration.join.requestNote')}</p>
      </div>
    );
  } else if (action === 'join') {
    body = (
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(s.copy)}>{t('matchRegistration.join.openCopy')}</p>
        <div {...stylex.props(s.actions)}>
          {submitButton(
            t('matchRegistration.join.button'),
            controller.pending || !controller.online
          )}
        </div>
        {capacity && <p {...stylex.props(s.meta)}>{capacity}</p>}
        {levelRange && <p {...stylex.props(s.meta)}>{levelRange}</p>}
        <FeedbackOutput message={feedbackMessage} />
        <p {...stylex.props(s.note)}>{t('matchRegistration.join.note')}</p>
      </div>
    );
  } else {
    body = (
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(s.counts)}>
          {counts.accepted} {t('matches.detail.accepted')}
        </p>
        <FeedbackOutput message={feedbackMessage} />
      </div>
    );
  }

  const requester = registration.state !== 'none';
  return (
    <section aria-labelledby="match-registration-heading" {...stylex.props(s.panel)}>
      <header {...stylex.props(s.header)}>
        <h2 id="match-registration-heading" tabIndex={-1} {...stylex.props(s.title)}>
          {requester
            ? t('matchRegistration.request.back')
            : t('matchRegistration.join.sectionTitle')}
        </h2>
        {requester && <p {...stylex.props(s.meta)}>{t('matchRegistration.request.context')}</p>}
      </header>
      {body}
      {!controller.online && (
        <output aria-live="polite" {...stylex.props(s.status)}>
          {t('matchRegistration.feedback.offline')}
        </output>
      )}
    </section>
  );
}
