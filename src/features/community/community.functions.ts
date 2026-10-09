import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  type PublicCommunity,
  validateAcceptInvitation,
  validateCreateCommunity,
  validateGetPublicCommunity,
  validateGetMyMembershipTimeline,
  validateLeaveCommunity,
  validateJoinCommunity,
  validateListPublicCommunities,
  validateUpdateCommunitySettings
} from './community.validators';

const publicCommunityColumns =
  'id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at' as const;

const joinErrors: Record<string, string> = {
  '28000': 'UNAUTHENTICATED',
  PJ001: 'INVITATION_INVALID',
  PJ002: 'INVITATION_EXPIRED',
  PJ003: 'INVITATION_USED',
  PJ004: 'INVITATION_REVOKED',
  PJ005: 'INVITATION_NOT_FOR_USER',
  PJ006: 'ALREADY_MEMBER_OR_PENDING',
  PJ007: 'COMMUNITY_NOT_ELIGIBLE',
  PJ008: 'MEMBERSHIP_INACTIVE'
};

function throwJoinError(error: { code: string }): never {
  if (Object.hasOwn(joinErrors, error.code)) throw new Error(joinErrors[error.code]);
  throw error;
}

export const listPublicCommunities = createServerFn({ method: 'GET' })
  .validator(validateListPublicCommunities)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { offset, limit, search } = data;
    let query = client
      .from('communities')
      .select(publicCommunityColumns)
      .eq('visibility', 'public');
    if (search) {
      // Quote each PostgREST value after escaping regex metacharacters. A user-supplied
      // comma, quote or parenthesis must stay inside the pattern, never become filter syntax.
      const pattern = search
        .replace(/[\\^$.|?*+(){}[\]]/g, '\\$&')
        .replace(/\\/g, '\\\\')
        .replace(/"/g, '\\"');
      const quoted = `"${pattern}"`;
      query = query.or(`name.imatch.${quoted},city_label.imatch.${quoted}`);
    }
    const { data: rows, error } = await query
      .order('created_at', { ascending: false })
      .order('id', { ascending: false })
      .range(offset, offset + limit);
    if (error) throw error;
    const communities: PublicCommunity[] = (rows ?? []).slice(0, limit);
    return {
      communities,
      next_offset: (rows?.length ?? 0) > limit && offset + limit <= 10000 ? offset + limit : null
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

export const joinCommunity = createServerFn({ method: 'POST' })
  .validator(validateJoinCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: joined, error } = await client
      .rpc('join_public_community', { p_community_id: data.community_id })
      .single();
    if (error) throwJoinError(error);
    if (!joined) throw new Error('COMMUNITY_JOIN_FAILED');
    return { community_id: joined.community_id, status: joined.status };
  });

const leaveErrors: Record<string, string> = {
  '28000': 'UNAUTHENTICATED',
  PL001: 'COMMUNITY_MEMBERSHIP_NOT_OPEN',
  PL002: 'FINAL_COMMUNITY_ADMIN'
};

export const leaveCommunity = createServerFn({ method: 'POST' })
  .validator(validateLeaveCommunity)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: left, error } = await client
      .rpc('leave_community', { p_community_id: data.community_id })
      .single();
    if (error) {
      if (Object.hasOwn(leaveErrors, error.code)) throw new Error(leaveErrors[error.code]);
      throw error;
    }
    if (!left) throw new Error('COMMUNITY_LEAVE_FAILED');
    return {
      membership_id: left.membership_id,
      community_id: left.community_id,
      status: left.status,
      valid_until: left.valid_until
    };
  });

export const acceptInvitation = createServerFn({ method: 'POST' })
  .validator(validateAcceptInvitation)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: joined, error } = await client
      .rpc('accept_community_invitation', { p_token: data.token })
      .single();
    if (error) throwJoinError(error);
    if (!joined) throw new Error('COMMUNITY_JOIN_FAILED');
    return { community_id: joined.community_id, status: joined.status };
  });

export const getMyMembershipTimeline = createServerFn({ method: 'GET' })
  .validator(validateGetMyMembershipTimeline)
  .handler(async ({ data }) => {
    const { client, userId } = await requireAuthenticatedClient();
    let query = client
      .from('community_members')
      .select('id,community_id,role,status,valid_from,valid_until,activated_at')
      .eq('user_id', userId);
    if (data.community_id) query = query.eq('community_id', data.community_id);
    const { data: rows, error } = await query
      .order('community_id', { ascending: true })
      .order('valid_from', { ascending: true })
      .order('id', { ascending: true })
      .range(data.offset, data.offset + data.limit);
    if (error) throw error;
    const page = rows ?? [];
    const intervals = page.slice(0, data.limit).map((row) => ({
      membership_id: row.id,
      community_id: row.community_id,
      role: row.role,
      status: row.status,
      valid_from: row.valid_from,
      valid_until: row.valid_until,
      activated_at: row.activated_at
    }));
    return {
      intervals,
      next_offset:
        page.length > data.limit && data.offset + data.limit <= 10000
          ? data.offset + data.limit
          : null
    };
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
