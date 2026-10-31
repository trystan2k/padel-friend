import { createServerFn } from '@tanstack/react-start';
import { getRequestUrl } from '@tanstack/react-start/server';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { scheduleMatchPlayerAddReconcile } from './match-add-player.server';
import {
  managementActionError,
  parseManagementSuccess,
  parseManagementParticipants,
  parseMatchAudit,
  parseMatchEventManagement,
  parseOwnershipSuccess,
  parseCancellationSuccess,
  parseMatchEditSuccess,
  type MatchEditSuccess,
  type OwnershipSuccess,
  type CancellationSuccess,
  type MatchEventManagement,
  type ManagementResult,
  type ManagementSuccess,
  type ManagementParticipant,
  type MatchAuditEntry
} from './match-management-model';
import {
  validateListMatchEventManagementParticipants,
  validateWithdrawMatchRegistration,
  validateRemoveMatchRegistration,
  validateListMatchEventAudit,
  validateGetMatchEventManagement,
  validateTransferMatchEventOwnership,
  validateCancelMatchEvent
} from './match-management.validators';
import { validateEditMatchEvent } from './match-management.validators';

export const editMatchEvent = createServerFn({ method: 'POST' })
  .validator(validateEditMatchEvent)
  .handler(async ({ data }): Promise<ManagementResult<MatchEditSuccess>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('edit_match_event', {
      p_match_event_id: data.event_id,
      p_expected_version: data.expected_version,
      p_patch: data.patch,
      p_request_id: data.request_id
    });
    return error
      ? managementActionError(error)
      : (parseMatchEditSuccess(result) ?? { status: 'error', code: 'unavailable' });
  });

async function managementClient() {
  const result = await requireAuthenticatedClient();
  const { data, error } = await result.client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return result.client;
}
export const listMatchEventManagementParticipants = createServerFn({ method: 'GET' })
  .validator(validateListMatchEventManagementParticipants)
  .handler(async ({ data }): Promise<ManagementResult<ManagementParticipant[]>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('list_match_event_management_participants', {
      p_match_event_id: data.event_id
    });
    if (error) return managementActionError(error);
    const value = parseManagementParticipants(result);
    return value
      ? { status: 'ok', value, replayed: false }
      : { status: 'error', code: 'unavailable' };
  });

export const getMatchEventManagement = createServerFn({ method: 'GET' })
  .validator(validateGetMatchEventManagement)
  .handler(async ({ data }): Promise<ManagementResult<MatchEventManagement | null>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('get_match_event_management', {
      p_match_event_id: data.event_id
    });
    if (error) return managementActionError(error);
    if (result === null) return { status: 'ok', value: null, replayed: false };
    const value = parseMatchEventManagement(result);
    if (!value) return { status: 'error', code: 'unavailable' };
    // An organizer opening the event reconciles undelivered player invitations (best effort).
    if (value.is_organizer)
      await scheduleMatchPlayerAddReconcile(getRequestUrl().origin).catch(() => undefined);
    return { status: 'ok', value, replayed: false };
  });
export const transferMatchEventOwnership = createServerFn({ method: 'POST' })
  .validator(validateTransferMatchEventOwnership)
  .handler(async ({ data }): Promise<ManagementResult<OwnershipSuccess>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('transfer_match_event_ownership', {
      p_match_event_id: data.event_id,
      p_target_user_id: data.target_user_id,
      p_expected_version: data.expected_version,
      p_request_id: data.request_id
    });
    return error
      ? managementActionError(error)
      : (parseOwnershipSuccess(result) ?? { status: 'error', code: 'unavailable' });
  });
export const cancelMatchEvent = createServerFn({ method: 'POST' })
  .validator(validateCancelMatchEvent)
  .handler(async ({ data }): Promise<ManagementResult<CancellationSuccess>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('cancel_match_event', {
      p_match_event_id: data.event_id,
      p_reason: data.reason,
      p_expected_version: data.expected_version,
      p_request_id: data.request_id
    });
    return error
      ? managementActionError(error)
      : (parseCancellationSuccess(result) ?? { status: 'error', code: 'unavailable' });
  });
export const withdrawMatchRegistration = createServerFn({ method: 'POST' })
  .validator(validateWithdrawMatchRegistration)
  .handler(async ({ data }): Promise<ManagementResult<ManagementSuccess>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('withdraw_match_registration', {
      p_match_event_id: data.event_id,
      p_attempt_id: data.attempt_id,
      p_request_id: data.request_id
    });
    return error
      ? managementActionError(error)
      : (parseManagementSuccess(result) ?? { status: 'error', code: 'unavailable' });
  });
export const removeMatchRegistration = createServerFn({ method: 'POST' })
  .validator(validateRemoveMatchRegistration)
  .handler(async ({ data }): Promise<ManagementResult<ManagementSuccess>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('remove_match_registration', {
      p_match_event_id: data.event_id,
      p_target_user_id: data.target_user_id,
      p_attempt_id: data.attempt_id,
      p_reason: data.reason,
      p_request_id: data.request_id
    });
    return error
      ? managementActionError(error)
      : (parseManagementSuccess(result) ?? { status: 'error', code: 'unavailable' });
  });
export const listMatchEventAudit = createServerFn({ method: 'GET' })
  .validator(validateListMatchEventAudit)
  .handler(async ({ data }): Promise<ManagementResult<MatchAuditEntry[]>> => {
    const client = await managementClient();
    const { data: result, error } = await client.rpc('list_match_event_audit', {
      p_match_event_id: data.event_id,
      p_before_at: data.before_at ?? undefined,
      p_before_id: data.before_id ?? undefined,
      p_limit: data.limit
    });
    if (error) return managementActionError(error);
    const value = parseMatchAudit(result);
    return value
      ? { status: 'ok', value, replayed: false }
      : { status: 'error', code: 'unavailable' };
  });
