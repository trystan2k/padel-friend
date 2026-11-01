import { COMMUNITY_TIMEZONES, type CommunityTimezone } from '../community/community-settings';
import {
  LEAGUE_BLOCKED_REASONS,
  LEAGUE_CLOSED_REASONS,
  LEAGUE_END_MODES,
  LEAGUE_STATUSES,
  type LeagueCommunityDto,
  type LeagueCounterEntry,
  type LeagueCountersResult,
  type LeagueDetailResult,
  type LeagueDto,
  type LeagueListResult
} from './league-contracts';

type ObjectValue = Record<string, unknown>;

const fail = (): never => {
  throw new Error('INVALID_LEAGUE_RESPONSE');
};
function exactObject(value: unknown, keys: readonly string[]): ObjectValue {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return fail();
  const row: ObjectValue = Object.fromEntries(Object.entries(value));
  if (Object.keys(row).length !== keys.length || keys.some((key) => !Object.hasOwn(row, key)))
    return fail();
  return row;
}
function text(value: unknown): string {
  return typeof value === 'string' && value ? value : fail();
}
function nullable<T>(value: unknown, decode: (input: unknown) => T): T | null {
  return value === null ? null : decode(value);
}
function boolean(value: unknown): boolean {
  return typeof value === 'boolean' ? value : fail();
}
function integer(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 1 ? value : fail();
}
function oneOf<T extends string>(value: unknown, values: readonly T[]): T {
  const matched = typeof value === 'string' ? values.find((item) => item === value) : undefined;
  return matched ?? fail();
}
function uuid(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : fail();
}
function instant(value: unknown): string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(value) &&
    Number.isFinite(Date.parse(value))
    ? value
    : fail();
}
function calendarDate(value: unknown): string {
  return typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(`${value}T00:00:00Z`))
    ? value
    : fail();
}

const LEAGUE_KEYS = [
  'id',
  'community_id',
  'name',
  'description',
  'owner_id',
  'owner_name',
  'timezone',
  'start_at',
  'end_mode',
  'end_at',
  'start_date',
  'end_date',
  'status',
  'blocked_reason',
  'activation_due',
  'minimum_matches_for_final_award',
  'activated_at',
  'closed_at',
  'closed_reason',
  'created_at',
  'version',
  'can_manage',
  'period_locked'
] as const;

export function decodeLeagueDto(value: unknown): LeagueDto {
  const row = exactObject(value, LEAGUE_KEYS);
  const endMode = oneOf(row.end_mode, LEAGUE_END_MODES);
  const status = oneOf(row.status, LEAGUE_STATUSES);
  const endAt = nullable(row.end_at, instant);
  const endDate = nullable(row.end_date, calendarDate);
  // Mirrors the database check: Fixed Leagues carry an end, Manual ones never do.
  if ((endMode === 'fixed_date') !== (endAt !== null) || (endAt === null) !== (endDate === null))
    return fail();
  const blockedReason = nullable(row.blocked_reason, (item) => oneOf(item, LEAGUE_BLOCKED_REASONS));
  if (blockedReason !== null && status !== 'upcoming') return fail();
  return {
    id: uuid(row.id),
    community_id: uuid(row.community_id),
    name: text(row.name),
    description: nullable(row.description, text),
    owner_id: uuid(row.owner_id),
    owner_name: nullable(row.owner_name, text),
    timezone: oneOf<CommunityTimezone>(row.timezone, COMMUNITY_TIMEZONES),
    start_at: instant(row.start_at),
    end_mode: endMode,
    end_at: endAt,
    start_date: calendarDate(row.start_date),
    end_date: endDate,
    status,
    blocked_reason: blockedReason,
    activation_due: boolean(row.activation_due),
    minimum_matches_for_final_award: integer(row.minimum_matches_for_final_award),
    activated_at: nullable(row.activated_at, instant),
    closed_at: nullable(row.closed_at, instant),
    closed_reason: nullable(row.closed_reason, (item) => oneOf(item, LEAGUE_CLOSED_REASONS)),
    created_at: instant(row.created_at),
    version: integer(row.version),
    can_manage: boolean(row.can_manage),
    period_locked: boolean(row.period_locked)
  };
}

function decodeCommunity(value: unknown): LeagueCommunityDto {
  const row = exactObject(value, ['id', 'name', 'timezone', 'creation_enabled', 'can_create']);
  return {
    id: uuid(row.id),
    name: text(row.name),
    timezone: oneOf<CommunityTimezone>(row.timezone, COMMUNITY_TIMEZONES),
    creation_enabled: boolean(row.creation_enabled),
    can_create: boolean(row.can_create)
  };
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fail();
}
function signedCount(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : fail();
}

const COUNTER_KEYS = [
  'user_id',
  'display_name',
  'is_provisional',
  'matches',
  'wins',
  'losses',
  'draws',
  'sets_won',
  'sets_lost',
  'set_differential'
] as const;

function decodeCounterEntry(value: unknown): LeagueCounterEntry {
  const row = exactObject(value, COUNTER_KEYS);
  const entry: LeagueCounterEntry = {
    user_id: uuid(row.user_id),
    display_name: nullable(row.display_name, text),
    is_provisional: boolean(row.is_provisional),
    matches: count(row.matches),
    wins: count(row.wins),
    losses: count(row.losses),
    draws: count(row.draws),
    sets_won: count(row.sets_won),
    sets_lost: count(row.sets_lost),
    set_differential: signedCount(row.set_differential)
  };
  // The counters are a closed arithmetic: any drift means a corrupted or foreign payload.
  if (
    entry.wins + entry.losses + entry.draws !== entry.matches ||
    entry.sets_won - entry.sets_lost !== entry.set_differential
  )
    return fail();
  return entry;
}

export function decodeLeagueCounters(value: unknown): LeagueCountersResult {
  const row = exactObject(value, ['league_id', 'participants', 'excluded_group_count']);
  if (!Array.isArray(row.participants)) return fail();
  const participants = row.participants.map(decodeCounterEntry);
  if (new Set(participants.map((entry) => entry.user_id)).size !== participants.length)
    return fail();
  return {
    league_id: uuid(row.league_id),
    participants,
    excluded_group_count: count(row.excluded_group_count)
  };
}

export function decodeLeagueList(value: unknown): LeagueListResult {
  const row = exactObject(value, ['community', 'leagues']);
  if (!Array.isArray(row.leagues)) return fail();
  return { community: decodeCommunity(row.community), leagues: row.leagues.map(decodeLeagueDto) };
}

export function decodeLeagueDetail(value: unknown): LeagueDetailResult {
  const row = exactObject(value, ['community', 'league']);
  return { community: decodeCommunity(row.community), league: decodeLeagueDto(row.league) };
}
