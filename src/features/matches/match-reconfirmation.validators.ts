import { validateMatchUuid } from './matches.validators';

export function validateReconfirmMatchRegistration(value: unknown) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_MATCH_INPUT');
  const data: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  if (
    Object.keys(data).some(
      (key) => !['event_id', 'attempt_id', 'generation', 'request_id'].includes(key)
    ) ||
    typeof data.generation !== 'number' ||
    !Number.isSafeInteger(data.generation) ||
    data.generation < 1
  )
    throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    attempt_id: validateMatchUuid(data.attempt_id),
    generation: data.generation,
    request_id: validateMatchUuid(data.request_id)
  };
}
