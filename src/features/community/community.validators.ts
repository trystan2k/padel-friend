import type { Database } from '../../lib/supabase/database.types';

type Visibility = Database['public']['Enums']['community_visibility'];
type JoinPolicy = Database['public']['Enums']['community_join_policy'];
type Settings = Database['public']['Tables']['communities']['Update']['settings'];
type CommunityRow = Database['public']['Tables']['communities']['Row'];
export type PublicCommunity = Pick<
  CommunityRow,
  | 'id'
  | 'name'
  | 'description'
  | 'logo_path'
  | 'city_label'
  | 'visibility'
  | 'join_policy'
  | 'created_at'
  | 'updated_at'
>;
export type ListPublicCommunitiesInput = { search?: string; offset: number; limit: number };
export type GetPublicCommunityInput = { community_id: string };
export type JoinCommunityInput = { community_id: string };
export type AcceptInvitationInput = { token: string };

export type CreateCommunityInput = {
  name: string;
  visibility: Visibility;
  join_policy: JoinPolicy;
  description?: string | null;
  city_label?: string | null;
};
export type UpdateCommunitySettingsInput = { community_id: string } & Partial<{
  name: string;
  visibility: Visibility;
  join_policy: JoinPolicy;
  description: string | null;
  city_label: string | null;
  logo_path: string | null;
  settings: Settings;
}>;

function invalid(): never {
  throw new Error('INVALID_COMMUNITY_INPUT');
}

function pgText(value: string): string {
  if (value.includes('\u0000') || Array.from(value).some((char) => /^[\uD800-\uDFFF]$/u.test(char)))
    invalid();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function objectWithKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key))) invalid();
  return value;
}

function name(value: unknown): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    /^[ \t\n\r\f\v]|[ \t\n\r\f\v]$/.test(value) ||
    Array.from(value).length > 80
  )
    invalid();
  return pgText(value);
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Array.from(value).length > max) invalid();
  return pgText(value);
}

function visibility(value: unknown): Visibility {
  if (value !== 'public' && value !== 'private') invalid();
  return value;
}

function joinPolicy(value: unknown): JoinPolicy {
  if (value !== 'instant' && value !== 'admin_approval') invalid();
  return value;
}

function communityId(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    invalid();
  return value;
}

function isJson(value: unknown, seen: WeakSet<object>): value is NonNullable<Settings> {
  if (typeof value === 'string') {
    pgText(value);
    return true;
  }
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value !== 'object' || seen.has(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  if (!Array.isArray(value) && prototype !== Object.prototype && prototype !== null) return false;
  seen.add(value);
  const valid = Array.isArray(value)
    ? Array.from(
        { length: value.length },
        (_, index) => index in value && isJson(value[index], seen)
      ).every(Boolean)
    : Object.entries(value).every(([key, item]) => {
        pgText(key);
        return isJson(item, seen);
      });
  seen.delete(value);
  return valid;
}

function settings(value: unknown): Settings {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    !isJson(value, new WeakSet())
  )
    invalid();
  try {
    if (new TextEncoder().encode(JSON.stringify(value)).length > 4096) invalid();
  } catch {
    invalid();
  }
  return value;
}

export function validateCreateCommunity(value: unknown): CreateCommunityInput {
  const input = objectWithKeys(value, [
    'name',
    'visibility',
    'join_policy',
    'description',
    'city_label'
  ]);
  return {
    name: name(input.name),
    visibility: visibility(input.visibility),
    join_policy: joinPolicy(input.join_policy),
    ...('description' in input ? { description: optionalText(input.description, 500) } : {}),
    ...('city_label' in input ? { city_label: optionalText(input.city_label, 120) } : {})
  };
}

export function validateUpdateCommunitySettings(value: unknown): UpdateCommunitySettingsInput {
  const input = objectWithKeys(value, [
    'community_id',
    'name',
    'visibility',
    'join_policy',
    'description',
    'city_label',
    'logo_path',
    'settings'
  ]);
  if (Object.keys(input).length < 2) invalid();
  return {
    community_id: communityId(input.community_id),
    ...('name' in input ? { name: name(input.name) } : {}),
    ...('visibility' in input ? { visibility: visibility(input.visibility) } : {}),
    ...('join_policy' in input ? { join_policy: joinPolicy(input.join_policy) } : {}),
    ...('description' in input ? { description: optionalText(input.description, 500) } : {}),
    ...('city_label' in input ? { city_label: optionalText(input.city_label, 120) } : {}),
    ...('logo_path' in input ? { logo_path: optionalText(input.logo_path, 256) } : {}),
    ...('settings' in input ? { settings: settings(input.settings) } : {})
  };
}

export function validateListPublicCommunities(value: unknown): ListPublicCommunitiesInput {
  const input = objectWithKeys(value, ['search', 'offset', 'limit']);
  const offset = 'offset' in input ? input.offset : 0;
  const limit = 'limit' in input ? input.limit : 20;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    invalid();
  if (!('search' in input)) return { offset, limit };
  if (typeof input.search !== 'string') invalid();
  const search = pgText(input.search.trim());
  if (Array.from(search).length > 80) invalid();
  return { offset, limit, ...(search ? { search } : {}) };
}

export function validateGetPublicCommunity(value: unknown): GetPublicCommunityInput {
  const input = objectWithKeys(value, ['community_id']);
  return { community_id: communityId(input.community_id) };
}

export function validateJoinCommunity(value: unknown): JoinCommunityInput {
  const input = objectWithKeys(value, ['community_id']);
  return { community_id: communityId(input.community_id) };
}

export function validateAcceptInvitation(value: unknown): AcceptInvitationInput {
  const input = objectWithKeys(value, ['token']);
  if (typeof input.token !== 'string' || !/^[0-9a-f]{64}$/.test(input.token)) invalid();
  return { token: input.token };
}
