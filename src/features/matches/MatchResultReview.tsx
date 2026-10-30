import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { MatchResultPending } from './MatchResultPending';
import { MatchResultRejectDialog } from './MatchResultRejectDialog';
import { MatchResultTeams, resultSetWins } from './MatchResultFacts';
import type { ResultProposal, ResultRejectionReason } from './match-result-model';
import { matchResultReviewStyles as s, matchResultStyles as base } from './match-result.styles';
import { useMatchResultReview } from './use-match-result-review';

function rejectionReasonKey(reason: ResultRejectionReason) {
  return reason
    .toLowerCase()
    .split('_')
    .map((part, index) => (index === 0 ? part : `${part[0]?.toUpperCase()}${part.slice(1)}`))
    .join('');
}

export function MatchResultReview({
  eventId,
  proposal,
  timezone,
  asOf,
  compact = false,
  onRefresh
}: {
  eventId: string;
  proposal: ResultProposal;
  timezone: string;
  asOf: string;
  compact?: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const [rejectOpen, setRejectOpen] = useState(false);
  const rejectTrigger = useRef<HTMLButtonElement>(null);
  const resultCard = useRef<HTMLElement>(null);
  const review = useMatchResultReview({ proposal, onRefresh });
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;
  const fullDate = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone
  });
  const pending = proposal.status === 'pending';
  const resultDeadline = fullDate.format(new Date(proposal.review_deadline_at));
  const submittedAt = fullDate.format(new Date(proposal.submitted_at));
  const submitterName = proposal.submitted_by_name ?? t('matches.results.unknownPlayer');
  const stale = review.feedback?.kind === 'stale' ? review.feedback : null;
  const canReviewCurrent = stale !== null && proposal.version >= stale.version;
  const currentFeedback = review.feedback;
  const feedbackCopy = (() => {
    const feedback = currentFeedback;
    if (!feedback) return null;
    if (feedback.kind === 'recorded') {
      if (feedback.decision === 'approve' && feedback.status === 'confirmed')
        return t('matches.results.review.recorded.approveConfirmed');
      if (feedback.decision === 'approve') return t('matches.results.review.recorded.approve');
      return t('matches.results.review.recorded.reject');
    }
    if (feedback.kind === 'offline') return t('matches.results.review.offline');
    if (feedback.kind === 'error') return t(feedback.copy);
    if (feedback.kind === 'stale')
      return t('matches.results.conflicts.currentProposal', {
        version: feedback.version,
        status: t(`matches.results.lifecycleStatus.${feedback.status}`)
      });
    return t(feedback.copy);
  })();

  const wins = resultSetWins(proposal.sets);
  const statusLabel =
    proposal.status === 'pending'
      ? proposal.version > 1
        ? t('matches.results.lifecycleStatus.correctionPending')
        : t('matches.results.pending')
      : proposal.status === 'disputed'
        ? t('matches.results.lifecycleStatus.disputed')
        : t(
            proposal.confirmation?.source === 'AUTO_48H'
              ? 'matches.results.confirmation.auto'
              : 'matches.results.confirmation.manual'
          );

  async function submitReject(reasonCode: ResultRejectionReason, reasonNote: string | null) {
    return review.reject(reasonCode, reasonNote);
  }

  return (
    <article
      ref={resultCard}
      aria-label={t('matches.results.group', { number: proposal.group_number })}
      tabIndex={-1}
      data-result-status={proposal.status}
      {...stylex.props(
        s.resultCard,
        compact && s.compactResultCard,
        pending && !compact && s.pendingDetailCard
      )}
    >
      {compact ? (
        <CompactResultSummary
          eventId={eventId}
          proposal={proposal}
          statusLabel={statusLabel}
          timezone={timezone}
          asOf={asOf}
        />
      ) : pending ? (
        <MatchResultPending
          proposal={proposal}
          timezone={timezone}
          asOf={asOf}
          approvalProgress={t('matches.results.approvalProgress', {
            received: proposal.received_team_coverage_count,
            required: proposal.required_team_coverage_count
          })}
        />
      ) : (
        <>
          <header {...stylex.props(s.resultHeader)}>
            <h3 {...stylex.props(s.groupHeading)}>
              {t('matches.results.group', { number: proposal.group_number })}
            </h3>
            <span
              {...stylex.props(
                s.statusBadge,
                proposal.status === 'disputed' ? s.statusDisputed : s.statusConfirmed
              )}
            >
              {statusLabel}
            </span>
          </header>
          <p {...stylex.props(s.resultMeta)}>
            <span>
              {t('matches.results.versionLabel', { version: proposal.version })} ·{' '}
              {t('matches.results.submittedByAt', {
                name: submitterName,
                submittedAt
              })}
            </span>
            <span>{t('matches.results.reviewDeadline', { deadline: resultDeadline })}</span>
          </p>
          <div {...stylex.props(s.facts)}>
            <MatchResultTeams teams={proposal.teams} />
            <section aria-label={t('matches.results.setScores')}>
              <table {...stylex.props(s.scoresTable)}>
                <caption {...stylex.props(s.srOnly)}>{t('matches.results.setScores')}</caption>
                <thead>
                  <tr>
                    <th scope="col" {...stylex.props(s.scoreHeading)}>
                      {t('matches.results.teams.team_a')}
                    </th>
                    <th scope="col" {...stylex.props(s.scoreHeading)}>
                      {t('matches.results.sets')}
                    </th>
                    <th scope="col" {...stylex.props(s.scoreHeading)}>
                      {t('matches.results.teams.team_b')}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {proposal.sets.map((set) => (
                    <tr key={set.position}>
                      <td {...stylex.props(s.scoreCell)}>{set.team_a_games}</td>
                      <th scope="row" {...stylex.props(s.scoreCell, s.setRowHeading)}>
                        {t('matches.results.setNumber', { number: set.position })}
                      </th>
                      <td {...stylex.props(s.scoreCell)}>{set.team_b_games}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p {...stylex.props(s.impactCopy)}>
                {t(`matches.results.outcome.${proposal.classification}`, {
                  winnerSets: Math.max(wins.team_a, wins.team_b),
                  loserSets: Math.min(wins.team_a, wins.team_b)
                })}
              </p>
            </section>
          </div>
          {proposal.status === 'disputed' ? (
            <>
              {proposal.dispute_evidence && (
                <div>
                  <p {...stylex.props(s.disputeCopy)}>
                    {t('matches.results.disputedBy', {
                      name:
                        proposal.dispute_evidence.rejector_name ??
                        t('matches.results.unknownPlayer'),
                      reason: t(
                        `matches.results.reject.reasons.${rejectionReasonKey(proposal.dispute_evidence.reason_code)}`
                      )
                    })}
                  </p>
                  {proposal.dispute_evidence.reason_note && (
                    <p {...stylex.props(s.impactCopy)}>{proposal.dispute_evidence.reason_note}</p>
                  )}
                </div>
              )}
              <p {...stylex.props(s.impactCopy)}>{t('matches.results.disputedImpact')}</p>
              {proposal.can_correct && (
                <Link
                  to="/matches/$eventId/record"
                  params={{ eventId }}
                  search={{
                    correctionProposalId: proposal.proposal_id,
                    groupNumber: proposal.group_number
                  }}
                  {...stylex.props(s.correctionAction)}
                >
                  {t('matches.results.correctResult')}
                </Link>
              )}
            </>
          ) : (
            <>
              <p {...stylex.props(s.impactCopy)}>
                {t('matches.results.confirmedAt', {
                  confirmedAt: fullDate.format(new Date(proposal.confirmation!.confirmed_at))
                })}
              </p>
              {!proposal.rating_effective && (
                <p {...stylex.props(s.impactCopy)}>{t('matches.results.ratingEffectNone')}</p>
              )}
            </>
          )}
        </>
      )}

      {(proposal.version_timeline.length > 1 || proposal.status === 'disputed') && (
        <details>
          <summary {...stylex.props(base.summary)}>{t('matches.results.timelineTitle')}</summary>
          <ol {...stylex.props(base.recap)}>
            {proposal.version_timeline.map((entry) => (
              <li key={`${entry.version}-${entry.submitted_at}`}>
                <p {...stylex.props(s.resultMeta)}>
                  <span>
                    {t('matches.results.versionLabel', { version: entry.version })} ·{' '}
                    {t(`matches.results.lifecycleStatus.${entry.status}`)}
                  </span>
                  <span>
                    {t('matches.results.submittedByAt', {
                      name: entry.submitted_by_name ?? t('matches.results.unknownPlayer'),
                      submittedAt: fullDate.format(new Date(entry.submitted_at))
                    })}
                  </span>
                </p>
                {entry.decisions.map((decision) => (
                  <p
                    key={`${decision.reviewer_id}-${decision.decided_at}`}
                    {...stylex.props(s.impactCopy)}
                  >
                    {decision.decision === 'reject' && decision.reason_code
                      ? t('matches.results.disputedBy', {
                          name: decision.reviewer_name ?? t('matches.results.unknownPlayer'),
                          reason: t(
                            `matches.results.reject.reasons.${rejectionReasonKey(decision.reason_code)}`
                          )
                        })
                      : t('matches.results.review.decisionRecorded', {
                          decision: t(`matches.results.review.decisions.${decision.decision}`),
                          name: decision.reviewer_name ?? t('matches.results.unknownPlayer')
                        })}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        </details>
      )}

      {stale && (
        <section {...stylex.props(s.inlineFeedback)}>
          <output aria-live="polite" aria-atomic="true">
            {feedbackCopy}
          </output>
          {canReviewCurrent ? (
            <button
              type="button"
              {...stylex.props(base.button)}
              onClick={() => review.clearFeedback()}
            >
              {t('matches.results.review.reviewCurrent')}
            </button>
          ) : (
            <button type="button" {...stylex.props(base.button)} onClick={() => void onRefresh()}>
              {t('matches.results.reload')}
            </button>
          )}
        </section>
      )}
      {feedbackCopy && !rejectOpen && review.feedback?.kind !== 'stale' && (
        <output
          aria-live="polite"
          aria-atomic="true"
          {...stylex.props(
            s.inlineFeedback,
            review.feedback?.kind === 'recorded' ? s.feedbackSuccess : s.feedbackError
          )}
        >
          {feedbackCopy}
        </output>
      )}
      {review.feedback?.kind === 'error' && review.feedback.retryable && review.online && (
        <button
          type="button"
          disabled={review.pending}
          {...stylex.props(base.button)}
          onClick={() => void review.retry()}
        >
          {t('matches.results.review.retry')}
        </button>
      )}
      {pending &&
        !stale &&
        !(
          review.feedback?.kind === 'recorded' &&
          review.feedback.version === proposal.version &&
          review.feedback.status !== 'pending'
        ) &&
        (review.online ? (
          <div {...stylex.props(s.actionRow)}>
            {proposal.can_approve &&
              !(
                review.feedback?.kind === 'recorded' &&
                review.feedback.decision === 'approve' &&
                review.feedback.version === proposal.version
              ) && (
                <button
                  type="button"
                  disabled={review.pending}
                  {...stylex.props(base.button, s.reviewApprove, s.action)}
                  onClick={() => void review.approve()}
                >
                  {t(
                    review.pending
                      ? 'matches.results.review.approving'
                      : 'matches.results.review.approve'
                  )}
                </button>
              )}
            {proposal.can_reject &&
              !(
                review.feedback?.kind === 'recorded' &&
                review.feedback.decision === 'reject' &&
                review.feedback.version === proposal.version
              ) && (
                <button
                  ref={rejectTrigger}
                  type="button"
                  disabled={review.pending}
                  {...stylex.props(base.button, s.action, s.rejectAction)}
                  onClick={() => setRejectOpen(true)}
                >
                  {t('matches.results.review.reject')}
                </button>
              )}
          </div>
        ) : review.feedback?.kind !== 'offline' ? (
          <output aria-live="polite" {...stylex.props(s.inlineFeedback, s.feedbackError)}>
            {t('matches.results.review.offline')}
          </output>
        ) : null)}
      {rejectOpen && (
        <MatchResultRejectDialog
          groupNumber={proposal.group_number}
          submitterName={submitterName}
          triggerRef={rejectTrigger}
          fallbackFocusRef={resultCard}
          pending={review.pending}
          feedbackMessage={
            review.feedback?.kind === 'error'
              ? t(review.feedback.copy)
              : review.feedback?.kind === 'offline'
                ? t('matches.results.review.offline')
                : review.feedback?.kind === 'stale'
                  ? t('matches.results.conflicts.currentProposal', {
                      version: review.feedback.version,
                      status: t(`matches.results.lifecycleStatus.${review.feedback.status}`)
                    })
                  : review.feedback?.kind === 'deadline'
                    ? t(review.feedback.copy)
                    : null
          }
          onClose={() => setRejectOpen(false)}
          onSubmit={submitReject}
        />
      )}
    </article>
  );
}

function CompactResultSummary({
  eventId,
  proposal,
  statusLabel,
  timezone,
  asOf
}: {
  eventId: string;
  proposal: ResultProposal;
  statusLabel: string;
  timezone: string;
  asOf: string;
}) {
  const { t, i18n } = useTranslation();
  const clockKey = `${proposal.proposal_id}:${proposal.version}:${asOf}`;
  const [clock, setClock] = useState(() => ({ key: clockKey, now: Date.parse(asOf) }));
  const now = clock.key === clockKey ? clock.now : Date.parse(asOf);
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;
  const fullDate = new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone
  });
  const submittedAt = fullDate.format(new Date(proposal.submitted_at));
  const countdown = t('matches.results.autoConfirmIn', {
    hours: Math.max(0, Math.ceil((Date.parse(proposal.review_deadline_at) - now) / 3600000))
  });
  const teamNames = (side: 'team_a' | 'team_b') =>
    proposal.teams[side]
      .map((player) => player.display_name ?? t('matches.results.unknownPlayer'))
      .join(' + ');
  const scores = proposal.sets.map((set) => `${set.team_a_games}–${set.team_b_games}`).join(' · ');

  useEffect(() => {
    if (proposal.status !== 'pending') return undefined;
    const seed = Date.parse(asOf);
    const observedAt = performance.now();
    const timer = setInterval(
      () => setClock({ key: clockKey, now: seed + (performance.now() - observedAt) }),
      60000
    );
    return () => clearInterval(timer);
  }, [asOf, clockKey, proposal.status]);

  return (
    <>
      <header {...stylex.props(s.resultHeader)}>
        <h3 {...stylex.props(s.groupHeading)}>
          {t('matches.results.group', { number: proposal.group_number })}
        </h3>
        <span
          {...stylex.props(
            s.statusBadge,
            proposal.status === 'pending'
              ? s.statusPending
              : proposal.status === 'disputed'
                ? s.statusDisputed
                : s.statusConfirmed
          )}
        >
          {statusLabel}
        </span>
      </header>
      <section aria-label={t('matches.results.setScores')} {...stylex.props(s.compactFacts)}>
        <span>
          {t('matches.results.teams.team_a')}: {teamNames('team_a')}
        </span>
        <strong>{scores}</strong>
        <span>
          {t('matches.results.teams.team_b')}: {teamNames('team_b')}
        </span>
      </section>
      <p {...stylex.props(s.resultMeta)}>
        {t('matches.results.versionLabel', { version: proposal.version })} ·{' '}
        {t('matches.results.submittedByAt', {
          name: proposal.submitted_by_name ?? t('matches.results.unknownPlayer'),
          submittedAt
        })}
      </p>
      {proposal.status === 'pending' ? (
        <div {...stylex.props(s.compactLifecycle)}>
          <p {...stylex.props(s.impactCopy)}>{t('matches.results.pendingDescription')}</p>
          <p {...stylex.props(s.approvalProgress)}>
            {t('matches.results.approvalProgress', {
              received: proposal.received_team_coverage_count,
              required: proposal.required_team_coverage_count
            })}
          </p>
          <p role="timer" aria-label={countdown} {...stylex.props(s.countdown)}>
            {countdown}
          </p>
        </div>
      ) : proposal.status === 'disputed' ? (
        <div {...stylex.props(s.compactLifecycle)}>
          {proposal.dispute_evidence && (
            <p {...stylex.props(s.disputeCopy)}>
              {t('matches.results.disputedBy', {
                name: proposal.dispute_evidence.rejector_name ?? t('matches.results.unknownPlayer'),
                reason: t(
                  `matches.results.reject.reasons.${rejectionReasonKey(proposal.dispute_evidence.reason_code)}`
                )
              })}
            </p>
          )}
          {proposal.dispute_evidence?.reason_note && (
            <p {...stylex.props(s.impactCopy)}>{proposal.dispute_evidence.reason_note}</p>
          )}
          <p {...stylex.props(s.impactCopy)}>{t('matches.results.disputedImpact')}</p>
          {proposal.can_correct && (
            <Link
              to="/matches/$eventId/record"
              params={{ eventId }}
              search={{
                correctionProposalId: proposal.proposal_id,
                groupNumber: proposal.group_number
              }}
              {...stylex.props(s.correctionAction)}
            >
              {t('matches.results.correctResult')}
            </Link>
          )}
        </div>
      ) : (
        <div {...stylex.props(s.compactLifecycle)}>
          <p {...stylex.props(s.impactCopy)}>
            {t('matches.results.confirmedAt', {
              confirmedAt: fullDate.format(new Date(proposal.confirmation!.confirmed_at))
            })}
          </p>
          {!proposal.rating_effective && (
            <p {...stylex.props(s.impactCopy)}>{t('matches.results.ratingEffectNone')}</p>
          )}
        </div>
      )}
    </>
  );
}
