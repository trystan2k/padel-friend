import { StatusBadge } from '../../components/ui/StatusBadge';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MatchEventCard } from './match-contracts';
import { matchesStyles as s } from './matches.styles';

export function MatchCard({ event }: { event: MatchEventCard }) {
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
  const starts = event.starts_at;
  const zone = event.timezone;
  const venue = event.venue_name;
  const price =
    event.price_minor !== null && event.currency !== null
      ? new Intl.NumberFormat(i18n.language, {
          style: 'currency',
          currency: event.currency
        }).format(event.price_minor / 100)
      : null;
  return (
    <article {...stylex.props(s.card)}>
      {event.photo_url && (
        <img {...stylex.props(s.image)} src={event.photo_url} alt={t('matches.card.photoAlt')} />
      )}
      <h2>
        <Link
          to="/matches/$eventId"
          params={{ eventId: event.event_id }}
          {...stylex.props(s.cardLink)}
        >
          {venue}
        </Link>
      </h2>
      <p>
        {new Intl.DateTimeFormat(i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: zone
        }).format(new Date(starts))}{' '}
        · {zone}
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
      {event.status === 'cancelled' && (
        <StatusBadge>{t('matches.management.cancelled')}</StatusBadge>
      )}
      {!event.registration_open && <p>{t('matches.detail.registrationClosed')}</p>}
      <p>
        {t(`matches.type.${event.event_type}`)} · {event.creator_name ?? ''} (
        {t('matches.card.approximateLevel')}: {String(event.creator_level ?? '')})
      </p>
      {event.status !== 'cancelled' && (
        <p>
          {counts.playing} {t('matches.counts.playing', { count: counts.playing })} ·{' '}
          {counts.reserve} {t('matches.counts.reserve', { count: counts.reserve })} ·{' '}
          {counts.groups} {t('matches.counts.groups', { count: counts.groups })} ·{' '}
          {counts.moreNeeded} {t('matches.counts.moreNeeded', { count: counts.moreNeeded })}
        </p>
      )}
      {price && (
        <p>
          {t('matches.card.pricePerPlayer')}: {price}
        </p>
      )}
      {event.status !== 'cancelled' && badge && badge !== 'creator' && (
        <StatusBadge appearance="emphasis">
          {t(
            badge === 'reconfirmation_required'
              ? 'matches.reconfirmation.requiredBadge'
              : `matches.badges.${badge}`
          )}
        </StatusBadge>
      )}
      {event.status !== 'cancelled' && event.caller_is_invited && (
        <p>{t('matches.detail.invitationInfo')}</p>
      )}
      {event.status !== 'cancelled' &&
        !callerAccepted &&
        event.caller_eligibility === 'nonmember' &&
        event.caller_requires_approval && <p>{t('matches.detail.guestApprovalRequired')}</p>}
      {event.status !== 'cancelled' &&
        !callerAccepted &&
        event.caller_eligibility === 'out_of_range' &&
        event.caller_requires_approval && <p>{t('matches.detail.outOfRangeApprovalRequired')}</p>}
      {event.status !== 'cancelled' && event.is_past && (
        <>
          <p>{t('matches.detail.pastScheduled')}</p>
          <p>{t('matches.detail.outcomeUnavailable')}</p>
        </>
      )}
    </article>
  );
}
