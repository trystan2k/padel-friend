import type { Database } from '../../lib/supabase/database.types';

type Status = Database['public']['Enums']['community_membership_status'];
export type MemberActionInput = { community_id: string; membership_id: string };
export type PageInput = { community_id: string; offset: number; limit: number };
export type SearchMembersInput = PageInput & { query: string; status: Status | null };
export type VenueInput = {
  community_id: string;
  name: string;
  address?: string | null;
  maps_url?: string | null;
  photo_path?: string | null;
};

function invalid(): never {
  throw new Error('INVALID_COMMUNITY_INPUT');
}
function record(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    invalid();
  return Object.fromEntries(Object.entries(value));
}
function uuid(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid();
  return value;
}
function text(value: unknown, max: number, required = false): string | null {
  if (value === null && !required) return null;
  if (
    typeof value !== 'string' ||
    (required && (!value || value.trim() !== value)) ||
    Array.from(value).length > max ||
    value.includes('\u0000') ||
    Array.from(value).some((char) => /^[\uD800-\uDFFF]$/u.test(char))
  )
    invalid();
  return value;
}
export function validateMemberAction(value: unknown): MemberActionInput {
  const input = record(value, ['community_id', 'membership_id']);
  return { community_id: uuid(input.community_id), membership_id: uuid(input.membership_id) };
}
export function validatePage(value: unknown): PageInput {
  const input = record(value, ['community_id', 'offset', 'limit']);
  return page(input);
}
function page(input: Record<string, unknown>): PageInput {
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    offset < 0 ||
    offset > 10000 ||
    limit < 1 ||
    limit > 50
  )
    invalid();
  return {
    community_id: uuid(input.community_id),
    offset,
    limit
  };
}
export function validateSearchMembers(value: unknown): SearchMembersInput {
  const input = record(value, ['community_id', 'offset', 'limit', 'query', 'status']);
  const status = input.status ?? null;
  if (status !== null && status !== 'active' && status !== 'pending' && status !== 'inactive')
    invalid();
  return { ...page(input), query: text(input.query ?? '', 80)!, status };
}
export function validateInvitation(value: unknown): {
  community_id: string;
  invitee_user_id: string;
} {
  const input = record(value, ['community_id', 'invitee_user_id']);
  return { community_id: uuid(input.community_id), invitee_user_id: uuid(input.invitee_user_id) };
}
export function validateRevokeInvitation(value: unknown): {
  community_id: string;
  invitation_id: string;
} {
  const input = record(value, ['community_id', 'invitation_id']);
  return { community_id: uuid(input.community_id), invitation_id: uuid(input.invitation_id) };
}
export function validateVenue(value: unknown): VenueInput {
  const input = record(value, ['community_id', 'name', 'address', 'maps_url', 'photo_path']);
  const name = text(input.name, 120, true)!;
  const mapsUrl = input.maps_url === undefined ? undefined : text(input.maps_url, 2048);
  if (mapsUrl !== undefined && mapsUrl !== null && !mapsUrl.startsWith('https://')) invalid();
  return {
    community_id: uuid(input.community_id),
    name,
    ...('address' in input ? { address: text(input.address, 300) } : {}),
    ...('maps_url' in input ? { maps_url: mapsUrl } : {}),
    ...('photo_path' in input ? { photo_path: text(input.photo_path, 256) } : {})
  };
}
export function validateVenueEdit(value: unknown): VenueInput & { venue_id: string } {
  const input = record(value, [
    'community_id',
    'venue_id',
    'name',
    'address',
    'maps_url',
    'photo_path'
  ]);
  const { venue_id, ...changes } = input;
  return { ...validateVenue(changes), venue_id: uuid(venue_id) };
}
export function validateVenueId(value: unknown): { community_id: string; venue_id: string } {
  const input = record(value, ['community_id', 'venue_id']);
  return { community_id: uuid(input.community_id), venue_id: uuid(input.venue_id) };
}
