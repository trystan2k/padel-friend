import { beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  claims: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>()
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
import { reconfirmMatchRegistration } from '../src/features/matches/match-reconfirmation.functions';
const id = '11111111-1111-4111-8111-111111111111';
const data = { event_id: id, attempt_id: id, generation: 2, request_id: id };
beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ client: { rpc: mocks.rpc, auth: { getClaims: mocks.claims } } });
  mocks.claims.mockResolvedValue({ data: { claims: { sub: id } }, error: null });
});
describe('reconfirmation server functions', () => {
  it('exact attempt generation request contracts', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        event_id: id,
        request_id: id,
        version: 2,
        transition_revision: 4,
        changed: true,
        replayed: false,
        confirmed_generation: 2,
        participation: 'reserve'
      },
      error: null
    });
    expect(await reconfirmMatchRegistration({ data })).toMatchObject({
      status: 'ok',
      value: { confirmed_generation: 2 }
    });
    expect(mocks.rpc).toHaveBeenCalledWith('reconfirm_match_registration', {
      p_match_event_id: id,
      p_attempt_id: id,
      p_generation: 2,
      p_request_id: id
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: 'P0001', message: 'MATCH_MANAGEMENT_STALE_GENERATION' }
    });
    expect(await reconfirmMatchRegistration({ data })).toEqual({
      status: 'error',
      code: 'stale_generation'
    });
    mocks.rpc.mockResolvedValue({ data: {}, error: null });
    expect(await reconfirmMatchRegistration({ data })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
  });
  it('rejects anonymous or unverified claims before RPC', async () => {
    for (const claims of [null, { sub: id, is_anonymous: true }]) {
      mocks.claims.mockResolvedValue({ data: { claims }, error: null });
      await expect(reconfirmMatchRegistration({ data })).rejects.toThrow('UNAUTHENTICATED');
    }
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
});
