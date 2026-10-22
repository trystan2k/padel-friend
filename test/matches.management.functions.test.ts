import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  claims: vi.fn<() => Promise<unknown>>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: typeof validate) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options: { data: unknown }) =>
        fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({ requireAuthenticatedClient: mocks.auth }));
import {
  withdrawMatchRegistration,
  removeMatchRegistration,
  listMatchEventManagementParticipants,
  listMatchEventAudit,
  getMatchEventManagement,
  transferMatchEventOwnership,
  cancelMatchEvent
} from '../src/features/matches/match-management.functions';
import { editMatchEvent } from '../src/features/matches/match-management.functions';
const id = '11111111-1111-4111-8111-111111111111';
const command = { event_id: id, attempt_id: id, request_id: id };
describe('management server functions', () => {
  it('version conflict decodes structured detail safely', async () => {
    const input = {
      data: { event_id: id, expected_version: 1, request_id: id, patch: { notes: 'Draft' } }
    };
    for (const details of [
      '{"current_version":3,"private":"hidden"}',
      '3',
      '{"current_version":0}',
      '{"current_version":9007199254740992}',
      '{"current_version":"3"}',
      'invalid'
    ]) {
      mocks.rpc.mockResolvedValue({
        data: null,
        error: { code: 'P0001', message: 'MATCH_MANAGEMENT_VERSION_CONFLICT', details }
      });
      expect(await editMatchEvent(input)).toEqual(
        details === '{"current_version":3,"private":"hidden"}'
          ? { status: 'conflict', code: 'version_conflict', current_version: 3 }
          : { status: 'error', code: 'unavailable' }
      );
    }
    mocks.rpc.mockResolvedValue({
      data: {
        event_id: id,
        request_id: id,
        version: 2,
        transition_revision: 2,
        changed: true,
        replayed: false,
        change_kind: 'minor',
        changed_fields: ['notes'],
        reconfirmation_generation: 0,
        private: 'hidden'
      },
      error: null
    });
    expect(await editMatchEvent(input)).toEqual({
      status: 'ok',
      replayed: false,
      value: {
        event_id: id,
        request_id: id,
        version: 2,
        transition_revision: 2,
        changed: true,
        change_kind: 'minor',
        changed_fields: ['notes'],
        reconfirmation_generation: 0
      }
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('edit_match_event', {
      p_match_event_id: id,
      p_expected_version: 1,
      p_request_id: id,
      p_patch: { notes: 'Draft' }
    });
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: id, is_anonymous: true } },
      error: null
    });
    await expect(editMatchEvent(input)).rejects.toThrow('UNAUTHENTICATED');
  });
  it('decodes structured version conflicts without accepting private fields or overwriting', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        code: 'P0001',
        message: 'MATCH_MANAGEMENT_VERSION_CONFLICT',
        details: '{"current_version":2}'
      }
    });
    expect(
      await transferMatchEventOwnership({
        data: { event_id: id, target_user_id: id, request_id: id, expected_version: 1 }
      })
    ).toEqual({ status: 'conflict', code: 'version_conflict', current_version: 2 });
    expect(
      await cancelMatchEvent({
        data: { event_id: id, reason: 'Weather', request_id: id, expected_version: 1 }
      })
    ).toEqual({ status: 'conflict', code: 'version_conflict', current_version: 2 });
    mocks.rpc.mockResolvedValue({ data: { version: 1 }, error: null });
    expect(await getMatchEventManagement({ data: { event_id: id } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });
  it('validates action-specific ownership and cancellation response fields', async () => {
    const envelope = {
      event_id: id,
      request_id: id,
      version: 2,
      transition_revision: 1,
      changed: true,
      replayed: false
    };
    mocks.rpc.mockResolvedValue({ data: { ...envelope, owner_id: id }, error: null });
    expect(
      await transferMatchEventOwnership({
        data: { event_id: id, target_user_id: id, request_id: id, expected_version: 1 }
      })
    ).toMatchObject({ status: 'ok', value: { owner_id: id } });
    mocks.rpc.mockResolvedValue({ data: { ...envelope, status: 'cancelled' }, error: null });
    expect(
      await cancelMatchEvent({
        data: { event_id: id, reason: ' Weather ', request_id: id, expected_version: 1 }
      })
    ).toMatchObject({ status: 'ok', value: { status: 'cancelled' } });
    expect(mocks.rpc).toHaveBeenLastCalledWith('cancel_match_event', {
      p_match_event_id: id,
      p_reason: 'Weather',
      p_request_id: id,
      p_expected_version: 1
    });
  });
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ client: { rpc: mocks.rpc, auth: { getClaims: mocks.claims } } });
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: id, is_anonymous: false } },
      error: null
    });
  });
  it('uses exact RPC signatures and canonical reasons', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        event_id: id,
        request_id: id,
        version: 1,
        transition_revision: 2,
        changed: true,
        replayed: false
      },
      error: null
    });
    expect(await withdrawMatchRegistration({ data: command })).toMatchObject({ status: 'ok' });
    expect(mocks.rpc).toHaveBeenCalledWith('withdraw_match_registration', {
      p_match_event_id: id,
      p_attempt_id: id,
      p_request_id: id
    });
    expect(
      await removeMatchRegistration({
        data: { ...command, target_user_id: id, reason: ' reason ' }
      })
    ).toMatchObject({ status: 'ok' });
    expect(mocks.rpc).toHaveBeenCalledWith('remove_match_registration', {
      p_match_event_id: id,
      p_target_user_id: id,
      p_attempt_id: id,
      p_reason: 'reason',
      p_request_id: id
    });
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    expect(await listMatchEventManagementParticipants({ data: { event_id: id } })).toEqual({
      status: 'ok',
      value: [],
      replayed: false
    });
    expect(await listMatchEventAudit({ data: { event_id: id } })).toMatchObject({ status: 'ok' });
    expect(mocks.rpc).toHaveBeenCalledWith('list_match_event_audit', {
      p_match_event_id: id,
      p_before_at: undefined,
      p_before_id: undefined,
      p_limit: 20
    });
  });
  it('authenticates every read and mutation before RPC', async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: id, is_anonymous: true } },
      error: null
    });
    await expect(withdrawMatchRegistration({ data: command })).rejects.toThrow('UNAUTHENTICATED');
    await expect(
      removeMatchRegistration({ data: { ...command, target_user_id: id, reason: 'reason' } })
    ).rejects.toThrow('UNAUTHENTICATED');
    await expect(listMatchEventManagementParticipants({ data: { event_id: id } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    await expect(listMatchEventAudit({ data: { event_id: id } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('maps domain errors and fails closed on malformed responses', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'MATCH_MANAGEMENT_STALE_ATTEMPT' }
    });
    expect(await withdrawMatchRegistration({ data: command })).toEqual({
      status: 'error',
      code: 'stale_attempt'
    });
    mocks.rpc.mockResolvedValue({ data: { secret: 'hidden' }, error: null });
    expect(
      await removeMatchRegistration({ data: { ...command, target_user_id: id, reason: 'reason' } })
    ).toEqual({ status: 'error', code: 'unavailable' });
    expect(await listMatchEventManagementParticipants({ data: { event_id: id } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    expect(await listMatchEventAudit({ data: { event_id: id } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });
});
