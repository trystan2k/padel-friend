import { STATISTICS_HISTORY_PAGE_DEFAULT, STATISTICS_HISTORY_PAGE_MAX } from './statistics-config';
import {
  STATISTICS_MATCH_TYPES,
  type StatisticsFilters,
  type StatisticsMatchType
} from './statistics-contracts';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function invalid(): never {
  throw new Error('INVALID_STATISTICS_INPUT');
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) return invalid();
  return data;
}
function optionalUuid(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  return typeof value === 'string' && UUID.test(value) ? value.toLowerCase() : invalid();
}
/** Whole UTC calendar date; impossible days (2030-02-31) are rejected, not rolled over. */
function optionalDate(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const instant = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(instant) && new Date(instant).toISOString().startsWith(value)
    ? value
    : invalid();
}
function matchType(value: unknown): StatisticsMatchType {
  if (value === undefined || value === null) return 'all';
  return STATISTICS_MATCH_TYPES.find((type) => type === value) ?? invalid();
}

/**
 * Normalizes a filter set: defaults type to all, rejects unknown keys, malformed ids/dates and a
 * range whose through date precedes from. League without community is rejected so a League id can
 * never silently widen to another community.
 */
export function validateStatisticsFilters(input: unknown): StatisticsFilters {
  const data = record(input ?? {}, ['communityId', 'leagueId', 'type', 'from', 'through']);
  const filters: StatisticsFilters = {
    communityId: optionalUuid(data.communityId),
    leagueId: optionalUuid(data.leagueId),
    type: matchType(data.type),
    from: optionalDate(data.from),
    through: optionalDate(data.through)
  };
  if (filters.leagueId !== null && filters.communityId === null) return invalid();
  if (filters.from !== null && filters.through !== null && filters.through < filters.from)
    return invalid();
  return filters;
}

/** Whole UTC dates → half-open instants: from inclusive, through converted to next UTC midnight. */
export function utcRangeBounds(filters: Pick<StatisticsFilters, 'from' | 'through'>): {
  fromInstant: string | null;
  untilInstant: string | null;
} {
  const next = (day: string) => new Date(Date.parse(`${day}T00:00:00Z`) + 86_400_000).toISOString();
  return {
    fromInstant: filters.from === null ? null : `${filters.from}T00:00:00.000Z`,
    untilInstant: filters.through === null ? null : next(filters.through)
  };
}

export function validateStatisticsPageSize(value: unknown): number {
  if (value === undefined || value === null) return STATISTICS_HISTORY_PAGE_DEFAULT;
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return invalid();
  return value < 1 ? STATISTICS_HISTORY_PAGE_DEFAULT : Math.min(value, STATISTICS_HISTORY_PAGE_MAX);
}

export type StatisticsHistoryInput = {
  filters: StatisticsFilters;
  limit: number;
  cursor: string | null;
};
export type StatisticsGroupDetailInput = { eventId: string; groupId: string };
export type DecodedHistoryCursor = { revision: number; at: string; key: string };

const FILTER_KEYS = ['communityId', 'leagueId', 'type', 'from', 'through'] as const;
const CURSOR_KEY = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const CURSOR_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/;

/** Opaque cursor: the pinned statistics revision plus the keyset position of the last row served. */
export function encodeHistoryCursor(revision: number, position: { at: string; key: string }) {
  return btoa(JSON.stringify({ r: revision, t: position.at, k: position.key }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function decodeHistoryCursor(cursor: string): DecodedHistoryCursor {
  if (cursor.length > 240 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return invalid();
  let parsed: unknown;
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/');
    parsed = JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')));
  } catch {
    return invalid();
  }
  const data = record(parsed, ['r', 't', 'k']);
  const { r: revision, t: at, k: key } = data;
  if (
    typeof revision !== 'number' ||
    !Number.isSafeInteger(revision) ||
    revision < 0 ||
    typeof at !== 'string' ||
    !CURSOR_INSTANT.test(at) ||
    Number.isNaN(Date.parse(at)) ||
    new Date(at).toISOString().slice(0, 19) !== at.slice(0, 19) ||
    typeof key !== 'string' ||
    !CURSOR_KEY.test(key)
  )
    return invalid();
  return { revision, at, key };
}

/** History query: the shared filter set plus a page size and an opaque keyset cursor. */
export function validateStatisticsHistoryInput(input: unknown): StatisticsHistoryInput {
  const data = record(input ?? {}, [...FILTER_KEYS, 'limit', 'cursor']);
  const filters = validateStatisticsFilters(
    Object.fromEntries(FILTER_KEYS.filter((key) => key in data).map((key) => [key, data[key]]))
  );
  const cursor = data.cursor;
  if (cursor !== undefined && cursor !== null) {
    if (typeof cursor !== 'string') return invalid();
    decodeHistoryCursor(cursor);
  }
  return {
    filters,
    limit: validateStatisticsPageSize(data.limit),
    cursor: typeof cursor === 'string' ? cursor : null
  };
}

export function validateStatisticsGroupDetailInput(input: unknown): StatisticsGroupDetailInput {
  const data = record(input, ['eventId', 'groupId']);
  const { eventId, groupId } = data;
  if (
    typeof eventId !== 'string' ||
    !UUID.test(eventId) ||
    typeof groupId !== 'string' ||
    !UUID.test(groupId)
  )
    return invalid();
  return { eventId: eventId.toLowerCase(), groupId: groupId.toLowerCase() };
}
