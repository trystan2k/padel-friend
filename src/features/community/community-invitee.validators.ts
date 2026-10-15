export function validateInviteeSearch(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_INVITEE_SEARCH');
  const input = value as { community_id?: unknown; query?: unknown };
  if (Object.keys(input).some((key) => !['community_id', 'query'].includes(key)))
    throw new Error('INVALID_INVITEE_SEARCH');
  if (
    typeof input.community_id !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input.community_id)
  )
    throw new Error('INVALID_INVITEE_SEARCH');
  if (
    typeof input.query !== 'string' ||
    input.query.trim().length < 3 ||
    input.query.trim().length > 80
  )
    throw new Error('INVALID_INVITEE_SEARCH');
  return { community_id: input.community_id, query: input.query.trim() };
}

export function validateDiscoverability(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('INVALID_DISCOVERABILITY');
  const enabled: unknown = Reflect.get(value, 'enabled');
  if (Object.keys(value).length !== 1 || typeof enabled !== 'boolean')
    throw new Error('INVALID_DISCOVERABILITY');
  return { enabled };
}
