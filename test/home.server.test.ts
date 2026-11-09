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

const USER = '00000000-0000-4000-8000-0000000000a1';
const A = '00000000-0000-4000-8000-00000000000a';
const B = '00000000-0000-4000-8000-00000000000b';
const EVENT_1 = '00000000-0000-4000-8000-0000000000e1';
const EVENT_2 = '00000000-0000-4000-8000-0000000000e2';

type Reply = { data: unknown; error: { code?: string; message?: string } | null };
type Rpc = Record<string, (args: Record<string, unknown>) => Reply>;

function fakeClient(options: { memberships?: Reply; communities?: Reply; rpc?: Rpc }) {
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
      for (const method of ['select', 'eq', 'is', 'lte', 'limit', 'in'])
        builder[method] = () => builder;
      builder.then = (resolve: (value: Reply) => unknown) => resolve(tables[table]!);
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
