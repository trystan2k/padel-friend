import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchRegistrationPanel } from './MatchRegistrationPanel';
import { MatchRequestQueue } from './MatchRequestQueue';
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
  roster = null
}: {
  event: Record<string, unknown> | null;
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
}) {
  const { t, i18n } = useTranslation();
  const [feedback, setFeedback] = useState<{ id: string; copied: boolean; failed: boolean } | null>(
    null
  );
  const eventId = typeof event?.event_id === 'string' ? event.event_id : '';
  const callerAccepted = registration?.state === 'accepted';
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
      <h1 {...stylex.props(s.title)}>
        {t('matches.detail.title')}: {venue}
      </h1>
      <div {...stylex.props(s.detailGroups)}>
        <section aria-labelledby="match-overview-heading" {...stylex.props(s.detailGroup)}>
          <h2 id="match-overview-heading" {...stylex.props(s.sectionTitle)}>
            {t('matches.detail.overview')}
          </h2>
          {typeof event.photo_url === 'string' && (
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
              href={typeof event.maps_url === 'string' ? event.maps_url : ''}
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
          {typeof event.notes === 'string' && (
            <p>
              {t('matches.card.notes')}: {event.notes}
            </p>
          )}
          {typeof event.court_notes === 'string' && (
            <p>
              {t('matches.detail.courtNotes')}: {event.court_notes}
            </p>
          )}
          {typeof event.payment_note === 'string' && (
            <p>
              {t('matches.detail.paymentNote')}: {event.payment_note}
            </p>
          )}
        </section>
        <section aria-labelledby="match-participation-heading" {...stylex.props(s.detailGroup)}>
          <h2 id="match-participation-heading" {...stylex.props(s.sectionTitle)}>
            {t('matches.detail.participation')}
          </h2>
          <h3 {...stylex.props(s.sectionTitle)}>{t('matches.detail.participants')}</h3>
          {typeof event.duration_minutes === 'number' && (
            <p>
              {t('matches.detail.duration')}: {event.duration_minutes}
            </p>
          )}
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
          {event.caller_is_invited === true && <p>{t('matches.detail.invitationInfo')}</p>}
        </section>
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
        ) : registration ? (
          <MatchRegistrationPanel
            event={event}
            registration={registration}
            callerLevel={callerLevel}
            roster={roster}
          />
        ) : null}
        {isCreator && (
          <MatchRequestQueue
            eventId={eventId}
            eventName={venue}
            queue={queue}
            minLevel={typeof event.min_level === 'number' ? event.min_level : null}
            maxLevel={typeof event.max_level === 'number' ? event.max_level : null}
            error={queueError}
            onRetry={onRetry}
          />
        )}
        <section aria-labelledby="match-eligibility-heading" {...stylex.props(s.detailGroup)}>
          <h2 id="match-eligibility-heading" {...stylex.props(s.sectionTitle)}>
            {t('matches.detail.eligibilityVisibility')}
          </h2>
          {typeof event.restriction_enabled === 'boolean' && (
            <p>
              {event.restriction_enabled &&
              typeof event.min_level === 'number' &&
              typeof event.max_level === 'number'
                ? `${t('matches.card.levelRange')}: ${event.min_level}–${event.max_level}`
                : t('matches.card.noLevelRestriction')}
            </p>
          )}
          {typeof event.team_assignment_mode === 'string' && (
            <p>{t(`matches.teamMode.${event.team_assignment_mode}`)}</p>
          )}
          <p>
            {event.maximum_registrations == null
              ? t('matches.card.unlimited')
              : typeof event.maximum_registrations === 'number'
                ? `${t('matches.card.maximum')}: ${event.maximum_registrations}`
                : null}
          </p>
          {event.registration_open === false && <p>{t('matches.detail.registrationClosed')}</p>}
          <p>
            {t(
              'matches.visibility.' +
                (event.visibility === 'invite_only' ? 'invite_only' : 'community_open')
            )}
          </p>
          {!callerAccepted && event.caller_eligibility === 'nonmember' && (
            <p>{t('matches.detail.guestApprovalRequired')}</p>
          )}
          {event.caller_eligibility === 'out_of_range' &&
            event.caller_requires_approval === true &&
            !callerAccepted && <p>{t('matches.detail.outOfRangeApprovalRequired')}</p>}
          {event.is_past === true && (
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
