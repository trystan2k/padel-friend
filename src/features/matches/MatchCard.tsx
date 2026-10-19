import { StatusBadge } from '../../components/ui/StatusBadge';
import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import {
  getMatchBadge,
  matchCallerBadge,
  matchEventCounts,
  type MatchEventListItem
} from './match-model';
import { matchesStyles as s } from './matches.styles';

export function MatchCard({ event }: { event: MatchEventListItem }) {
  const { t, i18n } = useTranslation();
  // Explicit flat counts keep Reserve Not Playing out of the ordinary Reserve
  // figure; only a payload without them falls back to quartet derivation.
  const counts = matchEventCounts(event);
  const badge =
    matchCallerBadge(event.caller_badge) ??
    getMatchBadge({
      creator: event.is_creator === true,
      accepted: event.is_accepted === true,
      invited: event.is_invited === true
    });
  const starts = typeof event.starts_at === 'string' ? event.starts_at : '';
  const zone = typeof event.timezone === 'string' ? event.timezone : 'UTC';
  const venue = event.venue_name ?? '';
  const price =
    typeof event.price_minor === 'number' && typeof event.currency === 'string'
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
          href={event.maps_url ?? ''}
          target="_blank"
          rel="noopener noreferrer"
          {...stylex.props(s.cardLink)}
          aria-label={t('matches.card.openMaps', { venue })}
        >
          {venue}
        </a>
      </p>
      <p>
        {event.restriction_enabled === true &&
        typeof event.min_level === 'number' &&
        typeof event.max_level === 'number'
          ? `${t('matches.card.levelRange')}: ${event.min_level}–${event.max_level}`
          : t('matches.card.noLevelRestriction')}
      </p>
      {typeof event.team_assignment_mode === 'string' && (
        <p>{t(`matches.teamMode.${event.team_assignment_mode}`)}</p>
      )}
      <p>
        {event.maximum_registrations == null
          ? t('matches.card.unlimited')
          : `${t('matches.card.maximum')}: ${event.maximum_registrations}`}
      </p>
      {!event.registration_open && <p>{t('matches.detail.registrationClosed')}</p>}
      <p>
        {t(
          event.event_type === 'competitive' ? 'matches.type.competitive' : 'matches.type.friendly'
        )}{' '}
        · {event.creator_name ?? ''} ({t('matches.card.approximateLevel')}:{' '}
        {String(event.creator_level ?? '')})
      </p>
      <p>
        {counts.playing} {t('matches.counts.playing', { count: counts.playing })} · {counts.reserve}{' '}
        {t('matches.counts.reserve', { count: counts.reserve })} · {counts.groups}{' '}
        {t('matches.counts.groups', { count: counts.groups })} · {counts.moreNeeded}{' '}
        {t('matches.counts.moreNeeded', { count: counts.moreNeeded })}
      </p>
      {price && (
        <p>
          {t('matches.card.pricePerPlayer')}: {price}
        </p>
      )}
      {badge && badge !== 'creator' && (
        <StatusBadge appearance="emphasis">{t(`matches.badges.${badge}`)}</StatusBadge>
      )}
      {event.caller_is_invited && <p>{t('matches.detail.invitationInfo')}</p>}
      {event.caller_eligibility === 'nonmember' && event.caller_requires_approval && (
        <p>{t('matches.detail.guestApprovalRequired')}</p>
      )}
      {event.caller_eligibility === 'out_of_range' && event.caller_requires_approval && (
        <p>{t('matches.detail.outOfRangeApprovalRequired')}</p>
      )}
      {event.is_past && (
        <>
          <p>{t('matches.detail.pastScheduled')}</p>
          <p>{t('matches.detail.outcomeUnavailable')}</p>
        </>
      )}
    </article>
  );
}
