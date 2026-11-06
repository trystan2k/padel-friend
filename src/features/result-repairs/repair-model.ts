import { parseResultRepairJob, type ResultRepairJob } from '../matches/result-dispute-model';
import { validateMatchUuid } from '../matches/matches.validators';

export const RESULT_REPAIR_STAGES = [
  'base',
  'lock',
  'fact',
  'replay',
  'publish',
  'complete'
] as const;
export type ResultRepairStage = (typeof RESULT_REPAIR_STAGES)[number];

export const RESULT_REPAIR_ERROR_CODES = [
  'unauthenticated',
  'not_found',
  'forbidden',
  'invalid_request',
  'busy',
  'already_applied',
  'not_retryable',
  'unavailable'
] as const;
export type ResultRepairErrorCode = (typeof RESULT_REPAIR_ERROR_CODES)[number];

export type ResultRepairResponse<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: ResultRepairErrorCode };

/** Sanitized job facts for diagnostics: codes and counts only, never SQL or stack text. */
export type ResultRepairDiagnosticJob = ResultRepairJob & {
  failure_stage: ResultRepairStage | null;
  retryable: boolean;
  // A running job whose lease elapsed: the worker is gone and the job is reclaimable.
  stale_lease: boolean;
  community_id: string;
};

export type ResultRepairSchedulerJob = {
  name: string;
  schedule: string;
  active: boolean;
  last_run_at: string | null;
  last_status: string | null;
};

export type ResultRepairSchedulerHealth = {
  pg_cron_installed: boolean;
  provisioned: boolean;
  jobs: ResultRepairSchedulerJob[];
  overdue_jobs: number;
};

export type ResultRepairDiagnostics = {
  jobs: ResultRepairDiagnosticJob[];
  // Present for Platform Admins only.
  scheduler: ResultRepairSchedulerHealth | null;
};

export type ResultRepairAttempt = {
  attempt_id: string;
  job_id: string;
  attempt_number: number;
  status: string;
  base_revision: number | null;
  result_revision: number | null;
  failure_code: string | null;
  started_at: string;
  finished_at: string | null;
};

