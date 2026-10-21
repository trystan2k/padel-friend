import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  invitationActionError,
  parseInvitationResult,
  parseMatchInvitation,
  type InvitationResult,
  type MyMatchInvitationResult
} from './match-invitation-model';
import {
  validateGetMyMatchInvitation,
  validateRespondMatchEventInvitation
} from './match-invitation.validators';

async function invitationClient() {
  const result = await requireAuthenticatedClient();
  const { data, error } = await result.client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return result;
}

export const getMyMatchInvitation = createServerFn({ method: 'GET' })
  .validator(validateGetMyMatchInvitation)
  .handler(async ({ data }): Promise<MyMatchInvitationResult> => {
    const { client } = await invitationClient();
    const { data: result, error } = await client.rpc('get_my_match_invitation', {
      p_match_event_id: data.event_id
    });
    if (error) return { status: 'unavailable' };
    if (result === null) return { status: 'empty' };
    const invitation = parseMatchInvitation(result);
    return invitation ? { status: 'ok', invitation } : { status: 'unavailable' };
  });

export const respondMatchEventInvitation = createServerFn({ method: 'POST' })
  .validator(validateRespondMatchEventInvitation)
  .handler(async ({ data }): Promise<InvitationResult> => {
    const { client } = await invitationClient();
    const { data: result, error } = await client.rpc('respond_match_event_invitation', {
      p_match_event_id: data.event_id,
      p_invitation_id: data.invitation_id,
      p_response: data.response
    });
    if (error) return invitationActionError(error);
    return parseInvitationResult(result) ?? { status: 'error', code: 'unavailable' };
  });
