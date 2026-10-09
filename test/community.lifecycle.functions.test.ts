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

import {
  getMyMembershipTimeline,
  leaveCommunity
} from '../src/features/community/community.functions';
import {
  validateGetMyMembershipTimeline,
  validateLeaveCommunity
} from '../src/features/community/community.validators';

const communityId = '11111111-1111-4111-8111-111111111111';
const userId = '22222222-2222-4222-8222-222222222222';
const membershipId = '33333333-3333-4333-8333-333333333333';

function client(
  options: {
    claimed?: boolean;
    rpcData?: unknown;
    rpcError?: unknown;
    timelineRows?: unknown[];
  } = {}
) {
  const rows = options.timelineRows ?? [];
  const single = vi
    .fn<() => Promise<{ data: unknown; error: unknown }>>()
    .mockResolvedValue({ data: options.rpcData ?? null, error: options.rpcError ?? null });
  const rpc = vi.fn<(name: string, args: unknown) => { single: typeof single }>(() => ({ single }));
  const query = {
    select: vi.fn<(columns: string) => object>(),
    eq: vi.fn<(column: string, value: unknown) => object>(),
    order: vi.fn<(column: string, options: { ascending: boolean }) => object>(),
    range: vi.fn<(from: number, to: number) => object>(),
    then: (
      resolve: (value: { data: unknown[]; error: null }) => unknown,
      reject: (error: unknown) => unknown
    ) => Promise.resolve({ data: rows, error: null }).then(resolve, reject)
  };
  for (const method of ['select', 'eq', 'order', 'range'] as const)
    query[method].mockImplementation(() => query);
  const from = vi.fn<(table: string) => typeof query>(() => query);
  return {
    auth: {
      getClaims: vi
        .fn<() => Promise<{ data: { claims: { sub: string } } | null; error: Error | null }>>()
        .mockResolvedValue(
          options.claimed === false
            ? { data: null, error: new Error('expired') }
            : { data: { claims: { sub: userId } }, error: null }
        )
    },
    rpc,
    single,
    from,
    query
  };
}

beforeEach(() => {
  mocks.getServerClient.mockReset();
  mocks.setResponseHeader.mockReset();
});

describe('community lifecycle validators', () => {
  it('accepts only community id for leave and rejects caller-controlled identity or state', () => {
    expect(validateLeaveCommunity({ community_id: communityId })).toEqual({
      community_id: communityId
    });
    for (const input of [
      null,
      {},
      { community_id: 'invalid' },
      { community_id: communityId, user_id: userId },
      { community_id: communityId, membership_id: membershipId },
      { community_id: communityId, status: 'inactive' }
    ])
      expect(() => validateLeaveCommunity(input)).toThrow('INVALID_COMMUNITY_INPUT');
  });

  it('defaults timeline pagination, accepts an optional community and rejects unsafe bounds', () => {
    expect(validateGetMyMembershipTimeline({})).toEqual({ offset: 0, limit: 20 });
    expect(
      validateGetMyMembershipTimeline({ community_id: communityId, offset: 10000, limit: 50 })
    ).toEqual({ community_id: communityId, offset: 10000, limit: 50 });
    for (const input of [
      null,
      { user_id: userId },
      { community_id: 'invalid' },
      { offset: -1 },
      { offset: 10001 },
      { offset: 1.5 },
      { limit: 0 },
      { limit: 51 },
      { limit: Number.MAX_SAFE_INTEGER + 1 },
      { offset: 0, extra: true }
    ])
      expect(() => validateGetMyMembershipTimeline(input)).toThrow('INVALID_COMMUNITY_INPUT');
  });
});

