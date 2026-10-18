import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { getMatchParticipation, matchEventCounts, type MatchEventListItem } from './match-model';
import {
  matchRegistrationGroup,
  matchRegistrationReservePosition,
  type MatchRegistrationSource,
  type MatchRosterEntry,
  type MyMatchRegistration
} from './match-registration-model';
import { matchRegistrationStyles as s } from './match-registration.styles';
import { useMatchRegistration } from './use-match-registration';

// PAF-5.5: the player's own registration area on the match detail screen.
// States: direct join, request, pending / approved / declined / expired, full
// capacity, closed and invited; plus the safe roster (the caller's own
// placement) and the authoritative counts. Full capacity and the closed state
// are explicit, separate states.

type EventRecord = Record<string, unknown>;

function eventString(event: EventRecord, key: string): string | null {
  const value = event[key];
  return typeof value === 'string' && value.length > 0 ? value : null;
}
function eventNumber(event: EventRecord, key: string): number | null {
  const value = event[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function eventBoolean(event: EventRecord, key: string): boolean | null {
  const value = event[key];
  return typeof value === 'boolean' ? value : null;
}
function callerEligibility(event: EventRecord): string | null {
  const value = event.caller_eligibility;
  return typeof value === 'string' ? value : null;
}

export function matchRegistrationCutoffPassed(event: EventRecord, now: number): boolean {
  const cutoff = eventString(event, 'registration_cutoff_at');
  if (!cutoff) return false;
  const target = Date.parse(cutoff);
  return Number.isFinite(target) && target <= now;
}

// Defensive narrowing: the route always hands the flat primitive detail
// projection, but a malformed payload must not leak into the counts reader.
function isMatchEventListItem(event: EventRecord): event is MatchEventListItem {
  return typeof event.event_id === 'string';
}

function eventCounts(event: EventRecord) {
  if (isMatchEventListItem(event)) return matchEventCounts(event);
  const accepted = eventNumber(event, 'accepted_count') ?? 0;
  const derived = getMatchParticipation(accepted);
  return {
    accepted,
    playing: derived.playing,
    reserve: derived.reserve,
    reserveNotPlaying: eventNumber(event, 'reserve_not_playing_count') ?? 0,
    groups: derived.groups,
    moreNeeded: derived.moreNeeded
  };
}

export function matchRegistrationIsFull(event: EventRecord): boolean {
  const maximum = eventNumber(event, 'maximum_registrations');
  if (maximum === null) return false;
  return eventCounts(event).accepted >= maximum;
}

export type MatchRegistrationAction = 'join' | 'request' | 'full' | 'closed' | 'invited' | 'none';

// Smallest defensible eligibility gate: the server stays authoritative, this
// only chooses which CTA (or explicit blocked state) to present.
export function matchRegistrationAction(event: EventRecord, now: number): MatchRegistrationAction {
  if (eventBoolean(event, 'is_past') === true || matchRegistrationCutoffPassed(event, now))
    return 'closed';
  if (matchRegistrationIsFull(event)) return 'full';
  const eligibility = callerEligibility(event);
  if (eligibility === 'invited') return 'invited';
  if (
    eligibility === 'out_of_range' ||
    eligibility === 'nonmember' ||
    eventBoolean(event, 'caller_requires_approval') === true
  )
    return 'request';
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

function Badge({
  tone,
  children
}: {
  tone: 'playing' | 'reserve' | 'muted' | 'danger' | 'guest';
  children: ReactNode;
}) {
  const toneStyle =
    tone === 'playing'
      ? s.badgePlaying
      : tone === 'guest'
        ? s.badgeGuest
        : tone === 'danger'
          ? s.badgeDanger
          : tone === 'reserve'
            ? s.badgeReserve
            : s.badgeMuted;
  return <span {...stylex.props(s.badge, toneStyle)}>{children}</span>;
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
  event: EventRecord;
  registration: MyMatchRegistration;
  callerLevel?: number | null;
  roster?: MatchRosterEntry[] | null;
}) {
  const { t, i18n } = useTranslation();
  const eventId = eventString(event, 'event_id') ?? '';
  const cutoffAt = eventString(event, 'registration_cutoff_at');
  const controller = useMatchRegistration({
    eventId,
    initialRegistration: registration,
    cutoffAt
  });
  const now = useState(() => Date.now())[0];
  const counts = eventCounts(event);
  const maximum = eventNumber(event, 'maximum_registrations');
  const timeZone = eventString(event, 'timezone') ?? 'UTC';

  const feedbackMessage = (() => {
    const feedback = controller.feedback;
    if (!feedback) return null;
    if (feedback.kind === 'accepted') return t('matchRegistration.feedback.accepted');
    if (feedback.kind === 'pending') return t('matchRegistration.feedback.pending');
    if (feedback.kind === 'offline') return t('matchRegistration.feedback.offline');
    return t(`matchRegistration.feedback.${feedback.code}`);
  })();

  const remaining = maximum === null ? null : Math.max(0, maximum - counts.accepted);
  const capacity =
    remaining !== null && maximum !== null
      ? t('matchRegistration.join.capacity', { count: remaining, remaining, maximum })
      : null;

  const levelRange = (() => {
    if (eventBoolean(event, 'restriction_enabled') !== true) return null;
    const min = eventNumber(event, 'min_level');
    const max = eventNumber(event, 'max_level');
    if (min === null || max === null) return null;
    return callerLevel === null
      ? t('matchRegistration.join.levelRangeNoLevel', { min, max })
      : t('matchRegistration.join.levelRange', { min, max, level: callerLevel });
  })();

  const action = controller.cutoffReached ? 'closed' : matchRegistrationAction(event, now);

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
        const tone =
          entry.participation === 'playing'
            ? 'playing'
            : entry.participation === 'reserve'
              ? 'reserve'
              : 'muted';
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
          <div
            key={entry.accepted_order}
            {...stylex.props(s.rosterRow, isCaller && s.rosterRowSelf)}
          >
            <p {...stylex.props(s.rosterName)}>{name}</p>
            {entry.display_level !== null && (
              <span {...stylex.props(s.meta)}>
                {t('matchRegistration.roster.level', { level: entry.display_level })}
              </span>
            )}
            <Badge tone={tone}>{participationBadge}</Badge>
            {(isCaller || entry.registration_source === 'guest') && (
              <Badge tone={entry.registration_source === 'guest' ? 'guest' : 'muted'}>
                {t(sourceBadgeKey(entry.registration_source))}
              </Badge>
            )}
            {entry.participation !== 'playing' && entry.reserve_position !== null && (
              <span {...stylex.props(s.meta)}>
                {t('matchRegistration.roster.position', { position: entry.reserve_position })}
              </span>
            )}
          </div>
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
    const group = matchRegistrationGroup(registration.accepted_order);
    const reservePosition = matchRegistrationReservePosition(
      registration.accepted_order,
      counts.playing
    );
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
    const tone =
      participation === 'playing' ? 'playing' : participation === 'reserve' ? 'reserve' : 'muted';
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
          <div {...stylex.props(s.rosterRow, s.rosterRowSelf)}>
            <p {...stylex.props(s.rosterName)}>{t('matchRegistration.roster.you')}</p>
            <Badge tone={tone}>{participationBadge}</Badge>
            <Badge tone={registration.registration_source === 'guest' ? 'guest' : 'muted'}>
              {t(sourceBadgeKey(registration.registration_source))}
            </Badge>
            {participation === 'reserve' && reservePosition !== null && (
              <span {...stylex.props(s.meta)}>
                {t('matchRegistration.roster.position', { position: reservePosition })}
              </span>
            )}
          </div>
        </div>
        <p {...stylex.props(s.note)}>{t('matchRegistration.roster.orderNote')}</p>
        <p {...stylex.props(s.note)}>{t('matchRegistration.roster.authoritativeNote')}</p>
      </section>
    );
  })();

  let body: ReactNode;
  if (registration.state === 'accepted') {
    const participation = registration.participation;
    const group = matchRegistrationGroup(registration.accepted_order);
    const reservePosition = matchRegistrationReservePosition(
      registration.accepted_order,
      counts.playing
    );
    const badgeLabel =
      participation === 'playing'
        ? t('matchRegistration.request.approvedPlayingBadge', { group })
        : participation === 'reserve'
          ? t('matchRegistration.request.approvedReserveBadge', { position: reservePosition })
          : t('matchRegistration.badges.reserveNotPlaying');
    const tone =
      participation === 'playing'
        ? 'playing'
        : participation === 'reserve_not_playing'
          ? 'muted'
          : 'reserve';
    const approvedWhen = clockTime(i18n.language, registration.approved_at, timeZone);
    const copy =
      participation === 'playing'
        ? t('matchRegistration.request.approvedPlayingCopy', { when: approvedWhen })
        : participation === 'reserve'
          ? t('matchRegistration.request.approvedReserveCopy', { when: approvedWhen })
          : t('matchRegistration.closed.detail');
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <Badge tone={tone}>{badgeLabel}</Badge>
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
        {rosterBlock}
      </div>
    );
  } else if (registration.state === 'pending') {
    body = (
      <div {...stylex.props(s.body)}>
        <div {...stylex.props(s.badgeRow)}>
          <Badge tone="reserve">{t('matchRegistration.request.pendingBadge')}</Badge>
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
          <Badge tone="danger">{t('matchRegistration.request.declinedBadge')}</Badge>
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
          <Badge tone="muted">{t('matchRegistration.request.expiredBadge')}</Badge>
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
          <Badge tone="muted">{t('matchRegistration.closed.badge')}</Badge>
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
          <Badge tone="danger">{t('matchRegistration.full.badge')}</Badge>
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
          {callerEligibility(event) === 'nonmember'
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
  } else if (action === 'invited') {
    body = (
      <div {...stylex.props(s.body)}>
        <p {...stylex.props(s.copy)}>{t('matches.detail.invitationInfo')}</p>
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
        <h2 id="match-registration-heading" {...stylex.props(s.title)}>
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
