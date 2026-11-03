import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  player: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  partners: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  opponents: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  pair: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  head: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  community: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('../src/features/statistics/statistics-player.functions', () => ({
  getPlayerStatistics: mocks.player
}));
vi.mock('../src/features/statistics/statistics-relationships.functions', () => ({
  getPartnerRecords: mocks.partners,
  getOpponentRecords: mocks.opponents,
  getPairStatistics: mocks.pair,
  getOpponentStatistics: mocks.head
}));
vi.mock('../src/features/statistics/statistics-community.functions', () => ({
  getCommunityStatistics: mocks.community
}));
import { Route as PlayerRoute } from '../src/routes/_protected.players.$playerId.index';
import { Route as PairRoute } from '../src/routes/_protected.players.$playerId.partners.$partnerId';
import { Route as OpponentRoute } from '../src/routes/_protected.players.$playerId.opponents.$opponentId';
import { Route as CommunityRoute } from '../src/routes/_protected.community.$communityId.statistics';

const player = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const community = '33333333-3333-4333-8333-333333333333';
const league = '44444444-4444-4444-8444-444444444444';

type Loader = (context: {
  params: Record<string, string>;
  deps: Record<string, string>;
  context: { locale: string };
}) => Promise<unknown>;
function loaderOf(route: unknown): Loader {
  const options =
    typeof route === 'object' && route !== null ? Reflect.get(route, 'options') : null;
  const loader =
    typeof options === 'object' && options !== null ? Reflect.get(options, 'loader') : null;
  if (typeof loader !== 'function') throw new Error('Missing route loader');
  return (context) => loader(context);
}
const ctx = { locale: 'pt-BR' };
const ok = { status: 'ok', value: {} };

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

