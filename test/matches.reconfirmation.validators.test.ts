import { describe, expect, it } from 'vitest';
import { validateReconfirmMatchRegistration } from '../src/features/matches/match-reconfirmation.validators';
import { validateEditMatchEvent } from '../src/features/matches/match-management.validators';
const id = '11111111-1111-4111-8111-111111111111';
const data = { event_id: id, attempt_id: id, generation: 1, request_id: id };
describe('reconfirmation validators', () => {
  it('exact attempt generation request contracts', () => {
    expect(validateReconfirmMatchRegistration(data)).toEqual(data);
    for (const value of [
      null,
      [],
      { ...data, actor_id: id },
      { ...data, attempt_id: 'invalid' },
      { ...data, request_id: undefined },
      ...[0, -1, 1.5, '1', NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].map((generation) => ({
        ...data,
        generation
      }))
    ])
      expect(() => validateReconfirmMatchRegistration(value)).toThrow('INVALID_MATCH_INPUT');
  });
  it('accepts type/time changes and canonicalizes equivalent offset instants', () => {
    expect(
      validateEditMatchEvent({
        event_id: id,
        expected_version: 1,
        request_id: id,
        patch: { event_type: 'competitive', starts_at: '2099-01-01T12:00:01+02:00' }
      }).patch
    ).toEqual({ event_type: 'competitive', starts_at: '2099-01-01T10:00:01.000Z' });
  });
});
