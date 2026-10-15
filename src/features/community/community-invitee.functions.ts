import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { validateDiscoverability, validateInviteeSearch } from './community-invitee.validators';

async function requireInviteeActor() {
  const actor = await requireAuthenticatedClient();
  const { data, error } = await actor.client.auth.getClaims();
  if (error || !data?.claims?.sub || data.claims.is_anonymous === true)
    throw new Error('UNAUTHENTICATED');
  return actor;
}

export const getMyInviteeDiscoverability = createServerFn({ method: 'GET' }).handler(async () => {
  const { client, userId } = await requireInviteeActor();
  const { data, error } = await client
    .from('community_invitee_directory_preferences')
    .select('user_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  return { enabled: Boolean(data) };
});

export const setMyInviteeDiscoverability = createServerFn({ method: 'POST' })
  .validator(validateDiscoverability)
  .handler(async ({ data }) => {
    const { client, userId } = await requireInviteeActor();
    if (data.enabled) {
      const { error } = await client
        .from('community_invitee_directory_preferences')
        .upsert({ user_id: userId }, { onConflict: 'user_id', ignoreDuplicates: true });
      if (error) throw error;
    } else {
      const { error } = await client
        .from('community_invitee_directory_preferences')
        .delete()
        .eq('user_id', userId);
      if (error) throw error;
    }
    return { enabled: data.enabled };
  });

export const searchCommunityInvitees = createServerFn({ method: 'GET' })
  .validator(validateInviteeSearch)
  .handler(async ({ data }) => {
    const { client } = await requireInviteeActor();
    const { data: rows, error } = await client.rpc('search_community_invitees', {
      p_community_id: data.community_id,
      p_query: data.query,
      p_limit: 20
    });
    if (error) throw error;
    return (rows ?? []).map(({ user_id, display_name }) => ({ user_id, display_name }));
  });
