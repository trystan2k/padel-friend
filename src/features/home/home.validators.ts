const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Route search: a malformed community id is dropped, so it can never reach a reader. Other
 * keys (for example a preserved deep-link query) pass through untouched.
 */
export function parseHomeSearch(
  search: Record<string, unknown>
): { community?: string } & Record<string, unknown> {
  const { community, ...rest } = search;
  return typeof community === 'string' && uuid.test(community)
    ? { ...rest, community: community.toLowerCase() }
    : rest;
}

export function validateHomeInput(value: unknown): { community_id: string | null } {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_HOME_INPUT');
  const data = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => key !== 'community_id'))
    throw new Error('INVALID_HOME_INPUT');
  const id = data.community_id;
  if (id == null) return { community_id: null };
  if (typeof id !== 'string' || !uuid.test(id)) throw new Error('INVALID_HOME_INPUT');
  return { community_id: id.toLowerCase() };
}