describe('community lifecycle server functions', () => {
  it('leaves through the exact RPC, returns an allowlisted result, and disables shared caching', async () => {
    const actor = client({
      rpcData: {
        membership_id: membershipId,
        community_id: communityId,
        status: 'inactive',
        valid_until: '2026-10-08T18:00:00.000001Z',
        user_id: userId
      }
    });
    mocks.getServerClient.mockReturnValue(actor);
    await expect(leaveCommunity({ data: { community_id: communityId } })).resolves.toEqual({
      membership_id: membershipId,
      community_id: communityId,
      status: 'inactive',
      valid_until: '2026-10-08T18:00:00.000001Z'
    });
    expect(actor.rpc).toHaveBeenCalledExactlyOnceWith('leave_community', {
      p_community_id: communityId
    });
    expect(actor.single).toHaveBeenCalledOnce();
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it.each([
    ['28000', 'UNAUTHENTICATED'],
    ['PL001', 'COMMUNITY_MEMBERSHIP_NOT_OPEN'],
    ['PL002', 'FINAL_COMMUNITY_ADMIN']
  ])('maps leave SQLSTATE %s to %s', async (code, message) => {
    const actor = client({ rpcError: { code } });
    mocks.getServerClient.mockReturnValue(actor);
    await expect(leaveCommunity({ data: { community_id: communityId } })).rejects.toThrow(message);
  });

  it('validates leave before auth, handles missing claims and preserves unknown errors', async () => {
    await expect(
      leaveCommunity({ data: { community_id: communityId, role: 'admin' } })
    ).rejects.toThrow('INVALID_COMMUNITY_INPUT');
    expect(mocks.getServerClient).not.toHaveBeenCalled();

    const guest = client({ claimed: false });
    mocks.getServerClient.mockReturnValue(guest);
    await expect(leaveCommunity({ data: { community_id: communityId } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(guest.rpc).not.toHaveBeenCalled();

    const unknown = { code: '23514', message: 'unexpected constraint' };
    const actor = client({ rpcError: unknown });
    mocks.getServerClient.mockReturnValue(actor);
    await expect(leaveCommunity({ data: { community_id: communityId } })).rejects.toBe(unknown);
    const empty = client();
    mocks.getServerClient.mockReturnValue(empty);
    await expect(leaveCommunity({ data: { community_id: communityId } })).rejects.toThrow(
      'COMMUNITY_LEAVE_FAILED'
    );
  });

  it('reads only caller-owned timeline rows with deterministic ordering and limit-plus-one paging', async () => {
    const actor = client({
      timelineRows: [
        {
          id: membershipId,
          community_id: communityId,
          role: 'member',
          status: 'inactive',
          valid_from: '2026-01-01T00:00:00Z',
          valid_until: '2026-02-01T00:00:00Z',
          activated_at: '2026-01-01T00:00:00Z',
          user_id: userId,
          email: 'private@example.test'
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          community_id: communityId,
          role: 'member',
          status: 'active',
          valid_from: '2026-02-01T00:00:00Z',
          valid_until: null,
          activated_at: '2026-02-01T00:00:00Z'
        },
        {
          id: '55555555-5555-4555-8555-555555555555',
          community_id: communityId,
          role: 'member',
          status: 'inactive',
          valid_from: '2026-03-01T00:00:00Z',
          valid_until: '2026-04-01T00:00:00Z',
          activated_at: null
        }
      ]
    });
    mocks.getServerClient.mockReturnValue(actor);
    await expect(
      getMyMembershipTimeline({ data: { community_id: communityId, offset: 2, limit: 2 } })
    ).resolves.toEqual({
      intervals: [
        {
          membership_id: membershipId,
          community_id: communityId,
          role: 'member',
          status: 'inactive',
          valid_from: '2026-01-01T00:00:00Z',
          valid_until: '2026-02-01T00:00:00Z',
          activated_at: '2026-01-01T00:00:00Z'
        },
        {
          membership_id: '44444444-4444-4444-8444-444444444444',
          community_id: communityId,
          role: 'member',
          status: 'active',
          valid_from: '2026-02-01T00:00:00Z',
          valid_until: null,
          activated_at: '2026-02-01T00:00:00Z'
        }
      ],
      next_offset: 4
    });
    expect(actor.from).toHaveBeenCalledExactlyOnceWith('community_members');
    expect(actor.query.select).toHaveBeenCalledExactlyOnceWith(
      'id,community_id,role,status,valid_from,valid_until,activated_at'
    );
    expect(actor.query.eq).toHaveBeenNthCalledWith(1, 'user_id', userId);
    expect(actor.query.eq).toHaveBeenCalledWith('community_id', communityId);
    expect(actor.query.order).toHaveBeenNthCalledWith(1, 'community_id', { ascending: true });
    expect(actor.query.order).toHaveBeenNthCalledWith(2, 'valid_from', { ascending: true });
    expect(actor.query.order).toHaveBeenNthCalledWith(3, 'id', { ascending: true });
    expect(actor.query.range).toHaveBeenCalledExactlyOnceWith(2, 4);
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('caps timeline continuation at offset limit and returns empty owner-scoped results', async () => {
    const actor = client({
      timelineRows: [
        {
          id: membershipId,
          community_id: communityId,
          role: 'member',
          status: 'active',
          valid_from: '2026-01-01T00:00:00Z',
          valid_until: null,
          activated_at: '2026-01-01T00:00:00Z'
        },
        {
          id: '44444444-4444-4444-8444-444444444444',
          community_id: communityId,
          role: 'member',
          status: 'inactive',
          valid_from: '2026-02-01T00:00:00Z',
          valid_until: '2026-03-01T00:00:00Z',
          activated_at: null
        }
      ]
    });
    mocks.getServerClient.mockReturnValue(actor);
    await expect(getMyMembershipTimeline({ data: { offset: 10000, limit: 1 } })).resolves.toEqual({
      intervals: [
        {
          membership_id: membershipId,
          community_id: communityId,
          role: 'member',
          status: 'active',
          valid_from: '2026-01-01T00:00:00Z',
          valid_until: null,
          activated_at: '2026-01-01T00:00:00Z'
        }
      ],
      next_offset: null
    });
    expect(actor.query.range).toHaveBeenCalledExactlyOnceWith(10000, 10001);
    expect(actor.query.eq).toHaveBeenCalledExactlyOnceWith('user_id', userId);

    const empty = client({ timelineRows: [] });
    mocks.getServerClient.mockReturnValue(empty);
    await expect(getMyMembershipTimeline({ data: {} })).resolves.toEqual({
      intervals: [],
      next_offset: null
    });
  });

  it('rejects unauthenticated timeline reads before querying membership history', async () => {
    const guest = client({ claimed: false });
    mocks.getServerClient.mockReturnValue(guest);
    await expect(getMyMembershipTimeline({ data: {} })).rejects.toThrow('UNAUTHENTICATED');
    expect(guest.from).not.toHaveBeenCalled();
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
});
