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
  listMatchEventAudit
} from '../src/features/matches/match-management.functions';
const id = '11111111-1111-4111-8111-111111111111';
const command = { event_id: id, attempt_id: id, request_id: id };
describe('management server functions', () => {
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
