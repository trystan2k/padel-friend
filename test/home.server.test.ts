import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  readRatingHistory: vi.fn<() => Promise<unknown>>(),
  readPlayerRankHistory: vi.fn<(client: unknown, input: unknown) => Promise<unknown>>()
}));
vi.mock('../src/features/player/rating.server', () => ({
  readRatingHistory: mocks.readRatingHistory
}));
vi.mock('../src/features/statistics/statistics-player.server', () => ({
  readPlayerRankHistory: mocks.readPlayerRankHistory
}));
vi.mock('../src/features/leagues/league-decoders', () => ({
  decodeLeagueList: (value: unknown) => value
}));
vi.mock('../src/features/leagues/league-standings-decoders', () => ({
  decodeLeagueStandings: (value: unknown) => value
}));

import { readHome } from '../src/features/home/home.server';
import { makeMatchRpcListRow } from './helpers/match-fixtures';
import { resultProposal } from './helpers/match-result-fixtures';

const USER = '00000000-0000-4000-8000-0000000000a1';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const EVENT_1 = '00000000-0000-4000-8000-0000000000e1';
const EVENT_2 = '00000000-0000-4000-8000-0000000000e2';

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
type Rpc = Record<string, (args: Record<string, unknown>) => Reply>;

type Row = Record<string, string>;

function fakeClient(options: {
  memberships?: Reply;
  communities?: Reply;
  /** Row-level datasets honour limit, range and in() like PostgREST, unlike a canned reply. */
  membershipRows?: Row[];
  communityRows?: Row[];
  rpc?: Rpc;
}) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const tables: Record<string, Reply> = {
    community_members: options.memberships ?? {
      data: [{ community_id: A }, { community_id: B }],
      error: null
    },
    communities: options.communities ?? {
      data: [
        { id: B, name: 'Beta' },
        { id: A, name: 'Alpha' }
      ],
      error: null
    }
  };
  const datasets: Record<string, Row[] | undefined> = {
    community_members: options.membershipRows,
    communities: options.communityRows
  };
  const rpc: Rpc = {
    count_my_unread_notifications: () => ({ data: 4, error: null }),
    list_match_events: () => ({ data: [], error: null }),
    list_match_event_registration_requests: () => ({ data: [], error: null }),
    list_leagues: () => ({ data: { leagues: [], truncated: false }, error: null }),
    ...options.rpc
  };
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      let window: [number, number] | null = null;
      let ids: string[] | null = null;
      for (const method of ['select', 'eq', 'is', 'lte', 'order']) builder[method] = () => builder;
      builder.limit = (count: number) => {
        window = [0, count - 1];
        return builder;
      };
      builder.range = (from: number, to: number) => {
        window = [from, to];
        return builder;
      };
      builder.in = (_column: string, values: string[]) => {
        ids = values;
        return builder;
      };
      builder.then = (resolve: (value: Reply) => unknown) => {
        const rows = datasets[table];
        if (!rows) return resolve(tables[table]!);
        const matched = ids ? rows.filter((row) => ids!.includes(row.id ?? '')) : rows;
        const [from, to] = window ?? [0, matched.length - 1];
        return resolve({ data: matched.slice(from, to + 1), error: null });
      };
      return builder;
    },
    rpc(name: string, args: Record<string, unknown> = {}) {
      calls.push({ name, args });
      return Promise.resolve((rpc[name] ?? (() => ({ data: null, error: null })))(args));
    }
  };
  // Structural test double of the Supabase client: only the calls Home makes are implemented.
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion
  return { client: client as never, calls };
}

const listBy =
  (byEntry: Record<string, unknown[]>) =>
  (args: Record<string, unknown>): Reply => ({
    data: byEntry[String(args.p_entry)] ?? [],
    error: null
  });

/** Serves one list entry by cursor pages exactly like list_match_events (ascending, keyset). */
const paged =
  (rows: ReturnType<typeof makeMatchRpcListRow>[]) =>
  (args: Record<string, unknown>): Reply => {
    const start = args.p_cursor ? rows.findIndex((row) => row.cursor === args.p_cursor) + 1 : 0;
    return { data: rows.slice(start, start + Number(args.p_limit)), error: null };
  };

