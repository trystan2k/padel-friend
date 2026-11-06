import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  parseResultDisputeReceipt,
  parseResultDisputeResolutions,
  parseResultRepairJobs,
  type ResultDisputeReceipt,
  type ResultDisputeResolution,
  type ResultRepairJob
} from './result-dispute-model';
import {
  parseResultAmendmentReceipt,
  parseResultAmendments,
  resultAmendmentError,
  type ResultAmendment,
  type ResultAmendmentReceipt,
  type ResultAmendmentResponse
} from './result-amendment-model';
import {
  validateCancelResultAmendment,
  validateGetResultAmendments,
  validateRequestResultAmendment,
  validateResolveResultDispute,
  validateReviewResultAmendment,
  validateSubmitResultAmendmentCandidate
} from './result-amendment.validators';
import { localMatchInstant } from './match-time';

async function amendmentClient() {
  setResponseHeader('Cache-Control', 'private, no-store');
  const { client } = await requireAuthenticatedClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return client;
}

// A receipt must answer the exact command; a mismatch means the transport is not trustworthy.
function receiptFor(
  parsed: ResultAmendmentResponse<ResultAmendmentReceipt> | null,
  commandId: string,
  amendmentId?: string
): ResultAmendmentResponse<ResultAmendmentReceipt> {
  if (!parsed) return { status: 'error', code: 'unavailable' };
  const receipt =
    parsed.status === 'conflict' && 'value' in parsed
      ? parsed.value
      : parsed.status === 'ok'
        ? parsed.value
        : null;
  if (
    receipt &&
    (receipt.command_id !== commandId || (amendmentId && receipt.amendment_id !== amendmentId))
  )
    return { status: 'error', code: 'unavailable' };
  return parsed;
}

export const getResultAmendments = createServerFn({ method: 'GET' })
  .validator(validateGetResultAmendments)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultAmendment[]>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('get_result_amendments', {
      p_match_event_id: data.event_id
    });
    if (error) return resultAmendmentError(error);
    const value = parseResultAmendments(result, data.event_id);
    return value
      ? { status: 'ok', value, replayed: false }
      : { status: 'error', code: 'unavailable' };
  });

export const requestResultAmendment = createServerFn({ method: 'POST' })
  .validator(validateRequestResultAmendment)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultAmendmentReceipt>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('request_result_amendment', {
      p_proposal_id: data.proposal_id,
      p_expected_confirmation_id: data.expected_confirmation_id,
      p_reason: data.reason,
      p_command_id: data.command_id
    });
    if (error) return resultAmendmentError(error);
    const parsed = receiptFor(parseResultAmendmentReceipt(result), data.command_id);
    return parsed.status === 'ok' && parsed.value.proposal_id !== data.proposal_id
      ? { status: 'error', code: 'unavailable' }
      : parsed;
  });

export const submitResultAmendmentCandidate = createServerFn({ method: 'POST' })
  .validator(validateSubmitResultAmendmentCandidate)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultAmendmentReceipt>> => {
    const client = await amendmentClient();
    // The event timezone is read through the caller's own RLS-scoped client.
    const { data: event, error: eventError } = await client
      .from('match_events')
      .select('timezone')
      .eq('id', data.event_id)
      .maybeSingle();
    if (eventError || !event) return { status: 'error', code: 'not_found' };
    let instant: string;
    try {
      instant = localMatchInstant(
        data.played_local.local.slice(0, 10),
        data.played_local.local.slice(11),
        event.timezone,
        data.played_local.offset_seconds
      ).instant.toISOString();
    } catch {
      return { status: 'error', code: 'invalid_played_at' };
    }
    const { data: result, error } = await client.rpc('submit_result_amendment_candidate', {
      p_amendment_id: data.amendment_id,
      p_expected_base_confirmation_id: data.expected_base_confirmation_id,
      p_expected_candidate_version: data.expected_candidate_version ?? undefined,
      p_teams: data.teams,
      p_sets: data.sets,
      p_played_local: { ...data.played_local, instant },
      p_court_label: data.court_label ?? undefined,
      p_command_id: data.command_id
    });
    if (error) return resultAmendmentError(error);
    return receiptFor(parseResultAmendmentReceipt(result), data.command_id, data.amendment_id);
  });

export const reviewResultAmendment = createServerFn({ method: 'POST' })
  .validator(validateReviewResultAmendment)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultAmendmentReceipt>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('review_result_amendment', {
      p_amendment_id: data.amendment_id,
      p_expected_base_confirmation_id: data.expected_base_confirmation_id,
      p_expected_candidate_version: data.expected_candidate_version,
      p_decision: data.decision,
      p_reason_code: data.reason_code ?? undefined,
      p_reason_note: data.reason_note ?? undefined,
      p_command_id: data.command_id
    });
    if (error) return resultAmendmentError(error);
    return receiptFor(parseResultAmendmentReceipt(result), data.command_id, data.amendment_id);
  });

export const resolveResultDispute = createServerFn({ method: 'POST' })
  .validator(validateResolveResultDispute)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultDisputeReceipt>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('resolve_result_dispute', {
      p_proposal_id: data.proposal_id,
      p_expected_candidate_version: data.expected_candidate_version,
      p_decision: data.decision,
      p_justification: data.justification,
      p_command_id: data.command_id,
      p_expected_base_confirmation_id: data.expected_base_confirmation_id ?? undefined
    });
    if (error) return resultAmendmentError(error);
    const receipt = parseResultDisputeReceipt(result);
    // A receipt must answer the exact command and decision; otherwise the transport is untrusted.
    return receipt &&
      receipt.command_id === data.command_id &&
      receipt.resolution.proposal_id === data.proposal_id &&
      receipt.resolution.decision === data.decision
      ? { status: 'ok', value: receipt, replayed: receipt.replayed }
      : { status: 'error', code: 'unavailable' };
  });

export const getResultDisputeResolutions = createServerFn({ method: 'GET' })
  .validator(validateGetResultAmendments)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultDisputeResolution[]>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('get_result_dispute_resolutions', {
      p_match_event_id: data.event_id
    });
    if (error) return resultAmendmentError(error);
    const value = parseResultDisputeResolutions(result, data.event_id);
    return value
      ? { status: 'ok', value, replayed: false }
      : { status: 'error', code: 'unavailable' };
  });

export const getResultRepairJobs = createServerFn({ method: 'GET' })
  .validator(validateGetResultAmendments)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultRepairJob[]>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('get_result_repair_jobs', {
      p_match_event_id: data.event_id
    });
    if (error) return resultAmendmentError(error);
    const value = parseResultRepairJobs(result);
    return value
      ? { status: 'ok', value, replayed: false }
      : { status: 'error', code: 'unavailable' };
  });

export const cancelResultAmendment = createServerFn({ method: 'POST' })
  .validator(validateCancelResultAmendment)
  .handler(async ({ data }): Promise<ResultAmendmentResponse<ResultAmendmentReceipt>> => {
    const client = await amendmentClient();
    const { data: result, error } = await client.rpc('cancel_result_amendment', {
      p_amendment_id: data.amendment_id,
      p_command_id: data.command_id
    });
    if (error) return resultAmendmentError(error);
    return receiptFor(parseResultAmendmentReceipt(result), data.command_id, data.amendment_id);
  });
