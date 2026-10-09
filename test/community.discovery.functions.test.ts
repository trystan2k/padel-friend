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
  getPublicCommunity,
  listPublicCommunities
} from '../src/features/community/community.functions';

const id = '11111111-1111-4111-8111-111111111111';
const columns =
  'id,name,description,logo_path,city_label,visibility,join_policy,created_at,updated_at';
const row = {
  id,
  name: 'Padel',
  description: null,
  logo_path: null,
  city_label: null,
  visibility: 'public',
  join_policy: 'instant',
  created_at: '2026-10-04T00:00:00Z',
  updated_at: '2026-10-04T00:00:00Z'
};

function client(
  claimed = true,
  rows: (typeof row)[] = [row],
  detail: typeof row | null = row,
  error: Error | null = null
) {
  const query = {
    select: vi.fn<(columns: string) => unknown>(),
    eq: vi.fn<(column: string, value: string) => unknown>(),
    filter: vi.fn<(column: string, operator: string, pattern: string) => unknown>(),
    or: vi.fn<(filters: string) => unknown>(),
    order: vi.fn<(column: string, options: { ascending: boolean }) => unknown>(),
    range:
      vi.fn<
        (start: number, end: number) => Promise<{ data: (typeof row)[]; error: Error | null }>
      >(),
    maybeSingle: vi.fn<() => Promise<{ data: typeof row | null; error: Error | null }>>()
  };
  query.select.mockReturnValue(query);
  query.eq.mockReturnValue(query);
  query.filter.mockReturnValue(query);
  query.or.mockReturnValue(query);
  query.order.mockReturnValue(query);
  query.range.mockResolvedValue({ data: rows, error });
  query.maybeSingle.mockResolvedValue({ data: detail, error });
  const from = vi.fn<(table: string) => typeof query>().mockReturnValue(query);
  return {
    auth: {
      getClaims: vi
        .fn<
          () => Promise<{
            data: { claims: { sub: string } } | null;
            error: Error | null;
          }>
        >()
        .mockResolvedValue(
          claimed
            ? { data: { claims: { sub: id } }, error: null }
            : { data: null, error: new Error('expired') }
        )
    },
    from,
    query
  };
}

beforeEach(() => {
  mocks.getServerClient.mockReset();
  mocks.setResponseHeader.mockReset();
});

