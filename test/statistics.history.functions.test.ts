import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  authenticate: vi.fn<() => Promise<unknown>>(),
  history: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  detail: vi.fn<(...args: unknown[]) => Promise<unknown>>()
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
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.authenticate
}));
vi.mock('../src/features/statistics/statistics-history.server', () => ({
  readStatisticsHistory: mocks.history,
  readStatisticsGroupDetail: mocks.detail
}));
import {
  getStatisticsHistory,
  getStatisticsGroupDetail
} from '../src/features/statistics/statistics-history.functions';

const eventId = '11111111-1111-4111-8111-111111111111';
const groupId = '22222222-2222-4222-8222-222222222222';
beforeEach(() => {
  mocks.authenticate.mockReset();
  mocks.history.mockReset();
  mocks.detail.mockReset();
});
describe('statistics server-function boundary', () => {
  it('rejects unauthenticated requests rather than returning empty history', async () => {
    mocks.authenticate.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(getStatisticsHistory({ data: {} })).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.history).not.toHaveBeenCalled();
  });
  it.each([
    [0, 20],
    [-5, 20],
    [101, 100]
  ])('normalizes limit %i to %i', async (limit, expected) => {
    const client = {};
    mocks.authenticate.mockResolvedValue({ client });
    mocks.history.mockResolvedValue({ status: 'ok', value: { items: [] } });
    await getStatisticsHistory({ data: { limit } });
    expect(mocks.history).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ limit: expected })
    );
  });
  it('preserves a denied detail response rather than returning empty data', async () => {
    const client = {};
    mocks.authenticate.mockResolvedValue({ client });
    mocks.detail.mockResolvedValue({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    await expect(getStatisticsGroupDetail({ data: { eventId, groupId } })).resolves.toEqual({
      status: 'error',
      code: 'STATISTICS_NOT_FOUND'
    });
    expect(mocks.detail).toHaveBeenCalledWith(client, { eventId, groupId });
  });
});
