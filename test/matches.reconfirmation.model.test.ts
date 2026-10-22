import { describe, expect, it } from 'vitest';
import { parseMyMatchRegistration } from '../src/features/matches/match-registration-model';
import {
  parseManagementParticipants,
  parseMatchEditSuccess
} from '../src/features/matches/match-management-model';
import {
  parseReconfirmationSuccess,
  requiresMatchReconfirmation
} from '../src/features/matches/match-reconfirmation-model';
import { matchEventCounts } from '../src/features/matches/match-model';
const id = '11111111-1111-4111-8111-111111111111';
const row = {
  event_id: id,
  attempt_id: id,
  registration_source: 'creator',
  lifecycle: 'accepted',
  participation: null,
  accepted_order: 1,
  accepted_at: '2099-01-01T00:00:00Z',
  required_generation: 2,
  confirmed_generation: 1,
  registration_cutoff_at: '2099-01-02T00:00:00Z'
};
describe('reconfirmation models', () => {
  it('counts separate capacity from consent eligible players', () => {
    expect(matchEventCounts({ accepted_count: 5, reconfirmation_required_count: 2 })).toMatchObject(
      { accepted: 5, playing: 0, reserve: 3, groups: 0, moreNeeded: 1 }
    );
    expect(requiresMatchReconfirmation(row)).toBe(true);
    expect(requiresMatchReconfirmation({ ...row, confirmed_generation: 2 })).toBe(false);
  });
  it('parses required and historical expired states', () => {
    expect(parseMyMatchRegistration(row)).toMatchObject({
      state: 'reconfirmation_required',
      required_generation: 2,
      attempt_id: id
    });
    expect(parseMyMatchRegistration({ ...row, confirmed_generation: 3 })).toBeNull();
    expect(parseMyMatchRegistration({ ...row, participation: 'playing' })).toBeNull();
    expect(
      parseMyMatchRegistration({
        ...row,
        lifecycle: 'expired',
        resolved_at: '2099-01-02T00:00:00Z'
      })
    ).toMatchObject({ state: 'expired' });
    expect(
      parseManagementParticipants([
        { ...row, registration_id: id, user_id: id, display_name: null, display_level: null }
      ])
    ).toMatchObject([{ participation: null, required_generation: 2 }]);
  });
  it('decodes major-edit and reconfirmation envelopes without private fields', () => {
    const envelope = {
      event_id: id,
      request_id: id,
      version: 2,
      transition_revision: 3,
      changed: true,
      replayed: false
    };
    expect(
      parseReconfirmationSuccess({
        ...envelope,
        confirmed_generation: 2,
        participation: 'reserve',
        private: 'hidden'
      })
    ).toMatchObject({ status: 'ok', value: { confirmed_generation: 2 } });
    expect(
      parseReconfirmationSuccess({ ...envelope, confirmed_generation: 2, participation: null })
    ).toBeNull();
    expect(
      parseMatchEditSuccess({
        ...envelope,
        change_kind: 'major',
        changed_fields: ['starts_at'],
        reconfirmation_generation: 2
      })
    ).toMatchObject({ status: 'ok', value: { change_kind: 'major' } });
  });
});
