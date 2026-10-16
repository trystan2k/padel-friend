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
function isTimestamp(value: unknown): value is string {
  if (typeof value !== 'string' || value.length > 32) return false;
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/.exec(
      value
    );
  if (!match) return false;

  const yearText = match[1];
  const monthText = match[2];
  const dayText = match[3];
  const hourText = match[4];
  const minuteText = match[5];
  const secondText = match[6];
  const offset = match[8];
  if (!yearText || !monthText || !dayText || !hourText || !minuteText || !secondText || !offset)
    return false;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  const second = Number(secondText);
  if (year === 0 || month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59)
    return false;
  const leapYear = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const daysInMonth = [31, leapYear ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
  if (daysInMonth === undefined || day < 1 || day > daysInMonth) return false;
  if (offset !== 'Z') {
    const offsetHour = Number(offset.slice(1, 3));
    const offsetMinute = Number(offset.slice(4, 6));
    if (offsetHour > 23 || offsetMinute > 59) return false;
  }
  return true;
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
    if (!isTimestamp(raw.createdAt)) throw new Error('INVALID_COMMUNITY_INPUT');
    cursor = { createdAt: raw.createdAt, id: uuid(raw.id) };
  }
  return { category, limit, cursor };
}
export function validateNotificationId(value: unknown) {
  return { notificationId: uuid(object(value, ['notificationId']).notificationId) };
}
export function validateMarkAllNotificationsRead(value: unknown) {
  const raw = object(value, ['before']).before;
  if (!isTimestamp(raw)) throw new Error('INVALID_COMMUNITY_INPUT');
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
