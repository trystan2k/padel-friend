import { createServerFn } from '@tanstack/react-start';
import { requireAuthenticatedClient } from '../auth/auth.server';
import {
  validateInvitation,
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
  PG001: 'NOT_COMMUNITY_ADMIN',
  PG002: 'FINAL_COMMUNITY_ADMIN',
  PG003: 'COMMUNITY_MEMBER_NOT_FOUND',
  PG004: 'INVALID_MEMBERSHIP_TRANSITION',
  PG005: 'ALREADY_MEMBER_OR_PENDING'
};
function throwGovernanceError(error: { code: string; message?: string }): never {
  if (Object.hasOwn(governanceErrors, error.code)) throw new Error(governanceErrors[error.code]);
  if (error.code === '23505' && error.message?.includes('community_members_open'))
    throw new Error('ALREADY_MEMBER_OR_PENDING');
  throw error;
}
function memberAction(action: 'approve' | 'deny' | 'remove' | 'reactivate' | 'promote' | 'demote') {
  return createServerFn({ method: 'POST' })
    .validator(validateMemberAction)
    .handler(async ({ data }) => {
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
    });
}
export const approveCommunityMember = memberAction('approve');
export const denyCommunityMember = memberAction('deny');
export const removeCommunityMember = memberAction('remove');
export const reactivateCommunityMember = memberAction('reactivate');
export const promoteCommunityMember = memberAction('promote');
export const demoteCommunityMember = memberAction('demote');

async function requireAdmin(communityId: string) {
  const { client } = await requireAuthenticatedClient();
  const { data, error } = await client.rpc('is_community_admin', { p_community_id: communityId });
  if (error) throwGovernanceError(error);
  if (!data) throw new Error('NOT_COMMUNITY_ADMIN');
  return client;
}

export const searchCommunityMembers = createServerFn({ method: 'GET' })
  .validator(validateSearchMembers)
  .handler(async ({ data }) => {
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
    if (error) throw error;
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
    if (error) throw error;
    return rows ?? [];
  });

export const addCommunityVenue = createServerFn({ method: 'POST' })
  .validator(validateVenue)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: venue, error } = await client
      .from('community_venues')
      .insert(data)
      .select(venueColumns)
      .single();
    if (error) throw error;
    return venue;
  });
export const editCommunityVenue = createServerFn({ method: 'POST' })
  .validator(validateVenueEdit)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { community_id, venue_id, ...changes } = data;
    const { data: venue, error } = await client
      .from('community_venues')
      .update(changes)
      .eq('community_id', community_id)
      .eq('id', venue_id)
      .is('archived_at', null)
      .select(venueColumns)
      .maybeSingle();
    if (error) throw error;
    if (!venue) throw new Error('COMMUNITY_VENUE_NOT_FOUND');
    return venue;
  });
export const archiveCommunityVenue = createServerFn({ method: 'POST' })
  .validator(validateVenueId)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: venue, error } = await client
      .from('community_venues')
      .update({ archived_at: new Date().toISOString() })
      .eq('community_id', data.community_id)
      .eq('id', data.venue_id)
      .is('archived_at', null)
      .select(venueColumns)
      .maybeSingle();
    if (error) throw error;
    if (!venue) throw new Error('COMMUNITY_VENUE_NOT_FOUND');
    return venue;
  });

export const issueInvitation = createServerFn({ method: 'POST' })
  .validator(validateInvitation)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: community, error: communityError } = await client
      .from('communities')
      .select('visibility')
      .eq('id', data.community_id)
      .single();
    if (communityError) throw communityError;
    if (community.visibility !== 'private') throw new Error('COMMUNITY_NOT_ELIGIBLE');
    const { data: existing, error: memberError } = await client
      .from('community_members')
      .select('id')
      .eq('community_id', data.community_id)
      .eq('user_id', data.invitee_user_id)
      .is('valid_until', null)
      .limit(1);
    if (memberError) throw memberError;
    if (existing.length) throw new Error('ALREADY_MEMBER_OR_PENDING');
    const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
    const token_hash = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('');
    const expires_at = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: invitation, error } = await client
      .from('community_invitations')
      .insert({ ...data, token_hash, expires_at })
      .select('id,expires_at')
      .single();
    if (error) {
      if (error.code === '23505' && error.message.includes('community_invitations_open'))
        throw new Error('INVITATION_ALREADY_OPEN');
      if (
        error.code === '23503' &&
        error.message.includes('community_invitations_invitee_user_id_fkey')
      )
        throw new Error('INVITEE_NOT_FOUND');
      if (error.code === '42501') throw new Error('NOT_COMMUNITY_ADMIN');
      throw error;
    }
    if (!invitation) throw new Error('INVITATION_ISSUE_FAILED');
    return { invitation_id: invitation.id, token, expires_at: invitation.expires_at };
  });

export const revokeInvitation = createServerFn({ method: 'POST' })
  .validator(validateRevokeInvitation)
  .handler(async ({ data }) => {
    const client = await requireAdmin(data.community_id);
    const { data: invitation, error } = await client
      .from('community_invitations')
      .update({ revoked_at: new Date().toISOString() })
      .eq('community_id', data.community_id)
      .eq('id', data.invitation_id)
      .is('revoked_at', null)
      .is('redeemed_at', null)
      .select('id,revoked_at')
      .maybeSingle();
    if (error) throw error;
    if (!invitation) throw new Error('INVITATION_NOT_FOUND');
    return invitation;
  });
