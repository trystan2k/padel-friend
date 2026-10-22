import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  managementActionError,
  parseManagementSuccess,
  parseManagementParticipants,
  parseMatchAudit,
  type ManagementResult,
  type ManagementSuccess,
  type ManagementParticipant,
  type MatchAuditEntry
} from './match-management-model';
import {
  validateListMatchEventManagementParticipants,
  validateWithdrawMatchRegistration,
  validateRemoveMatchRegistration,
  validateListMatchEventAudit
} from './match-management.validators';

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
