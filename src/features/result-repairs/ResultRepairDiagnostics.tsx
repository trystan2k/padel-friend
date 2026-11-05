import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { levelReview as lr } from '../level-reviews/level-review.styles';
import { resultCorrectionStyles as c } from '../matches/result-correction.styles';
import {
  RESULT_REPAIR_FAILURE_CODES,
  RESULT_REPAIR_STATUSES
} from '../matches/result-dispute-model';
import { ResultRepairStatus } from './ResultRepairStatus';
import type {
  ResultRepairAttempt,
  ResultRepairDiagnosticJob,
  ResultRepairDiagnostics as Diagnostics,
  ResultRepairSchedulerHealth
} from './repair-model';
import { getResultRepairAttempts } from './repair.functions';

type Scope = { kind: 'platform' } | { kind: 'community'; communityId: string };

/**
 * Repair queue for operators. Platform Admins see the global queue with scheduler health and
 * attempt evidence; a Community Admin sees only their own community's jobs. Every row carries
 * sanitized codes and counts, never private payloads, so a community view cannot name another
 * community's users or facts.
 */
export function ResultRepairDiagnostics({
  diagnostics,
  scope,
  onRefresh
}: {
  diagnostics: Diagnostics;
  scope: Scope;
  onRefresh: () => void | Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const processing = diagnostics.jobs.some(
    (job) => job.status === 'queued' || job.status === 'running'
  );
  useEffect(() => {
    if (!processing) return undefined;
    const timer = setInterval(() => void onRefresh(), 10_000);
    return () => clearInterval(timer);
  }, [processing, onRefresh]);
  const counts = RESULT_REPAIR_STATUSES.map((status) => ({
    status,
    count: diagnostics.jobs.filter((job) => job.status === status).length
  }));
  const when = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC'
        }).format(new Date(iso))
      : t('matches.corrections.diagnostics.never');
  return (
    <main data-result-route="repair-diagnostics" {...stylex.props(lr.page)}>
      <header {...stylex.props(lr.header)}>
        <div {...stylex.props(lr.headingRow)}>
          <Link
            to={scope.kind === 'platform' ? '/dashboard' : '/community/$communityId/admin'}
            params={scope.kind === 'platform' ? undefined : { communityId: scope.communityId }}
            aria-label={t('matches.corrections.diagnostics.back')}
            {...stylex.props(lr.backLink)}
          >
            ‹
          </Link>
          <h1 {...stylex.props(lr.title)}>{t('matches.corrections.diagnostics.title')}</h1>
        </div>
        <p {...stylex.props(lr.context)}>
          {t(
            scope.kind === 'platform'
              ? 'matches.corrections.diagnostics.platformSubtitle'
              : 'matches.corrections.diagnostics.communitySubtitle'
          )}
        </p>
      </header>
      <button type="button" onClick={() => void onRefresh()} {...stylex.props(c.action)}>
        {t('matches.results.reload')}
      </button>
      {diagnostics.scheduler && <SchedulerHealth scheduler={diagnostics.scheduler} when={when} />}
      <section aria-labelledby="repair-summary-heading" {...stylex.props(c.section)}>
        <h2 id="repair-summary-heading" {...stylex.props(c.sectionTitle)}>
          {t('matches.corrections.diagnostics.summary')}
        </h2>
        <div {...stylex.props(c.tableScroll)}>
          <table {...stylex.props(c.table)}>
            <caption {...stylex.props(c.muted)}>
              {t('matches.corrections.diagnostics.summaryCaption')}
            </caption>
            <thead>
              <tr>
                {counts.map(({ status }) => (
                  <th key={status} scope="col" {...stylex.props(c.cell)}>
                    {t(`matches.corrections.repair.status.${status}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {counts.map(({ status, count }) => (
                  <td key={status} data-repair-count={status} {...stylex.props(c.cell)}>
                    {count}
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      </section>
      <section aria-labelledby="repair-jobs-heading" {...stylex.props(c.section)}>
        <h2 id="repair-jobs-heading" {...stylex.props(c.sectionTitle)}>
          {t('matches.corrections.diagnostics.jobs')}
        </h2>
        {diagnostics.jobs.length === 0 && (
          <p {...stylex.props(c.muted)}>{t('matches.corrections.diagnostics.empty')}</p>
        )}
        {diagnostics.jobs.map((job) => (
          <DiagnosticJob
            key={job.job_id}
            job={job}
            platform={scope.kind === 'platform'}
            onRefresh={onRefresh}
          />
        ))}
      </section>
    </main>
  );
}

function SchedulerHealth({
  scheduler,
  when
}: {
  scheduler: ResultRepairSchedulerHealth;
  when: (iso: string | null) => string;
}) {
  const { t } = useTranslation();
  const statuses: Record<string, string> = {
    succeeded: 'matches.corrections.repair.status.succeeded',
    failed: 'matches.corrections.repair.status.failed',
    running: 'matches.corrections.repair.status.running',
    starting: 'matches.corrections.repair.status.running',
    connecting: 'matches.corrections.repair.status.running',
    sending: 'matches.corrections.repair.status.running'
  };
  return (
    <section
      aria-labelledby="repair-scheduler-heading"
      data-repair-scheduler={scheduler.provisioned ? 'provisioned' : 'missing'}
      {...stylex.props(c.card)}
    >
      <h2 id="repair-scheduler-heading" {...stylex.props(c.sectionTitle)}>
        {t('matches.corrections.diagnostics.scheduler')}
      </h2>
      {!scheduler.provisioned && (
        <p role="alert" {...stylex.props(c.error)}>
          {t(
            scheduler.pg_cron_installed
              ? 'matches.corrections.diagnostics.schedulerMissing'
              : 'matches.corrections.diagnostics.schedulerUnavailable'
          )}
        </p>
      )}
      <p {...stylex.props(c.muted)}>
        {t('matches.corrections.diagnostics.overdue', { count: scheduler.overdue_jobs })}
      </p>
      {scheduler.jobs.length > 0 && (
        <div {...stylex.props(c.tableScroll)}>
          <table {...stylex.props(c.table)}>
            <caption {...stylex.props(c.muted)}>
              {t('matches.corrections.diagnostics.schedulerCaption')}
            </caption>
            <thead>
              <tr>
                <th scope="col" {...stylex.props(c.cell)}>
                  {t('matches.corrections.diagnostics.schedulerJob')}
                </th>
                <th scope="col" {...stylex.props(c.cell)}>
                  {t('matches.corrections.diagnostics.schedulerActive')}
                </th>
                <th scope="col" {...stylex.props(c.cell)}>
                  {t('matches.corrections.diagnostics.schedulerLastRun')}
                </th>
              </tr>
            </thead>
            <tbody>
              {scheduler.jobs.map((job) => (
                <tr key={job.name}>
                  <th scope="row" {...stylex.props(c.cell)}>
                    {job.name}
                  </th>
                  <td {...stylex.props(c.cell)}>
                    {t(
                      job.active
                        ? 'matches.corrections.diagnostics.yes'
                        : 'matches.corrections.diagnostics.no'
                    )}
                  </td>
                  <td {...stylex.props(c.cell)}>
                    {when(job.last_run_at)}
                    {job.last_status
                      ? ` · ${t(statuses[job.last_status] ?? 'matches.corrections.diagnostics.schedulerStatusUnknown')}`
                      : ''}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

function DiagnosticJob({
  job,
  platform,
  onRefresh
}: {
  job: ResultRepairDiagnosticJob;
  platform: boolean;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  const [attempts, setAttempts] = useState<ResultRepairAttempt[] | 'error' | null>(null);
  const disclosure = useRef<HTMLDetailsElement>(null);
  const latest = useRef(0);
  const loadAttempts = useCallback(
    async (expectedCount: number) => {
      const request = ++latest.current;
      try {
        const result = await getResultRepairAttempts({ data: { job_id: job.job_id } });
        if (request === latest.current)
          setAttempts(
            result.status === 'ok' && result.value.length >= expectedCount ? result.value : 'error'
          );
      } catch {
        if (request === latest.current) setAttempts('error');
      }
    },
    [job.job_id]
  );
  useEffect(() => {
    if (platform && disclosure.current?.open) void loadAttempts(job.attempt_count);
  }, [job.attempt_count, loadAttempts, platform]);
  return (
    <article
      aria-label={t('matches.corrections.diagnostics.jobLabel', { id: job.job_id.slice(0, 8) })}
      data-repair-job={job.job_id}
      {...stylex.props(c.section)}
    >
      <h3 {...stylex.props(c.sectionTitle)}>
        {t('matches.corrections.diagnostics.jobHeading', {
          id: job.job_id.slice(0, 8),
          kind: t(`matches.corrections.decisions.${job.kind}`),
          group: job.group_number
        })}
      </h3>
      <ResultRepairStatus job={job} canRetry onChanged={onRefresh} />
      {platform && (
        <details
          ref={disclosure}
          onToggle={(event) => event.currentTarget.open && void loadAttempts(job.attempt_count)}
        >
          <summary {...stylex.props(c.summary)}>
            {t('matches.corrections.diagnostics.attempts')}
          </summary>
          {attempts === 'error' && (
            <p role="alert" {...stylex.props(c.error)}>
              {t('matches.corrections.diagnostics.attemptsUnavailable')}
            </p>
          )}
          {Array.isArray(attempts) && (
            <div {...stylex.props(c.tableScroll)}>
              <table {...stylex.props(c.table)}>
                <caption {...stylex.props(c.muted)}>
                  {t('matches.corrections.diagnostics.attemptsCaption')}
                </caption>
                <thead>
                  <tr>
                    {['attempt', 'status', 'base', 'result', 'failure'].map((key) => (
                      <th key={key} scope="col" {...stylex.props(c.cell)}>
                        {t(`matches.corrections.diagnostics.columns.${key}`)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {attempts.map((attempt) => (
                    <tr key={attempt.attempt_id}>
                      <th scope="row" {...stylex.props(c.cell)}>
                        {attempt.attempt_number}
                      </th>
                      <td {...stylex.props(c.cell)}>
                        {t(
                          attempt.status === 'expired'
                            ? 'matches.corrections.repair.staleLease'
                            : ['running', 'failed', 'succeeded'].includes(attempt.status)
                              ? `matches.corrections.repair.status.${attempt.status}`
                              : 'matches.corrections.diagnostics.schedulerStatusUnknown'
                        )}
                      </td>
                      <td {...stylex.props(c.cell)}>{attempt.base_revision ?? '—'}</td>
                      <td {...stylex.props(c.cell)}>{attempt.result_revision ?? '—'}</td>
                      <td {...stylex.props(c.cell)}>
                        {attempt.failure_code
                          ? t(
                              `matches.corrections.repair.failureCodes.${RESULT_REPAIR_FAILURE_CODES.some((code) => code === attempt.failure_code) ? attempt.failure_code : 'INTERNAL'}`
                            )
                          : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </details>
      )}
    </article>
  );
}
