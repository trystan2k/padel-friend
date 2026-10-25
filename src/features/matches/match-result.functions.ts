import { createServerFn } from '@tanstack/react-start';
import { setResponseHeader } from '@tanstack/react-start/server';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  matchResultActionError,
  parseResultProposals,
  parseResultSubmission,
  type MatchResultResponse,
  type ResultProposal,
  type ResultSubmission
} from './match-result-model';
import {
  validateGetMatchEventResultProposals,
  validateSubmitMatchEventResult
} from './match-result.validators';
import { localMatchInstant } from './match-time';

async function resultClient() {
  setResponseHeader('Cache-Control', 'private, no-store');
  const { client } = await requireAuthenticatedClient();
  const { data, error } = await client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return client;
}

export const getMatchEventResultProposals = createServerFn({ method: 'GET' })
  .validator(validateGetMatchEventResultProposals)
  .handler(async ({ data }): Promise<MatchResultResponse<ResultProposal[]>> => {
    const client = await resultClient();
    const { data: result, error } = await client.rpc('get_match_event_result_proposals', {
      p_match_event_id: data.event_id
    });
    if (error) return matchResultActionError(error);
    const value = parseResultProposals(result);
    return value
      ? { status: 'ok', value, replayed: false }
      : { status: 'error', code: 'unavailable' };
  });

export const submitMatchEventResult = createServerFn({ method: 'POST' })
  .validator(validateSubmitMatchEventResult)
  .handler(async ({ data }): Promise<MatchResultResponse<ResultSubmission>> => {
    const client = await resultClient();
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
    const { data: result, error } = await client.rpc('submit_match_event_result', {
      p_match_event_id: data.event_id,
      p_group_number: data.group_number,
      p_teams: data.teams,
      p_sets: data.sets,
      p_played_local: { ...data.played_local, instant },
      p_court_label: data.court_label ?? undefined,
      p_request_id: data.request_id
    });
    return error
      ? matchResultActionError(error)
      : (parseResultSubmission(result) ?? { status: 'error', code: 'unavailable' });
  });
