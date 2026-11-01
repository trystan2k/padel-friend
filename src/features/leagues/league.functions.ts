import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import type {
  LeagueCommunityEntry,
  LeagueDetailResult,
  LeagueDto,
  LeagueListResult
} from './league-contracts';
import { decodeLeagueDetail, decodeLeagueDto, decodeLeagueList } from './league-decoders';
import { leagueErrorFromDatabase } from './league-errors';
import {
  validateCreateLeague,
  validateLeagueCommand,
  validateLeagueCommunity,
  validateLeagueId,
  validateUpdateLeague
} from './league.validators';

/** Authenticates through the request cookies and verifies the claims, never a stored session. */
async function authenticatedClient() {
  const result = await requireAuthenticatedClient();
  const { data, error } = await result.client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return result;
}

function decoded<T>(decode: (value: unknown) => T, value: unknown): T {
  try {
    return decode(value);
  } catch {
    throw new Error('INVALID_LEAGUE_RESPONSE');
  }
}

export const listLeagues = createServerFn({ method: 'GET' })
  .validator(validateLeagueCommunity)
  .handler(async ({ data }): Promise<LeagueListResult> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('list_leagues', {
      p_community_id: data.community_id
    });
    if (error) throw new Error(leagueErrorFromDatabase(error));
    return decoded(decodeLeagueList, result);
  });

export const getLeague = createServerFn({ method: 'GET' })
  .validator(validateLeagueId)
  .handler(async ({ data }): Promise<LeagueDetailResult> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('get_league', { p_league_id: data.league_id });
    if (error) throw new Error(leagueErrorFromDatabase(error));
    return decoded(decodeLeagueDetail, result);
  });

export const createLeague = createServerFn({ method: 'POST' })
  .validator(validateCreateLeague)
  .handler(async ({ data }): Promise<LeagueDto> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('create_league', {
      p_request_id: data.request_id,
      p_community_id: data.community_id,
      p_name: data.name,
      p_end_mode: data.end_mode,
      p_start_date: data.start_date,
      p_description: data.description ?? undefined,
      p_end_date: data.end_date ?? undefined,
      p_minimum_matches: data.minimum_matches
    });
    if (error) throw new Error(leagueErrorFromDatabase(error));
    return decoded(decodeLeagueDto, result);
  });

export const updateLeague = createServerFn({ method: 'POST' })
  .validator(validateUpdateLeague)
  .handler(async ({ data }): Promise<LeagueDto> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('update_league', {
      p_league_id: data.league_id,
      p_expected_version: data.expected_version,
      p_changes: data.changes
    });
    if (error) throw new Error(leagueErrorFromDatabase(error));
    return decoded(decodeLeagueDto, result);
  });

export const activateLeague = createServerFn({ method: 'POST' })
  .validator(validateLeagueCommand)
  .handler(async ({ data }): Promise<LeagueDto> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('activate_league', {
      p_league_id: data.league_id,
      p_expected_version: data.expected_version
    });
    if (error) throw new Error(leagueErrorFromDatabase(error));
    return decoded(decodeLeagueDto, result);
  });

export const closeLeague = createServerFn({ method: 'POST' })
  .validator(validateLeagueCommand)
  .handler(async ({ data }): Promise<LeagueDto> => {
    const { client } = await authenticatedClient();
    const { data: result, error } = await client.rpc('close_league', {
      p_league_id: data.league_id,
      p_expected_version: data.expected_version
    });
    if (error) throw new Error(leagueErrorFromDatabase(error));
    return decoded(decodeLeagueDto, result);
  });

/** Communities where the caller is an active member: entry points for League navigation. */
export const listMyLeagueCommunities = createServerFn({ method: 'GET' }).handler(
  async (): Promise<LeagueCommunityEntry[]> => {
    const { client, userId } = await authenticatedClient();
    const { data: memberships, error } = await client
      .from('community_members')
      .select('community_id')
      .eq('user_id', userId)
      .eq('status', 'active')
      .is('valid_until', null)
      .lte('valid_from', new Date().toISOString());
    if (error) throw new Error('LEAGUE_UNAVAILABLE');
    const ids = (memberships ?? []).map(({ community_id }) => community_id);
    if (ids.length === 0) return [];
    const { data: communities, error: communityError } = await client
      .from('communities')
      .select('id,name')
      .in('id', ids)
      .order('name');
    if (communityError) throw new Error('LEAGUE_UNAVAILABLE');
    return communities ?? [];
  }
);