const upcomingRow = (index: number, overrides: Partial<ReturnType<typeof makeMatchRpcListRow>>) =>
  makeMatchRpcListRow({
    event_id: `00000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    cursor: `cursor-${String(index).padStart(4, '0')}`,
    starts_at: new Date(Date.UTC(2099, 0, 1, 0, index)).toISOString(),
    is_past: false,
    ...overrides
  });

beforeEach(() => {
  mocks.readRatingHistory.mockReset();
  mocks.readRatingHistory.mockResolvedValue({ status: 'ok', value: { items: [] } });
  mocks.readPlayerRankHistory.mockReset();
  mocks.readPlayerRankHistory.mockResolvedValue({
    status: 'ok',
    value: { transitions: [], leaguePositions: [], truncated: false }
  });
});

describe('readHome', () => {
  it('starts scoped readers without waiting for unrelated rating activity', async () => {
    let finish!: (value: unknown) => void;
    mocks.readRatingHistory.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      })
    );
    const { client, calls } = fakeClient({});
    const pending = readHome(client, USER, { community_id: A });
    await vi.waitFor(() =>
      expect(calls.some(({ name }) => name === 'list_match_events')).toBe(true)
    );
    finish({ status: 'ok', value: { items: [] } });
    expect((await pending).unread).toBe(4);
  });

  it('reports zero memberships as empty and leaves community sections unavailable', async () => {
    const { client, calls } = fakeClient({ memberships: { data: [], error: null } });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.communities).toEqual({ status: 'empty' });
    expect(home.selection).toEqual({ selectedId: null, requestedUnavailable: true });
    expect(home.matches).toEqual({ status: 'unavailable' });
    expect(home.actions).toEqual({ status: 'unavailable' });
    expect(home.ranking).toEqual({ status: 'unavailable' });
    expect(home.activity).toEqual({ status: 'empty' });
    expect(home.unread).toBe(4);
    expect(calls.some(({ name }) => name === 'list_match_events')).toBe(false);
  });

  it('defaults to the first membership and scopes every read to it at one instant', async () => {
    const { client, calls } = fakeClient({});
    const home = await readHome(client, USER, { community_id: null });
    expect(home.selection).toEqual({ selectedId: A, requestedUnavailable: false });
    const scoped = calls.filter(({ name }) => name === 'list_match_events');
    expect(
      scoped.map(({ args }) => args.p_entry).sort((a, b) => String(a).localeCompare(String(b)))
    ).toEqual(['available', 'my', 'past']);
    expect(new Set(scoped.map(({ args }) => args.p_community_id))).toEqual(new Set([A]));
    expect(new Set(scoped.map(({ args }) => args.p_as_of))).toEqual(new Set([home.asOf]));
    expect(mocks.readPlayerRankHistory).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ playerId: USER, communityId: A })
    );
  });

  it('falls back from a revoked selection and never queries the requested community', async () => {
    const { client, calls } = fakeClient({});
    const requested = '00000000-0000-4000-8000-0000000000ff';
    const home = await readHome(client, USER, { community_id: requested });
    expect(home.selection).toEqual({ selectedId: A, requestedUnavailable: true });
    expect(JSON.stringify(calls)).not.toContain(requested);
    expect(JSON.stringify(home)).not.toContain(requested);
  });

  it('picks the nearest upcoming match by instant with a stable id tie-break', async () => {
    const at = '2099-06-01T14:00:00.000Z';
    const rows = [
      makeMatchRpcListRow({ event_id: EVENT_2, starts_at: at, is_past: false }),
      makeMatchRpcListRow({ event_id: EVENT_1, starts_at: at, is_past: false })
    ];
    const { client } = fakeClient({ rpc: { list_match_events: listBy({ my: rows }) } });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.matches).toMatchObject({
      status: 'ok',
      value: { next: { event_id: EVENT_1 }, available: [] }
    });
  });

  it('keeps independent sections when one optional read fails, never faking success', async () => {
    const { client } = fakeClient({
      rpc: {
        list_match_events: (args) =>
          args.p_entry === 'available'
            ? { data: null, error: { message: 'boom' } }
            : { data: [], error: null },
        list_leagues: () => ({ data: null, error: { message: 'boom' } })
      }
    });
    mocks.readRatingHistory.mockResolvedValue({ status: 'error', code: 'unavailable' });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.matches).toEqual({ status: 'error' });
    expect(home.actions).toEqual({ status: 'empty' });
    expect(home.activity).toEqual({ status: 'error' });
    expect(home.ranking).toMatchObject({
      status: 'ok',
      value: { skill: { status: 'empty' }, league: { status: 'error' } }
    });
  });

  it('flags a partial action list when an organizer request read fails', async () => {
    const mine = makeMatchRpcListRow({
      event_id: EVENT_1,
      caller_badge: 'creator',
      starts_at: '2099-01-01T10:00:00.000Z',
      is_past: false
    });
    const { client } = fakeClient({
      rpc: {
        list_match_events: listBy({ my: [mine] }),
        list_match_event_registration_requests: () => ({ data: null, error: { message: 'boom' } })
      }
    });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.actions).toEqual({ status: 'ok', value: { items: [], partial: true } });
  });

  describe('result review action', () => {
    const pastRow = (eventId: string) =>
      makeMatchRpcListRow({
        event_id: eventId,
        caller_badge: 'playing',
        is_past: true,
        status: 'open',
        result_summary: {
          ...makeMatchRpcListRow().result_summary,
          expected_group_count: 1,
          pending_group_count: 1,
          results_roster_frozen: true
        }
      });
    const readWith = async (
      proposals: Record<string, unknown[]>,
      rows = [pastRow(EVENT_1), pastRow(EVENT_2)]
    ) => {
      const { client, calls } = fakeClient({
        rpc: {
          list_match_events: listBy({ past: rows }),
          get_match_event_result_proposals: (args) => ({
            data: proposals[String(args.p_match_event_id)] ?? [],
            error: null
          })
        }
      });
      const home = await readHome(client, USER, { community_id: A });
      return { home, calls };
    };

    it('shows the action only for events where the caller can approve or reject', async () => {
      const { home } = await readWith({
        [EVENT_1]: [{ ...resultProposal, can_approve: true, can_reject: true }],
        [EVENT_2]: [{ ...resultProposal, can_approve: false, can_reject: false }]
      });
      const items = home.actions.status === 'ok' ? home.actions.value.items : [];
      expect(items.map(({ kind, event_id, count }) => [kind, event_id, count])).toEqual([
        ['result_review', EVENT_1, 1]
      ]);
    });

    it('shows no action to a player who cannot review any pending group', async () => {
      const { home } = await readWith({
        [EVENT_1]: [{ ...resultProposal }],
        [EVENT_2]: []
      });
      expect(home.actions).toEqual({ status: 'empty' });
    });

    it('flags a partial list and omits the action when the proposal read fails', async () => {
      const { client } = fakeClient({
        rpc: {
          list_match_events: listBy({ past: [pastRow(EVENT_1)] }),
          get_match_event_result_proposals: () => ({ data: null, error: { message: 'boom' } })
        }
      });
      const home = await readHome(client, USER, { community_id: A });
      expect(home.actions).toEqual({ status: 'ok', value: { items: [], partial: true } });
    });
  });

  it('counts organizer requests on every organized upcoming event, not only the first five', async () => {
    const mine = Array.from({ length: 8 }, (_, index) =>
      upcomingRow(index + 1, { caller_badge: 'creator', status: 'open' })
    );
    const { client, calls } = fakeClient({
      rpc: {
        list_match_events: listBy({ my: mine }),
        list_match_event_registration_requests: () => ({ data: [{}], error: null })
      }
    });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.actions).toMatchObject({ status: 'ok', value: { partial: false } });
    const items = home.actions.status === 'ok' ? home.actions.value.items : [];
    expect(items.map(({ event_id }) => event_id).sort()).toEqual(
      mine.map(({ event_id }) => event_id).sort()
    );
    expect(
      calls.filter(({ name }) => name === 'list_match_event_registration_requests')
    ).toHaveLength(8);
  });

  it('finds the nearest eligible match behind more than 20 earlier cancelled events', async () => {
    const cancelled = Array.from({ length: 30 }, (_, index) =>
      upcomingRow(index + 1, { status: 'cancelled' })
    );
    const valid = upcomingRow(31, { status: 'open' });
    const { client } = fakeClient({
      rpc: {
        list_match_events: (args) =>
          args.p_entry === 'my' ? paged([...cancelled, valid])(args) : { data: [], error: null }
      }
    });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.matches).toMatchObject({
      status: 'ok',
      value: { next: { event_id: valid.event_id } }
    });
  });

  it('pages through full event pages and stops at a bound, never faking an empty answer', async () => {
    const many = Array.from({ length: 260 }, (_, index) =>
      upcomingRow(index + 1, { status: 'cancelled' })
    );
    const { client, calls } = fakeClient({
      rpc: {
        list_match_events: (args) =>
          args.p_entry === 'my' ? paged(many)(args) : { data: [], error: null }
      }
    });
    const home = await readHome(client, USER, { community_id: A });
    const pages = calls.filter(({ args }) => args.p_entry === 'my');
    expect(pages.length).toBeLessThanOrEqual(4);
    expect(
      pages.slice(1).every(({ args }) => typeof args.p_cursor === 'string' && args.p_cursor)
    ).toBe(true);
    expect(home.matches).toEqual({ status: 'error' });
    expect(home.actions).toEqual({ status: 'ok', value: { items: [], partial: true } });
  });

  it('keeps every membership beyond the first page and resolves a deep link to the last one', async () => {
    const rows = Array.from({ length: 120 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      name: `Club ${String(index).padStart(3, '0')}`
    }));
    const last = rows.at(-1)!;
    const { client } = fakeClient({
      membershipRows: rows.map(({ id }) => ({ community_id: id })),
      communityRows: rows
    });
    const home = await readHome(client, USER, { community_id: last.id });
    expect(home.communities.status === 'ok' ? home.communities.value : []).toHaveLength(120);
    expect(home.selection).toEqual({ selectedId: last.id, requestedUnavailable: false });
  });

  it('fails the communities section instead of silently truncating an unbounded membership list', async () => {
    const rows = Array.from({ length: 600 }, (_, index) => ({
      id: `00000000-0000-4000-8000-${String(index + 1000).padStart(12, '0')}`,
      name: `Club ${index}`
    }));
    const { client } = fakeClient({
      membershipRows: rows.map(({ id }) => ({ community_id: id })),
      communityRows: rows
    });
    const home = await readHome(client, USER, { community_id: null });
    expect(home.communities).toEqual({ status: 'error' });
  });

  it('keeps the unread count unknown instead of zero when its read fails', async () => {
    const { client } = fakeClient({
      rpc: { count_my_unread_notifications: () => ({ data: null, error: { message: 'boom' } }) }
    });
    expect((await readHome(client, USER, { community_id: A })).unread).toBeNull();
  });

  it('fails the communities section without inventing a selection', async () => {
    const { client } = fakeClient({ memberships: { data: null, error: { message: 'boom' } } });
    const home = await readHome(client, USER, { community_id: A });
    expect(home.communities).toEqual({ status: 'error' });
    expect(home.selection.selectedId).toBeNull();
    expect(home.matches).toEqual({ status: 'error' });
  });

  it('rejects the whole view when the session is invalid', async () => {
    const { client } = fakeClient({ memberships: { data: null, error: { code: 'PGRST301' } } });
    await expect(readHome(client, USER, { community_id: null })).rejects.toThrow('UNAUTHENTICATED');

    const section = fakeClient({
      rpc: { list_match_events: () => ({ data: null, error: { message: 'JWT expired' } }) }
    });
    await expect(readHome(section.client, USER, { community_id: A })).rejects.toThrow(
      'UNAUTHENTICATED'
    );

    mocks.readRatingHistory.mockResolvedValue({ status: 'error', code: 'unauthenticated' });
    await expect(readHome(fakeClient({}).client, USER, { community_id: A })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
  });
});
