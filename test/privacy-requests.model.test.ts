import { describe, expect, it } from 'vitest';
import {
  PRIVACY_CASE_STATES,
  canTransition,
  canWithdraw,
  nextPhase,
  parseMyDeletionRequest,
  parsePrivacyReceipt,
  privacyRequestError,
  purgeAfter,
  validatePrivacyCommand,
  type PrivacyCaseState
} from '../src/features/privacy-requests/privacy-request-model';

const COMMAND = '11111111-2222-4333-8444-555555555555';
const receipt = {
  command_id: COMMAND,
  reference: 'PR-0123456789AB',
  state: 'received',
  received_at: '2026-11-27T10:00:00Z',
  replayed: false,
  can_withdraw: true
};

describe('privacy case state graph', () => {
  const valid: Array<[PrivacyCaseState, PrivacyCaseState]> = [
    ['received', 'verified'],
    ['verified', 'ready'],
    ['verified', 'received'],
    ['ready', 'executing'],
    ['executing', 'blocked'],
    ['app_data_erased', 'blocked'],
    ['supabase_erased', 'closed'],
    ['blocked', 'executing'],
    ['supabase_erased', 'blocked'],
    ['blocked', 'supabase_erased'],
    ['blocked', 'app_data_erased'],
    ['blocked', 'ready']
  ];
  it.each(valid)('allows %s -> %s', (from, to) => {
    expect(canTransition(from, to)).toBe(true);
  });

  it('rejects every edge outside the graph and every exit from a terminal state', () => {
    expect(canTransition('received', 'executing')).toBe(false);
    expect(canTransition('verified', 'executing')).toBe(false);
    expect(canTransition('executing', 'closed')).toBe(false);
    expect(canTransition('app_data_erased', 'closed')).toBe(false);
    expect(canTransition('supabase_erased', 'executing')).toBe(false);
    for (const terminal of ['closed', 'withdrawn'] as const)
      for (const to of PRIVACY_CASE_STATES)
        expect({ terminal, to, allowed: canTransition(terminal, to) }).toEqual({
          terminal,
          to,
          allowed: false
        });
  });

  it('only completes a phase transition after the matching phase is committed', () => {
    expect(canTransition('executing', 'app_data_erased', { lastPhase: 'freeze' })).toBe(false);
    expect(canTransition('executing', 'app_data_erased', { lastPhase: 'relational' })).toBe(true);
    expect(canTransition('app_data_erased', 'supabase_erased', { lastPhase: 'storage' })).toBe(
      false
    );
    expect(canTransition('app_data_erased', 'supabase_erased', { lastPhase: 'auth' })).toBe(true);
  });

  it('keeps a case irreversible once the arm is consumed', () => {
    expect(canTransition('blocked', 'received', { armConsumed: false })).toBe(true);
    expect(canTransition('blocked', 'received', { armConsumed: true })).toBe(false);
    expect(canTransition('blocked', 'withdrawn', { armConsumed: false })).toBe(true);
    expect(canTransition('blocked', 'withdrawn', { armConsumed: true })).toBe(false);
    expect(canTransition('blocked', 'closed', { armConsumed: true })).toBe(false);
    expect(canWithdraw('ready', false)).toBe(true);
    expect(canWithdraw('executing', true)).toBe(false);
    expect(canWithdraw('app_data_erased', true)).toBe(false);
    expect(canWithdraw('blocked', true)).toBe(false);
  });

  it('closes withdrawal, restart and refusal once the destructive phase started (F15)', () => {
    const started = { destructiveStarted: true, armConsumed: true };
    for (const from of ['ready', 'blocked'] as const) {
      expect(canTransition(from, 'withdrawn', started)).toBe(false);
      expect(canTransition(from, 'received', started)).toBe(false);
      expect(canTransition(from, 'closed', started)).toBe(false);
    }
    expect(canTransition('ready', 'verified', started)).toBe(false);
    // Only the resume paths remain, and the finish.
    expect(canTransition('blocked', 'executing', started)).toBe(true);
    expect(canTransition('blocked', 'supabase_erased', started)).toBe(true);
    expect(canTransition('blocked', 'ready', started)).toBe(true);
    expect(canTransition('supabase_erased', 'closed', started)).toBe(true);
    expect(canWithdraw('ready', false, true)).toBe(false);
    expect(canWithdraw('blocked', false, true)).toBe(false);
  });

  it('runs one phase at a time and never repeats a committed one', () => {
    expect(nextPhase('executing', null)).toBe('freeze');
    expect(nextPhase('executing', 'freeze')).toBe('relational');
    expect(nextPhase('app_data_erased', 'relational')).toBe('storage');
    expect(nextPhase('app_data_erased', 'storage')).toBe('auth');
    expect(nextPhase('supabase_erased', 'auth')).toBe('finish');
    expect(nextPhase('executing', 'relational')).toBeNull();
    expect(nextPhase('ready', null)).toBeNull();
    expect(nextPhase('blocked', 'freeze')).toBeNull();
    expect(nextPhase('closed', 'auth')).toBeNull();
  });
});

