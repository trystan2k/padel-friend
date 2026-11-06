import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  matchResultReviewStyles as s,
  matchResultStyles as base
} from '../matches/match-result.styles';
import { resultCorrectionStyles as c } from '../matches/result-correction.styles';
import type { ResultRepairJob } from '../matches/result-dispute-model';
import type { ResultRepairDiagnosticJob, ResultRepairErrorCode } from './repair-model';
import { retryResultRepair } from './repair.functions';

type RetryFeedback =
  | { kind: 'succeeded' | 'failed' | 'stale' | 'busy' }
  | { kind: 'error'; code: ResultRepairErrorCode };

/**
 * Honest application state of one correction job. Queued, running and failed repairs read as
 * "not applied yet": only a committed (succeeded) job with a revision is shown as applied.
 */
export function ResultRepairStatus({
  job,
  canRetry,
  onChanged,
  timezone,
  embedded = false
}: {
  job: ResultRepairJob | ResultRepairDiagnosticJob;
  canRetry: boolean;
  onChanged: () => void | Promise<void>;
  timezone?: string;
  // Rendered inside a job card that already provides the surface.
  embedded?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const [confirming, setConfirming] = useState(false);
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<RetryFeedback | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const fallback = useRef<HTMLElement>(null);
  const when = (iso: string) =>
    new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : i18n.language, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: timezone ?? 'UTC'
    }).format(new Date(iso));
  const stale = 'stale_lease' in job && job.stale_lease;
  const retryable = job.status === 'failed' ? !('retryable' in job) || job.retryable : stale;

  async function retry() {
    setFeedback(null);
    setPending(true);
    try {
      const result = await retryResultRepair({ data: { job_id: job.job_id } });
      setFeedback(
        result.status === 'ok'
          ? { kind: result.value.outcome }
          : { kind: 'error', code: result.code }
      );
      await onChanged();
      return true;
    } catch {
      setFeedback({ kind: 'error', code: 'unavailable' });
      return false;
    } finally {
      setPending(false);
    }
  }

  return (
    <section
      ref={fallback}
      tabIndex={-1}
      aria-label={t('matches.corrections.repair.title')}
      data-repair-status={job.status}
      data-repair-publication={job.publication}
      {...stylex.props(c.card, embedded && c.cardEmbedded)}
    >
      <output
        aria-live="polite"
        aria-atomic="true"
        {...stylex.props(
          c.chip,
          job.status === 'failed' && c.bannerDisputed,
          job.status !== 'succeeded' && job.status !== 'failed' && c.bannerPending
        )}
      >
        {t(`matches.corrections.repair.status.${job.status}`)}
      </output>
      <p {...stylex.props(c.muted)}>
        {t(`matches.corrections.repair.publication.${job.publication}`)}
      </p>
      <dl {...stylex.props(c.facts)}>
        <dt {...stylex.props(c.factLabel)}>{t('matches.corrections.repair.attempts')}</dt>
        <dd {...stylex.props(c.factValue, c.factCompact)}>{job.attempt_count}</dd>
        <dt {...stylex.props(c.factLabel)}>{t('matches.corrections.repair.requestedAt')}</dt>
        <dd {...stylex.props(c.factValue, c.factCompact)}>{when(job.requested_at)}</dd>
        {job.failure_code && (
          <>
            <dt {...stylex.props(c.factLabel)}>{t('matches.corrections.repair.failure')}</dt>
            <dd {...stylex.props(c.factValue, c.factCompact, c.error)}>
              {t(`matches.corrections.repair.failureCodes.${job.failure_code}`)}
              {'failure_stage' in job &&
                job.failure_stage &&
                ` · ${t(`matches.corrections.repair.stages.${job.failure_stage}`)}`}
            </dd>
          </>
        )}
        {job.next_attempt_at && job.status === 'failed' && (
          <>
            <dt {...stylex.props(c.factLabel)}>{t('matches.corrections.repair.nextAttempt')}</dt>
            <dd {...stylex.props(c.factValue, c.factCompact)}>{when(job.next_attempt_at)}</dd>
          </>
        )}
        {job.committed_revision !== null && (
          <>
            <dt {...stylex.props(c.factLabel)}>{t('matches.corrections.repair.revision')}</dt>
            <dd {...stylex.props(c.factValue, c.factCompact)}>{job.committed_revision}</dd>
          </>
        )}
      </dl>
      {stale && <p {...stylex.props(c.error)}>{t('matches.corrections.repair.staleLease')}</p>}
      <output aria-live="polite" aria-atomic="true" {...stylex.props(c.muted)}>
        {feedback &&
          (feedback.kind === 'error'
            ? t(`matches.corrections.repair.retryErrors.${feedback.code}`)
            : t(`matches.corrections.repair.retryOutcome.${feedback.kind}`))}
      </output>
      {canRetry && retryable && (
        <div {...stylex.props(c.actions)}>
          <button
            ref={trigger}
            type="button"
            disabled={pending}
            data-emphasis="primary"
            {...stylex.props(c.action, c.primary)}
            onClick={() => {
              setFeedback(null);
              setConfirming(true);
            }}
          >
            {t('matches.corrections.repair.retry')}
          </button>
        </div>
      )}
      {confirming && (
        <Dialog.Root
          open
          onOpenChange={(open) => {
            if (!open && !pending) setConfirming(false);
          }}
          disablePointerDismissal={pending}
        >
          <Dialog.Portal>
            <Dialog.Backdrop {...stylex.props(s.reviewBackdrop)} />
            <Dialog.Viewport {...stylex.props(s.reviewViewport)}>
              <Dialog.Popup
                finalFocus={() =>
                  trigger.current?.isConnected ? trigger.current : fallback.current
                }
                {...stylex.props(s.reviewPopup)}
              >
                <header {...stylex.props(s.dialogHeader)}>
                  <Dialog.Title {...stylex.props(s.dialogTitle, c.retryDialogTitle)}>
                    {t('matches.corrections.repair.confirmTitle')}
                  </Dialog.Title>
                  <Dialog.Description
                    {...stylex.props(s.dialogDescription, c.retryDialogDescription)}
                  >
                    {t('matches.corrections.repair.confirmBody')}
                  </Dialog.Description>
                </header>
                {feedback?.kind === 'error' && (
                  <p role="alert" {...stylex.props(s.dialogError)}>
                    {t(`matches.corrections.repair.retryErrors.${feedback.code}`)}
                  </p>
                )}
                <div {...stylex.props(s.dialogActions)}>
                  <Dialog.Close
                    disabled={pending}
                    type="button"
                    {...stylex.props(base.button, s.dialogAction, c.dialogActionLabel)}
                  >
                    {t('matches.corrections.dialog.cancel')}
                  </Dialog.Close>
                  <button
                    type="button"
                    disabled={pending}
                    {...stylex.props(base.button, s.dialogAction, c.primary, c.dialogActionLabel)}
                    onClick={() => void retry().then((done) => done && setConfirming(false))}
                  >
                    {pending
                      ? t('matches.corrections.dialog.submitting')
                      : t('matches.corrections.repair.confirmAction')}
                  </button>
                </div>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}
