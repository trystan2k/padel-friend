import { validateMatchUuid } from './matches.validators';

function exact(value: unknown, keys: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_MATCH_INPUT');
  const data = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error('INVALID_MATCH_INPUT');
  return data;
}

export function validateListMatchEventManagementParticipants(value: unknown) {
  const data = exact(value, ['event_id']);
  return { event_id: validateMatchUuid(data.event_id) };
}

export function validateWithdrawMatchRegistration(value: unknown) {
  const data = exact(value, ['event_id', 'attempt_id', 'request_id']);
  return {
    event_id: validateMatchUuid(data.event_id),
    attempt_id: validateMatchUuid(data.attempt_id),
    request_id: validateMatchUuid(data.request_id)
  };
}

export function validateRemoveMatchRegistration(value: unknown) {
  const data = exact(value, ['event_id', 'target_user_id', 'attempt_id', 'reason', 'request_id']);
  if (
    typeof data.reason !== 'string' ||
    data.reason
      .split('')
      .some(
        (char) =>
          char.charCodeAt(0) < 32 || (char.charCodeAt(0) >= 127 && char.charCodeAt(0) <= 159)
      )
  )
    throw new Error('INVALID_MATCH_INPUT');
  const reason = data.reason.trim();
  if (reason.length < 1 || reason.length > 500) throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    target_user_id: validateMatchUuid(data.target_user_id),
    attempt_id: validateMatchUuid(data.attempt_id),
    reason,
    request_id: validateMatchUuid(data.request_id)
  };
}

export function validateListMatchEventAudit(value: unknown) {
  const data = exact(value, ['event_id', 'before_at', 'before_id', 'limit']);
  const before_at = data.before_at ?? null;
  const before_id = data.before_id ?? null;
  const limit = data.limit ?? 20;
  if (
    (before_at === null) !== (before_id === null) ||
    (before_at !== null &&
      (typeof before_at !== 'string' || !Number.isFinite(Date.parse(before_at)))) ||
    typeof limit !== 'number' ||
    !Number.isSafeInteger(limit) ||
    limit < 1 ||
    limit > 50
  )
    throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    before_at: before_at === null ? null : new Date(String(before_at)).toISOString(),
    before_id: before_id === null ? null : validateMatchUuid(before_id),
    limit
  };
}
