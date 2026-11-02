import { beforeEach, describe, expect, it, vi } from 'vitest';

type RpcResult = { data: unknown; error: { message: string } | null };
type Claims = { data: { claims: { sub?: string; is_anonymous?: boolean } } | null; error: unknown };

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown; userId: string }>>()
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
        (fn: (context: { data: unknown }) => unknown) => async (options?: { data: unknown }) =>
          fn({ data: validate(options?.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));

import {
  activateLeague,
  closeLeague,
  createLeague,
  getLeague,
  listLeagues,
  listMoreLeagues,
  listMyLeagueCommunities,
  updateLeague
} from '../src/features/leagues/league.functions';
import {
  LEAGUE_COMMUNITY_ID,
  LEAGUE_ID,
  makeLeagueDetail,
  makeLeagueDto,
  makeLeagueList
} from './helpers/league-dto-fixtures';

const request_id = '44444444-4444-4444-8444-444444444444';
const creation = {
  request_id,
  community_id: LEAGUE_COMMUNITY_ID,
  name: 'Autumn League',
  description: null,
  end_mode: 'fixed_date' as const,
  start_date: '2030-10-01',
  end_date: '2030-12-20',
  minimum_matches: 1
};

describe('League server functions', () => {
  let rpc: ReturnType<
    typeof vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>
  >;
  let getClaims: ReturnType<typeof vi.fn<() => Promise<Claims>>>;
  let from: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();
    getClaims = vi
      .fn<() => Promise<Claims>>()
      .mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
    from = vi.fn<(table: string) => unknown>();
    mocks.requireAuthenticatedClient
      .mockReset()
      .mockResolvedValue({ client: { auth: { getClaims }, rpc, from }, userId: 'user-1' });
  });

  it.each([
    ['list', () => listLeagues({ data: { community_id: LEAGUE_COMMUNITY_ID } })],
    ['get', () => getLeague({ data: { league_id: LEAGUE_ID } })],
    ['create', () => createLeague({ data: creation })],
    [
      'update',
      () =>
        updateLeague({
          data: { league_id: LEAGUE_ID, expected_version: 1, changes: { name: 'x' } }
        })
    ],
    ['activate', () => activateLeague({ data: { league_id: LEAGUE_ID, expected_version: 1 } })],
    ['close', () => closeLeague({ data: { league_id: LEAGUE_ID, expected_version: 1 } })],
    ['entries', () => listMyLeagueCommunities()]
  ])('%s rejects a missing or anonymous session before any database call', async (_name, call) => {
    getClaims.mockResolvedValueOnce({ data: null, error: new Error('no session') });
    await expect(call()).rejects.toThrow('UNAUTHENTICATED');
    getClaims.mockResolvedValueOnce({ data: { claims: {} }, error: null });
    await expect(call()).rejects.toThrow('UNAUTHENTICATED');
    getClaims.mockResolvedValueOnce({
      data: { claims: { sub: 'u', is_anonymous: true } },
      error: null
    });
    await expect(call()).rejects.toThrow('UNAUTHENTICATED');
    expect(rpc).not.toHaveBeenCalled();
    expect(from).not.toHaveBeenCalled();
  });

  it('rejects invalid input before authenticating', async () => {
    await expect(listLeagues({ data: { community_id: 'x' } })).rejects.toThrow(
      'INVALID_LEAGUE_INPUT'
    );
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('lists and reads Leagues through the authorized readers', async () => {
    const list = makeLeagueList([makeLeagueDto()]);
    rpc.mockResolvedValueOnce({ data: list, error: null });
    await expect(listLeagues({ data: { community_id: LEAGUE_COMMUNITY_ID } })).resolves.toEqual(
      list
    );
    expect(rpc).toHaveBeenLastCalledWith('list_leagues', { p_community_id: LEAGUE_COMMUNITY_ID });

    const more = makeLeagueList(
      [makeLeagueDto()],
      {},
      { total: 201, truncated: false, next_offset: 201 }
    );
    rpc.mockResolvedValueOnce({ data: more, error: null });
    await expect(
      listMoreLeagues({ data: { community_id: LEAGUE_COMMUNITY_ID, offset: 200 } })
    ).resolves.toEqual(more);
    expect(rpc).toHaveBeenLastCalledWith('list_leagues', {
      p_community_id: LEAGUE_COMMUNITY_ID,
      p_offset: 200
    });

    const detail = makeLeagueDetail();
    rpc.mockResolvedValueOnce({ data: detail, error: null });
    await expect(getLeague({ data: { league_id: LEAGUE_ID } })).resolves.toEqual(detail);
    expect(rpc).toHaveBeenLastCalledWith('get_league', { p_league_id: LEAGUE_ID });
  });

  it('creates with every field, omitting nulls so database defaults apply', async () => {
    rpc.mockResolvedValueOnce({ data: makeLeagueDto(), error: null });
    await expect(createLeague({ data: creation })).resolves.toEqual(makeLeagueDto());
    expect(rpc).toHaveBeenLastCalledWith('create_league', {
      p_request_id: request_id,
      p_community_id: LEAGUE_COMMUNITY_ID,
      p_name: 'Autumn League',
      p_end_mode: 'fixed_date',
      p_start_date: '2030-10-01',
      p_description: undefined,
      p_end_date: '2030-12-20',
      p_minimum_matches: 1
    });
  });

  it('sends updates, activation and close with the expected version', async () => {
    rpc.mockResolvedValue({ data: makeLeagueDto({ version: 2 }), error: null });
    await updateLeague({
      data: { league_id: LEAGUE_ID, expected_version: 1, changes: { name: 'Spring' } }
    });
    expect(rpc).toHaveBeenLastCalledWith('update_league', {
      p_league_id: LEAGUE_ID,
      p_expected_version: 1,
      p_changes: { name: 'Spring' }
    });
    await activateLeague({ data: { league_id: LEAGUE_ID, expected_version: 2 } });
    expect(rpc).toHaveBeenLastCalledWith('activate_league', {
      p_league_id: LEAGUE_ID,
      p_expected_version: 2
    });
    await closeLeague({ data: { league_id: LEAGUE_ID, expected_version: 3 } });
    expect(rpc).toHaveBeenLastCalledWith('close_league', {
      p_league_id: LEAGUE_ID,
      p_expected_version: 3
    });
  });

  it('surfaces stable codes and never raw database text', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAGUE_CREATION_DISABLED' } });
    await expect(createLeague({ data: creation })).rejects.toThrow('LEAGUE_CREATION_DISABLED');
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'permission denied for table leagues' }
    });
    await expect(createLeague({ data: creation })).rejects.toThrow('LEAGUE_UNAVAILABLE');
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAGUE_VERSION_CONFLICT' } });
    await expect(
      activateLeague({ data: { league_id: LEAGUE_ID, expected_version: 1 } })
    ).rejects.toThrow('LEAGUE_VERSION_CONFLICT');
  });

  it('refuses a malformed response instead of passing it on', async () => {
    rpc.mockResolvedValueOnce({ data: { ...makeLeagueDto(), leaked: true }, error: null });
    await expect(createLeague({ data: creation })).rejects.toThrow('INVALID_LEAGUE_RESPONSE');
    rpc.mockResolvedValueOnce({ data: [], error: null });
    await expect(listLeagues({ data: { community_id: LEAGUE_COMMUNITY_ID } })).rejects.toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
  });

  describe('member-reachable community entries', () => {
    const query = (result: { data: unknown; error: unknown }) => {
      const chain: Record<string, unknown> = {};
      for (const method of ['select', 'eq', 'is', 'lte', 'in', 'order'])
        chain[method] = vi.fn<() => unknown>(() => chain);
      chain.then = (resolve: (value: unknown) => void) => resolve(result);
      return chain;
    };

    it("lists the active memberships' communities for any member, not only Admins", async () => {
      const memberships = query({ data: [{ community_id: 'c1' }], error: null });
      const communities = query({ data: [{ id: 'c1', name: 'Club' }], error: null });
      from.mockReturnValueOnce(memberships).mockReturnValueOnce(communities);
      await expect(listMyLeagueCommunities()).resolves.toEqual([{ id: 'c1', name: 'Club' }]);
      expect(from).toHaveBeenNthCalledWith(1, 'community_members');
      expect(memberships.eq).toHaveBeenCalledWith('user_id', 'user-1');
      expect(memberships.eq).toHaveBeenCalledWith('status', 'active');
      expect(memberships.eq).not.toHaveBeenCalledWith('role', 'admin');
    });

    it('returns an empty list without a second query and hides lookup failures', async () => {
      from.mockReturnValueOnce(query({ data: [], error: null }));
      await expect(listMyLeagueCommunities()).resolves.toEqual([]);
      expect(from).toHaveBeenCalledTimes(1);
      from.mockReturnValueOnce(query({ data: null, error: new Error('db') }));
      await expect(listMyLeagueCommunities()).rejects.toThrow('LEAGUE_UNAVAILABLE');
      from
        .mockReturnValueOnce(query({ data: [{ community_id: 'c1' }], error: null }))
        .mockReturnValueOnce(query({ data: null, error: new Error('db') }));
      await expect(listMyLeagueCommunities()).rejects.toThrow('LEAGUE_UNAVAILABLE');
    });
  });
});
