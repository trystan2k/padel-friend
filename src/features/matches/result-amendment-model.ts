import {
  matchResultActionError,
  type ResultClassification,
  type ResultSetRow,
  type ResultTeams,
  type ResultValidationDetail
} from './match-result-model';
import type { MatchResultErrorCode } from './match-result-error-copy';
import { validateMatchResultSets, validateMatchResultTeams } from './match-result.validators';
import { validateMatchUuid } from './matches.validators';
import {
  parseResultDisputeResolution,
  parseResultRepairJob,
  RESULT_DISPUTE_DECISIONS,
  type ResultDisputeDecision,
  type ResultDisputeResolution,
  type ResultRepairJob,
  type ResultRepairPublication,
  type ResultRepairStatus
} from './result-dispute-model';

export const RESULT_AMENDMENT_LIFECYCLES = [
  'requested',
  'proposal_pending',
  'disputed',
  'approved_pending_repair',
  'applied',
  'rejected',
  'canceled'
] as const;
export type ResultAmendmentLifecycle = (typeof RESULT_AMENDMENT_LIFECYCLES)[number];
export type ResultAmendmentDecisionSource = 'MANUAL' | 'AUTO_48H' | 'ADMIN_OVERRIDE';

export const RESULT_AMENDMENT_ERROR_CODES = [
  'unauthenticated',
  'not_found',
  'forbidden',
  'invalid_request',
  'idempotency_conflict',
  'not_confirmed',
  'no_change',
  'invalid_review',
  'invalid_rejection_reason',
  'review_forbidden',
  'ranked_membership',
  'ranked_out_of_period',
  'ranked_league_invalid',
  'ranked_ineligible',
  'invalid_justification',
  'invalid_decision',
  'unavailable'
] as const;
export type ResultAmendmentErrorCode =
  | (typeof RESULT_AMENDMENT_ERROR_CODES)[number]
  | MatchResultErrorCode;

export type ResultAmendmentConflict =
  | { code: 'base_conflict'; current_confirmation_id: string }
  | {
      code: 'candidate_version_conflict';
      current_version: number | null;
      // Null when the disputed result has no amendment (first-confirmation branch).
      lifecycle: ResultAmendmentLifecycle | null;
    }
  | { code: 'state_conflict'; lifecycle: ResultAmendmentLifecycle }
  | { code: 'already_open'; amendment_id: string }
  | { code: 'already_resolved'; resolution_id: string; decision: ResultDisputeDecision };

export type ResultAmendmentReceipt = {
  amendment_id: string;
  event_id: string;
  proposal_id: string;
  lifecycle: ResultAmendmentLifecycle;
  base_confirmation_id: string;
  official_confirmation_id: string | null;
  candidate_version: number | null;
  review_deadline_at: string | null;
  decision_source: ResultAmendmentDecisionSource | null;
  // Approved but not yet published: the prior official result stays active.
  pending_application: boolean;
  // Queued correction job: the prior official result stays active until it publishes.
  repair_job_id: string | null;
  repair_status: ResultRepairStatus | null;
  publication: ResultRepairPublication | null;
  command_id: string;
};

export type ResultAmendmentResponse<T> =
  | { status: 'ok'; value: T; replayed: boolean }
  | ({ status: 'conflict' } & ResultAmendmentConflict)
  | { status: 'conflict'; code: 'deadline_elapsed'; value: T }
  | { status: 'error'; code: ResultAmendmentErrorCode; detail?: ResultValidationDetail };

export type ResultAmendmentCandidate = {
  version: number;
  submitted_by: string;
  submitted_at: string;
  review_deadline_at: string;
  teams: ResultTeams;
  sets: ResultSetRow[];
  classification: ResultClassification;
  played_at_utc: string;
  played_at_local: string;
  played_at_offset_seconds: number;
  court_label: string | null;
  team_a_approval_count: number;
  team_b_approval_count: number;
  required_team_coverage_count: number;
  received_team_coverage_count: number;
  caller_decision: 'approve' | 'reject' | null;
};

