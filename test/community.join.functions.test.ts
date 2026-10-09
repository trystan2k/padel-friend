import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  getServerClient: vi.fn<() => unknown>(),
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options: { data: unknown }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.setResponseHeader }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: mocks.getServerClient }));

import { acceptInvitation, joinCommunity } from '../src/features/community/community.functions';

const id = '11111111-1111-4111-8111-111111111111';
const token = 'a'.repeat(64);
function client(claimed = true, status = 'active', error: unknown = null) {
  const single = vi
    .fn<() => Promise<{ data: { community_id: string; status: string } | null; error: unknown }>>()
    .mockResolvedValue({
      data: error ? null : { community_id: id, status },
      error
    });
  const rpc = vi
    .fn<(name: string, args: unknown) => { single: typeof single }>()
    .mockReturnValue({ single });
  return {
    auth: {
      getClaims: vi
        .fn<() => Promise<{ data: { claims: { sub: string } } | null; error: Error | null }>>()
        .mockResolvedValue(
          claimed
            ? { data: { claims: { sub: id } }, error: null }
            : { data: null, error: new Error('expired') }
        )
    },
    rpc,
    single
  };
}

beforeEach(() => {
  mocks.getServerClient.mockReset();
  mocks.setResponseHeader.mockReset();
});

describe('community join server functions', () => {
  it('rejects unknown keys, caller identity and malformed tokens before auth', async () => {
    for (const data of [
      null,
      {},
      { community_id: 'bad' },
      { community_id: id, user_id: id },
      { community_id: id, role: 'admin' }
    ])
      await expect(joinCommunity({ data })).rejects.toThrow('INVALID_COMMUNITY_INPUT');
    for (const data of [
      null,
      {},
      { token: '' },
      { token: 'A'.repeat(64) },
      { token: 'g'.repeat(64) },
      { token: token + 'a' },
      { token, invitee_user_id: id }
    ])
      await expect(acceptInvitation({ data })).rejects.toThrow('INVALID_COMMUNITY_INPUT');
    expect(mocks.getServerClient).not.toHaveBeenCalled();
  });

  it('rejects missing claims before RPC and disables shared caching', async () => {
    const guest = client(false);
    mocks.getServerClient.mockReturnValue(guest);
    await expect(joinCommunity({ data: { community_id: id } })).rejects.toThrow('UNAUTHENTICATED');
    await expect(acceptInvitation({ data: { token } })).rejects.toThrow('UNAUTHENTICATED');
    expect(guest.rpc).not.toHaveBeenCalled();
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('calls exact RPC signatures and returns active/pending results without caller identity', async () => {
    const instant = client();
    mocks.getServerClient.mockReturnValue(instant);
    await expect(joinCommunity({ data: { community_id: id } })).resolves.toEqual({
      community_id: id,
      status: 'active'
    });
    expect(instant.rpc).toHaveBeenCalledExactlyOnceWith('join_public_community', {
      p_community_id: id
    });
    expect(instant.single).toHaveBeenCalledOnce();
    const approval = client(true, 'pending');
    mocks.getServerClient.mockReturnValue(approval);
    await expect(acceptInvitation({ data: { token } })).resolves.toEqual({
      community_id: id,
      status: 'pending'
    });
    expect(approval.rpc).toHaveBeenCalledExactlyOnceWith('accept_community_invitation', {
      p_token: token
    });
  });

  it.each([
    ['28000', 'UNAUTHENTICATED'],
    ['PJ001', 'INVITATION_INVALID'],
    ['PJ002', 'INVITATION_EXPIRED'],
    ['PJ003', 'INVITATION_USED'],
    ['PJ004', 'INVITATION_REVOKED'],
    ['PJ005', 'INVITATION_NOT_FOR_USER'],
    ['PJ006', 'ALREADY_MEMBER_OR_PENDING'],
    ['PJ007', 'COMMUNITY_NOT_ELIGIBLE'],
    ['PJ008', 'MEMBERSHIP_INACTIVE']
  ])('maps exact SQLSTATE %s to %s', async (code, message) => {
    mocks.getServerClient.mockReturnValue(client(true, 'active', { code }));
    await expect(joinCommunity({ data: { community_id: id } })).rejects.toThrow(message);
    await expect(acceptInvitation({ data: { token } })).rejects.toThrow(message);
  });

  it('preserves unknown database errors and rejects absent results', async () => {
    const unknown = { code: '23505', message: 'unrelated unique violation' };
    mocks.getServerClient.mockReturnValue(client(true, 'active', unknown));
    await expect(joinCommunity({ data: { community_id: id } })).rejects.toBe(unknown);
    await expect(acceptInvitation({ data: { token } })).rejects.toBe(unknown);
    const empty = client();
    empty.single.mockResolvedValue({ data: null, error: null });
    mocks.getServerClient.mockReturnValue(empty);
    await expect(joinCommunity({ data: { community_id: id } })).rejects.toThrow(
      'COMMUNITY_JOIN_FAILED'
    );
    await expect(acceptInvitation({ data: { token } })).rejects.toThrow('COMMUNITY_JOIN_FAILED');
  });
});