describe('public community discovery server functions', () => {
  it('rejects unknown keys, invalid search and pagination before client access', async () => {
    for (const input of [
      null,
      { created_by: id },
      { search: null },
      { search: undefined },
      { search: 'x'.repeat(81) },
      { search: 'Pad\u0000el' },
      { search: 'Pad\uD800el' },
      { search: 'Pad\uDC00el' },
      { offset: -1 },
      { offset: 10001 },
      { offset: 0.5 },
      { offset: '0' },
      { offset: Infinity },
      { limit: 0 },
      { limit: 51 },
      { limit: 1.5 },
      { limit: NaN },
      { limit: undefined }
    ])
      await expect(listPublicCommunities({ data: input })).rejects.toThrow(
        'INVALID_COMMUNITY_INPUT'
      );
    for (const input of [{}, { community_id: 'bad' }, { community_id: id, visibility: 'private' }])
      await expect(getPublicCommunity({ data: input })).rejects.toThrow('INVALID_COMMUNITY_INPUT');
    expect(mocks.getServerClient).not.toHaveBeenCalled();
  });

  it('rejects missing claims without database reads and sets private no-store', async () => {
    const unauthenticated = client(false);
    mocks.getServerClient.mockReturnValue(unauthenticated);
    await expect(listPublicCommunities({ data: {} })).rejects.toThrow('UNAUTHENTICATED');
    await expect(getPublicCommunity({ data: { community_id: id } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(unauthenticated.from).not.toHaveBeenCalled();
    expect(mocks.setResponseHeader).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('projects only public columns and uses deterministic descending sentinel pagination', async () => {
    const authenticated = client(true, [
      row,
      { ...row, id: '22222222-2222-4222-8222-222222222222' }
    ]);
    mocks.getServerClient.mockReturnValue(authenticated);
    await expect(listPublicCommunities({ data: { offset: 10, limit: 1 } })).resolves.toEqual({
      communities: [row],
      next_offset: 11
    });
    expect(authenticated.from).toHaveBeenCalledExactlyOnceWith('communities');
    expect(authenticated.query.select).toHaveBeenCalledExactlyOnceWith(columns);
    expect(authenticated.query.eq).toHaveBeenCalledExactlyOnceWith('visibility', 'public');
    expect(authenticated.query.filter).not.toHaveBeenCalled();
    expect(authenticated.query.order.mock.calls).toEqual([
      ['created_at', { ascending: false }],
      ['id', { ascending: false }]
    ]);
    expect(authenticated.query.range).toHaveBeenCalledExactlyOnceWith(10, 11);
  });

  it('normalizes blank search, defaults bounds and returns null cursor for short/empty pages', async () => {
    const authenticated = client(true, [row]);
    mocks.getServerClient.mockReturnValue(authenticated);
    await expect(listPublicCommunities({ data: { search: '   ' } })).resolves.toEqual({
      communities: [row],
      next_offset: null
    });
    expect(authenticated.query.filter).not.toHaveBeenCalled();
    expect(authenticated.query.range).toHaveBeenCalledWith(0, 20);
    const empty = client(true, []);
    mocks.getServerClient.mockReturnValue(empty);
    await expect(listPublicCommunities({ data: {} })).resolves.toEqual({
      communities: [],
      next_offset: null
    });
  });

  it('escapes regex and PostgREST syntax in both searchable columns', async () => {
    const authenticated = client();
    mocks.getServerClient.mockReturnValue(authenticated);
    await listPublicCommunities({
      data: { search: '  PáDel%_\\🎾.*[x]  ', offset: 10000, limit: 50 }
    });
    expect(authenticated.query.or).toHaveBeenCalledExactlyOnceWith(
      'name.imatch."PáDel%_\\\\\\\\🎾\\\\.\\\\*\\\\[x\\\\]",city_label.imatch."PáDel%_\\\\\\\\🎾\\\\.\\\\*\\\\[x\\\\]"'
    );
    expect(authenticated.query.eq).toHaveBeenCalledWith('visibility', 'public');
    expect(authenticated.query.range).toHaveBeenCalledWith(10000, 10050);
    await listPublicCommunities({ data: { search: '") , visibility.eq.private, name.imatch.("' } });
    const filter = authenticated.query.or.mock.lastCall?.[0] ?? '';
    expect(filter).toContain('\\"');
    expect(filter).toContain('\\(');
    await listPublicCommunities({ data: { search: '🎾'.repeat(80) } });
    expect(authenticated.query.or).toHaveBeenLastCalledWith(
      `name.imatch."${'🎾'.repeat(80)}",city_label.imatch."${'🎾'.repeat(80)}"`
    );
  });

  it('never advertises an offset beyond the validator cap', async () => {
    const full = Array.from({ length: 51 }, () => row);
    mocks.getServerClient.mockReturnValue(client(true, full));
    await expect(
      listPublicCommunities({ data: { offset: 9950, limit: 50 } })
    ).resolves.toMatchObject({
      communities: full.slice(0, 50),
      next_offset: 10000
    });
    await expect(
      listPublicCommunities({ data: { offset: 10000, limit: 50 } })
    ).resolves.toMatchObject({
      communities: full.slice(0, 50),
      next_offset: null
    });
    mocks.getServerClient.mockReturnValue(client(true, full.slice(0, 50)));
    await expect(
      listPublicCommunities({ data: { offset: 9950, limit: 50 } })
    ).resolves.toMatchObject({
      next_offset: null
    });
    mocks.getServerClient.mockReturnValue(client(true, [row, row]));
    await expect(
      listPublicCommunities({ data: { offset: 9999, limit: 2 } })
    ).resolves.toMatchObject({
      next_offset: null
    });
  });

  it('returns only public detail; private and absent IDs share null response', async () => {
    const authenticated = client();
    mocks.getServerClient.mockReturnValue(authenticated);
    await expect(getPublicCommunity({ data: { community_id: id } })).resolves.toEqual(row);
    expect(authenticated.query.select).toHaveBeenCalledExactlyOnceWith(columns);
    expect(authenticated.query.eq.mock.calls).toEqual([
      ['id', id],
      ['visibility', 'public']
    ]);
    expect(authenticated.query.maybeSingle).toHaveBeenCalledOnce();
    for (const hidden of [null, null]) {
      mocks.getServerClient.mockReturnValue(client(true, [], hidden));
      await expect(getPublicCommunity({ data: { community_id: id } })).resolves.toBeNull();
    }
  });

  it('propagates list and detail database failures without mapping to absence', async () => {
    const error = new Error('database unavailable');
    mocks.getServerClient.mockReturnValue(client(true, [], null, error));
    await expect(listPublicCommunities({ data: {} })).rejects.toBe(error);
    await expect(getPublicCommunity({ data: { community_id: id } })).rejects.toBe(error);
  });
});
