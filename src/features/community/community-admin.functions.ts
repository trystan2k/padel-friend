import { createServerFn } from '@tanstack/react-start';
import { toClientError } from '../../lib/client-error.server';
import { isCommunityRpcErrorCode } from '../../lib/client-error-codes';
import { requireAuthenticatedClient } from '../auth/auth.server';
import { signVenuePhoto } from './community-venue-photo.server';
import type { CommunityMemberSearchResult } from './community-admin.types';
import {
  DEFAULT_COMMUNITY_ADMIN_DEFAULTS,
  parseCommunityAdminDefaults,
  type CommunityAdminDefaults
} from './community-settings';
import {
  validateAdminDefaults,
  validateInvitation,
  validateCommunityId,
  validateMemberAction,
  validatePage,
  validateRevokeInvitation,
  validateSearchMembers,
  validateVenue,
  validateVenueEdit,
  validateVenueId
} from './community-admin.validators';

const governanceErrors: Record<string, string> = {
  '28000': 'UNAUTHENTICATED',
  '40P01': 'COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE',
  '40001': 'COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE',
  PG001: 'NOT_COMMUNITY_ADMIN',
  PG006: 'NOT_COMMUNITY_MEMBER',
  PG002: 'FINAL_COMMUNITY_ADMIN',
  PG003: 'COMMUNITY_MEMBER_NOT_FOUND',
  PG004: 'INVALID_MEMBERSHIP_TRANSITION',
  PG005: 'ALREADY_MEMBER_OR_PENDING'
};
function throwGovernanceError(error: { code: string; message?: string }): never {
  if (isCommunityRpcErrorCode(error.message)) throw toClientError(error);
  // guard-allow: dynamic-error — value of a fixed lookup table of literal codes
  if (Object.hasOwn(governanceErrors, error.code)) throw new Error(governanceErrors[error.code]);
  if (error.code === '23505' && error.message?.includes('community_members_open'))
    throw new Error('ALREADY_MEMBER_OR_PENDING');
  throw toClientError(error);
}
type MemberAction = 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote';

async function runMemberAction(
  data: ReturnType<typeof validateMemberAction>,
  action: MemberAction
) {
  // Membership transitions use the canonical community → membership lock order; see
  // docs/security/community-governance-lock-order.md. Do not retry failed RPCs automatically.
  const { client } = await requireAuthenticatedClient();
  const { data: result, error } = await client
    .rpc('govern_community_member', {
      p_community_id: data.community_id,
      p_membership_id: data.membership_id,
      p_action: action
    })
    .single();
  if (error) throwGovernanceError(error);
  if (!result) throw new Error('COMMUNITY_GOVERNANCE_FAILED');
  return result;
}
export const approveCommunityMember = createServerFn({ method: 'POST' })
  .validator(validateMemberAction)
  .handler(({ data }) => runMemberAction(data, 'approve'));
export const denyCommunityMember = createServerFn({ method: 'POST' })
  .validator(validateMemberAction)
  .handler(({ data }) => runMemberAction(data, 'deny'));
export const removeCommunityMember = createServerFn({ method: 'POST' })
  .validator(validateMemberAction)
  .handler(({ data }) => runMemberAction(data, 'remove'));
export const reactivateCommunityMember = createServerFn({ method: 'POST' })
  .validator(validateMemberAction)
  .handler(({ data }) => runMemberAction(data, 'reactivate'));
export const promoteCommunityMember = createServerFn({ method: 'POST' })
  .validator(validateMemberAction)
  .handler(({ data }) => runMemberAction(data, 'promote'));
export const demoteCommunityMember = createServerFn({ method: 'POST' })
  .validator(validateMemberAction)
  .handler(({ data }) => runMemberAction(data, 'demote'));

export const listMyAdminCommunities = createServerFn({ method: 'GET' }).handler(async () => {
  const { client, userId } = await requireAuthenticatedClient();
  const { data: memberships, error } = await client
    .from('community_members')
    .select('community_id')
    .eq('user_id', userId)
    .eq('role', 'admin')
    .eq('status', 'active')
    .is('valid_until', null)
    .lte('valid_from', new Date().toISOString());
  if (error) throw toClientError(error);
  const ids = (memberships ?? []).map(({ community_id }) => community_id);
  if (!ids.length) return [];
  const { data: communities, error: communityError } = await client
    .from('communities')
    .select('id,name')
    .in('id', ids)
    .order('name');
  if (communityError) throw toClientError(communityError);
  return communities ?? [];
});

async function requireAdmin(communityId: string) {
  const { client } = await requireAuthenticatedClient();
  const { data, error } = await client.rpc('is_community_admin', { p_community_id: communityId });
  if (error) throwGovernanceError(error);
  if (!data) throw new Error('NOT_COMMUNITY_ADMIN');
  return client;
}

export const getCommunityAdminContext = createServerFn({ method: 'GET' })
  .validator(validateCommunityId)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: community, error } = await client
      .from('communities')
      .select('id,name,city_label,description,visibility,join_policy')
      .eq('id', data.community_id)
      .single();
    if (error) throw toClientError(error);
    return community;
  });

