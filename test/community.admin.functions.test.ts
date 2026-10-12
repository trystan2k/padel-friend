import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ client: vi.fn<() => unknown>(), header: vi.fn<() => void>() }));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) =>
        (options: { data: unknown } = { data: undefined }) =>
          fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.header }));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: mocks.client }));
import {
  approveCommunityMember,
  getCommunityMemberById,
  denyCommunityMember,
  removeCommunityMember,
  reactivateCommunityMember,
  promoteCommunityMember,
  demoteCommunityMember,
  issueInvitation,
  listMyAdminCommunities,
  searchCommunityMembers,
  getCommunityAdminContext
} from '../src/features/community/community-admin.functions';
import { validateVenue } from '../src/features/community/community-admin.validators';

const community_id = '11111111-1111-4111-8111-111111111111';
const membership_id = '22222222-2222-4222-8222-222222222222';
const functions = [
  approveCommunityMember,
  denyCommunityMember,
  removeCommunityMember,
  reactivateCommunityMember,
  promoteCommunityMember,
  demoteCommunityMember
];
function mockClient(error: { code: string; message?: string } | null = null, claimed = true) {
  const single = vi
    .fn<
      () => Promise<{
        data: { membership_id: string; status: string; role: string } | null;
        error: { code: string; message?: string } | null;
      }>
    >()
    .mockResolvedValue({
      data: error ? null : { membership_id, status: 'active', role: 'member' },
      error
    });
  const rpc = vi.fn<() => { single: typeof single }>().mockReturnValue({ single });
  const client = {
    auth: {
      getClaims: vi
        .fn<() => Promise<{ data: { claims: { sub: string } } | null; error: Error | null }>>()
        .mockResolvedValue(
          claimed
            ? { data: { claims: { sub: membership_id } }, error: null }
            : { data: null, error: new Error('expired') }
        )
    },
    rpc
  };
  mocks.client.mockReturnValue(client);
  return { rpc, single };
}
beforeEach(() => {
  mocks.client.mockReset();
  mocks.header.mockReset();
});
describe('admin function boundary', () => {
  it.each([null, [], {}, { community_id: 'not-a-uuid' }, { community_id, extra: true }])(
    'rejects invalid admin-context payload before client access: %j',
    (data) => {
      expect(() => getCommunityAdminContext({ data })).toThrow('INVALID_COMMUNITY_INPUT');
      expect(mocks.client).not.toHaveBeenCalled();
    }
  );
  it('rejects inherited-only community IDs and accepts uppercase UUIDs', async () => {
    const inherited = Object.create({ community_id });
    expect(() => getCommunityAdminContext({ data: inherited })).toThrow('INVALID_COMMUNITY_INPUT');
    expect(mocks.client).not.toHaveBeenCalled();

    const uppercaseId = community_id.toUpperCase();
    const communityQuery = {
      select: vi.fn<(columns: string) => unknown>(),
      eq: vi.fn<(column: string, value: string) => unknown>(),
      single: vi.fn<() => Promise<{ data: { id: string }; error: null }>>().mockResolvedValue({
        data: { id: uppercaseId },
        error: null
      })
    };
    communityQuery.select.mockImplementation(() => communityQuery);
    communityQuery.eq.mockImplementation(() => communityQuery);
    const client = {
      auth: {
        getClaims: vi
          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
      },
      rpc: vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
        data: true,
        error: null
      }),
      from: vi.fn<(table: string) => typeof communityQuery>().mockReturnValue(communityQuery)
    };
    mocks.client.mockReturnValue(client);
    await expect(
      getCommunityAdminContext({ data: { community_id: uppercaseId } })
    ).resolves.toEqual({ id: uppercaseId });
    expect(client.auth.getClaims).toHaveBeenCalledOnce();
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
  it('does not read communities or admin data when live admin authorization denies access', async () => {
    const rpc = vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
      data: false,
      error: null
    });
    const from = vi.fn<(table: string) => never>();
    const client = {
      auth: {
        getClaims: vi
          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
      },
      rpc,
      from
    };
    mocks.client.mockReturnValue(client);
    await expect(getCommunityAdminContext({ data: { community_id } })).rejects.toThrow(
      'NOT_COMMUNITY_ADMIN'
    );
    expect(client.auth.getClaims).toHaveBeenCalledOnce();
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(rpc).toHaveBeenCalledWith('is_community_admin', { p_community_id: community_id });
    expect(from).not.toHaveBeenCalled();
  });
  it('reads only the safe community context fields after live authorization', async () => {
    const communityQuery = {
      select: vi.fn<(columns: string) => unknown>(),
      eq: vi.fn<(column: string, value: string) => unknown>(),
      single: vi
        .fn<() => Promise<{ data: { id: string; name: string }; error: null }>>()
        .mockResolvedValue({
          data: { id: community_id, name: 'Safe' },
          error: null
        })
    };
    communityQuery.select.mockImplementation(() => communityQuery);
    communityQuery.eq.mockImplementation(() => communityQuery);
    const client = {
      auth: {
        getClaims: vi
          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
      },
      rpc: vi.fn<() => Promise<{ data: boolean; error: null }>>().mockResolvedValue({
        data: true,
        error: null
      }),
      from: vi.fn<(table: string) => typeof communityQuery>().mockReturnValue(communityQuery)
    };
    mocks.client.mockReturnValue(client);
    await expect(getCommunityAdminContext({ data: { community_id } })).resolves.toEqual({
      id: community_id,
      name: 'Safe'
    });
    expect(client.from).toHaveBeenCalledOnce();
    expect(client.from).toHaveBeenCalledWith('communities');
    expect(communityQuery.select).toHaveBeenCalledWith(
      'id,name,city_label,description,visibility,join_policy'
    );
    expect(communityQuery.eq).toHaveBeenCalledWith('id', community_id);
    expect(communityQuery.single).toHaveBeenCalledOnce();
  });
  it('filters future-valid admin memberships in one server query without per-row RPCs', async () => {
    const futureCommunityId = '44444444-4444-4444-8444-444444444444';
    const memberships = [
      { community_id, valid_from: new Date(Date.now() - 60_000).toISOString() },
      { community_id: futureCommunityId, valid_from: new Date(Date.now() + 60_000).toISOString() }
    ];
    const membershipQuery = {
      select: vi.fn<(columns: string) => unknown>(),
      eq: vi.fn<(column: string, value: string) => unknown>(),
      is: vi.fn<(column: string, value: null) => unknown>(),
      lte: vi.fn<
        (
          column: string,
          value: string
        ) => Promise<{ data: { community_id: string }[]; error: null }>
      >()
    };
    membershipQuery.select.mockReturnValue(membershipQuery);
    membershipQuery.eq.mockReturnValue(membershipQuery);
    membershipQuery.is.mockReturnValue(membershipQuery);
    membershipQuery.lte.mockImplementation((column: string, value: string) =>
      Promise.resolve({
        data: memberships
          .filter(({ valid_from }) =>
            column === 'valid_from' ? Date.parse(valid_from) <= Date.parse(value) : true
          )
          .map(({ community_id: id }) => ({ community_id: id })),
        error: null
      })
    );
    const communityQuery = {
      select: vi.fn<(columns: string) => unknown>(),
      in: vi.fn<(column: string, values: string[]) => unknown>(),
      order:
        vi.fn<(column: string) => Promise<{ data: { id: string; name: string }[]; error: null }>>()
    };
    communityQuery.select.mockReturnValue(communityQuery);
    communityQuery.in.mockReturnValue(communityQuery);
    communityQuery.order.mockResolvedValue({
      data: [{ id: community_id, name: 'Current admin community' }],
      error: null
    });
    const client = {
      auth: {
        getClaims: vi
          .fn<() => Promise<{ data: { claims: { sub: string } }; error: null }>>()
          .mockResolvedValue({
            data: { claims: { sub: membership_id } },
            error: null
          })
      },
      from: vi.fn<(table: string) => typeof membershipQuery | typeof communityQuery>((table) =>
        table === 'community_members' ? membershipQuery : communityQuery
      ),
      rpc: vi.fn<() => unknown>()
    };
    mocks.client.mockReturnValue(client);

    await expect(listMyAdminCommunities()).resolves.toEqual([
      { id: community_id, name: 'Current admin community' }
    ]);
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(1, 'user_id', membership_id);
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(2, 'role', 'admin');
    expect(membershipQuery.eq).toHaveBeenNthCalledWith(3, 'status', 'active');
    expect(membershipQuery.is).toHaveBeenCalledWith('valid_until', null);
    expect(membershipQuery.lte).toHaveBeenCalledWith('valid_from', expect.any(String));
    expect(communityQuery.in).toHaveBeenCalledWith('id', [community_id]);
    expect(client.rpc).not.toHaveBeenCalled();
  });
  it('declares all governance endpoints as module-level createServerFn chains', () => {
    const source = readFileSync(
      new URL('../src/features/community/community-admin.functions.ts', import.meta.url),
      'utf8'
    );
    for (const name of [
      'approveCommunityMember',
      'denyCommunityMember',
      'removeCommunityMember',
      'reactivateCommunityMember',
      'promoteCommunityMember',
      'demoteCommunityMember'
    ])
      expect(source).toMatch(new RegExp(`export const ${name} = createServerFn\\(`));
  });
  it('accepts PostgreSQL-valid Unicode edge whitespace in venue names', () => {
    expect(validateVenue({ community_id, name: '\u00a0Court\u00a0' }).name).toBe(
      '\u00a0Court\u00a0'
    );
    expect(() => validateVenue({ community_id, name: ' Court' })).toThrow(
      'INVALID_COMMUNITY_INPUT'
    );
  });
  it('looks up a membership by scoped ID and separates missing rows from database failures', async () => {
    const member = {
      membership_id,
      user_id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Outside first page',
      role: 'member',
      status: 'inactive',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: '2026-10-02T00:00:00Z',
      activated_at: '2026-10-01T00:00:00Z',
      display_level: 3,
      reliability_percent: 80
    };
    const rpc = vi.fn<
      () => Promise<{
        data: (typeof member)[] | null;
        error: { code: string; message?: string } | null;
      }>
    >();
    rpc.mockResolvedValue({ data: [member], error: null });
    const client = {
      auth: {
        getClaims: vi
          .fn<
            () => Promise<{
              data: { claims: { sub: string } } | null;
              error: Error | null;
            }>
          >()
          .mockResolvedValue({ data: { claims: { sub: membership_id } }, error: null })
      },
      rpc
    };
    mocks.client.mockReturnValue(client);
    await expect(
      getCommunityMemberById({ data: { community_id, membership_id } })
    ).resolves.toEqual(member);
    expect(client.rpc).toHaveBeenCalledWith('get_community_member_by_id', {
      p_community_id: community_id,
      p_membership_id: membership_id
    });
    client.rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(getCommunityMemberById({ data: { community_id, membership_id } })).rejects.toThrow(
      'COMMUNITY_MEMBER_NOT_FOUND'
    );
    const readFailure = { code: 'XX000', message: 'database unavailable' };
    client.rpc.mockResolvedValueOnce({ data: null, error: readFailure });
    await expect(getCommunityMemberById({ data: { community_id, membership_id } })).rejects.toBe(
      readFailure
    );
  });

  it('rejects unknown action fields and invalid IDs before client access', async () => {
    for (const fn of functions) {
      for (const data of [
        { community_id, membership_id, role: 'admin' },
        { community_id: 'bad', membership_id },
        { community_id }
      ])
        expect(() => fn({ data })).toThrow('INVALID_COMMUNITY_INPUT');
    }
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('requires claims and sets private no-store on every action', async () => {
    const { rpc } = mockClient(null, false);
    for (const fn of functions)
      await expect(fn({ data: { community_id, membership_id } })).rejects.toThrow(
        'UNAUTHENTICATED'
      );
    expect(rpc).not.toHaveBeenCalled();
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });
  it('binds six fixed actions to a single typed RPC', async () => {
    const { rpc } = mockClient();
    for (const [index, fn] of functions.entries()) {
      await expect(fn({ data: { community_id, membership_id } })).resolves.toMatchObject({
        membership_id
      });
      expect(rpc).toHaveBeenNthCalledWith(index + 1, 'govern_community_member', {
        p_community_id: community_id,
        p_membership_id: membership_id,
        p_action: ['approve', 'deny', 'remove', 'reactivate', 'promote', 'demote'][index]
      });
    }
  });
  it('maps only documented codes and preserves unknown errors', async () => {
    for (const [code, expected] of Object.entries({
      '28000': 'UNAUTHENTICATED',
      PG001: 'NOT_COMMUNITY_ADMIN',
      PG006: 'NOT_COMMUNITY_MEMBER',
      PG002: 'FINAL_COMMUNITY_ADMIN',
      PG003: 'COMMUNITY_MEMBER_NOT_FOUND',
      PG004: 'INVALID_MEMBERSHIP_TRANSITION',
      PG005: 'ALREADY_MEMBER_OR_PENDING'
    })) {
      mockClient({ code });
      await expect(
        approveCommunityMember({ data: { community_id, membership_id } })
      ).rejects.toThrow(expected);
    }
    const unexpected = { code: '23514', message: 'Different check' };
    mockClient(unexpected);
    await expect(approveCommunityMember({ data: { community_id, membership_id } })).rejects.toBe(
      unexpected
    );
  });
  it.each(['40P01', '40001'])(
    'maps retryable SQLSTATE %s once for every membership action without automatic retry',
    async (code) => {
      for (const fn of functions) {
        const failure = { code, message: 'transaction conflict' };
        const { rpc } = mockClient(failure);
        await expect(fn({ data: { community_id, membership_id } })).rejects.toThrow(
          'COMMUNITY_GOVERNANCE_CONFLICT_RETRYABLE'
        );
        expect(rpc).toHaveBeenCalledTimes(1);
      }
    }
  );
  it('preserves unknown governance errors and invokes the RPC exactly once', async () => {
    const unknown = { code: 'XX000', message: 'unmapped failure' };
    for (const fn of functions) {
      const { rpc } = mockClient(unknown);
      await expect(fn({ data: { community_id, membership_id } })).rejects.toBe(unknown);
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('maps invitation RLS denial only and preserves infrastructure 42501 errors', async () => {
    const attemptIssue = async (writeError: { code: string; message: string }) => {
      const invitationQuery = {
        select: () => invitationQuery,
        single: async () => ({ data: null, error: writeError })
      };
      const pendingQuery = {
        select: () => pendingQuery,
        eq: () => pendingQuery,
        is: () => pendingQuery,
        limit: () => Promise.resolve({ data: [], error: null })
      };
      const communityQuery = {
        select: () => communityQuery,
        eq: () => communityQuery,
        single: async () => ({ data: { visibility: 'private' }, error: null })
      };
      const client = {
        auth: {
          getClaims: async () => ({ data: { claims: { sub: membership_id } }, error: null })
        },
        rpc: async () => ({ data: true, error: null }),
        from: (table: string) => {
          if (table === 'communities') return communityQuery;
          if (table === 'community_members') return pendingQuery;
          return { insert: () => invitationQuery };
        }
      };
      mocks.client.mockReturnValue(client);
      return issueInvitation({ data: { community_id, invitee_user_id: membership_id } });
    };
    await expect(
      attemptIssue({
        code: '42501',
        message: 'new row violates row-level security policy for table "community_invitations"'
      })
    ).rejects.toThrow('NOT_COMMUNITY_ADMIN');
    const infrastructureError = { code: '42501', message: 'permission denied for relation' };
    await expect(attemptIssue(infrastructureError)).rejects.toBe(infrastructureError);
  });
  it('rejects malformed member search and never exposes unvalidated SQL input', async () => {
    for (const query of ['\u0000', '\uD800', 'x'.repeat(81)])
      expect(() => searchCommunityMembers({ data: { community_id, query } })).toThrow(
        'INVALID_COMMUNITY_INPUT'
      );
    expect(mocks.client).not.toHaveBeenCalled();
  });
  it('returns nullable roster timestamps and ratings without manufacturing values', async () => {
    const row = {
      membership_id,
      user_id: '33333333-3333-4333-8333-333333333333',
      display_name: 'Unknown ratings',
      role: 'member',
      status: 'active',
      valid_from: '2026-10-01T00:00:00Z',
      valid_until: null,
      activated_at: null,
      display_level: null,
      reliability_percent: null
    };
    const rpc = vi.fn<() => Promise<{ data: (typeof row)[]; error: null }>>().mockResolvedValue({
      data: [row],
      error: null
    });
    mocks.client.mockReturnValue({
      auth: { getClaims: async () => ({ data: { claims: { sub: membership_id } }, error: null }) },
      rpc
    });
    await expect(searchCommunityMembers({ data: { community_id, query: '' } })).resolves.toEqual([
      row
    ]);
    expect(rpc).toHaveBeenCalledWith('search_community_members', {
      p_community_id: community_id,
      p_query: '',
      p_offset: 0,
      p_limit: 20
    });
  });
  it('does not generate token when claims fail', async () => {
    const { rpc } = mockClient(null, false);
    await expect(
      issueInvitation({ data: { community_id, invitee_user_id: membership_id } })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect(rpc).not.toHaveBeenCalled();
  });
});
