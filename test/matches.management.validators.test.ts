import { describe, expect, it } from 'vitest';
import {
  validateWithdrawMatchRegistration,
  validateRemoveMatchRegistration,
  validateListMatchEventManagementParticipants,
  validateListMatchEventAudit,
  validateTransferMatchEventOwnership,
  validateCancelMatchEvent
} from '../src/features/matches/match-management.validators';
const id = '11111111-1111-4111-8111-111111111111';
const command = { event_id: id, attempt_id: id, request_id: id };
const removal = { ...command, target_user_id: id, reason: '  Schedule changed  ' };
describe('management exact-key validators', () => {
  it('rejects unsafe versions, forged ownership and invalid cancellation reasons', () => {
    const transfer = { event_id: id, target_user_id: id, expected_version: 1, request_id: id };
    const cancel = { event_id: id, reason: ' Weather ', expected_version: 1, request_id: id };
    expect(validateTransferMatchEventOwnership(transfer)).toEqual(transfer);
    expect(validateCancelMatchEvent(cancel).reason).toBe('Weather');
    for (const expected_version of [0, -1, 1.2, Number.MAX_SAFE_INTEGER + 1, '1', undefined]) {
      expect(() => validateTransferMatchEventOwnership({ ...transfer, expected_version })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() => validateCancelMatchEvent({ ...cancel, expected_version })).toThrow(
        'INVALID_MATCH_INPUT'
      );
    }
    for (const reason of ['', ' ', 'x'.repeat(501), 'line\nbreak', '\u0080'])
      expect(() => validateCancelMatchEvent({ ...cancel, reason })).toThrow('INVALID_MATCH_INPUT');
    expect(() => validateTransferMatchEventOwnership({ ...transfer, published_by: id })).toThrow(
      'INVALID_MATCH_INPUT'
    );
    expect(() => validateCancelMatchEvent({ ...cancel, status: 'cancelled' })).toThrow(
      'INVALID_MATCH_INPUT'
    );
  });
  it('validates IDs and canonicalizes reasons', () => {
    expect(validateWithdrawMatchRegistration(command)).toEqual(command);
    expect(validateRemoveMatchRegistration(removal).reason).toBe('Schedule changed');
    expect(validateListMatchEventManagementParticipants({ event_id: id })).toEqual({
      event_id: id
    });
  });
  it('rejects actor, owner, ordinal and unknown-key injection', () => {
    for (const key of ['actor_id', 'owner_id', 'accepted_order', 'status', 'version', 'unknown']) {
      expect(() => validateWithdrawMatchRegistration({ ...command, [key]: id })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() => validateRemoveMatchRegistration({ ...removal, [key]: id })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() =>
        validateListMatchEventManagementParticipants({ event_id: id, [key]: id })
      ).toThrow('INVALID_MATCH_INPUT');
    }
  });
  it('rejects missing IDs, invalid reasons, arrays and undefined required values', () => {
    for (const reason of [
      '',
      ' ',
      'x'.repeat(501),
      'line\nbreak',
      '\u0000',
      '\u0080',
      undefined,
      3
    ])
      expect(() => validateRemoveMatchRegistration({ ...removal, reason })).toThrow(
        'INVALID_MATCH_INPUT'
      );
    for (const key of ['event_id', 'attempt_id', 'request_id']) {
      expect(() => validateWithdrawMatchRegistration({ ...command, [key]: 'invalid' })).toThrow(
        'INVALID_MATCH_INPUT'
      );
      expect(() => validateWithdrawMatchRegistration({ ...command, [key]: undefined })).toThrow(
        'INVALID_MATCH_INPUT'
      );
    }
    expect(() => validateWithdrawMatchRegistration([])).toThrow('INVALID_MATCH_INPUT');
  });
  it('requires paired audit cursor and bounded limit', () => {
    expect(validateListMatchEventAudit({ event_id: id })).toMatchObject({
      before_at: null,
      before_id: null,
      limit: 20
    });
    expect(
      validateListMatchEventAudit({
        event_id: id,
        before_at: '2030-01-01T00:00:00Z',
        before_id: id,
        limit: 50
      })
    ).toMatchObject({ limit: 50 });
    for (const input of [
      { before_at: '2030-01-01' },
      { before_id: id },
      { before_at: 'bad', before_id: id },
      { limit: 51 },
      { limit: 0 },
      { limit: 1.2 },
      { actor_id: id }
    ])
      expect(() => validateListMatchEventAudit({ event_id: id, ...input })).toThrow(
        'INVALID_MATCH_INPUT'
      );
  });
});
