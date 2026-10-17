import { validateMatchUuid } from './matches.validators';

// Registration inputs are intentionally narrow: the client may only ever name an
// event (and, for a decision, the target request). Actor, accepted time/order,
// registration source, guest flag, player level and maximum capacity are always
// server-derived. `exact()` additionally rejects unknown keys, so a crafted
// payload cannot smuggle those fields through.
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

export type MatchRegistrationDecision = 'approve' | 'reject';
export const MATCH_REGISTRATION_DECISIONS: readonly MatchRegistrationDecision[] = [
  'approve',
  'reject'
];

function eventEventId(value: unknown) {
  const data = exact(value, ['event_id']);
  return { event_id: validateMatchUuid(data.event_id) };
}

export function validateSubmitMatchRegistration(value: unknown) {
  return eventEventId(value);
}

export function validateMyMatchRegistration(value: unknown) {
  return eventEventId(value);
}

export function validateListMatchRegistrationRequests(value: unknown) {
  return eventEventId(value);
}

export function validateDecideMatchRegistration(value: unknown) {
  const data = exact(value, ['event_id', 'user_id', 'decision']);
  const decision = data.decision;
  if (decision !== 'approve' && decision !== 'reject') throw new Error('INVALID_MATCH_INPUT');
  return {
    event_id: validateMatchUuid(data.event_id),
    user_id: validateMatchUuid(data.user_id),
    decision: decision satisfies MatchRegistrationDecision
  };
}
