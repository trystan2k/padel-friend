import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
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
  sharePlatform
}: {
  event: Record<string, unknown> | null;
  loadError?: boolean;
  onRetry?: () => void;
  sharePlatform?: Pick<Navigator, 'share' | 'clipboard'>;
}) {
  const { t, i18n } = useTranslation();
  const [feedback, setFeedback] = useState<{ id: string; copied: boolean; failed: boolean } | null>(
    null
  );
  const eventId = typeof event?.event_id === 'string' ? event.event_id : '';
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
  const zone = typeof event.timezone === 'string' ? event.timezone : 'UTC';
  const venue = typeof event.venue_name === 'string' ? event.venue_name : '';
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
    typeof event.price_minor === 'number' && typeof event.currency === 'string'
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
      <h1>
        {t('matches.detail.title')}: {venue}
      </h1>
      {typeof event.photo_url === 'string' && (
        <img {...stylex.props(s.image)} src={event.photo_url} alt={t('matches.card.photoAlt')} />
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
          href={typeof event.maps_url === 'string' ? event.maps_url : ''}
          target="_blank"
          rel="noopener noreferrer"
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
      {typeof event.notes === 'string' && <p>{event.notes}</p>}
      <h2>{t('matches.detail.participants')}</h2>
      <p>
        {typeof event.accepted_count === 'number' ? event.accepted_count : 0} ·{' '}
        {t('matches.detail.accepted')}
      </p>
      <p>
        {typeof event.playing_count === 'number' ? event.playing_count : 0}{' '}
        {t('matches.counts.playing', {
          count: typeof event.playing_count === 'number' ? event.playing_count : 0
        })}{' '}
        · {typeof event.reserve_count === 'number' ? event.reserve_count : 0}{' '}
        {t('matches.counts.reserve', {
          count: typeof event.reserve_count === 'number' ? event.reserve_count : 0
        })}{' '}
        · {typeof event.group_count === 'number' ? event.group_count : 0}{' '}
        {t('matches.counts.groups', {
          count: typeof event.group_count === 'number' ? event.group_count : 0
        })}{' '}
        · {typeof event.more_needed === 'number' ? event.more_needed : 4}{' '}
        {t('matches.counts.moreNeeded', {
          count: typeof event.more_needed === 'number' ? event.more_needed : 4
        })}
      </p>
      {event.caller_badge === 'creator' && <p>{t('matches.detail.creatorAccepted')}</p>}
      {event.caller_eligibility === 'invited' && <p>{t('matches.detail.invitationInfo')}</p>}
      <p>
        {t(
          'matches.visibility.' +
            (event.visibility === 'invite_only' ? 'invite_only' : 'community_open')
        )}
      </p>
      {event.caller_eligibility === 'nonmember' && (
        <p>{t('matches.detail.guestApprovalRequired')}</p>
      )}
      {event.caller_eligibility === 'out_of_range' && event.caller_requires_approval === true && (
        <p>{t('matches.detail.outOfRangeApprovalRequired')}</p>
      )}
      {event.is_past === true && (
        <>
          <p>{t('matches.detail.pastScheduled')}</p>
          <p>{t('matches.detail.outcomeUnavailable')}</p>
        </>
      )}
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
