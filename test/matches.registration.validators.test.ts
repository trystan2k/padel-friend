import { describe, expect, it } from 'vitest';
import {
  MATCH_REGISTRATION_DECISIONS,
  validateDecideMatchRegistration,
  validateListMatchRegistrationRequests,
  validateMyMatchRegistration,
  validateSubmitMatchRegistration
} from '../src/features/matches/match-registration.validators';

const eventId = '123e4567-e89b-12d3-a456-426614174000';
const userId = 'a3bb189e-8bf9-4888-9912-ace4e6543002';
const attemptId = 'b7c2f9de-1111-4222-8333-444455556666';
const now = '2026-10-17T12:00:00.000Z';

describe('match registration validators', () => {
  it('accepts exactly the narrow server-derived inputs', () => {
    expect(validateSubmitMatchRegistration({ event_id: eventId })).toEqual({ event_id: eventId });
    expect(validateMyMatchRegistration({ event_id: eventId })).toEqual({ event_id: eventId });
    expect(validateListMatchRegistrationRequests({ event_id: eventId })).toEqual({
      event_id: eventId
    });
    expect(
      validateDecideMatchRegistration({
        event_id: eventId,
        attempt_id: attemptId,
        decision: 'approve'
      })
    ).toEqual({ event_id: eventId, attempt_id: attemptId, decision: 'approve' });
    expect(
      validateDecideMatchRegistration({
        event_id: eventId,
        attempt_id: attemptId,
        decision: 'reject'
      })
    ).toEqual({ event_id: eventId, attempt_id: attemptId, decision: 'reject' });
    expect(MATCH_REGISTRATION_DECISIONS).toEqual(['approve', 'reject']);
  });

  it('accepts uppercase UUIDs because the client forwards them for the server cast', () => {
    expect(validateSubmitMatchRegistration({ event_id: eventId.toUpperCase() })).toEqual({
      event_id: eventId.toUpperCase()
    });
  });

  it('rejects non-object payloads for every registration input', () => {
    for (const input of [null, undefined, 42, 'x', true, [], [{ event_id: eventId }]]) {
      expect(() => validateSubmitMatchRegistration(input)).toThrow('INVALID_MATCH_INPUT');
      expect(() => validateMyMatchRegistration(input)).toThrow('INVALID_MATCH_INPUT');
      expect(() => validateListMatchRegistrationRequests(input)).toThrow('INVALID_MATCH_INPUT');
      expect(() => validateDecideMatchRegistration(input)).toThrow('INVALID_MATCH_INPUT');
    }
  });

  it('rejects malformed and missing UUIDs', () => {
    const badIds = [
      '',
      'not-a-uuid',
      '123',
      'https://evil.example',
      '123e4567-e89b-12d3-a456-42661417400g',
      '123e4567-e89b-12d3-a456-42661417400',
      `${eventId} `,
      123,
      null,
      undefined
    ];
    for (const event_id of badIds) {
      expect(() => validateSubmitMatchRegistration({ event_id })).toThrow('INVALID_MATCH_INPUT');
      expect(() => validateMyMatchRegistration({ event_id })).toThrow('INVALID_MATCH_INPUT');
      expect(() => validateListMatchRegistrationRequests({ event_id })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() =>
        validateDecideMatchRegistration({ event_id, attempt_id: attemptId, decision: 'approve' })
      ).toThrow('INVALID_MATCH_INPUT');
      expect(() =>
        validateDecideMatchRegistration({
          event_id: eventId,
          attempt_id: event_id,
          decision: 'reject'
        })
      ).toThrow('INVALID_MATCH_INPUT');
    }
    expect(() => validateSubmitMatchRegistration({})).toThrow('INVALID_MATCH_INPUT');
    expect(() =>
      validateDecideMatchRegistration({ event_id: eventId, decision: 'approve' })
    ).toThrow('INVALID_MATCH_INPUT');
    expect(() =>
      validateDecideMatchRegistration({ event_id: eventId, attempt_id: attemptId })
    ).toThrow('INVALID_MATCH_INPUT');
  });

  it('rejects unknown keys so a client cannot inject server-derived fields', () => {
    // Nothing the server derives may be accepted from the wire: actor identity,
    // anchors, ordinal, source, guest flag, level range and capacity included.
    const smuggled: Record<string, unknown> = {
      actor: userId,
      actor_id: userId,
      user_id: userId,
      accepted_at: now,
      approved_at: now,
      accepted_order: 3,
      participation: 'playing',
      lifecycle: 'accepted',
      registration_source: 'creator',
      is_guest: false,
      guest: true,
      level: 4.5,
      display_level: 4.5,
      min_level: 1,
      max_level: 7,
      maximum_registrations: 99,
      requested_at: now,
      resolved_at: now,
      resolved_by: userId,
      decision: 'approve',
      replayed: true
    };
    for (const [key, value] of Object.entries(smuggled)) {
      expect(() => validateSubmitMatchRegistration({ event_id: eventId, [key]: value })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() => validateMyMatchRegistration({ event_id: eventId, [key]: value })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() =>
        validateListMatchRegistrationRequests({ event_id: eventId, [key]: value })
      ).toThrow('INVALID_MATCH_INPUT');
    }
    // The decision payload allows only event_id/attempt_id/decision; the same
    // server-derived fields stay rejected on top of the valid trio.
    for (const [key, value] of Object.entries(smuggled)) {
      if (key === 'attempt_id' || key === 'decision') continue;
      expect(() =>
        validateDecideMatchRegistration({
          event_id: eventId,
          attempt_id: attemptId,
          decision: 'approve',
          [key]: value
        })
      ).toThrow('INVALID_MATCH_INPUT');
    }
  });

  it('bounds the decision enum to approve and reject', () => {
    for (const decision of [
      'APPROVE',
      'Reject',
      'accept',
      'maybe',
      '',
      'approve ',
      null,
      undefined,
      0,
      1,
      true,
      {}
    ]) {
      expect(() =>
        validateDecideMatchRegistration({ event_id: eventId, attempt_id: attemptId, decision })
      ).toThrow('INVALID_MATCH_INPUT');
    }
  });
});
