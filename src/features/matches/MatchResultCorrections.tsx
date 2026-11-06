import * as stylex from '@stylexjs/stylex';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { MatchEventDetail } from './match-contracts';
import type { ResultPlayer, ResultProposal } from './match-result-model';
import { MatchResultAmendmentCard, scoreLine } from './MatchResultAmendmentCard';
import { ResultCorrectionDialog } from './ResultCorrectionDialog';
import { canRequestResultCorrection } from './result-correction-entitlements';
import type { ResultAmendment } from './result-amendment-model';
import { requestResultAmendment, resolveResultDispute } from './result-amendment.functions';
import { resultCorrectionStyles as c } from './result-correction.styles';
import { useCorrectionCommand } from './use-result-correction-command';

export type ResultCorrectionsData = {
  amendments: ResultAmendment[];
  amendmentsError: boolean;
  // Display gate only: every command is authorized again by the server.
  isAdmin: boolean;
  callerId?: string | null;
};

const REPAIR_POLL_MS = 10_000;
const LIVE = new Set(['requested', 'proposal_pending', 'disputed', 'approved_pending_repair']);

/**
 * Correction surfaces of a match: request a correction on a confirmed result, review and resolve
 * the open corrections, and settle a disputed first confirmation as Community Admin. The server
 * grants every command; the buttons only reflect what it reported.
 */
