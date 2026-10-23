import { validateMatchUuid } from './matches.validators';

function exact(value: unknown, keys: readonly string[]) {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    throw new Error('INVALID_MATCH_INPUT');
  const data = Object.fromEntries(Object.entries(value));
  if (Object.keys(data).some((key) => !keys.includes(key))) throw new Error('INVALID_MATCH_INPUT');
  return data;
}

export function validateGetMyMatchInvitation(value: unknown) {
  const data = exact(value, ['event_id']);
  return { event_id: validateMatchUuid(data.event_id) };
}

export function validateRespondMatchEventInvitation(value: unknown) {
  const data = exact(value, ['event_id', 'invitation_id', 'response']);
  if (data.response !== 'accept' && data.response !== 'decline')
    throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    invitation_id: validateMatchUuid(data.invitation_id),
    response: data.response
  };
}
