import type { ResultAmendmentLifecycle } from './result-amendment-model';
import { validateMatchUuid } from './matches.validators';

export const RESULT_DISPUTE_DECISIONS = ['uphold', 'replace', 'void'] as const;
export type ResultDisputeDecision = (typeof RESULT_DISPUTE_DECISIONS)[number];
export type ResultDisputeKind = 'amendment' | 'first_confirmation';

export const RESULT_REPAIR_STATUSES = ['queued', 'running', 'failed', 'succeeded'] as const;
export type ResultRepairStatus = (typeof RESULT_REPAIR_STATUSES)[number];
// Publication is reported only by a committed job; queued and running stay pending.
export type ResultRepairPublication = 'pending' | 'failed' | 'published';
export type ResultRepairKind = 'replace' | 'void';

// Sanitized diagnostic codes: never SQL text, stack traces or cross-community payloads.
export const RESULT_REPAIR_FAILURE_CODES = [
  'BASE_STALE',
  'CANDIDATE_INVALID',
  'PERMISSION_REVOKED',
  'CONFIG_UNSUPPORTED',
  'REPLAY_FAILED',
  'PUBLICATION_FAILED',
  'LEASE_EXPIRED',
  'INTERNAL'
] as const;
export type ResultRepairFailureCode = (typeof RESULT_REPAIR_FAILURE_CODES)[number];

export type ResultRepairJob = {
  job_id: string;
  amendment_id: string;
  resolution_id: string | null;
  proposal_id: string;
  group_number: number;
  kind: ResultRepairKind;
  status: ResultRepairStatus;
  publication: ResultRepairPublication;
  projections_complete: boolean;
  attempt_count: number;
  failure_code: ResultRepairFailureCode | null;
  next_attempt_at: string | null;
  requested_at: string;
  started_at: string | null;
  finished_at: string | null;
  committed_revision: number | null;
};

export type ResultDisputeResolution = {
  resolution_id: string;
  event_id: string;
  proposal_id: string;
  group_number: number;
  resolution_kind: ResultDisputeKind;
  amendment_id: string | null;
  base_confirmation_id: string | null;
  candidate_version: number;
  decision: ResultDisputeDecision;
  confirmation_id: string | null;
  actor_id: string;
  justification: string;
  evidence_review_id: string | null;
  decided_at: string;
};

export type ResultDisputeReceipt = {
  resolution: ResultDisputeResolution;
  amendment_lifecycle: ResultAmendmentLifecycle | null;
  official_confirmation_id: string | null;
  repair: ResultRepairJob | null;
  // The prior official fact stays active until a committed repair.
  pending_application: boolean;
  command_id: string;
  replayed: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function positive(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1;
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return timestamp(value) ? value : undefined;
}
function uuidOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  try {
    return validateMatchUuid(value);
  } catch {
    return undefined;
  }
}
function oneOf<T extends string>(list: readonly T[], value: unknown): T | null {
  return list.find((item) => item === value) ?? null;
}

export function parseResultRepairJob(value: unknown): ResultRepairJob | null {
  if (!record(value)) return null;
  const status = oneOf(RESULT_REPAIR_STATUSES, value.status);
  const kind = oneOf(['replace', 'void'] as const, value.kind);
  const publication = oneOf(['pending', 'failed', 'published'] as const, value.publication);
  const failure =
    value.failure_code === null ? null : oneOf(RESULT_REPAIR_FAILURE_CODES, value.failure_code);
  const resolution = uuidOrNull(value.resolution_id);
  const nextAttempt = nullableTimestamp(value.next_attempt_at);
  const started = nullableTimestamp(value.started_at);
  const finished = nullableTimestamp(value.finished_at);
  const revision = value.committed_revision;
  if (
    !status ||
    !kind ||
    !publication ||
    (value.failure_code !== null && !failure) ||
    resolution === undefined ||
    nextAttempt === undefined ||
    started === undefined ||
    finished === undefined ||
    !positive(value.group_number) ||
    typeof value.projections_complete !== 'boolean' ||
    typeof value.attempt_count !== 'number' ||
    !Number.isSafeInteger(value.attempt_count) ||
    value.attempt_count < 0 ||
    !timestamp(value.requested_at) ||
    (revision !== null && !positive(revision)) ||
    // Completion is claimed only by a succeeded job with a committed revision.
    value.projections_complete !== (status === 'succeeded' && revision !== null) ||
    publication !==
      (status === 'succeeded' ? 'published' : status === 'failed' ? 'failed' : 'pending')
  )
    return null;
  try {
    return {
      job_id: validateMatchUuid(value.job_id),
      amendment_id: validateMatchUuid(value.amendment_id),
      resolution_id: resolution,
      proposal_id: validateMatchUuid(value.proposal_id),
      group_number: value.group_number,
      kind,
      status,
      publication,
      projections_complete: value.projections_complete,
      attempt_count: value.attempt_count,
      failure_code: failure,
      next_attempt_at: nextAttempt,
      requested_at: value.requested_at,
      started_at: started,
      finished_at: finished,
      committed_revision: revision
    };
  } catch {
    return null;
  }
}

