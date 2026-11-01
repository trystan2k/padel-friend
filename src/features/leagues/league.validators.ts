import { hasEdgeWhitespace } from '../../lib/edge-whitespace';
import {
  LEAGUE_DESCRIPTION_MAX,
  LEAGUE_END_MODES,
  LEAGUE_MINIMUM_MATCHES_MAX,
  LEAGUE_MINIMUM_MATCHES_MIN,
  LEAGUE_NAME_MAX,
  type CreateLeagueInput,
  type LeagueEndMode,
  type UpdateLeagueChanges
} from './league-contracts';

function invalid(): never {
  throw new Error('INVALID_LEAGUE_INPUT');
}
function record(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return invalid();
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) return invalid();
  return data;
}
function uuid(value: unknown): string {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
    ? value
    : invalid();
}
function boundedText(value: unknown, max: number): string {
  if (
    typeof value !== 'string' ||
    !value ||
    hasEdgeWhitespace(value) ||
    Array.from(value).length > max ||
    value.includes('\u0000')
  )
    return invalid();
  return value;
}
function calendarDate(value: unknown): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid();
  const instant = Date.parse(`${value}T00:00:00Z`);
  // Rejects impossible days (2030-02-31 rolls over; 2030-13-01 is not a date at all).
  return Number.isFinite(instant) && new Date(instant).toISOString().startsWith(value)
    ? value
    : invalid();
}
function minimumMatches(value: unknown): number {
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= LEAGUE_MINIMUM_MATCHES_MIN &&
    value <= LEAGUE_MINIMUM_MATCHES_MAX
    ? value
    : invalid();
}
function endMode(value: unknown): LeagueEndMode {
  return LEAGUE_END_MODES.find((mode) => mode === value) ?? invalid();
}

/** Mode/date coherence shared with the database: Manual has no end; Fixed ends after it starts. */
function periodFields(mode: LeagueEndMode, startDate: string, endDate: unknown) {
  if (mode === 'manual') {
    if (endDate !== null) invalid();
    return null;
  }
  const end = calendarDate(endDate);
  if (end <= startDate) invalid();
  return end;
}

export function validateLeagueCommunity(value: unknown): { community_id: string } {
  const data = record(value, ['community_id']);
  return { community_id: uuid(data.community_id) };
}

export function validateLeagueId(value: unknown): { league_id: string } {
  const data = record(value, ['league_id']);
  return { league_id: uuid(data.league_id) };
}

export function validateLeagueCommand(value: unknown): {
  league_id: string;
  expected_version: number;
} {
  const data = record(value, ['league_id', 'expected_version']);
  const version = data.expected_version;
  if (typeof version !== 'number' || !Number.isSafeInteger(version) || version < 1) invalid();
  return { league_id: uuid(data.league_id), expected_version: version };
}

export function validateCreateLeague(value: unknown): CreateLeagueInput {
  const data = record(value, [
    'request_id',
    'community_id',
    'name',
    'description',
    'end_mode',
    'start_date',
    'end_date',
    'minimum_matches'
  ]);
  const mode = endMode(data.end_mode);
  const startDate = calendarDate(data.start_date);
  return {
    request_id: uuid(data.request_id),
    community_id: uuid(data.community_id),
    name: boundedText(data.name, LEAGUE_NAME_MAX),
    description:
      data.description === null ? null : boundedText(data.description, LEAGUE_DESCRIPTION_MAX),
    end_mode: mode,
    start_date: startDate,
    end_date: periodFields(mode, startDate, data.end_date),
    minimum_matches: minimumMatches(data.minimum_matches)
  };
}

export function validateUpdateLeague(value: unknown): {
  league_id: string;
  expected_version: number;
  changes: UpdateLeagueChanges;
} {
  const data = record(value, ['league_id', 'expected_version', 'changes']);
  const command = validateLeagueCommand({
    league_id: data.league_id,
    expected_version: data.expected_version
  });
  const raw = record(data.changes, [
    'name',
    'description',
    'minimum_matches_for_final_award',
    'end_mode',
    'start_date',
    'end_date'
  ]);
  const changes: UpdateLeagueChanges = {};
  if (Object.hasOwn(raw, 'name')) changes.name = boundedText(raw.name, LEAGUE_NAME_MAX);
  if (Object.hasOwn(raw, 'description'))
    changes.description =
      raw.description === null ? null : boundedText(raw.description, LEAGUE_DESCRIPTION_MAX);
  if (Object.hasOwn(raw, 'minimum_matches_for_final_award'))
    changes.minimum_matches_for_final_award = minimumMatches(raw.minimum_matches_for_final_award);
  if (Object.hasOwn(raw, 'end_mode')) changes.end_mode = endMode(raw.end_mode);
  if (Object.hasOwn(raw, 'start_date')) changes.start_date = calendarDate(raw.start_date);
  if (Object.hasOwn(raw, 'end_date'))
    changes.end_date = raw.end_date === null ? null : calendarDate(raw.end_date);
  if (Object.keys(changes).length === 0) invalid();
  return { ...command, changes };
}
