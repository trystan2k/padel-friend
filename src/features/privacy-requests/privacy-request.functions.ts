import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  parseMyDeletionRequest,
  parsePrivacyReceipt,
  privacyRequestError,
  validatePrivacyCommand,
  type MyDeletionRequest,
  type PrivacyReceipt,
  type PrivacyRequestResponse
} from './privacy-request-model';
import { requireSameOrigin } from './request-origin.server';

// The subject is always the verified session identity (auth.uid() inside the RPCs). No email, UUID
// or case reference is ever accepted from the caller, and no mail is sent on an intake click.

function receiptFor(value: unknown, commandId: string): PrivacyRequestResponse<PrivacyReceipt> {
  const receipt = parsePrivacyReceipt(value);
  // A receipt must answer the exact command; a mismatch means the transport is not trustworthy.
  return receipt && receipt.command_id === commandId
    ? { status: 'ok', value: receipt }
    : { status: 'error', code: 'unavailable' };
}

export const requestDeletion = createServerFn({ method: 'POST' })
  .validator(validatePrivacyCommand)
  .handler(async ({ data }): Promise<PrivacyRequestResponse<PrivacyReceipt>> => {
    requireSameOrigin();
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client.rpc('request_account_deletion', {
      p_command_id: data.command_id
    });
    if (error) return privacyRequestError(error);
    return receiptFor(result, data.command_id);
  });

export const getMyDeletionRequest = createServerFn({ method: 'GET' }).handler(
  async (): Promise<PrivacyRequestResponse<MyDeletionRequest | null>> => {
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client.rpc('get_my_deletion_request');
    if (error) return privacyRequestError(error);
    const value = parseMyDeletionRequest(result);
    return value === undefined ? { status: 'error', code: 'unavailable' } : { status: 'ok', value };
  }
);

export const withdrawMyDeletionRequest = createServerFn({ method: 'POST' })
  .validator(validatePrivacyCommand)
  .handler(async ({ data }): Promise<PrivacyRequestResponse<PrivacyReceipt>> => {
    requireSameOrigin();
    const { client } = await requireAuthenticatedClient();
    const { data: result, error } = await client.rpc('withdraw_my_deletion_request', {
      p_command_id: data.command_id
    });
    if (error) return privacyRequestError(error);
    return receiptFor(result, data.command_id);
  });