describe('player statistics route', () => {
  const load = (params: Record<string, string>, deps: Record<string, string> = {}) =>
    loaderOf(PlayerRoute)({ params, deps, context: ctx });

  it('rejects a malformed player id before any read', async () => {
    await expect(load({ playerId: 'nope' })).rejects.toMatchObject({ isNotFound: true });
    expect(mocks.player).not.toHaveBeenCalled();
  });

  it('turns invalid filters into a typed error without reading', async () => {
    const result = await load({ playerId: player }, { from: '2026-10-05', through: '2026-09-01' });
    expect(result).toMatchObject({
      result: { status: 'error', code: 'INVALID_STATISTICS_INPUT' },
      locale: 'pt-BR'
    });
    expect(mocks.player).not.toHaveBeenCalled();
  });

  it('passes the URL filters through to every reader and keeps the locale', async () => {
    mocks.player.mockResolvedValue(ok);
    mocks.partners.mockResolvedValue(ok);
    mocks.opponents.mockResolvedValue(ok);
    const deps = { communityId: community, type: 'competitive' };
    const result = await load({ playerId: player }, deps);
    expect(result).toMatchObject({ result: ok, partners: ok, opponents: ok, locale: 'pt-BR' });
    for (const mock of [mocks.player, mocks.partners, mocks.opponents])
      expect(mock).toHaveBeenCalledWith({ data: { playerId: player, ...deps } });
  });

  it('adds the League choices of the selected community for the filter bar', async () => {
    mocks.player.mockResolvedValue(ok);
    mocks.partners.mockResolvedValue(ok);
    mocks.opponents.mockResolvedValue(ok);
    const leagues = [{ id: league, name: 'Spring', status: 'active' }];
    mocks.community.mockResolvedValue({
      status: 'ok',
      value: { leagues, activeLeagueId: league }
    });
    const result = await load({ playerId: player }, { communityId: community });
    expect(result).toMatchObject({ options: { leagues, activeLeagueId: league } });
    expect(mocks.community).toHaveBeenCalledWith({ data: { communityId: community } });
  });

  it('keeps the filter bar usable without Leagues when no community is selected or its read fails', async () => {
    mocks.player.mockResolvedValue(ok);
    mocks.partners.mockResolvedValue(ok);
    mocks.opponents.mockResolvedValue(ok);
    const none = { options: { leagues: [], activeLeagueId: null } };
    expect(await load({ playerId: player })).toMatchObject(none);
    expect(mocks.community).not.toHaveBeenCalled();
    mocks.community.mockRejectedValue(new Error('offline'));
    expect(await load({ playerId: player }, { communityId: community })).toMatchObject(none);
    mocks.community.mockResolvedValue({ status: 'error', code: 'STATISTICS_UNAVAILABLE' });
    expect(await load({ playerId: player }, { communityId: community })).toMatchObject(none);
  });

  it('a failing record list never hides the player statistics', async () => {
    mocks.player.mockResolvedValue(ok);
    mocks.partners.mockRejectedValue(new Error('offline'));
    mocks.opponents.mockResolvedValue(ok);
    expect(await load({ playerId: player })).toMatchObject({
      result: ok,
      partners: { status: 'error', code: 'STATISTICS_UNAVAILABLE' },
      opponents: ok
    });
  });

  it('a missing or inaccessible player is not found', async () => {
    mocks.player.mockResolvedValue({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    mocks.partners.mockResolvedValue(ok);
    mocks.opponents.mockResolvedValue(ok);
    await expect(load({ playerId: player })).rejects.toMatchObject({ isNotFound: true });
  });
});

describe.each([
  ['partner pair', PairRoute, mocks.pair, { playerId: player, partnerId: other }],
  ['opponent head-to-head', OpponentRoute, mocks.head, { playerId: player, opponentId: other }]
] as const)('%s route', (_name, route, reader, params) => {
  const load = (p: Record<string, string>, deps: Record<string, string> = {}) =>
    loaderOf(route)({ params: p, deps, context: ctx });

  it('reads the oriented relationship with the URL filters', async () => {
    reader.mockResolvedValue(ok);
    const deps = { leagueId: league, communityId: community };
    expect(await load(params, deps)).toMatchObject({ result: ok, locale: 'pt-BR' });
    expect(reader).toHaveBeenCalledWith({ data: { playerId: player, otherId: other, ...deps } });
  });

  it('rejects malformed ids and filters with a typed error, no read', async () => {
    const [first, second] = Object.keys(params);
    const bad = { ...params, [second!]: 'nope' };
    expect(await load(bad)).toMatchObject({
      result: { status: 'error', code: 'INVALID_STATISTICS_INPUT' }
    });
    expect(await load(params, { from: '2026-10-05', through: '2026-09-01' })).toMatchObject({
      result: { status: 'error', code: 'INVALID_STATISTICS_INPUT' }
    });
    expect(first).toBe('playerId');
    expect(reader).not.toHaveBeenCalled();
  });

  it('maps denial to not found and transport failure to a retryable error', async () => {
    reader.mockResolvedValueOnce({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    await expect(load(params)).rejects.toMatchObject({ isNotFound: true });
    reader.mockRejectedValueOnce(new Error('offline'));
    expect(await load(params)).toMatchObject({
      result: { status: 'error', code: 'STATISTICS_UNAVAILABLE' }
    });
  });
});

describe('community statistics route', () => {
  const load = (deps: Record<string, string> = {}, communityId = community) =>
    loaderOf(CommunityRoute)({ params: { communityId }, deps, context: ctx });

  it('keeps the community in the path and the League, type and dates in the URL', async () => {
    mocks.community.mockResolvedValue(ok);
    const deps = { leagueId: league, type: 'friendly', from: '2026-09-15' };
    expect(await load(deps)).toMatchObject({ result: ok, locale: 'pt-BR' });
    expect(mocks.community).toHaveBeenCalledWith({
      data: expect.objectContaining({ communityId: community, leagueId: league, type: 'friendly' })
    });
  });

  it('never lets a search param override the path community', async () => {
    mocks.community.mockResolvedValue(ok);
    await load({ communityId: other });
    expect(mocks.community).toHaveBeenCalledWith({
      data: expect.objectContaining({ communityId: community })
    });
  });

  it('types invalid scope, maps denial to not found and failures to unavailable', async () => {
    expect(await load({}, 'nope')).toMatchObject({
      result: { status: 'error', code: 'INVALID_STATISTICS_INPUT' }
    });
    expect(await load({ from: '2026-10-05', through: '2026-09-01' })).toMatchObject({
      result: { status: 'error', code: 'INVALID_STATISTICS_INPUT' }
    });
    expect(mocks.community).not.toHaveBeenCalled();
    mocks.community.mockResolvedValueOnce({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    await expect(load()).rejects.toMatchObject({ isNotFound: true });
    mocks.community.mockRejectedValueOnce(new Error('offline'));
    expect(await load()).toMatchObject({
      result: { status: 'error', code: 'STATISTICS_UNAVAILABLE' }
    });
  });
});
