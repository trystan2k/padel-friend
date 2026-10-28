import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useTranslation } from 'react-i18next';
import type { MatchEventDetail } from './match-contracts';
import type { ResultProposal } from './match-result-model';
import { MatchResultReview } from './MatchResultReview';
import { MatchResultNavigation } from './MatchResultNavigation';
import {
  matchResultReviewStyles as reviewStyles,
  matchResultStyles as s
} from './match-result.styles';
import { useMatchResultFreshness } from './use-match-result-freshness';

export function MatchResultDetail({
  event,
  proposals,
  canRecord,
  onRefresh,
  proposalsError = false
}: {
  event: MatchEventDetail;
  proposals: ResultProposal[];
  canRecord: boolean;
  onRefresh: () => void | Promise<void>;
  proposalsError?: boolean;
}) {
  const { t, i18n } = useTranslation();
  useMatchResultFreshness({
    eventId: event.event_id,
    asOf: event.as_of,
    proposals,
    onRefresh
  });
  const expectedGroups = event.result_summary.expected_group_count;
  const groups = Array.from({ length: expectedGroups }, (_, index) => index + 1);
  const proposalsByGroup = new Map(proposals.map((proposal) => [proposal.group_number, proposal]));
  const singlePendingGroup =
    expectedGroups === 1 && proposals.length === 1 && proposals[0]?.status === 'pending';
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
    <main data-result-route="lifecycle" data-route-chrome="navigation" {...stylex.props(s.page)}>
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
        {!singlePendingGroup && (
          <section
            aria-label={t('matches.results.resolution.title')}
            {...stylex.props(
              reviewStyles.resolutionBanner,
              event.result_summary.result_resolution === 'completed' &&
                reviewStyles.resolutionComplete
            )}
          >
            <strong>
              {t(
                `matches.results.resolution.${event.result_summary.result_resolution === 'awaiting_results' ? 'awaitingResults' : event.result_summary.result_resolution === 'partially_resolved' ? 'partiallyResolved' : 'completed'}`
              )}
            </strong>
            <span>
              {t('matches.results.resolution.progress', {
                confirmed: event.result_summary.confirmed_group_count,
                expected: expectedGroups
              })}
            </span>
          </section>
        )}
        {proposalsError && (
          <section role="alert" {...stylex.props(s.card)}>
            <p {...stylex.props(s.copy)}>{t('matches.results.errors.unavailable')}</p>
            <button type="button" {...stylex.props(s.button)} onClick={() => void onRefresh()}>
              {t('matches.results.reload')}
            </button>
          </section>
        )}
        {!proposalsError &&
          groups.map((groupNumber) => {
            const proposal = proposalsByGroup.get(groupNumber);
            if (proposal)
              return (
                <MatchResultReview
                  key={proposal.proposal_id}
                  eventId={event.event_id}
                  proposal={proposal}
                  timezone={event.timezone}
                  asOf={event.as_of}
                  compact={expectedGroups > 1}
                  onRefresh={onRefresh}
                />
              );
            return (
              <article key={groupNumber} {...stylex.props(reviewStyles.resultCard)}>
                <header {...stylex.props(reviewStyles.resultHeader)}>
                  <h3 {...stylex.props(reviewStyles.groupHeading)}>
                    {t('matches.results.group', { number: groupNumber })}
                  </h3>
                  <span {...stylex.props(reviewStyles.statusBadge, reviewStyles.statusAwaiting)}>
                    {t('matches.results.awaitingResult')}
                  </span>
                </header>
                {canRecord && (
                  <Link
                    to="/matches/$eventId/record"
                    params={{ eventId: event.event_id }}
                    search={{ correctionProposalId: undefined, groupNumber }}
                    {...stylex.props(s.button)}
                  >
                    {t('matches.results.title')}
                  </Link>
                )}
              </article>
            );
          })}
      </div>
      <MatchResultNavigation />
    </main>
  );
}
