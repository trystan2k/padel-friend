import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  type PublicCommunity,
  validateCreateCommunity,
  validateGetPublicCommunity,
  validateListPublicCommunities,
  validateUpdateCommunitySettings
} from './community.validators';

const publicCommunityColumns =
  'id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at' as const;

export const listPublicCommunities = createServerFn({ method: 'GET' })
  .validator(validateListPublicCommunities)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { offset, limit, search } = data;
    let query = client
      .from('communities')
      .select(publicCommunityColumns)
      .eq('visibility', 'public');
    if (search) query = query.ilike('name', `%${search.replace(/[%_\\]/g, '\\$&')}%`);
    const { data: rows, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit);
    if (error) throw error;
    const communities: PublicCommunity[] = (rows ?? []).slice(0, limit);
    return {
      communities,
      next_offset: (rows?.length ?? 0) > limit ? offset + limit : null
    };
  });

export const getPublicCommunity = createServerFn({ method: 'GET' })
  .validator(validateGetPublicCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: community, error } = await client
      .from('communities')
      .select(publicCommunityColumns)
      .eq('id', data.community_id)
      .eq('visibility', 'public')
      .maybeSingle();
    if (error) throw error;
    return community;
  });

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
