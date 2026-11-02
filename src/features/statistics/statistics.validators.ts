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
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= 1 &&
    value <= STATISTICS_HISTORY_PAGE_MAX
    ? value
    : invalid();
}
