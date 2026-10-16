import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import { getMatchBadge, getMatchParticipation, type MatchEventListItem } from './match-model';
import { matchesStyles as s } from './matches.styles';

export function MatchCard({ event }: { event: MatchEventListItem }) {
  const { t, i18n } = useTranslation();
  const accepted = Number(event.accepted_count ?? 0);
  const counts = getMatchParticipation(accepted);
  const badge =
    typeof event.caller_badge === 'string'
      ? event.caller_badge
      : getMatchBadge({
          creator: event.is_creator === true,
          accepted: event.is_accepted === true,
          invited: event.is_invited === true
        });
  const starts = typeof event.starts_at === 'string' ? event.starts_at : '';
  const zone = typeof event.timezone === 'string' ? event.timezone : 'UTC';
  const venue = String(event.venue_name ?? '');
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
        <Link to="/matches/$eventId" params={{ eventId: event.event_id }}>
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
          href={String(event.maps_url ?? '')}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t('matches.card.openMaps', { venue })}
        >
          {venue}
        </a>
      </p>
      <p>
        {t(
          event.event_type === 'competitive' ? 'matches.type.competitive' : 'matches.type.friendly'
        )}{' '}
        · {String(event.creator_name ?? '')} ({t('matches.card.approximateLevel')}:{' '}
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
      {badge && badge !== 'creator' && <strong>{t(`matches.badges.${badge}`)}</strong>}
    </article>
  );
}