export function MatchResultCorrections({
  event,
  proposals,
  corrections: { amendments, amendmentsError, isAdmin, callerId = null },
  onRefresh
}: {
  event: MatchEventDetail;
  proposals: ResultProposal[];
  corrections: ResultCorrectionsData;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  // An approved correction is applied by a background processor: poll while one is pending so
  // the official facts flip as soon as the repair commits.
  const applying = amendments.some((item) => item.pending_application);
  useEffect(() => {
    if (!applying) return undefined;
    const timer = setInterval(() => void onRefresh(), REPAIR_POLL_MS);
    return () => clearInterval(timer);
  }, [applying, onRefresh]);
  const names = new Map<string, ResultPlayer>();
  for (const proposal of proposals)
    for (const player of [...proposal.teams.team_a, ...proposal.teams.team_b])
      names.set(player.user_id, player);
  const liveProposals = new Set(
    amendments.filter((item) => LIVE.has(item.lifecycle)).map((item) => item.proposal_id)
  );
  const requestable = proposals.filter(
    (proposal) =>
      proposal.status === 'confirmed' &&
      !liveProposals.has(proposal.proposal_id) &&
      canRequestResultCorrection(proposal, event.creator_id, callerId, isAdmin)
  );
  const disputedFirst = isAdmin
    ? proposals.filter(
        (proposal) => proposal.status === 'disputed' && !liveProposals.has(proposal.proposal_id)
      )
    : [];
  if (
    !amendmentsError &&
    amendments.length === 0 &&
    requestable.length === 0 &&
    !disputedFirst.length
  )
    return null;
  return (
    <section
      aria-labelledby="result-corrections-heading"
      data-result-corrections
      {...stylex.props(c.section)}
    >
      <h2 id="result-corrections-heading" {...stylex.props(c.sectionTitle)}>
        {t('matches.corrections.title')}
      </h2>
      {amendmentsError && (
        <p role="alert" {...stylex.props(c.error)}>
          {t('matches.corrections.unavailable')}
        </p>
      )}
      {amendments.map((amendment) => (
        <MatchResultAmendmentCard
          key={amendment.amendment_id}
          amendment={amendment}
          event={event}
          names={names}
          isAdmin={isAdmin}
          onRefresh={onRefresh}
        />
      ))}
      {disputedFirst.map((proposal) => (
        <FirstConfirmationResolution
          key={proposal.proposal_id}
          proposal={proposal}
          onRefresh={onRefresh}
        />
      ))}
      {requestable.map((proposal) => (
        <RequestCorrection key={proposal.proposal_id} proposal={proposal} onRefresh={onRefresh} />
      ))}
    </section>
  );
}

function RequestCorrection({
  proposal,
  onRefresh
}: {
  proposal: ResultProposal;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const command = useCorrectionCommand(onRefresh);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const feedback = command.feedback;
  if (!proposal.confirmation) return null;
  const confirmationId = proposal.confirmation.confirmation_id;
  return (
    <article
      ref={card}
      tabIndex={-1}
      aria-label={t('matches.corrections.requestCardLabel', { number: proposal.group_number })}
      {...stylex.props(c.card)}
    >
      <p {...stylex.props(c.banner)}>{t('matches.corrections.officialLabel')}</p>
      <p {...stylex.props(c.scoreLine)}>
        {t('matches.results.group', { number: proposal.group_number })} · {scoreLine(proposal.sets)}
      </p>
      <p {...stylex.props(c.muted)}>{t('matches.corrections.requestNote')}</p>
      {feedback && feedback.kind === 'done' && (
        <output aria-live="polite" {...stylex.props(c.muted)}>
          {t(feedback.copy)}
        </output>
      )}
      <div {...stylex.props(c.actions)}>
        <button
          ref={trigger}
          type="button"
          {...stylex.props(c.action, c.primary)}
          onClick={() => setOpen(true)}
        >
          {t('matches.corrections.request.open')}
        </button>
      </div>
      {open && (
        <ResultCorrectionDialog
          title={t('matches.corrections.request.title')}
          description={t('matches.corrections.request.description', {
            group: proposal.group_number
          })}
          fieldLabel={t('matches.corrections.request.reason')}
          submitLabel={t('matches.corrections.request.submit')}
          notice={t('matches.corrections.request.notice')}
          pending={command.pending}
          feedbackMessage={feedback && feedback.kind !== 'done' ? t(feedback.copy) : null}
          triggerRef={trigger}
          fallbackFocusRef={card}
          onClose={() => setOpen(false)}
          onSubmit={(reason) =>
            command.run(
              { request: proposal.proposal_id, confirmationId, reason },
              (commandId) =>
                requestResultAmendment({
                  data: {
                    proposal_id: proposal.proposal_id,
                    expected_confirmation_id: confirmationId,
                    reason,
                    command_id: commandId
                  }
                }),
              'matches.corrections.feedback.requested'
            )
          }
        />
      )}
    </article>
  );
}

function FirstConfirmationResolution({
  proposal,
  onRefresh
}: {
  proposal: ResultProposal;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const command = useCorrectionCommand(onRefresh);
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const card = useRef<HTMLElement>(null);
  const feedback = command.feedback;
  return (
    <article
      ref={card}
      tabIndex={-1}
      aria-label={t('matches.corrections.disputeCardLabel', { number: proposal.group_number })}
      data-dispute-resolution
      {...stylex.props(c.card)}
    >
      <p {...stylex.props(c.banner, c.bannerDisputed)}>{t('matches.corrections.disputed')}</p>
      <p {...stylex.props(c.factValue)}>
        {t('matches.results.group', { number: proposal.group_number })} ·{' '}
        {t('matches.results.versionLabel', { version: proposal.version })} ·{' '}
        {scoreLine(proposal.sets)}
      </p>
      <p {...stylex.props(c.muted)}>{t('matches.corrections.disputeImpact')}</p>
      {feedback?.kind === 'done' && (
        <output aria-live="polite" {...stylex.props(c.muted)}>
          {t(feedback.copy)}
        </output>
      )}
      <div {...stylex.props(c.actions)}>
        <button
          ref={trigger}
          type="button"
          {...stylex.props(c.action)}
          onClick={() => setOpen(true)}
        >
          {t('matches.corrections.resolve.open')}
        </button>
      </div>
      {open && (
        <ResultCorrectionDialog
          title={t('matches.corrections.resolve.title')}
          description={t('matches.corrections.resolve.description', {
            group: proposal.group_number
          })}
          decisionLegend={t('matches.corrections.resolve.legend')}
          decisions={(['uphold', 'void'] as const).map((value) => ({
            value,
            label: t(`matches.corrections.resolve.firstOptions.${value}`),
            hint: t(`matches.corrections.resolve.firstHints.${value}`)
          }))}
          fieldLabel={t('matches.corrections.resolve.justification')}
          submitLabel={t('matches.corrections.resolve.submit')}
          notice={t('matches.corrections.resolve.notice')}
          pending={command.pending}
          feedbackMessage={feedback && feedback.kind !== 'done' ? t(feedback.copy) : null}
          triggerRef={trigger}
          fallbackFocusRef={card}
          onClose={() => setOpen(false)}
          onSubmit={(justification, decision) =>
            decision === null
              ? Promise.resolve(false)
              : command.run(
                  {
                    resolve: proposal.proposal_id,
                    version: proposal.version,
                    decision,
                    justification
                  },
                  (commandId) =>
                    resolveResultDispute({
                      data: {
                        proposal_id: proposal.proposal_id,
                        expected_base_confirmation_id: null,
                        expected_candidate_version: proposal.version,
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