export type ResultAmendment = {
  amendment_id: string;
  event_id: string;
  proposal_id: string;
  group_number: number;
  lifecycle: ResultAmendmentLifecycle;
  base_confirmation_id: string;
  base_version: number;
  official_confirmation_id: string | null;
  requester_id: string;
  reason: string;
  requested_at: string;
  candidate: ResultAmendmentCandidate | null;
  decision: {
    source: ResultAmendmentDecisionSource;
    actor_id: string | null;
    decided_at: string;
    note: string | null;
  } | null;
  pending_application: boolean;
  repair_job_id: string | null;
  repair: ResultRepairJob | null;
  resolution: ResultDisputeResolution | null;
  can_resolve: boolean;
  can_submit_candidate: boolean;
  can_approve: boolean;
  can_reject: boolean;
  can_cancel: boolean;
};

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function count(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}
function positive(value: unknown): value is number {
  return count(value) && value >= 1;
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}
function lifecycleOf(value: unknown): ResultAmendmentLifecycle | null {
  return RESULT_AMENDMENT_LIFECYCLES.find((item) => item === value) ?? null;
}
function sourceOf(value: unknown): ResultAmendmentDecisionSource | null {
  return value === 'MANUAL' || value === 'AUTO_48H' || value === 'ADMIN_OVERRIDE' ? value : null;
}
function nullablePositive(value: unknown): number | null | undefined {
  if (value === null) return null;
  return positive(value) ? value : undefined;
}
function nullableTimestamp(value: unknown): string | null | undefined {
  if (value === null) return null;
  return timestamp(value) ? value : undefined;
}
function nullableText(value: unknown): string | null | undefined {
  if (value === null) return null;
  return typeof value === 'string' ? value : undefined;
}
function classificationOf(value: unknown): ResultClassification | null {
  return value === 'team_a' || value === 'team_b' || value === 'draw' || value === 'incomplete'
    ? value
    : null;
}
function uuidOrNull(value: unknown): string | null | undefined {
  if (value === null) return null;
  try {
    return validateMatchUuid(value);
  } catch {
    return undefined;
  }
}

export function parseResultAmendmentReceipt(
  value: unknown
): ResultAmendmentResponse<ResultAmendmentReceipt> | null {
  if (!record(value) || typeof value.replayed !== 'boolean') return null;
  const lifecycle = lifecycleOf(value.lifecycle);
  const decisionSource = value.decision_source === null ? null : sourceOf(value.decision_source);
  const official = uuidOrNull(value.official_confirmation_id);
  const candidateVersion = nullablePositive(value.candidate_version);
  const reviewDeadline = nullableTimestamp(value.review_deadline_at);
  // Repair fields are absent on receipts that predate the correction queue.
  const repairJob = value.repair_job_id === undefined ? null : uuidOrNull(value.repair_job_id);
  const repairStatus =
    value.repair_status === undefined || value.repair_status === null
      ? null
      : (['queued', 'running', 'failed', 'succeeded'] as const).find(
          (item) => item === value.repair_status
        );
  const publication =
    value.publication === undefined || value.publication === null
      ? null
      : (['pending', 'failed', 'published'] as const).find((item) => item === value.publication);
  if (
    repairJob === undefined ||
    repairStatus === undefined ||
    publication === undefined ||
    (repairJob === null) !== (repairStatus === null) ||
    (repairStatus === null) !== (publication === null) ||
    !lifecycle ||
    official === undefined ||
    (value.decision_source !== null && !decisionSource) ||
    candidateVersion === undefined ||
    reviewDeadline === undefined ||
    typeof value.pending_application !== 'boolean' ||
    value.pending_application !== (lifecycle === 'approved_pending_repair')
  )
    return null;
  let receipt: ResultAmendmentReceipt;
  try {
    receipt = {
      amendment_id: validateMatchUuid(value.amendment_id),
      event_id: validateMatchUuid(value.event_id),
      proposal_id: validateMatchUuid(value.proposal_id),
      lifecycle,
      base_confirmation_id: validateMatchUuid(value.base_confirmation_id),
      official_confirmation_id: official,
      candidate_version: candidateVersion,
      review_deadline_at: reviewDeadline,
      decision_source: decisionSource,
      pending_application: value.pending_application,
      repair_job_id: repairJob,
      repair_status: repairStatus,
      publication,
      command_id: validateMatchUuid(value.command_id)
    };
  } catch {
    return null;
  }
  if (value.conflict === 'deadline_elapsed')
    return { status: 'conflict', code: 'deadline_elapsed', value: receipt };
  if (value.conflict !== undefined) return null;
  return { status: 'ok', value: receipt, replayed: value.replayed };
}

