import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { StatusBadge, type StatusBadgeTone } from '../../components/ui/StatusBadge';
import type { MatchEventCard } from './match-contracts';
import { matchListStyles as s } from './match-list.styles';
import { MatchCompetitionBadge } from './MatchCompetitionBadge';

const CALLER_BADGE_TONE: Record<string, StatusBadgeTone> = { playing: 'positive' };

/**
 * One match in a list. Content order is fixed by the Clubhouse frames: time and price, venue, chips,
 * then participation; map, creator and eligibility notes follow as secondary lines. The frames draw
 * no venue photo, so the list omits it (the detail page keeps it). `grouped` lists
 * sit under a day heading, so the venue heading drops one level.
 */
export function MatchCard({
  event,
  grouped = false
}: {
  event: MatchEventCard;
  grouped?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const counts = {
    playing: event.playing_count,
    reserve: event.reserve_count,
    groups: event.group_count,
    moreNeeded: event.more_needed
  };
  const badge = event.caller_badge;
  const callerAccepted =
    badge === 'playing' ||
    badge === 'reserve' ||
    badge === 'reserve_not_playing' ||
    badge === 'reconfirmation_required';
  const venue = event.venue_name;
  const cancelled = event.status === 'cancelled';
  const resultResolutionKey =
    event.result_summary.result_resolution === 'awaiting_results'
      ? 'awaitingResults'
      : event.result_summary.result_resolution === 'partially_resolved'
        ? 'partiallyResolved'
        : 'completed';
  const price =
    event.price_minor !== null && event.currency !== null
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: event.currency
        }).format(event.price_minor / 100)
      : null;
  const Heading = grouped ? 'h3' : 'h2';
  const details = [
    event.restriction_enabled && event.min_level !== null && event.max_level !== null
      ? `${t('matches.card.levelRange')}: ${event.min_level}–${event.max_level}`
      : t('matches.card.noLevelRestriction'),
    t(`matches.teamMode.${event.team_assignment_mode}`),
    event.maximum_registrations == null
      ? t('matches.card.unlimited')
      : `${t('matches.card.maximum')}: ${event.maximum_registrations}`
  ].join(' · ');
  return (
    <article {...stylex.props(s.card)}>
      <div {...stylex.props(s.top)}>
        <span>
          <time dateTime={event.starts_at} {...stylex.props(s.time)}>
            {new Intl.DateTimeFormat(i18n.language, {
              timeStyle: 'short',
              timeZone: event.timezone
            }).format(new Date(event.starts_at))}
          </time>
          <span {...stylex.props(s.zone)}>{event.timezone}</span>
        </span>
        {price && (
          <span {...stylex.props(s.price)}>
            <span {...stylex.props(s.srOnly)}>{t('matches.card.pricePerPlayer')}: </span>
            {price}
          </span>
        )}
      </div>
      <Heading {...stylex.props(s.venue)}>
        <Link
          to="/matches/$eventId"
          params={{ eventId: event.event_id }}
          {...stylex.props(s.venueLink)}
        >
          {venue}
        </Link>
      </Heading>
      <div {...stylex.props(s.chips)}>
        <StatusBadge tone={event.event_type === 'competitive' ? 'positive' : 'neutral'}>
          {t(`matches.type.${event.event_type}`)}
        </StatusBadge>
        <MatchCompetitionBadge event={event} />
        {cancelled && <StatusBadge>{t('matches.management.cancelled')}</StatusBadge>}
        {!cancelled && event.result_summary.expected_group_count > 0 && (
          <StatusBadge appearance="emphasis" tone="neutral">
            {t(`matches.results.resolution.${resultResolutionKey}`)}
          </StatusBadge>
        )}
        {!event.registration_open && (
          <StatusBadge>{t('matches.detail.registrationClosed')}</StatusBadge>
        )}
        {!cancelled && badge && badge !== 'creator' && (
          <StatusBadge
            appearance="emphasis"
            tone={CALLER_BADGE_TONE[badge] ?? 'neutral'}
            xstyle={badge === 'invited' ? s.accentChip : undefined}
          >
            {t(
              badge === 'reconfirmation_required'
                ? 'matches.reconfirmation.requiredBadge'
                : `matches.badges.${badge}`
            )}
          </StatusBadge>
        )}
      </div>
      {!cancelled && (
        <p {...stylex.props(s.meta)}>
          {counts.playing} {t('matches.counts.playing', { count: counts.playing })} ·{' '}
          {counts.reserve} {t('matches.counts.reserve', { count: counts.reserve })} ·{' '}
          {counts.groups} {t('matches.counts.groups', { count: counts.groups })} ·{' '}
          {counts.moreNeeded} {t('matches.counts.moreNeeded', { count: counts.moreNeeded })}
        </p>
      )}
      <p {...stylex.props(s.meta)}>{details}</p>
      <p {...stylex.props(s.meta)}>
        {event.creator_name ?? ''} ({t('matches.card.approximateLevel')}:{' '}
        {String(event.creator_level ?? '')})
      </p>
      {!cancelled && event.caller_is_invited && (
        <p {...stylex.props(s.note)}>{t('matches.detail.invitationInfo')}</p>
      )}
      {!cancelled &&
        !callerAccepted &&
        event.caller_eligibility === 'nonmember' &&
        event.caller_requires_approval && (
          <p {...stylex.props(s.note)}>{t('matches.detail.guestApprovalRequired')}</p>
        )}
      {!cancelled && !callerAccepted && event.caller_eligibility === 'ranked_members_only' && (
        <p {...stylex.props(s.note)}>{t('matches.detail.rankedMembersOnly')}</p>
      )}
      {!cancelled &&
        !callerAccepted &&
        event.caller_eligibility === 'out_of_range' &&
        event.caller_requires_approval && (
          <p {...stylex.props(s.note)}>{t('matches.detail.outOfRangeApprovalRequired')}</p>
        )}
      {!cancelled && event.is_past && (
        <>
          <p {...stylex.props(s.note)}>{t('matches.detail.pastScheduled')}</p>
          <p {...stylex.props(s.note)}>{t('matches.detail.outcomeUnavailable')}</p>
        </>
      )}
      <a
        href={event.maps_url}
        target="_blank"
        rel="noopener noreferrer"
        {...stylex.props(s.mapLink)}
        aria-label={t('matches.card.openMaps', { venue })}
      >
        {t('matches.card.map')}
      </a>
    </article>
  );
}
