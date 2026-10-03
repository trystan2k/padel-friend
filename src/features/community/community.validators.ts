import type { Database } from '../../lib/supabase/database.types';

type Visibility = Database['public']['Enums']['community_visibility'];
type JoinPolicy = Database['public']['Enums']['community_join_policy'];
type Settings = Database['public']['Tables']['communities']['Update']['settings'];

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
  return value;
}

function optionalText(value: unknown, max: number): string | null {
  if (value === null) return null;
  if (typeof value !== 'string' || Array.from(value).length > max) invalid();
  return value;
}

function visibility(value: unknown): Visibility {
  if (value !== 'public' && value !== 'private') invalid();
  return value;
}

function joinPolicy(value: unknown): JoinPolicy {
  if (value !== 'instant' && value !== 'admin_approval') invalid();
  return value;
}

function isJson(value: unknown, seen: WeakSet<object>): value is NonNullable<Settings> {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true;
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
    : Object.values(value).every((item) => isJson(item, seen));
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
  if (
    typeof input.community_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.community_id) ||
    Object.keys(input).length < 2
  )
    invalid();
  return {
    community_id: input.community_id,
    ...('name' in input ? { name: name(input.name) } : {}),
    ...('visibility' in input ? { visibility: visibility(input.visibility) } : {}),
    ...('join_policy' in input ? { join_policy: joinPolicy(input.join_policy) } : {}),
    ...('description' in input ? { description: optionalText(input.description, 500) } : {}),
    ...('city_label' in input ? { city_label: optionalText(input.city_label, 120) } : {}),
    ...('logo_path' in input ? { logo_path: optionalText(input.logo_path, 256) } : {}),
    ...('settings' in input ? { settings: settings(input.settings) } : {})
  };
}