function candidateOf(value: unknown): ResultAmendmentCandidate | null | undefined {
  if (value === null) return null;
  if (!record(value)) return undefined;
  try {
    const classification = classificationOf(value.classification);
    const decision =
      value.caller_decision === null
        ? null
        : value.caller_decision === 'approve' || value.caller_decision === 'reject'
          ? value.caller_decision
          : undefined;
    if (
      !classification ||
      decision === undefined ||
      !positive(value.version) ||
      !timestamp(value.submitted_at) ||
      !timestamp(value.review_deadline_at) ||
      !timestamp(value.played_at_utc) ||
      typeof value.played_at_local !== 'string' ||
      typeof value.played_at_offset_seconds !== 'number' ||
      (value.court_label !== null && typeof value.court_label !== 'string') ||
      !count(value.team_a_approval_count) ||
      !count(value.team_b_approval_count) ||
      !count(value.required_team_coverage_count) ||
      !count(value.received_team_coverage_count)
    )
      return undefined;
    return {
      version: value.version,
      submitted_by: validateMatchUuid(value.submitted_by),
      submitted_at: value.submitted_at,
      review_deadline_at: value.review_deadline_at,
      teams: validateMatchResultTeams(value.teams),
      sets: validateMatchResultSets(value.sets),
      classification,
      played_at_utc: value.played_at_utc,
      played_at_local: value.played_at_local,
      played_at_offset_seconds: value.played_at_offset_seconds,
      court_label: value.court_label,
      team_a_approval_count: value.team_a_approval_count,
      team_b_approval_count: value.team_b_approval_count,
      required_team_coverage_count: value.required_team_coverage_count,
      received_team_coverage_count: value.received_team_coverage_count,
      caller_decision: decision
    };
  } catch {
    return undefined;
  }
}

export function parseResultAmendments(value: unknown, eventId: string): ResultAmendment[] | null {
  if (!Array.isArray(value)) return null;
  const amendments: ResultAmendment[] = [];
  for (const item of value as unknown[]) {
    if (!record(item)) return null;
    const lifecycle = lifecycleOf(item.lifecycle);
    const candidate = candidateOf(item.candidate);
    const official = uuidOrNull(item.official_confirmation_id);
    const repair = uuidOrNull(item.repair_job_id);
    // Additive repair/resolution fields are absent on older payloads.
    const repairJob =
      item.repair === undefined || item.repair === null ? null : parseResultRepairJob(item.repair);
    const resolution =
      item.resolution === undefined || item.resolution === null
        ? null
        : parseResultDisputeResolution(item.resolution);
    let decision: ResultAmendment['decision'] = null;
    if (item.decision !== null) {
      const raw = item.decision;
      const source = record(raw) ? sourceOf(raw.source) : null;
      const actor = record(raw) ? uuidOrNull(raw.actor_id) : undefined;
      const note = record(raw) ? nullableText(raw.note) : undefined;
      if (
        !record(raw) ||
        !source ||
        actor === undefined ||
        !timestamp(raw.decided_at) ||
        note === undefined
      )
        return null;
      decision = {
        source,
        actor_id: actor,
        decided_at: raw.decided_at,
        note
      };
    }
    if (
      !lifecycle ||
      candidate === undefined ||
      official === undefined ||
      repair === undefined ||
      (item.repair !== undefined && item.repair !== null && !repairJob) ||
      (item.resolution !== undefined && item.resolution !== null && !resolution) ||
      (repairJob !== null && repairJob.job_id !== repair) ||
      (item.can_resolve !== undefined && typeof item.can_resolve !== 'boolean') ||
      !positive(item.group_number) ||
      !positive(item.base_version) ||
      !timestamp(item.requested_at) ||
      typeof item.reason !== 'string' ||
      typeof item.pending_application !== 'boolean' ||
      item.pending_application !== (lifecycle === 'approved_pending_repair') ||
      typeof item.can_submit_candidate !== 'boolean' ||
      typeof item.can_approve !== 'boolean' ||
      typeof item.can_reject !== 'boolean' ||
      typeof item.can_cancel !== 'boolean'
    )
      return null;
    try {
      const event = validateMatchUuid(item.event_id);
      if (event !== eventId) return null;
      amendments.push({
        amendment_id: validateMatchUuid(item.amendment_id),
        event_id: event,
        proposal_id: validateMatchUuid(item.proposal_id),
        group_number: item.group_number,
        lifecycle,
        base_confirmation_id: validateMatchUuid(item.base_confirmation_id),
        base_version: item.base_version,
        official_confirmation_id: official,
        requester_id: validateMatchUuid(item.requester_id),
        reason: item.reason,
        requested_at: item.requested_at,
        candidate,
        decision,
        pending_application: item.pending_application,
        repair_job_id: repair,
        repair: repairJob,
        resolution,
        can_resolve: item.can_resolve === true,
        can_submit_candidate: item.can_submit_candidate,
        can_approve: item.can_approve,
        can_reject: item.can_reject,
        can_cancel: item.can_cancel
      });
    } catch {
      return null;
    }
  }
  return amendments;
}

