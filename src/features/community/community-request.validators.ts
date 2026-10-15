import { hasEdgeWhitespace } from '../../lib/edge-whitespace';

function record(value: unknown, keys: string[]): Record<string, unknown> {
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
  if (
    typeof value !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
  )
    throw new Error('INVALID_COMMUNITY_INPUT');
  return value;
}
export function validateSendCommunityRequestMessage(value: unknown) {
  const input = record(value, ['community_id', 'membership_id', 'body', 'client_request_id']);
  if (
    typeof input.body !== 'string' ||
    input.body.includes('\u0000') ||
    Array.from(input.body).length > 1000 ||
    !input.body.trim() ||
    hasEdgeWhitespace(input.body.trim())
  )
    throw new Error('INVALID_COMMUNITY_INPUT');
  return {
    community_id: uuid(input.community_id),
    membership_id: uuid(input.membership_id),
    body: input.body.trim(),
    client_request_id: uuid(input.client_request_id)
  };
}
export function validateNotificationPage(value: unknown) {
  const input = record(value, ['offset', 'limit']);
  const offset = input.offset ?? 0;
  const limit = input.limit ?? 20;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0 ||
    offset > 10000 ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error('INVALID_COMMUNITY_INPUT');
  return { offset, limit };
}
export function validateNotificationId(value: unknown) {
  return { notification_id: uuid(record(value, ['notification_id']).notification_id) };
}