export function parseResultRepairJobs(value: unknown): ResultRepairJob[] | null {
  if (!Array.isArray(value)) return null;
  const jobs: ResultRepairJob[] = [];
  for (const item of value as unknown[]) {
    const job = parseResultRepairJob(item);
    if (!job) return null;
    jobs.push(job);
  }
  return jobs;
}

export function parseResultDisputeResolution(value: unknown): ResultDisputeResolution | null {
  if (!record(value)) return null;
  const kind = oneOf(['amendment', 'first_confirmation'] as const, value.resolution_kind);
  const decision = oneOf(RESULT_DISPUTE_DECISIONS, value.decision);
  const amendment = uuidOrNull(value.amendment_id);
  const base = uuidOrNull(value.base_confirmation_id);
  const confirmation = uuidOrNull(value.confirmation_id);
  const evidence = uuidOrNull(value.evidence_review_id);
  if (
    !kind ||
    !decision ||
    amendment === undefined ||
    base === undefined ||
    confirmation === undefined ||
    evidence === undefined ||
    !positive(value.group_number) ||
    !positive(value.candidate_version) ||
    typeof value.justification !== 'string' ||
    value.justification.length < 1 ||
    !timestamp(value.decided_at) ||
    // Shape mirrors the table: amendment resolutions carry a base, first confirmations a
    // confirmation only for an upheld (overridden) result.
    (kind === 'amendment'
      ? amendment === null || base === null || confirmation !== null
      : amendment !== null ||
        base !== null ||
        decision === 'replace' ||
        (confirmation !== null) !== (decision === 'uphold'))
  )
    return null;
  try {
    return {
      resolution_id: validateMatchUuid(value.resolution_id),
      event_id: validateMatchUuid(value.event_id),
      proposal_id: validateMatchUuid(value.proposal_id),
      group_number: value.group_number,
      resolution_kind: kind,
      amendment_id: amendment,
      base_confirmation_id: base,
      candidate_version: value.candidate_version,
      decision,
      confirmation_id: confirmation,
      actor_id: validateMatchUuid(value.actor_id),
      justification: value.justification,
      evidence_review_id: evidence,
      decided_at: value.decided_at
    };
  } catch {
    return null;
  }
}

export function parseResultDisputeResolutions(
  value: unknown,
  eventId: string
): ResultDisputeResolution[] | null {
  if (!Array.isArray(value)) return null;
  const resolutions: ResultDisputeResolution[] = [];
  for (const item of value as unknown[]) {
    const resolution = parseResultDisputeResolution(item);
    if (!resolution || resolution.event_id !== eventId) return null;
    resolutions.push(resolution);
  }
  return resolutions;
}

export function parseResultDisputeReceipt(value: unknown): ResultDisputeReceipt | null {
  if (!record(value) || typeof value.replayed !== 'boolean') return null;
  const resolution = parseResultDisputeResolution(value.resolution);
  const repair = value.repair === null ? null : parseResultRepairJob(value.repair);
  const official = uuidOrNull(value.official_confirmation_id);
  const lifecycles: readonly ResultAmendmentLifecycle[] = [
    'requested',
    'proposal_pending',
    'disputed',
    'approved_pending_repair',
    'applied',
    'rejected',
    'canceled'
  ];
  const lifecycle =
    value.amendment_lifecycle === null ? null : oneOf(lifecycles, value.amendment_lifecycle);
  if (
    !resolution ||
    (value.repair !== null && !repair) ||
    official === undefined ||
    (value.amendment_lifecycle !== null && !lifecycle) ||
    typeof value.pending_application !== 'boolean' ||
    // A queued or failed correction is never reported as applied.
    value.pending_application !== (repair !== null && repair.status !== 'succeeded') ||
    // Only replace/void of an official fact queues a job, always linked to this resolution.
    (resolution.resolution_kind === 'amendment' && resolution.decision !== 'uphold') !==
      (repair !== null) ||
    (repair !== null && repair.resolution_id !== resolution.resolution_id)
  )
    return null;
  try {
    return {
      resolution,
      amendment_lifecycle: lifecycle,
      official_confirmation_id: official,
      repair,
      pending_application: value.pending_application,
      command_id: validateMatchUuid(value.command_id),
      replayed: value.replayed
    };
  } catch {
    return null;
  }
}