function detailOf(error: { details?: string | null }): unknown {
  try {
    return JSON.parse(error.details ?? 'null');
  } catch {
    return null;
  }
}

export function resultAmendmentError(error: {
  code?: string | null;
  message?: string | null;
  details?: string | null;
}): ResultAmendmentResponse<never> {
  const message = error.message ?? '';
  if (!message.startsWith('RESULT_AMENDMENT_')) {
    const mapped = matchResultActionError(error);
    return mapped.status === 'error' ? mapped : { status: 'error', code: 'unavailable' };
  }
  const code = message.slice('RESULT_AMENDMENT_'.length).toLowerCase();
  const detail = detailOf(error);
  if (code === 'idempotency_conflict') return { status: 'error', code };
  if (code === 'base_conflict') {
    const id = record(detail) ? uuidOrNull(detail.current_confirmation_id) : undefined;
    return id
      ? { status: 'conflict', code, current_confirmation_id: id }
      : { status: 'error', code: 'unavailable' };
  }
  if (code === 'already_open') {
    const id = record(detail) ? uuidOrNull(detail.amendment_id) : undefined;
    return id
      ? { status: 'conflict', code, amendment_id: id }
      : { status: 'error', code: 'unavailable' };
  }
  if (code === 'already_resolved') {
    const id = record(detail) ? uuidOrNull(detail.resolution_id) : undefined;
    const decision = record(detail)
      ? RESULT_DISPUTE_DECISIONS.find((item) => item === detail.decision)
      : undefined;
    return id && decision
      ? { status: 'conflict', code, resolution_id: id, decision }
      : { status: 'error', code: 'unavailable' };
  }
  if (code === 'state_conflict' || code === 'candidate_version_conflict') {
    if (!record(detail)) return { status: 'error', code: 'unavailable' };
    const lifecycle = lifecycleOf(detail.lifecycle);
    if (code === 'state_conflict')
      return lifecycle
        ? { status: 'conflict', code, lifecycle }
        : { status: 'error', code: 'unavailable' };
    const current = detail.current_version;
    // A disputed first confirmation has no amendment lifecycle.
    return (current === null || positive(current)) && (lifecycle || detail.lifecycle === null)
      ? { status: 'conflict', code, current_version: current, lifecycle }
      : { status: 'error', code: 'unavailable' };
  }
  const known = RESULT_AMENDMENT_ERROR_CODES.find((item) => item === code);
  if (known) return { status: 'error', code: known };
  return {
    status: 'error',
    code:
      error.code === '28000'
        ? 'unauthenticated'
        : error.code === '42501'
          ? 'forbidden'
          : 'unavailable'
  };
}
