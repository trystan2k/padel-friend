import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MatchEventDetail } from './match-contracts';
import type { ResultProposal } from './match-result-model';
import { MatchResultPending } from './MatchResultPending';
import { MatchResultNavigation } from './MatchResultNavigation';
import { matchResultStyles as s } from './match-result.styles';

export function MatchResultDetail({
  event,
  proposals,
  reviewerGroup,
  canRecord
}: {
  event: MatchEventDetail;
  proposals: ResultProposal[];
  reviewerGroup: number | null;
  canRecord: boolean;
}) {
  const { t, i18n } = useTranslation();
  const starts = new Date(event.starts_at);
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;
  const date = new Intl.DateTimeFormat(locale, {
    day: 'numeric',
    month: 'short',
    timeZone: event.timezone
  });
  const weekday = new Intl.DateTimeFormat(locale, {
    weekday: 'short',
    timeZone: event.timezone
  });
  const time = new Intl.DateTimeFormat(locale, {
    timeStyle: 'short',
    timeZone: event.timezone
  });
  return (
    <main data-result-route="pending" data-route-chrome="navigation" {...stylex.props(s.page)}>
      <header {...stylex.props(s.routeHeader)}>
        <Link to="/matches" aria-label={t('matches.back')} {...stylex.props(s.routeBack)}>
          ‹
        </Link>
        <h1 {...stylex.props(s.routeTitle)}>{t('matches.detail.title')}</h1>
        <p {...stylex.props(s.copy)}>
          {event.community_name} · {t(`matches.detail.visibility.${event.visibility}`)}
        </p>
      </header>
      <div {...stylex.props(s.form)}>
        {event.photo_url && (
          <section {...stylex.props(s.hero)}>
            <img
              src={event.photo_url}
              alt={t('matches.card.photoAlt')}
              {...stylex.props(s.heroImage)}
            />
            <div {...stylex.props(s.heroCopy)}>
              <span {...stylex.props(s.label, s.heroLabel)}>{event.venue_name}</span>
              <h2 {...stylex.props(s.heroTitle)}>{t('matches.results.venueHeadline')}</h2>
              <a
                href={event.maps_url}
                target="_blank"
                rel="noopener noreferrer"
                {...stylex.props(s.heroLink)}
              >
                <span>
                  <span aria-hidden="true">📍&nbsp; </span>
                  {event.court_notes && <>{event.court_notes} &nbsp;·&nbsp; </>}
                  {t('matches.results.openMap')}
                </span>
              </a>
            </div>
          </section>
        )}
        <section {...stylex.props(s.card, s.overview)}>
          <div {...stylex.props(s.row, s.overviewBadges)}>
            <span
              {...stylex.props(
                s.statePill,
                s.overviewBadge,
                event.event_type === 'competitive' ? s.positive : s.neutral
              )}
            >
              {t(`matches.type.${event.event_type}`)}
            </span>
            <span {...stylex.props(s.statePill, s.neutral, s.overviewBadge)}>
              {t(
                event.event_type === 'competitive'
                  ? 'matches.results.globalRating'
                  : 'matches.results.friendlyType'
              )}
            </span>
          </div>
          <h2 {...stylex.props(s.overviewTitle)}>{event.notes ?? event.venue_name}</h2>
          <p {...stylex.props(s.copy, s.overviewTime)}>
            {t('matches.results.overviewDate', {
              weekday: weekday.format(starts),
              date: date.format(starts)
            })}{' '}
            · {time.format(starts)}
            {event.duration_minutes !== null && (
              <>–{time.format(new Date(starts.getTime() + event.duration_minutes * 60_000))}</>
            )}
          </p>
        </section>
        {proposals.map((proposal) => (
          <MatchResultPending
            key={proposal.proposal_id}
            proposal={proposal}
            timezone={event.timezone}
            asOf={event.as_of}
            canReview={reviewerGroup === proposal.group_number}
          />
        ))}
        {canRecord && event.group_count > proposals.length && (
          <Link
            to="/matches/$eventId/record"
            params={{ eventId: event.event_id }}
            {...stylex.props(s.button)}
          >
            {t('matches.results.title')}
          </Link>
        )}
      </div>
      <MatchResultNavigation />
    </main>
  );
}
