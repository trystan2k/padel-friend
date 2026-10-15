const categories = ['all', 'community', 'matches', 'results', 'rankings', 'leagues'] as const;
function isCategory(value: unknown): value is (typeof categories)[number] {
  return categories.some((category) => category === value);
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function object(value: unknown, keys: string[]): Record<string, unknown> {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key))
  )
    throw new Error('INVALID_COMMUNITY_INPUT');
  return Object.fromEntries(Object.entries(value));
}
function uuid(value: unknown): string {
  if (typeof value !== 'string' || !uuidPattern.test(value))
    throw new Error('INVALID_COMMUNITY_INPUT');
  return value;
}
export function validateListMyNotifications(value: unknown) {
  const input = object(value, ['category', 'cursor', 'limit']);
  const category = input.category ?? 'all';
  const limit = input.limit ?? 20;
  if (
    !isCategory(category) ||
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error('INVALID_COMMUNITY_INPUT');
  let cursor: { createdAt: string; id: string } | undefined;
  if (input.cursor !== undefined) {
    const raw = object(input.cursor, ['createdAt', 'id']);
    if (
      typeof raw.createdAt !== 'string' ||
      !Number.isFinite(Date.parse(raw.createdAt)) ||
      new Date(raw.createdAt).toISOString() !== raw.createdAt
    )
      throw new Error('INVALID_COMMUNITY_INPUT');
    cursor = { createdAt: raw.createdAt, id: uuid(raw.id) };
  }
  return { category, limit, cursor };
}
export function validateNotificationId(value: unknown) {
  return { notificationId: uuid(object(value, ['notificationId']).notificationId) };
}
export function validateMarkAllNotificationsRead(value: unknown) {
  const raw = object(value, ['before']).before;
  if (
    typeof raw !== 'string' ||
    !Number.isFinite(Date.parse(raw)) ||
    new Date(raw).toISOString() !== raw
  )
    throw new Error('INVALID_COMMUNITY_INPUT');
  return { before: raw };
}
export function validateNotificationPreferences(value: unknown) {
  const keys = [
    'push_enabled',
    'push_community',
    'push_matches',
    'push_results',
    'push_rankings',
    'push_leagues'
  ];
  const input = object(value, keys);
  if (keys.some((key) => typeof input[key] !== 'boolean'))
    throw new Error('INVALID_COMMUNITY_INPUT');
  const booleanValue = (key: string): boolean => {
    const setting = input[key];
    if (typeof setting !== 'boolean') throw new Error('INVALID_COMMUNITY_INPUT');
    return setting;
  };
  return {
    push_enabled: booleanValue('push_enabled'),
    push_community: booleanValue('push_community'),
    push_matches: booleanValue('push_matches'),
    push_results: booleanValue('push_results'),
    push_rankings: booleanValue('push_rankings'),
    push_leagues: booleanValue('push_leagues')
  };
}