export const getCommunityAdminDefaults = createServerFn({ method: 'GET' })
  .validator(validateCommunityId)
  .handler(async ({ data }): Promise<CommunityAdminDefaults> => {
    const client = await requireAdmin(data.community_id);
    const { data: rows, error } = await client.rpc('get_community_settings', {
      p_community_id: data.community_id
    });
    if (error) throw toClientError(error);
    const stored: unknown = rows?.[0]?.settings;
    if (stored === null || stored === undefined) return DEFAULT_COMMUNITY_ADMIN_DEFAULTS;
    if (typeof stored !== 'object' || Array.isArray(stored))
      return DEFAULT_COMMUNITY_ADMIN_DEFAULTS;
    const namespace = Reflect.get(stored, 'admin_defaults');
    return namespace === undefined
      ? DEFAULT_COMMUNITY_ADMIN_DEFAULTS
      : parseCommunityAdminDefaults(namespace);
  });

export const updateCommunityAdminDefaults = createServerFn({ method: 'POST' })
  .validator(validateAdminDefaults)
  .handler(async ({ data }): Promise<CommunityAdminDefaults> => {
    const client = await requireAdmin(data.community_id);
    const { data: result, error } = await client.rpc('update_community_admin_defaults', {
      p_community_id: data.community_id,
      p_defaults: data.defaults
    });
    if (error) throw toClientError(error);
    return parseCommunityAdminDefaults(result);
  });

export const getCommunityMemberById = createServerFn({ method: 'GET' })
  .validator(validateMemberAction)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: rows, error } = await client.rpc('get_community_member_by_id', {
      p_community_id: data.community_id,
      p_membership_id: data.membership_id
    });
    if (error) throwGovernanceError(error);
    const member = rows?.[0];
    if (!member) throw new Error('COMMUNITY_MEMBER_NOT_FOUND');
    return member;
  });

export const searchCommunityMembers = createServerFn({ method: 'GET' })
  .validator(validateSearchMembers)
  .handler(async ({ data }): Promise<CommunityMemberSearchResult[]> => {
    const { client } = await requireAuthenticatedClient();
    const { data: rows, error } = await client.rpc('search_community_members', {
      p_community_id: data.community_id,
      p_query: data.query,
      ...(data.status ? { p_status: data.status } : {}),
      p_offset: data.offset,
      p_limit: data.limit
    });
    if (error) throwGovernanceError(error);
    return rows ?? [];
  });

export const listCommunityAudit = createServerFn({ method: 'GET' })
  .validator(validatePage)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: rows, error } = await client
      .from('community_audit_log')
      .select('id,actor_user_id,entity,entity_id,action,details,occurred_at')
      .eq('community_id', data.community_id)
      .order('occurred_at', { ascending: false })
      .order('id', { ascending: false })
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw toClientError(error);
    return rows ?? [];
  });

const venueColumns =
  'id,community_id,name,address,maps_url,photo_path,created_at,updated_at,archived_at' as const;
export const listCommunityVenues = createServerFn({ method: 'GET' })
  .validator(validatePage)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: rows, error } = await client
      .from('community_venues')
      .select(venueColumns)
      .eq('community_id', data.community_id)
      .is('archived_at', null)
      .order('name')
      .order('id')
      .range(data.offset, data.offset + data.limit - 1);
    if (error) throw toClientError(error);
    return Promise.all(
      (rows ?? []).map(async (row) => ({
        id: row.id,
        community_id: row.community_id,
        name: row.name,
        address: row.address,
        maps_url: row.maps_url,
        created_at: row.created_at,
        updated_at: row.updated_at,
        archived_at: row.archived_at,
        photo_signed_url: await signVenuePhoto(client, row.photo_path)
      }))
    );
  });

export const addCommunityVenue = createServerFn({ method: 'POST' })
  .validator(validateVenue)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: venue, error } = await client
      .rpc('add_community_venue', {
        p_community_id: data.community_id,
        p_name: data.name,
        p_address: data.address ?? undefined,
        p_maps_url: data.maps_url ?? undefined
      })
      .single();
    if (error) throwGovernanceError(error);
    return venue;
  });
export const editCommunityVenue = createServerFn({ method: 'POST' })
  .validator(validateVenueEdit)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { community_id, venue_id, ...changes } = data;
    const { data: venue, error } = await client
      .rpc('edit_community_venue', {
        p_community_id: community_id,
        p_venue_id: venue_id,
        p_changes: changes
      })
      .single();
    if (error) throwGovernanceError(error);
    return venue;
  });
export const archiveCommunityVenue = createServerFn({ method: 'POST' })
  .validator(validateVenueId)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: venue, error } = await client
      .rpc('archive_community_venue', {
        p_community_id: data.community_id,
        p_venue_id: data.venue_id
      })
      .single();
    if (error) throwGovernanceError(error);
    return venue;
  });

export const issueInvitation = createServerFn({ method: 'POST' })
  .validator(validateInvitation)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: invitation, error } = await client
      .rpc('issue_community_invitation', {
        p_community_id: data.community_id,
        p_invitee_user_id: data.invitee_user_id
      })
      .single();
    if (error) throwGovernanceError(error);
    if (!invitation) throw new Error('INVITATION_ISSUE_FAILED');
    return {
      invitation_id: invitation.invitation_id,
      token: invitation.token,
      expires_at: invitation.expires_at
    };
  });

export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator(validateRevokeInvitation)
  .handler(async ({ data }) => {
    const { client } = await requireAuthenticatedClient();
    const { data: invitation, error } = await client
      .rpc('revoke_community_invitation', {
        p_community_id: data.community_id,
        p_invitation_id: data.invitation_id
      })
      .single();
    if (error) throwGovernanceError(error);
    return invitation;
  });
