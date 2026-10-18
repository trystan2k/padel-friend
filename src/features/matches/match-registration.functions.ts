import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  matchRegistrationActionError,
  parseDecideMatchRegistrationResult,
  parseMatchRegistrationQueue,
  parseMatchRoster,
  parseMyMatchRegistration,
  parseSubmitMatchRegistrationResult,
  type DecideMatchRegistrationResult,
  type MatchRegistrationQueueResult,
  type MatchRosterResult,
  type MyMatchRegistrationResult,
  type SubmitMatchRegistrationResult
} from './match-registration-model';
import {
  validateDecideMatchRegistration,
  validateListMatchEventRegistrations,
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
      p_attempt_id: data.attempt_id,
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

// Browser-callable accepted-roster read. The server returns no rows to a caller
// who cannot read the event, so a hidden event simply degrades to an absent
// roster. Malformed rows degrade the whole read to unavailable rather than
// reaching the UI.
export const listMatchEventRegistrations = createServerFn({ method: 'GET' })
  .validator(validateListMatchEventRegistrations)
  .handler(async ({ data }): Promise<MatchRosterResult> => {
    const { client } = await matchRegistrationClient();
    const { data: result, error } = await client.rpc('list_match_event_registrations', {
      p_match_event_id: data.event_id
    });
    if (error) return { status: 'unavailable' };
    const entries = parseMatchRoster(result);
    if (!entries) return { status: 'unavailable' };
    return entries.length === 0 ? { status: 'empty' } : { status: 'ok', entries };
  });
