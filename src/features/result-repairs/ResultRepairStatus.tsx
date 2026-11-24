import { Dialog } from '@base-ui/react/dialog';
import * as stylex from '@stylexjs/stylex';
import { useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '../../components/ui/Button';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { isOffline, isTransportFailure } from '../../lib/connectivity';
import { matchResultReviewStyles as s } from '../matches/match-result.styles';
import type { ResultRepairJob } from '../matches/result-dispute-model';
import { RepairIcon } from './RepairIcon';
import { repairDiagnostics as rd } from './repair-diagnostics.styles';
import type { ResultRepairDiagnosticJob, ResultRepairErrorCode } from './repair-model';
import { retryResultRepair } from './repair.functions';

const statusBadges = {
  failed: { tone: 'danger', icon: 'failed' },
  queued: { tone: 'provisional', icon: 'clock' },
  running: { tone: 'neutral', icon: 'play' },
  succeeded: { tone: 'positive', icon: 'check' }
} as const;

type RetryFeedback =
  | { kind: 'succeeded' | 'failed' | 'stale' | 'busy' }
  | { kind: 'error'; code: ResultRepairErrorCode | 'offline' | 'unconfirmed' };

/**
 * Honest application state of one correction job. Queued, running and failed repairs read as
 * "not applied yet": only a committed (succeeded) job with a revision is shown as applied.
 */
export function ResultRepairStatus({
  job,
  canRetry,
  onChanged,
  timezone,
  embedded = false,
  heading
}: {
  job: ResultRepairJob | ResultRepairDiagnosticJob;
  canRetry: boolean;
  onChanged: () => void | Promise<void>;
  timezone?: string;
  // Rendered inside a job card that already provides the surface.
  embedded?: boolean;
  heading?: ReactNode;
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

  const { tone, icon } = statusBadges[job.status];

  async function retry() {
    if (isOffline()) {
      setFeedback({ kind: 'error', code: 'offline' });
      return false;
    }
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
    } catch (error) {
      const unknownOutcome = isTransportFailure(error);
      setFeedback({ kind: 'error', code: unknownOutcome ? 'unconfirmed' : 'unavailable' });
      if (unknownOutcome) await Promise.resolve(onChanged()).catch(() => undefined);
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
      {...stylex.props(embedded ? rd.job : rd.card)}
    >
      <div {...stylex.props(rd.jobHeader)}>
        {heading}
        <output aria-live="polite" aria-atomic="true">
          <StatusBadge tone={tone} xstyle={rd.badge}>
            <RepairIcon name={icon} size={14} />
            {t(`matches.corrections.repair.status.${job.status}`)}
          </StatusBadge>
        </output>
      </div>
      <p {...stylex.props(rd.muted)}>
        {t(`matches.corrections.repair.publication.${job.publication}`)}
      </p>
      <dl {...stylex.props(rd.facts)}>
        <dt {...stylex.props(rd.detailLabel)}>{t('matches.corrections.repair.attempts')}</dt>
        <dd {...stylex.props(rd.detailValue)}>{job.attempt_count}</dd>
        <dt {...stylex.props(rd.detailLabel)}>{t('matches.corrections.repair.requestedAt')}</dt>
        <dd {...stylex.props(rd.detailValue)}>{when(job.requested_at)}</dd>
        {job.failure_code && (
          <>
            <dt {...stylex.props(rd.detailLabel)}>{t('matches.corrections.repair.failure')}</dt>
            <dd {...stylex.props(rd.detailValue, rd.error)}>
              {t(`matches.corrections.repair.failureCodes.${job.failure_code}`)}
              {'failure_stage' in job &&
                job.failure_stage &&
                ` · ${t(`matches.corrections.repair.stages.${job.failure_stage}`)}`}
            </dd>
          </>
        )}
        {job.next_attempt_at && job.status === 'failed' && (
          <>
            <dt {...stylex.props(rd.detailLabel)}>{t('matches.corrections.repair.nextAttempt')}</dt>
            <dd {...stylex.props(rd.detailValue)}>{when(job.next_attempt_at)}</dd>
          </>
        )}
        {job.committed_revision !== null && (
          <>
            <dt {...stylex.props(rd.detailLabel)}>{t('matches.corrections.repair.revision')}</dt>
            <dd {...stylex.props(rd.detailValue)}>{job.committed_revision}</dd>
          </>
        )}
      </dl>
      {stale && <p {...stylex.props(rd.error)}>{t('matches.corrections.repair.staleLease')}</p>}
      <output aria-live="polite" aria-atomic="true" {...stylex.props(rd.muted)}>
        {feedback &&
          (feedback.kind === 'error'
            ? t(`matches.corrections.repair.retryErrors.${feedback.code}`)
            : t(`matches.corrections.repair.retryOutcome.${feedback.kind}`))}
      </output>
      {canRetry && retryable && (
        <Button
          ref={trigger}
          variant="secondary"
          disabled={pending}
          onClick={() => {
            setFeedback(null);
            setConfirming(true);
          }}
        >
          {t('matches.corrections.repair.retry')}
        </Button>
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
                {...stylex.props(s.reviewPopup, rd.retryPopup)}
              >
                <header {...stylex.props(s.dialogHeader)}>
                  <Dialog.Title {...stylex.props(rd.sectionHeading)}>
                    {t('matches.corrections.repair.confirmTitle')}
                  </Dialog.Title>
                  <Dialog.Description {...stylex.props(rd.muted)}>
                    {t('matches.corrections.repair.confirmBody')}
                  </Dialog.Description>
                </header>
                {feedback?.kind === 'error' && (
                  <p role="alert" {...stylex.props(s.dialogError)}>
                    {t(`matches.corrections.repair.retryErrors.${feedback.code}`)}
                  </p>
                )}
                <div {...stylex.props(rd.retryActions)}>
                  <Dialog.Close
                    render={<Button variant="secondary" xstyle={rd.retryAction} />}
                    disabled={pending}
                  >
                    {t('matches.corrections.dialog.cancel')}
                  </Dialog.Close>
                  <Button
                    busy={pending}
                    xstyle={rd.retryAction}
                    onClick={() => void retry().then((done) => done && setConfirming(false))}
                  >
                    {pending
                      ? t('matches.corrections.dialog.submitting')
                      : t('matches.corrections.repair.confirmAction')}
                  </Button>
                </div>
              </Dialog.Popup>
            </Dialog.Viewport>
          </Dialog.Portal>
        </Dialog.Root>
      )}
    </section>
  );
}
