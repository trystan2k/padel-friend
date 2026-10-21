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
  getMyMatchInvitation,
  respondMatchEventInvitation
} from '../src/features/matches/match-invitation.functions';
const id = '11111111-1111-4111-8111-111111111111';
const input = { event_id: id, invitation_id: id, response: 'decline' };
describe('invitation server functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.auth.mockResolvedValue({ client: { rpc: mocks.rpc, auth: { getClaims: mocks.claims } } });
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: id, is_anonymous: false } },
      error: null
    });
  });
  it('uses authenticated client and exact SQL signatures', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        event_id: id,
        invitation_id: id,
        status: 'declined',
        registration: null,
        replayed: false
      },
      error: null
    });
    expect(await respondMatchEventInvitation({ data: input })).toMatchObject({
      status: 'declined'
    });
    expect(mocks.rpc).toHaveBeenCalledWith('respond_match_event_invitation', {
      p_match_event_id: id,
      p_invitation_id: id,
      p_response: 'decline'
    });
    expect(mocks.claims).toHaveBeenCalled();
  });
  it('rejects anonymous or missing claims before RPC', async () => {
    for (const claims of [{ sub: id, is_anonymous: true }, {}]) {
      mocks.claims.mockResolvedValue({ data: { claims }, error: null });
      await expect(respondMatchEventInvitation({ data: input })).rejects.toThrow('UNAUTHENTICATED');
      await expect(getMyMatchInvitation({ data: { event_id: id } })).rejects.toThrow(
        'UNAUTHENTICATED'
      );
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it('fails closed on malformed DTOs and maps SQL errors', async () => {
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    expect(await respondMatchEventInvitation({ data: input })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    expect(await getMyMatchInvitation({ data: { event_id: id } })).toEqual({
      status: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'MATCH_REGISTRATION_FULL' }
    });
    expect(await respondMatchEventInvitation({ data: input })).toEqual({
      status: 'error',
      code: 'full'
    });
    expect(await getMyMatchInvitation({ data: { event_id: id } })).toEqual({
      status: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({ data: null, error: null });
    expect(await getMyMatchInvitation({ data: { event_id: id } })).toEqual({ status: 'empty' });
    mocks.rpc.mockResolvedValue({
      data: {
        invitation_id: id,
        status: 'pending',
        effective_status: 'pending',
        expires_at: '2030-01-01T00:00:00Z',
        responded_at: null
      },
      error: null
    });
    expect(await getMyMatchInvitation({ data: { event_id: id } })).toMatchObject({
      status: 'ok',
      invitation: { status: 'pending' }
    });
  });
});
