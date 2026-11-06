import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ResultRepairStatus } from '../result-repairs/ResultRepairStatus';
import type { MatchEventDetail } from './match-contracts';
import type { ResultPlayer, ResultRejectionReason, ResultSetRow } from './match-result-model';
import type { ResultAmendment } from './result-amendment-model';
import {
  cancelResultAmendment,
  resolveResultDispute,
  reviewResultAmendment
} from './result-amendment.functions';
import { MatchResultRejectDialog } from './MatchResultRejectDialog';
import { ResultCorrectionDialog } from './ResultCorrectionDialog';
import { resultCorrectionStyles as c } from './result-correction.styles';
import { useCorrectionCommand } from './use-result-correction-command';

export function scoreLine(sets: ResultSetRow[]) {
  return sets.map((set) => `${set.team_a_games}–${set.team_b_games}`).join(', ');
}

const shortId = (id: string) => id.slice(0, 8);

/**
 * One result correction: the proposed result beside the reason, the review and resolution actions
 * the server grants, the honest application state (approved is not applied), and the audit chain.
 */
export function MatchResultAmendmentCard({
  amendment,
  event,
  names,
  isAdmin,
  onRefresh
}: {
  amendment: ResultAmendment;
  event: MatchEventDetail;
  names: Map<string, ResultPlayer>;
  isAdmin: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const command = useCorrectionCommand(onRefresh);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [resolveOpen, setResolveOpen] = useState(false);
  const rejectTrigger = useRef<HTMLButtonElement>(null);
  const resolveTrigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const locale = i18n.language === 'en' ? 'en-GB' : i18n.language;
  const when = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: event.timezone
    }).format(new Date(iso));
  const candidate = amendment.candidate;
  const playerName = (id: string) =>
    names.get(id)?.display_name ?? t('matches.results.unknownPlayer');
  const teamLine = (ids: readonly string[]) => ids.map(playerName).join(' + ');
  const tone =
    amendment.lifecycle === 'disputed' || amendment.lifecycle === 'rejected'
      ? c.bannerDisputed
      : amendment.lifecycle === 'applied' || amendment.lifecycle === 'canceled'
        ? null
        : c.bannerPending;
  const reviewing = amendment.lifecycle === 'proposal_pending' && candidate !== null;
  const feedback = command.feedback;
  const failureCopy = feedback && feedback.kind !== 'done' ? t(feedback.copy) : null;

  async function review(
    decision: 'approve' | 'reject',
    reasonCode: ResultRejectionReason | null,
    reasonNote: string | null
  ) {
    if (!candidate) return false;
    return command.run(
      { amendment: amendment.amendment_id, version: candidate.version, decision, reasonCode },
      (commandId) =>
        reviewResultAmendment({
          data: {
            amendment_id: amendment.amendment_id,
            expected_base_confirmation_id: amendment.base_confirmation_id,
            expected_candidate_version: candidate.version,
            decision,
            reason_code: reasonCode,
            reason_note: reasonNote,
            command_id: commandId
          }
        }),
      decision === 'approve'
        ? 'matches.corrections.feedback.approved'
        : 'matches.corrections.feedback.rejected'
    );
  }

  return (
    <article
      ref={card}
      tabIndex={-1}
      id={`amendment-${amendment.amendment_id}`}
      aria-label={t('matches.corrections.cardLabel', { number: amendment.group_number })}
      data-amendment-lifecycle={amendment.lifecycle}
      data-pending-application={amendment.pending_application}
      {...stylex.props(c.card)}
    >
      <p {...stylex.props(c.banner, tone)}>
        {t(`matches.corrections.lifecycle.${amendment.lifecycle}`)}
      </p>
      <h3 {...stylex.props(c.sectionTitle)}>
        {t('matches.corrections.cardTitle', { number: amendment.group_number })}
      </h3>
      <p {...stylex.props(c.muted)}>
        {t('matches.corrections.requestedAt', { date: when(amendment.requested_at) })}
      </p>
      <dl {...stylex.props(c.facts)}>
        <dt {...stylex.props(c.factLabel)}>{t('matches.corrections.reason')}</dt>
        <dd {...stylex.props(c.factValue)}>{amendment.reason}</dd>
      </dl>

      {candidate && (
        <section
          aria-label={t('matches.corrections.proposed')}
          {...stylex.props(c.card, c.proposed)}
        >
          <h4 {...stylex.props(c.factLabel)}>
            {t('matches.corrections.proposedVersion', { version: candidate.version })}
          </h4>
          <p {...stylex.props(c.newScore)}>{scoreLine(candidate.sets)}</p>
          <p {...stylex.props(c.muted)}>
            {t('matches.results.teams.team_a')}: {teamLine(candidate.teams.team_a)}
          </p>
          <p {...stylex.props(c.muted)}>
            {t('matches.results.teams.team_b')}: {teamLine(candidate.teams.team_b)}
          </p>
          <p {...stylex.props(c.muted)}>
            {t('matches.corrections.proposedBy', {
              name: playerName(candidate.submitted_by),
              date: when(candidate.submitted_at)
            })}
          </p>
          {reviewing && (
            <>
              <p {...stylex.props(c.muted)}>
                {t('matches.corrections.autoConfirm', {
                  deadline: when(candidate.review_deadline_at)
                })}
              </p>
              <p {...stylex.props(c.muted)}>
                {t('matches.results.approvalProgress', {
                  received: candidate.received_team_coverage_count,
                  required: candidate.required_team_coverage_count
                })}
              </p>
              <p {...stylex.props(c.muted)}>{t('matches.corrections.rejectBlocks')}</p>
            </>
          )}
        </section>
      )}

      {amendment.pending_application && (
        <output {...stylex.props(c.banner, c.bannerPending)}>
          {t('matches.corrections.pendingApplication')}
        </output>
      )}
      {amendment.repair && (
        <ResultRepairStatus
          job={amendment.repair}
          canRetry={isAdmin}
          onChanged={onRefresh}
          timezone={event.timezone}
        />
      )}

      {amendment.resolution && (
        <p {...stylex.props(c.muted)}>
          {t('matches.corrections.resolvedBy', {
            decision: t(`matches.corrections.decisions.${amendment.resolution.decision}`),
            justification: amendment.resolution.justification
          })}
        </p>
      )}
      {amendment.decision?.source === 'ADMIN_OVERRIDE' && (
        <p {...stylex.props(c.muted)}>{t('matches.corrections.adminOverride')}</p>
      )}

      {feedback && (
        <output
          aria-live="polite"
          aria-atomic="true"
          {...stylex.props(feedback.kind === 'done' ? c.muted : c.error)}
        >
          {t(feedback.copy)}
        </output>
      )}

      <div {...stylex.props(c.actions)}>
        {amendment.can_submit_candidate && (
          <Link
            to="/matches/$eventId/record"
            params={{ eventId: event.event_id }}
            search={{
              correctionProposalId: amendment.proposal_id,
              groupNumber: amendment.group_number,
              amendmentId: amendment.amendment_id
            }}
            {...stylex.props(c.action, c.primary)}
          >
            {t(candidate ? 'matches.corrections.resubmit' : 'matches.corrections.submitCandidate')}
          </Link>
        )}
        {reviewing && amendment.can_approve && (
          <button
            type="button"
            disabled={command.pending}
            {...stylex.props(c.action, c.primary)}
            onClick={() => void review('approve', null, null)}
          >
            {t('matches.results.review.approve')}
          </button>
        )}
        {reviewing && amendment.can_reject && (
          <button
            ref={rejectTrigger}
            type="button"
            disabled={command.pending}
            {...stylex.props(c.action, c.danger)}
            onClick={() => setRejectOpen(true)}
          >
            {t('matches.results.review.reject')}
          </button>
        )}
        {amendment.can_resolve && candidate && (
          <button
            ref={resolveTrigger}
            type="button"
            disabled={command.pending}
            {...stylex.props(c.action)}
            onClick={() => setResolveOpen(true)}
          >
            {t('matches.corrections.resolve.open')}
          </button>
        )}
        {amendment.can_cancel && (
          <button
            type="button"
            disabled={command.pending}
            {...stylex.props(c.action)}
            onClick={() =>
              void command.run(
                { cancel: amendment.amendment_id },
                (commandId) =>
                  cancelResultAmendment({
                    data: { amendment_id: amendment.amendment_id, command_id: commandId }
                  }),
                'matches.corrections.feedback.canceled'
              )
            }
          >
            {t('matches.corrections.cancel')}
          </button>
        )}
      </div>

      <details>
        <summary {...stylex.props(c.summary)}>{t('matches.corrections.history')}</summary>
        <ol {...stylex.props(c.list)}>
          <li>
            {t('matches.corrections.historyRequested', { date: when(amendment.requested_at) })}
          </li>
          {candidate && (
            <li>
              {t('matches.corrections.historyCandidate', {
                version: candidate.version,
                date: when(candidate.submitted_at)
              })}
            </li>
          )}
          {candidate && (
            <li>
              {t('matches.corrections.historyReviews', {
                teamA: candidate.team_a_approval_count,
                teamB: candidate.team_b_approval_count,
                received: candidate.received_team_coverage_count,
                required: candidate.required_team_coverage_count
              })}
            </li>
          )}
          {amendment.decision && (
            <li>
              {t('matches.corrections.historyDecision', {
                source: t(`matches.corrections.sources.${amendment.decision.source}`),
                date: when(amendment.decision.decided_at)
              })}
            </li>
          )}
          {amendment.resolution && (
            <li>
              {t('matches.corrections.historyResolution', {
                decision: t(`matches.corrections.decisions.${amendment.resolution.decision}`),
                date: when(amendment.resolution.decided_at)
              })}
            </li>
          )}
          {amendment.repair && (
            <li>
              {t('matches.corrections.historyRepair', {
                status: t(`matches.corrections.repair.status.${amendment.repair.status}`),
                attempts: amendment.repair.attempt_count
              })}
              {amendment.repair.committed_revision !== null &&
                ` · ${t('matches.corrections.repair.revision')} ${amendment.repair.committed_revision}`}
            </li>
          )}
          <li>
            {amendment.official_confirmation_id &&
            amendment.official_confirmation_id !== amendment.base_confirmation_id
              ? t('matches.corrections.historyRevisionApplied', {
                  base: shortId(amendment.base_confirmation_id),
                  version: amendment.base_version,
                  current: shortId(amendment.official_confirmation_id)
                })
              : t('matches.corrections.historyRevisionPending', {
                  base: shortId(amendment.base_confirmation_id),
                  version: amendment.base_version
                })}
          </li>
          <li>
            {t('matches.corrections.historyReference', {
              amendment: shortId(amendment.amendment_id),
              job: amendment.repair_job_id ? shortId(amendment.repair_job_id) : '—'
            })}
          </li>
        </ol>
      </details>

      {rejectOpen && candidate && (
        <MatchResultRejectDialog
          groupNumber={amendment.group_number}
          submitterName={playerName(candidate.submitted_by)}
          triggerRef={rejectTrigger}
          fallbackFocusRef={card}
          pending={command.pending}
          feedbackMessage={failureCopy}
          onClose={() => setRejectOpen(false)}
          onSubmit={(reasonCode, note) => review('reject', reasonCode, note)}
        />
      )}
      {resolveOpen && candidate && (
        <ResultCorrectionDialog
          title={t('matches.corrections.resolve.title')}
          description={t('matches.corrections.resolve.description', {
            group: amendment.group_number
          })}
          decisionLegend={t('matches.corrections.resolve.legend')}
          decisions={(['uphold', 'replace', 'void'] as const).map((value) => ({
            value,
            label: t(`matches.corrections.resolve.options.${value}`),
            hint: t(`matches.corrections.resolve.hints.${value}`)
          }))}
          fieldLabel={t('matches.corrections.resolve.justification')}
          submitLabel={t('matches.corrections.resolve.submit')}
          notice={t('matches.corrections.resolve.notice')}
          pending={command.pending}
          feedbackMessage={failureCopy}
          triggerRef={resolveTrigger}
          fallbackFocusRef={card}
          onClose={() => setResolveOpen(false)}
          onSubmit={(justification, decision) =>
            decision === null
              ? Promise.resolve(false)
              : command.run(
                  {
                    resolve: amendment.proposal_id,
                    version: candidate.version,
                    decision,
                    justification
                  },
                  (commandId) =>
                    resolveResultDispute({
                      data: {
                        proposal_id: amendment.proposal_id,
                        expected_base_confirmation_id: amendment.base_confirmation_id,
                        expected_candidate_version: candidate.version,
                        decision,
                        justification,
                        command_id: commandId
                      }
                    }),
                  'matches.corrections.feedback.resolved'
                )
          }
        />
      )}
    </article>
  );
}