export type ResultRepairRetryOutcome =
  | { outcome: 'succeeded' | 'failed' | 'stale'; job: ResultRepairJob }
  // The claim was refused: another repair holds the single running claim.
  | { outcome: 'busy'; job: ResultRepairJob | null };

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function timestampOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' && !Number.isNaN(Date.parse(value)) ? value : undefined;
}
function revisionOrNull(value: unknown): number | null | undefined {
  if (value === null) return null;
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

export function parseResultRepairDiagnosticJob(value: unknown): ResultRepairDiagnosticJob | null {
  const job = parseResultRepairJob(value);
  if (!job || !record(value)) return null;
  const stage =
    value.failure_stage === null || value.failure_stage === undefined
      ? null
      : (RESULT_REPAIR_STAGES.find((item) => item === value.failure_stage) ?? undefined);
  if (
    stage === undefined ||
    typeof value.retryable !== 'boolean' ||
    typeof value.stale_lease !== 'boolean'
  )
    return null;
  try {
    return {
      ...job,
      failure_stage: stage,
      retryable: value.retryable,
      stale_lease: value.stale_lease,
      community_id: validateMatchUuid(value.community_id)
    };
  } catch {
    return null;
  }
}

function parseScheduler(value: unknown): ResultRepairSchedulerHealth | null | undefined {
  if (value === null || value === undefined) return null;
  if (
    !record(value) ||
    typeof value.pg_cron_installed !== 'boolean' ||
    typeof value.provisioned !== 'boolean' ||
    !Array.isArray(value.jobs) ||
    typeof value.overdue_jobs !== 'number' ||
    !Number.isSafeInteger(value.overdue_jobs) ||
    value.overdue_jobs < 0
  )
    return undefined;
  const jobs: ResultRepairSchedulerJob[] = [];
  for (const item of value.jobs as unknown[]) {
    if (!record(item)) return undefined;
    const lastRun = timestampOrNull(item.last_run_at);
    if (
      typeof item.name !== 'string' ||
      typeof item.schedule !== 'string' ||
      typeof item.active !== 'boolean' ||
      lastRun === undefined ||
      (item.last_status !== null && typeof item.last_status !== 'string')
    )
      return undefined;
    jobs.push({
      name: item.name,
      schedule: item.schedule,
      active: item.active,
      last_run_at: lastRun,
      last_status: item.last_status
    });
  }
  return {
    pg_cron_installed: value.pg_cron_installed,
    provisioned: value.provisioned,
    jobs,
    overdue_jobs: value.overdue_jobs
  };
}

export function parseResultRepairDiagnostics(value: unknown): ResultRepairDiagnostics | null {
  if (!record(value) || !Array.isArray(value.jobs)) return null;
  const scheduler = parseScheduler(value.scheduler);
  if (scheduler === undefined) return null;
  const jobs: ResultRepairDiagnosticJob[] = [];
  for (const item of value.jobs as unknown[]) {
    const job = parseResultRepairDiagnosticJob(item);
    if (!job) return null;
    jobs.push(job);
  }
  return { jobs, scheduler };
}

export function parseResultRepairAttempts(value: unknown): ResultRepairAttempt[] | null {
  if (!Array.isArray(value)) return null;
  const attempts: ResultRepairAttempt[] = [];
  for (const item of value as unknown[]) {
    if (!record(item)) return null;
    const base = revisionOrNull(item.base_revision);
    const result = revisionOrNull(item.result_revision);
    const finished = timestampOrNull(item.finished_at);
    if (
      base === undefined ||
      result === undefined ||
      finished === undefined ||
      typeof item.attempt_number !== 'number' ||
      !Number.isSafeInteger(item.attempt_number) ||
      item.attempt_number < 1 ||
      typeof item.status !== 'string' ||
      (item.failure_code !== null && typeof item.failure_code !== 'string') ||
      timestampOrNull(item.started_at) === undefined ||
      typeof item.started_at !== 'string'
    )
      return null;
    try {
      attempts.push({
        attempt_id: validateMatchUuid(item.attempt_id),
        job_id: validateMatchUuid(item.job_id),
        attempt_number: item.attempt_number,
        status: item.status,
        base_revision: base,
        result_revision: result,
        failure_code: item.failure_code,
        started_at: item.started_at,
        finished_at: finished
      });
    } catch {
      return null;
    }
  }
  return attempts;
}

/** The retry RPC's claim step: only a granted claim may proceed to execution. */
export function parseResultRepairClaim(
  value: unknown
): { claimed: true; job: ResultRepairJob; attempt_number: number } | { claimed: false } | null {
  if (!record(value) || !record(value.claim) || typeof value.claim.claimed !== 'boolean')
    return null;
  if (!value.claim.claimed) return { claimed: false };
  const job = parseResultRepairJob(value.job);
  const attempt = value.claim.attempt_number;
  if (!job || typeof attempt !== 'number' || !Number.isSafeInteger(attempt) || attempt < 1)
    return null;
  return { claimed: true, job, attempt_number: attempt };
}

export function parseResultRepairExecution(
  value: unknown
): { outcome: 'succeeded' | 'failed' | 'stale'; job: ResultRepairJob } | null {
  if (!record(value)) return null;
  const outcome = (['succeeded', 'failed', 'stale'] as const).find(
    (item) => item === value.outcome
  );
  const job = parseResultRepairJob(value.job);
  if (!outcome || !job) return null;
  // The processor reports success or failure only with the corresponding durable job state.
  if (outcome !== 'stale' && outcome !== job.status) return null;
  return { outcome, job };
}

export function resultRepairError(error: {
  code?: string | null;
  message?: string | null;
}): ResultRepairResponse<never> {
  const message = error.message ?? '';
  if (message.startsWith('RESULT_REPAIR_')) {
    const code = message.slice('RESULT_REPAIR_'.length).toLowerCase();
    const known = RESULT_REPAIR_ERROR_CODES.find((item) => item === code);
    if (known) return { status: 'error', code: known };
  }
  if (error.code === '28000') return { status: 'error', code: 'unauthenticated' };
  if (error.code === '42501') return { status: 'error', code: 'forbidden' };
  return { status: 'error', code: 'unavailable' };
}
