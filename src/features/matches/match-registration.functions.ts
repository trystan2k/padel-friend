import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  matchRegistrationActionError,
  parseDecideMatchRegistrationResult,
  parseMatchRegistrationQueue,
  parseMyMatchRegistration,
  parseSubmitMatchRegistrationResult,
  type DecideMatchRegistrationResult,
  type MatchRegistrationQueueResult,
  type MyMatchRegistrationResult,
  type SubmitMatchRegistrationResult
} from './match-registration-model';
import {
  validateDecideMatchRegistration,
  validateListMatchRegistrationRequests,
  validateMyMatchRegistration,
  validateSubmitMatchRegistration
} from './match-registration.validators';

// Same private/no-store authenticated client used by matches.functions.ts, plus
// the match-local guard that additionally rejects anonymous JWTs so a guest
// session can never reach the registration RPCs.
async function matchRegistrationClient() {
  const result = await requireAuthenticatedClient();
  const { data, error } = await result.client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return result;
}

export const submitMatchRegistration = createServerFn({ method: 'POST' })
  .validator(validateSubmitMatchRegistration)
  .handler(async ({ data }): Promise<SubmitMatchRegistrationResult> => {
    const { client } = await matchRegistrationClient();
    const { data: result, error } = await client.rpc('submit_match_registration', {
      p_match_event_id: data.event_id
    });
    if (error)
      return matchRegistrationActionError(error) ?? { status: 'error', code: 'unavailable' };
    return parseSubmitMatchRegistrationResult(result) ?? { status: 'error', code: 'unavailable' };
  });

export const decideMatchRegistration = createServerFn({ method: 'POST' })
  .validator(validateDecideMatchRegistration)
  .handler(async ({ data }): Promise<DecideMatchRegistrationResult> => {
    const { client } = await matchRegistrationClient();
    const { data: result, error } = await client.rpc('decide_match_registration', {
      p_match_event_id: data.event_id,
      p_user_id: data.user_id,
      p_decision: data.decision
    });
    if (error)
      return matchRegistrationActionError(error) ?? { status: 'error', code: 'unavailable' };
    return parseDecideMatchRegistrationResult(result) ?? { status: 'error', code: 'unavailable' };
  });

export const getMyMatchRegistration = createServerFn({ method: 'GET' })
  .validator(validateMyMatchRegistration)
  .handler(async ({ data }): Promise<MyMatchRegistrationResult> => {
    const { client } = await matchRegistrationClient();
    const { data: result, error } = await client.rpc('get_my_match_registration', {
      p_match_event_id: data.event_id
    });
    if (error) return { status: 'unavailable' };
    const registration = parseMyMatchRegistration(result);
    return registration ? { status: 'ok', registration } : { status: 'unavailable' };
  });

export const listMatchEventRegistrationRequests = createServerFn({ method: 'GET' })
  .validator(validateListMatchRegistrationRequests)
  .handler(async ({ data }): Promise<MatchRegistrationQueueResult> => {
    const { client } = await matchRegistrationClient();
    const { data: result, error } = await client.rpc('list_match_event_registration_requests', {
      p_match_event_id: data.event_id
    });
    if (error) return { status: 'unavailable' };
    const row = Array.isArray(result) ? result[0] : undefined;
    if (row === undefined) return { status: 'empty' };
    const queue = parseMatchRegistrationQueue(row);
    return queue ? { status: 'ok', queue } : { status: 'unavailable' };
  });
