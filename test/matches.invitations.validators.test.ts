import { describe, expect, it } from 'vitest';
import {
  validateGetMyMatchInvitation,
  validateRespondMatchEventInvitation
} from '../src/features/matches/match-invitation.validators';
const id = '11111111-1111-4111-8111-111111111111';
describe('invitation validators', () => {
  it('rejects unknown keys and forged actors', () => {
    for (const key of [
      'actor_id',
      'user_id',
      'status',
      'accepted_order',
      'maximum_registrations'
    ]) {
      expect(() => validateGetMyMatchInvitation({ event_id: id, [key]: id })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() =>
        validateRespondMatchEventInvitation({
          event_id: id,
          invitation_id: id,
          response: 'accept',
          [key]: id
        })
      ).toThrow('INVALID_MATCH_INPUT');
    }
  });
  it('validates exact UUID and response contracts', () => {
    expect(validateGetMyMatchInvitation({ event_id: id })).toEqual({ event_id: id });
    for (const response of ['accept', 'decline'])
      expect(
        validateRespondMatchEventInvitation({ event_id: id, invitation_id: id, response })
      ).toEqual({ event_id: id, invitation_id: id, response });
    for (const value of [
      null,
      [],
      {},
      { event_id: 'bad' },
      { event_id: id, invitation_id: id, response: 'cancel' }
    ])
      expect(() => validateRespondMatchEventInvitation(value)).toThrow('INVALID_MATCH_INPUT');
  });
});