describe('privacy request receipts and errors', () => {
  it('accepts exactly the allowlisted receipt shape', () => {
    expect(parsePrivacyReceipt(receipt)).toEqual(receipt);
    expect(parsePrivacyReceipt({ ...receipt, subject_id: COMMAND })).toBeNull();
    const { can_withdraw: _canWithdraw, ...partial } = receipt;
    expect(parsePrivacyReceipt(partial)).toBeNull();
    expect(parsePrivacyReceipt({ ...receipt, state: 'archived' })).toBeNull();
    expect(parsePrivacyReceipt({ ...receipt, reference: 'PR-1' })).toBeNull();
    expect(parsePrivacyReceipt({ ...receipt, received_at: 'yesterday' })).toBeNull();
    expect(parsePrivacyReceipt(null)).toBeNull();
  });

  it('parses the status response: none, a case, or untrusted', () => {
    expect(parseMyDeletionRequest(null)).toBeNull();
    const status = {
      reference: 'PR-0123456789AB',
      state: 'blocked',
      received_at: receipt.received_at,
      blocked: true,
      can_withdraw: false
    };
    expect(parseMyDeletionRequest(status)).toEqual(status);
    expect(parseMyDeletionRequest({ ...status, blocker_code: 'PLAN_MISMATCH' })).toBeUndefined();
    expect(parseMyDeletionRequest('x')).toBeUndefined();
  });

  it('validates the command id and nothing else', () => {
    expect(validatePrivacyCommand({ command_id: COMMAND })).toEqual({ command_id: COMMAND });
    expect(() => validatePrivacyCommand({ command_id: COMMAND, email: 'a@b.c' })).toThrow(
      'INVALID_PRIVACY_REQUEST'
    );
    expect(() => validatePrivacyCommand({ command_id: 'nope' })).toThrow('INVALID_PRIVACY_REQUEST');
    expect(() => validatePrivacyCommand(null)).toThrow('INVALID_PRIVACY_REQUEST');
  });

  it('maps database messages to stable codes and never forwards the message', () => {
    expect(privacyRequestError({ message: 'PRIVACY_REQUEST_RATE_LIMITED' }).code).toBe(
      'rate_limited'
    );
    expect(privacyRequestError({ message: 'PRIVACY_REQUESTS_DISABLED' }).code).toBe('disabled');
    expect(privacyRequestError({ message: 'PRIVACY_REQUEST_NOT_WITHDRAWABLE' }).code).toBe(
      'not_withdrawable'
    );
    expect(privacyRequestError({ message: 'PRIVACY_REQUEST_NOT_FOUND' }).code).toBe('not_found');
    expect(privacyRequestError({ message: 'PRIVACY_REQUEST_ACCOUNT_REQUIRED' }).code).toBe(
      'account_required'
    );
    expect(privacyRequestError({ message: 'PROVISIONAL_PLAYER_RESTRICTED' }).code).toBe(
      'restricted'
    );
    expect(privacyRequestError({ message: 'x', code: '28000' }).code).toBe('unauthenticated');
    expect(JSON.stringify(privacyRequestError({ message: 'relation "x" does not exist' }))).toBe(
      '{"status":"error","code":"unavailable"}'
    );
  });

  it('computes the purge instant 90 days after the final response', () => {
    const response = new Date('2026-11-27T10:00:00Z');
    expect(purgeAfter(response).toISOString()).toBe('2027-02-25T10:00:00.000Z');
  });
});
