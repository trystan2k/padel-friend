import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { validateCreateCommunity, validateUpdateCommunitySettings } from './community.validators';

export const createCommunity = createServerFn({ method: 'POST' })
  .validator(validateCreateCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: id, error } = await client.rpc('create_community', {
      p_name: data.name,
      p_visibility: data.visibility,
      p_join_policy: data.join_policy,
      ...(data.description != null ? { p_description: data.description } : {}),
      ...(data.city_label != null ? { p_city_label: data.city_label } : {})
    });
    if (error) throw error;
    return { id };
  });

export const updateCommunitySettings = createServerFn({ method: 'POST' })
  .validator(validateUpdateCommunitySettings)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { community_id, ...changes } = data;
    const { data: updated, error } = await client
      .from('communities')
      .update(changes)
      .eq('id', community_id)
      .select('id,name,visibility,join_policy,description,city_label,logo_path,settings,updated_at')
      .maybeSingle();
    if (error) throw error;
    if (!updated) throw new Error('NOT_COMMUNITY_ADMIN');
    return updated;
  });
