import { beforeEach, describe, expect, it, vi } from 'vitest';
import { FOCAL, OTHER } from './helpers/relationship-statistics-fixtures';

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  pair: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  opponent: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  partners: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  opponents: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => ({
    validator: (validate: (value: unknown) => unknown) => ({
      handler:
        (handle: (input: { data: unknown }) => Promise<unknown>) => (input: { data: unknown }) =>
          handle({ data: validate(input.data) })
    })
  })
}));
vi.mock('../src/features/auth/auth.server', () => ({ requireAuthenticatedClient: mocks.auth }));
vi.mock('../src/features/statistics/statistics-relationships.server', () => ({
  readPairStatistics: mocks.pair,
  readOpponentStatistics: mocks.opponent,
  readPartnerRecords: mocks.partners,
  readOpponentRecords: mocks.opponents
}));
import {
  getOpponentRecords,
  getOpponentStatistics,
  getPairStatistics,
  getPartnerRecords
} from '../src/features/statistics/statistics-relationships.functions';

beforeEach(() => {
  for (const mock of Object.values(mocks)) mock.mockReset();
});

const relationship = [
  ['pair', getPairStatistics, mocks.pair],
  ['opponent', getOpponentStatistics, mocks.opponent]
] as const;
const lists = [
  ['partners', getPartnerRecords, mocks.partners],
  ['opponents', getOpponentRecords, mocks.opponents]
] as const;

describe.each(relationship)('%s server boundary', (_name, serverFn, reader) => {
  it('rejects unauthenticated requests before reading', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(serverFn({ data: { playerId: FOCAL, otherId: OTHER } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(reader).not.toHaveBeenCalled();
  });
  it('returns typed invalid input for a self pair without reading', async () => {
    mocks.auth.mockResolvedValueOnce({ client: {} });
    await expect(serverFn({ data: { playerId: FOCAL, otherId: FOCAL } })).resolves.toEqual({
      status: 'error',
      code: 'INVALID_STATISTICS_INPUT'
    });
    expect(reader).not.toHaveBeenCalled();
  });
  it('passes validated filters and the request-local client to the reader', async () => {
    const client = {};
    mocks.auth.mockResolvedValueOnce({ client });
    reader.mockResolvedValueOnce({ status: 'ok', value: {} });
    await serverFn({
      data: { playerId: FOCAL, otherId: OTHER, communityId: OTHER, type: 'friendly' }
    });
    expect(reader).toHaveBeenCalledWith(client, {
      playerId: FOCAL,
      otherId: OTHER,
      filters: { communityId: OTHER, leagueId: null, type: 'friendly', from: null, through: null }
    });
  });
  it('returns outsider denial rather than an empty result', async () => {
    mocks.auth.mockResolvedValueOnce({ client: {} });
    reader.mockResolvedValueOnce({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    await expect(serverFn({ data: { playerId: FOCAL, otherId: OTHER } })).resolves.toEqual({
      status: 'error',
      code: 'STATISTICS_NOT_FOUND'
    });
  });
});

describe.each(lists)('%s records server boundary', (_name, serverFn, reader) => {
  it('rejects unauthenticated requests before reading', async () => {
    mocks.auth.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(serverFn({ data: { playerId: FOCAL } })).rejects.toThrow('UNAUTHENTICATED');
    expect(reader).not.toHaveBeenCalled();
  });
  it('returns typed invalid input for a bad offset without reading', async () => {
    mocks.auth.mockResolvedValueOnce({ client: {} });
    await expect(serverFn({ data: { playerId: FOCAL, offset: -3 } })).resolves.toEqual({
      status: 'error',
      code: 'INVALID_STATISTICS_INPUT'
    });
    expect(reader).not.toHaveBeenCalled();
  });
  it('clamps the page size and passes the client through', async () => {
    const client = {};
    mocks.auth.mockResolvedValueOnce({ client });
    reader.mockResolvedValueOnce({ status: 'ok', value: {} });
    await serverFn({ data: { playerId: FOCAL, limit: 9999 } });
    expect(reader).toHaveBeenCalledWith(client, {
      playerId: FOCAL,
      filters: { communityId: null, leagueId: null, type: 'all', from: null, through: null },
      limit: 100,
      offset: 0
    });
  });
});
