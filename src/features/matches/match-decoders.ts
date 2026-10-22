import type {
  MatchCreationOptions,
  MatchEventDetail,
  MatchEventRpcDetail,
  MatchEventRpcListRow,
  MatchInvitee
} from './match-contracts';
import { matchCallerBadge } from './match-model';

type ObjectValue = Record<string, unknown>;
const fail = (): never => {
  throw new Error('INVALID_MATCH_RESPONSE');
};
function object(value: unknown): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  return Object.fromEntries(Object.entries(value));
}
function required<T>(data: ObjectValue, key: string, decode: (value: unknown) => T): T {
  if (!Object.hasOwn(data, key)) return fail();
  return decode(data[key]);
}
function text(value: unknown): string {
  return typeof value === 'string' ? value : fail();
}
function nonEmptyText(value: unknown): string {
  return typeof value === 'string' && value.trim() ? value : fail();
}
function nullableText(value: unknown): string | null {
  return value === null ? null : text(value);
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}
function safeNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fail();
}
function nullableNumber(value: unknown): number | null {
  return value === null ? null : safeNumber(value);
}
function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function timestamp(value: unknown): string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/i.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : fail();
}
function timeZone(value: unknown): string {
  if (typeof value !== 'string' || !value) return fail();
  try {
    const formatter = new Intl.DateTimeFormat('en', { timeZone: value });
    formatter.resolvedOptions();
    return value;
  } catch {
    return fail();
  }
}
function enumValue<T extends string>(value: unknown, values: readonly T[]): T {
  const matched =
    typeof value === 'string' ? values.find((candidate) => candidate === value) : undefined;
  return matched ?? fail();
}
const eventTypes = ['friendly', 'competitive'] as const;
const visibilities = ['community_open', 'invite_only'] as const;
const teamModes = ['PREDEFINED_TEAMS', 'POST_MATCH_TEAMS'] as const;
const eligibility = ['creator', 'member', 'out_of_range', 'nonmember'] as const;
const currencies = ['BRL', 'USD', 'EUR'] as const;

function decodeProjection(value: unknown) {
  const row = object(value);
  const badgeValue = required(row, 'caller_badge', (entry) => entry);
  const nullableField = <T>(key: string, decoder: (entry: unknown) => T) =>
    required(row, key, (entry) => (entry === null ? null : decoder(entry)));
  return {
    event_id: required(row, 'event_id', nonEmptyText),
    status: required(row, 'status', (entry) => enumValue(entry, ['open', 'cancelled'] as const)),
    community_id: required(row, 'community_id', nonEmptyText),
    community_name: required(row, 'community_name', text),
    creator_id: required(row, 'creator_id', nonEmptyText),
    creator_name: nullableField('creator_name', text),
    creator_level: nullableField('creator_level', safeNumber),
    starts_at: required(row, 'starts_at', timestamp),
    timezone: required(row, 'timezone', timeZone),
    event_type: required(row, 'event_type', (entry) => enumValue(entry, eventTypes)),
    visibility: required(row, 'visibility', (entry) => enumValue(entry, visibilities)),
    team_assignment_mode: required(row, 'team_assignment_mode', (entry) =>
      enumValue(entry, teamModes)
    ),
    venue_name: required(row, 'venue_name', text),
    maps_url: required(row, 'maps_url', text),
    court_notes: nullableField('court_notes', text),
    duration_minutes: nullableField('duration_minutes', count),
    notes: nullableField('notes', text),
    court_booked: required(row, 'court_booked', boolean),
    restriction_enabled: required(row, 'restriction_enabled', boolean),
    min_level: nullableField('min_level', safeNumber),
    max_level: nullableField('max_level', safeNumber),
    price_minor: nullableField('price_minor', count),
    currency: nullableField('currency', (entry) => enumValue(entry, currencies)),
    payment_note: nullableField('payment_note', text),
    maximum_registrations: nullableField('maximum_registrations', count),
    registration_cutoff_at: required(row, 'registration_cutoff_at', timestamp),
    accepted_count: required(row, 'accepted_count', count),
    playing_count: required(row, 'playing_count', count),
    reserve_count: required(row, 'reserve_count', count),
    reserve_not_playing_count: required(row, 'reserve_not_playing_count', count),
    group_count: required(row, 'group_count', count),
    more_needed: required(row, 'more_needed', count),
    caller_badge: matchCallerBadge(badgeValue),
    caller_is_invited: required(row, 'caller_is_invited', boolean),
    caller_eligibility: nullableField('caller_eligibility', (entry) =>
      enumValue(entry, eligibility)
    ),
    caller_requires_approval: required(row, 'caller_requires_approval', boolean),
    is_past: required(row, 'is_past', boolean),
    registration_open: required(row, 'registration_open', boolean)
  };
}

export function decodeMatchCreationOptions(value: unknown): MatchCreationOptions {
  const data = object(value);
  const communitiesValue = required(data, 'communities', (entry) => entry);
  const venuesValue = required(data, 'saved_venues', (entry) => entry);
  if (!Array.isArray(communitiesValue) || !Array.isArray(venuesValue)) return fail();
  const communities = communitiesValue.map((entry) => {
    const row = object(entry);
    return {
      id: required(row, 'id', nonEmptyText),
      name: required(row, 'name', text),
      timezone: required(row, 'timezone', (zone) => (zone === null ? null : timeZone(zone))),
      currency: required(row, 'currency', nonEmptyText)
    };
  });
  const saved_venues = venuesValue.map((entry) => {
    const row = object(entry);
    return {
      id: required(row, 'id', nonEmptyText),
      name: required(row, 'name', text),
      maps_url: required(row, 'maps_url', nullableText),
      photo_path: required(row, 'photo_path', nullableText)
    };
  });
  const levelValue = required(data, 'level_defaults', (entry) => entry);
  const level_defaults =
    levelValue === null
      ? null
      : (() => {
          const level = object(levelValue);
          return {
            min: required(level, 'min', nullableNumber),
            max: required(level, 'max', nullableNumber),
            level: required(level, 'level', nullableNumber)
          };
        })();
  return { communities, saved_venues, level_defaults };
}

export function decodeMatchInvitees(value: unknown): MatchInvitee[] {
  if (!Array.isArray(value)) return fail();
  return value.map((entry) => {
    const row = object(entry);
    return {
      user_id: required(row, 'user_id', nonEmptyText),
      display_name: required(row, 'display_name', text)
    };
  });
}

export function decodeMatchRpcDetail(value: unknown): MatchEventRpcDetail {
  const row = object(value);
  return {
    ...decodeProjection(row),
    photo_path: required(row, 'photo_path', nonEmptyText),
    as_of: required(row, 'as_of', timestamp)
  };
}

export function decodeMatchRpcListRows(value: unknown): MatchEventRpcListRow[] {
  if (!Array.isArray(value)) return fail();
  return value.map((entry) => {
    const row = object(entry);
    return {
      ...decodeProjection(row),
      photo_path: required(row, 'photo_path', nonEmptyText),
      as_of: required(row, 'as_of', timestamp),
      cursor: required(row, 'cursor', nonEmptyText)
    };
  });
}

export function signedMatchDetail(
  raw: MatchEventRpcDetail,
  photo_url: string | null
): MatchEventDetail {
  const { photo_path: _photoPath, ...projection } = raw;
  return { ...projection, photo_url };
}
