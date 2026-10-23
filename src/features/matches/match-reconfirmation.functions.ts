import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { managementActionError, type ManagementResult } from './match-management-model';
import {
  parseReconfirmationSuccess,
  type ReconfirmationSuccess
} from './match-reconfirmation-model';
import { validateReconfirmMatchRegistration } from './match-reconfirmation.validators';

export const reconfirmMatchRegistration = createServerFn({ method: 'POST' })
  .validator(validateReconfirmMatchRegistration)
  .handler(async ({ data }): Promise<ManagementResult<ReconfirmationSuccess>> => {
    const { client } = await requireAuthenticatedClient();
    const claims = await client.auth.getClaims();
    if (claims.error || !claims.data?.claims?.sub || claims.data.claims.is_anonymous === true)
      throw new Error('UNAUTHENTICATED');
    const result = await client.rpc('reconfirm_match_registration', {
      p_match_event_id: data.event_id,
      p_attempt_id: data.attempt_id,
      p_generation: data.generation,
      p_request_id: data.request_id
    });
    return result.error
      ? managementActionError(result.error)
      : (parseReconfirmationSuccess(result.data) ?? { status: 'error', code: 'unavailable' });
  });
