import * as stylex from '@stylexjs/stylex';
import { Link } from '@tanstack/react-router';
import { useEffect, useState, type KeyboardEvent } from 'react';
import { useTranslation } from 'react-i18next';
import { levelReview as lr } from '../level-reviews/level-review.styles';
import { resultCorrectionStyles as c } from '../matches/result-correction.styles';
import {
  RESULT_REPAIR_FAILURE_CODES,
  RESULT_REPAIR_STATUSES
} from '../matches/result-dispute-model';
import { ResultRepairStatus } from './ResultRepairStatus';
import { repairDiagnostics as rd } from './repair-diagnostics.styles';
import type {
  ResultRepairAttempt,
  ResultRepairDiagnosticJob,
  ResultRepairDiagnostics as Diagnostics,
  ResultRepairSchedulerHealth
} from './repair-model';
import { getResultRepairAttempts } from './repair.functions';

type Scope = { kind: 'platform' } | { kind: 'community'; communityId: string };
type When = (iso: string | null) => string;

/**
 * Repair queue for operators. Platform Admins see the global queue with scheduler health and
 * attempt evidence; a Community Admin sees only their own community's jobs. Every row carries
 * sanitized codes and counts, never private payloads, so a community view cannot name another
 * community's users or facts. Selecting a queue job shows its detail in the adjacent region
 * (stacked after the queue on narrow screens).
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
  const [selectedId, setSelectedId] = useState<string | null>(null);
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
  // The first job is selected until the operator picks another; a job that left the queue falls back too.
  const selected = diagnostics.jobs.find((job) => job.job_id === selectedId) ?? diagnostics.jobs[0];
  const when: When = (iso) =>
    iso
      ? new Intl.DateTimeFormat(i18n.language === 'en' ? 'en-GB' : i18n.language, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC'
        }).format(new Date(iso))
      : t('matches.corrections.diagnostics.never');
  const moveFocus = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const buttons = [
      ...(event.currentTarget
        .closest('[data-repair-region]')
        ?.querySelectorAll<HTMLButtonElement>('[data-repair-select]') ?? [])
    ];
    const index = buttons.indexOf(event.currentTarget);
    event.preventDefault();
    buttons[
      (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    ]?.focus();
  };
  return (
    <main data-result-route="repair-diagnostics" {...stylex.props(rd.page)}>
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
          <h1 {...stylex.props(rd.title)}>{t('matches.corrections.diagnostics.title')}</h1>
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
      <div {...stylex.props(rd.regions)}>
        <div data-repair-region="queue" {...stylex.props(rd.region)}>
          <section aria-labelledby="repair-jobs-heading" {...stylex.props(c.section)}>
            <h2 id="repair-jobs-heading" {...stylex.props(rd.sectionHeading)}>
              {t('matches.corrections.diagnostics.jobs')}
            </h2>
            {diagnostics.jobs.length === 0 && (
              <p {...stylex.props(c.muted)}>{t('matches.corrections.diagnostics.empty')}</p>
            )}
            {diagnostics.jobs.map((job) => (
              <DiagnosticJob
                key={job.job_id}
                job={job}
                selected={job.job_id === selected?.job_id}
                onSelect={() => setSelectedId(job.job_id)}
                onKeyDown={moveFocus}
                onRefresh={onRefresh}
              />
            ))}
          </section>
        </div>
        <div data-repair-region="detail" {...stylex.props(rd.region)}>
          {selected ? (
            <JobDetail
              key={selected.job_id}
              job={selected}
              platform={scope.kind === 'platform'}
              when={when}
            />
          ) : (
            <section aria-labelledby="repair-detail-heading" {...stylex.props(c.card)}>
              <h2 id="repair-detail-heading" {...stylex.props(rd.sectionHeading)}>
                {t('matches.corrections.diagnostics.detail')}
              </h2>
              <p {...stylex.props(c.muted)}>{t('matches.corrections.diagnostics.detailEmpty')}</p>
            </section>
          )}
          <section aria-labelledby="repair-summary-heading" {...stylex.props(c.section)}>
            <h2 id="repair-summary-heading" {...stylex.props(rd.sectionHeading)}>
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
        </div>
      </div>
    </main>
  );
}

function SchedulerHealth({
  scheduler,
  when
}: {
  scheduler: ResultRepairSchedulerHealth;
  when: When;
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
      <h2 id="repair-scheduler-heading" {...stylex.props(rd.sectionHeading)}>
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
  selected,
  onSelect,
  onKeyDown,
  onRefresh
}: {
  job: ResultRepairDiagnosticJob;
  selected: boolean;
  onSelect: () => void;
  onKeyDown: (event: KeyboardEvent<HTMLButtonElement>) => void;
  onRefresh: () => void | Promise<void>;
}) {
  const { t } = useTranslation();
  return (
    <article
      aria-label={t('matches.corrections.diagnostics.jobLabel', { id: job.job_id.slice(0, 8) })}
      data-repair-job={job.job_id}
      data-selected={selected}
      {...stylex.props(c.card, rd.job, selected && rd.jobSelected)}
    >
      <h3 {...stylex.props(c.sectionTitle)}>
        <button
          type="button"
          data-repair-select
          aria-current={selected ? 'true' : undefined}
          onClick={onSelect}
          onKeyDown={onKeyDown}
          {...stylex.props(rd.jobSelect)}
        >
          {t('matches.corrections.diagnostics.jobHeading', {
            id: job.job_id.slice(0, 8),
            kind: t(`matches.corrections.decisions.${job.kind}`),
            group: job.group_number
          })}
        </button>
      </h3>
      <ResultRepairStatus job={job} canRetry embedded onChanged={onRefresh} />
    </article>
  );
}

/** Detail of the selected job: attempt timeline (Platform Admin), official revision, correlation ID. */
function JobDetail({
  job,
  platform,
  when
}: {
  job: ResultRepairDiagnosticJob;
  platform: boolean;
  when: When;
}) {
  const { t } = useTranslation();
  const [attempts, setAttempts] = useState<ResultRepairAttempt[] | 'error' | null>(null);
  // Re-read when the repair attempt count changes; the cleanup drops an older read that lands late.
  useEffect(() => {
    if (!platform) return undefined;
    let current = true;
    getResultRepairAttempts({ data: { job_id: job.job_id } })
      .then((result) => {
        if (current)
          setAttempts(
            result.status === 'ok' && result.value.length >= job.attempt_count
              ? result.value
              : 'error'
          );
      })
      .catch(() => {
        if (current) setAttempts('error');
      });
    return () => {
      current = false;
    };
  }, [job.job_id, job.attempt_count, platform]);
  const committed = job.committed_revision;
  const before = Array.isArray(attempts)
    ? attempts.find((attempt) => attempt.result_revision === committed)?.base_revision
    : null;
  return (
    <section
      aria-labelledby="repair-detail-heading"
      data-repair-detail={job.job_id}
      {...stylex.props(c.card)}
    >
      <h2 id="repair-detail-heading" {...stylex.props(rd.sectionHeading)}>
        {t('matches.corrections.diagnostics.detail')}
      </h2>
      <p {...stylex.props(c.muted)}>
        {t('matches.corrections.diagnostics.jobHeading', {
          id: job.job_id.slice(0, 8),
          kind: t(`matches.corrections.decisions.${job.kind}`),
          group: job.group_number
        })}
      </p>
      {platform && (
        <div {...stylex.props(rd.job)}>
          <h3 {...stylex.props(rd.subHeading)}>{t('matches.corrections.diagnostics.timeline')}</h3>
          {attempts === 'error' && (
            <p role="alert" {...stylex.props(c.error)}>
              {t('matches.corrections.diagnostics.attemptsUnavailable')}
            </p>
          )}
          {Array.isArray(attempts) &&
            (attempts.length === 0 ? (
              <p {...stylex.props(c.muted)}>{t('matches.corrections.diagnostics.noAttempts')}</p>
            ) : (
              <ol
                aria-label={t('matches.corrections.diagnostics.attemptsCaption')}
                {...stylex.props(rd.timeline)}
              >
                {attempts.map((attempt) => (
                  <li key={attempt.attempt_id} {...stylex.props(rd.attempt)}>
                    <p
                      {...stylex.props(
                        c.chip,
                        attempt.status === 'failed' && c.bannerDisputed,
                        attempt.status !== 'succeeded' &&
                          attempt.status !== 'failed' &&
                          c.bannerPending
                      )}
                    >
                      {t(
                        attempt.status === 'expired'
                          ? 'matches.corrections.repair.staleLease'
                          : ['running', 'failed', 'succeeded'].includes(attempt.status)
                            ? `matches.corrections.repair.status.${attempt.status}`
                            : 'matches.corrections.diagnostics.schedulerStatusUnknown'
                      )}
                    </p>
                    <p {...stylex.props(c.muted)}>
                      {t('matches.corrections.diagnostics.columns.attempt')}{' '}
                      {attempt.attempt_number}
                      {' · '}
                      {when(attempt.started_at)}
                    </p>
                    <p {...stylex.props(c.muted)}>
                      {t('matches.corrections.diagnostics.columns.base')}:{' '}
                      {attempt.base_revision ?? '—'}
                      {' · '}
                      {t('matches.corrections.diagnostics.columns.result')}:{' '}
                      {attempt.result_revision ?? '—'}
                    </p>
                    {attempt.failure_code && (
                      <p {...stylex.props(c.error)}>
                        {t('matches.corrections.diagnostics.columns.failure')}:{' '}
                        {t(
                          `matches.corrections.repair.failureCodes.${RESULT_REPAIR_FAILURE_CODES.some((code) => code === attempt.failure_code) ? attempt.failure_code : 'INTERNAL'}`
                        )}
                      </p>
                    )}
                  </li>
                ))}
              </ol>
            ))}
        </div>
      )}
      <dl {...stylex.props(rd.detailMeta)}>
        <dt {...stylex.props(rd.detailLabel)}>
          {t('matches.corrections.diagnostics.officialRevision')}
        </dt>
        <dd {...stylex.props(rd.detailValue)}>
          {committed === null ? '—' : `${before ?? '—'} → ${committed}`}
        </dd>
        <dt {...stylex.props(rd.detailLabel)}>
          {t('matches.corrections.diagnostics.correlation')}
        </dt>
        <dd {...stylex.props(rd.detailValue)}>{job.job_id}</dd>
      </dl>
    </section>
  );
}
