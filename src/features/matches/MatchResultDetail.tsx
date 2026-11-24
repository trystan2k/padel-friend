import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { TopBar } from '../../components/ui/TopBar';
import type { MatchEventDetail } from './match-contracts';
import type { ResultProposal } from './match-result-model';
import { MatchResultCorrections, type ResultCorrectionsData } from './MatchResultCorrections';
import { MatchResultReview } from './MatchResultReview';
import { MatchResultRatingChanges } from './MatchResultRatingChanges';
import { matchDetailShellStyles as shell } from './match-detail-shell.styles';
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
  proposalsError = false,
  corrections
}: {
  event: MatchEventDetail;
  proposals: ResultProposal[];
  canRecord: boolean;
  onRefresh: () => void | Promise<void>;
  proposalsError?: boolean;
  corrections?: ResultCorrectionsData;
}) {
  const { t, i18n } = useTranslation();
  // The sticky action bar's mount point: the single-result review renders Approve / secondary there (sLXK7).
  const [actionBarSlot, setActionBarSlot] = useState<HTMLElement | null>(null);
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
    <main
      data-result-route="lifecycle"
      data-route-chrome="navigation"
      {...stylex.props(stylex.defaultMarker(), shell.page)}
    >
      <TopBar
        title={t('matches.detail.barTitle')}
        headingId="match-detail-heading"
        back={{ to: '/matches', label: t('matches.back') }}
      />
      <div {...stylex.props(shell.groups)}>
        <section aria-labelledby="match-overview-heading" {...stylex.props(shell.hero)}>
          {event.photo_url && (
            <img
              src={event.photo_url}
              alt={t('matches.card.photoAlt')}
              {...stylex.props(shell.image)}
            />
          )}
          <div {...stylex.props(shell.chips)}>
            <StatusBadge tone={event.event_type === 'competitive' ? 'positive' : 'neutral'}>
              {t(`matches.type.${event.event_type}`)}
            </StatusBadge>
            <StatusBadge>
              {t(
                event.event_type === 'competitive'
                  ? 'matches.results.globalRating'
                  : 'matches.results.friendlyType'
              )}
            </StatusBadge>
            <StatusBadge>{t(`matches.detail.visibility.${event.visibility}`)}</StatusBadge>
          </div>
          <div {...stylex.props(shell.heroBody)}>
            <h2 id="match-overview-heading" {...stylex.props(shell.title, shell.venue)}>
              {event.notes ?? event.venue_name}
            </h2>
            <p {...stylex.props(shell.schedule)}>
              {t('matches.results.overviewDate', {
                weekday: weekday.format(starts),
                date: date.format(starts)
              })}{' '}
              · {time.format(starts)}
              {event.duration_minutes !== null && (
                <>–{time.format(new Date(starts.getTime() + event.duration_minutes * 60_000))}</>
              )}
            </p>
          </div>
          <div {...stylex.props(shell.venueCard)}>
            <span {...stylex.props(shell.venueText)}>
              <span {...stylex.props(shell.venueName)}>{event.venue_name}</span>
              {event.court_notes && <span {...stylex.props(shell.note)}>{event.court_notes}</span>}
            </span>
            <a
              href={event.maps_url}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={t('matches.detail.viewCourtLocationFor', { venue: event.venue_name })}
              {...stylex.props(shell.maps)}
            >
              {t('matches.results.openMap')}
            </a>
          </div>
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
                <div key={proposal.proposal_id} id={`result-group-${groupNumber}`} tabIndex={-1}>
                  {proposal.status === 'confirmed' && (
                    <Link
                      to="/matches/$eventId/groups/$groupId"
                      params={{ eventId: event.event_id, groupId: proposal.proposal_id }}
                      {...stylex.props(s.button)}
                    >
                      {t('statistics.history.viewDetails')}
                    </Link>
                  )}
                  <MatchResultReview
                    eventId={event.event_id}
                    proposal={proposal}
                    timezone={event.timezone}
                    asOf={event.as_of}
                    compact={expectedGroups > 1}
                    actionSlot={singlePendingGroup ? actionBarSlot : undefined}
                    onRefresh={onRefresh}
                  />
                </div>
              );
            return (
              <article
                key={groupNumber}
                id={`result-group-${groupNumber}`}
                tabIndex={-1}
                {...stylex.props(reviewStyles.resultCard)}
              >
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
        {!proposalsError && corrections && (
          <MatchResultCorrections
            event={event}
            proposals={proposals}
            corrections={corrections}
            onRefresh={onRefresh}
          />
        )}
        {!proposalsError &&
          event.event_type === 'competitive' &&
          event.result_summary.confirmed_group_count > 0 && (
            <MatchResultRatingChanges
              key={event.result_summary.confirmed_group_count}
              eventId={event.event_id}
              revision={Math.max(
                0,
                ...(corrections?.amendments.map((item) => item.repair?.committed_revision ?? 0) ??
                  [])
              )}
            />
          )}
        {singlePendingGroup && <div ref={setActionBarSlot} {...stylex.props(shell.barSlot)} />}
      </div>
    </main>
  );
}
