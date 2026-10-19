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
export function validatePublishMatch(value: unknown) {
  const data = exact(value, ['event_id', 'input', 'invitee_ids']);
  const input = record(data.input);
  if (
    Object.keys(input).length > 40 ||
    !Array.isArray(data.invitee_ids) ||
    data.invitee_ids.length > 100
  )
    throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    input,
    invitee_ids: [...new Set(data.invitee_ids.map(validateMatchUuid))]
  };
}
