const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const record = (value: unknown): Record<string, unknown> => {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_MATCH_INPUT');
  return Object.fromEntries(Object.entries(value));
};
function exact(value: unknown, keys: readonly string[]) {
  const data = record(value);
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error('INVALID_MATCH_INPUT');
  return data;
}
export function validateMatchUuid(value: unknown): string {
  if (typeof value !== 'string' || !uuid.test(value)) throw new Error('INVALID_MATCH_INPUT');
  return value;
}
export function validateMatchOptions(value: unknown) {
  const data = exact(value, ['community_id']);
  return { community_id: data.community_id == null ? null : validateMatchUuid(data.community_id) };
}
export function validateMatchInviteSearch(value: unknown) {
  const data = exact(value, ['community_id', 'query', 'limit']);
  if (typeof data.query !== 'string' || data.query.length > 100)
    throw new Error('INVALID_MATCH_INPUT');
  const limit = data.limit ?? 20;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 20)
    throw new Error('INVALID_MATCH_INPUT');
  return { community_id: validateMatchUuid(data.community_id), query: data.query, limit };
}
export function validateMatchList(value: unknown) {
  const data = exact(value, ['entry', 'community_id', 'cursor', 'limit', 'as_of']);
  if (data.entry !== 'available' && data.entry !== 'my' && data.entry !== 'past')
    throw new Error('INVALID_MATCH_INPUT');
  const limit = data.limit ?? 20;
  if (typeof limit !== 'number' || !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error('INVALID_MATCH_INPUT');
  if (data.cursor != null && (typeof data.cursor !== 'string' || data.cursor.length > 200))
    throw new Error('INVALID_MATCH_INPUT');
  if (
    data.as_of != null &&
    (typeof data.as_of !== 'string' || !Number.isFinite(Date.parse(data.as_of)))
  )
    throw new Error('INVALID_MATCH_INPUT');
  return {
    entry: data.entry,
    community_id: data.community_id == null ? null : validateMatchUuid(data.community_id),
    cursor: typeof data.cursor === 'string' ? data.cursor : '',
    limit,
    as_of: typeof data.as_of === 'string' ? data.as_of : null
  };
}
export function validateMatchDetail(value: unknown) {
  const data = exact(value, ['event_id']);
  return { event_id: validateMatchUuid(data.event_id) };
}
function optionalString(
  data: Record<string, unknown>,
  key: keyof MatchPublishInput,
  nullable: boolean
) {
  const value = data[key];
  if (value === undefined || (nullable && value === null)) return value;
  if (typeof value !== 'string') throw new Error('INVALID_MATCH_INPUT');
  return value;
}
function optionalNumber(
  data: Record<string, unknown>,
  key: keyof MatchPublishInput,
  nullable: boolean
) {
  const value = data[key];
  if (value === undefined || (nullable && value === null)) return value;
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new Error('INVALID_MATCH_INPUT');
  return value;
}
export function validatePublishMatch(value: unknown): {
  event_id: string;
  input: MatchPublishInput;
  invitee_ids: string[];
} {
  const data = exact(value, ['event_id', 'input', 'invitee_ids']);
  const input = record(data.input);
  const inputKeys = [
    'community_id',
    'date',
    'start_time',
    'event_type',
    'visibility',
    'team_assignment_mode',
    'venue_name',
    'maps_url',
    'photo_path',
    'saved_venue_id',
    'court_notes',
    'duration_minutes',
    'notes',
    'court_booked',
    'restriction_enabled',
    'min_level',
    'max_level',
    'price',
    'currency',
    'payment_note',
    'maximum_registrations',
    'cutoff_at'
  ] as const;
  const allowedInputKeys = new Set<string>(inputKeys);
  if (
    Object.keys(input).some((key) => !allowedInputKeys.has(key)) ||
    !Array.isArray(data.invitee_ids) ||
    data.invitee_ids.length > 100
  )
    throw new Error('INVALID_MATCH_INPUT');
  const community_id = validateMatchUuid(input.community_id);
  const parsedDate = typeof input.date === 'string' ? new Date(`${input.date}T00:00:00Z`) : null;
  if (
    typeof input.date !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}$/.test(input.date) ||
    !parsedDate ||
    !Number.isFinite(parsedDate.getTime()) ||
    parsedDate.toISOString().slice(0, 10) !== input.date ||
    typeof input.start_time !== 'string' ||
    !/^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(input.start_time)
  )
    throw new Error('INVALID_MATCH_INPUT');
  const event_type = input.event_type;
  const visibility = input.visibility;
  const team_assignment_mode = input.team_assignment_mode;
  if (event_type !== 'friendly' && event_type !== 'competitive')
    throw new Error('INVALID_MATCH_INPUT');
  if (visibility !== 'community_open' && visibility !== 'invite_only')
    throw new Error('INVALID_MATCH_INPUT');
  if (team_assignment_mode !== 'PREDEFINED_TEAMS' && team_assignment_mode !== 'POST_MATCH_TEAMS')
    throw new Error('INVALID_MATCH_INPUT');
  const venue_name = input.venue_name;
  const maps_url = input.maps_url;
  const photo_path = input.photo_path;
  if (
    typeof venue_name !== 'string' ||
    typeof maps_url !== 'string' ||
    typeof photo_path !== 'string'
  )
    throw new Error('INVALID_MATCH_INPUT');
  if (input.court_booked !== undefined && typeof input.court_booked !== 'boolean')
    throw new Error('INVALID_MATCH_INPUT');
  if (input.restriction_enabled !== undefined && typeof input.restriction_enabled !== 'boolean')
    throw new Error('INVALID_MATCH_INPUT');
  const price = optionalString(input, 'price', true);
  if (
    typeof price === 'string' &&
    (!/^\d+(\.\d{1,2})?$/.test(price) ||
      !Number.isFinite(Number(price)) ||
      Number(price) * 100 > Number.MAX_SAFE_INTEGER)
  )
    throw new Error('INVALID_MATCH_INPUT');
  const currency = input.currency;
  if (currency !== undefined && currency !== 'BRL' && currency !== 'EUR' && currency !== 'USD')
    throw new Error('INVALID_MATCH_INPUT');
  const optionalLevel = (key: 'min_level' | 'max_level'): number | null | undefined => {
    const level = input[key];
    if (level === undefined || level === null) return level;
    if (typeof level !== 'number' || !Number.isFinite(level))
      throw new Error('INVALID_MATCH_INPUT');
    return level;
  };
  const min_level = optionalLevel('min_level');
  const max_level = optionalLevel('max_level');
  const savedVenue = optionalString(input, 'saved_venue_id', true);
  if (typeof savedVenue === 'string' && savedVenue !== '') validateMatchUuid(savedVenue);
  const court_notes = optionalString(input, 'court_notes', true);
  const notes = optionalString(input, 'notes', true);
  const payment_note = optionalString(input, 'payment_note', true);
  const cutoff_at = optionalString(input, 'cutoff_at', true);
  if (typeof cutoff_at === 'string' && !Number.isFinite(Date.parse(cutoff_at)))
    throw new Error('INVALID_MATCH_INPUT');
  const duration_minutes = optionalNumber(input, 'duration_minutes', true);
  const maximum_registrations = optionalNumber(input, 'maximum_registrations', true);
  if (duration_minutes !== undefined && duration_minutes !== null && duration_minutes < 1)
    throw new Error('INVALID_MATCH_INPUT');
  if (
    maximum_registrations !== undefined &&
    maximum_registrations !== null &&
    maximum_registrations < 1
  )
    throw new Error('INVALID_MATCH_INPUT');
  const inputResult: MatchPublishInput = {
    community_id,
    date: input.date,
    start_time: input.start_time,
    event_type,
    visibility,
    team_assignment_mode,
    venue_name,
    maps_url,
    photo_path,
    ...(savedVenue !== undefined ? { saved_venue_id: savedVenue } : {}),
    ...(court_notes !== undefined ? { court_notes } : {}),
    ...(duration_minutes !== undefined ? { duration_minutes } : {}),
    ...(notes !== undefined ? { notes } : {}),
    ...(input.court_booked !== undefined ? { court_booked: input.court_booked } : {}),
    ...(input.restriction_enabled !== undefined
      ? { restriction_enabled: input.restriction_enabled }
      : {}),
    ...(min_level !== undefined ? { min_level } : {}),
    ...(max_level !== undefined ? { max_level } : {}),
    ...(price !== undefined ? { price } : {}),
    ...(currency !== undefined ? { currency } : {}),
    ...(payment_note !== undefined ? { payment_note } : {}),
    ...(maximum_registrations !== undefined ? { maximum_registrations } : {}),
    ...(cutoff_at !== undefined ? { cutoff_at } : {})
  };
  return {
    event_id: validateMatchUuid(data.event_id),
    input: inputResult,
    invitee_ids: [...new Set(data.invitee_ids.map(validateMatchUuid))]
  };
}
import type { MatchPublishInput } from './match-contracts';
