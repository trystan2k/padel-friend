import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { validateStatisticsHistoryInput } from '../src/features/statistics/statistics.validators';

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

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
describe.skipIf(!environment.env)(
  'history reader with database fixtures',
  { timeout: 300_000 },
  () => {
    let kit: RankedResultKit;
    let confirmed: string;
    let fixtureEventId: string;
    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!, { levels: [4, 4, 4, 4] });
      fixtureEventId = await kit.event();
      const result = await kit.submit(fixtureEventId, playedAt(900).played);
      if (result.error) throw result.error;
      confirmed = String(asRecord(result.data)['proposal_id']);
      const approval = await kit.approve(confirmed);
      if (approval.error) throw approval.error;
      const pendingEvent = await kit.event();
      const pending = await kit.submit(pendingEvent, playedAt(800).played);
      if (pending.error) throw pending.error;
    });
    afterAll(async () => {
      if (!kit) return;
      const players = kit.players.map((player) => sqlText(player.id)).join(',');
      await fixtureSql(`delete from public.statistics_scope_summaries where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};
      delete from public.statistics_daily_buckets where subject_players && array[${players}]::uuid[] or subject_a = ${sqlText(kit.communityId)};`);
      await kit.cleanup();
    });
    it('reads member history in merge order and repeats a cursor deterministically', async () => {
      const reader = await vi.importActual<
        typeof import('../src/features/statistics/statistics-history.server')
      >('../src/features/statistics/statistics-history.server');
      const input = validateStatisticsHistoryInput({ communityId: kit.communityId, limit: 1 });
      const first = await reader.readStatisticsHistory(kit.players[0]!.client, input);
      expect(first.status).toBe('ok');
      if (first.status !== 'ok' || !first.value.next_cursor)
        throw new Error('Expected first page cursor');
      const next = { ...input, cursor: first.value.next_cursor };
      const one = await reader.readStatisticsHistory(kit.players[0]!.client, next);
      const two = await reader.readStatisticsHistory(kit.players[0]!.client, next);
      expect(one).toEqual(two);
      expect(one.status).toBe('ok');
      if (one.status !== 'ok') throw new Error('Expected second page');
      const items = [...first.value.items, ...one.value.items];
      expect(items.map((item) => item.status).sort()).toEqual(['pending', 'played']);
      expect(items.map((item) => item.sort_at)).toEqual(
        items
          .map((item) => item.sort_at)
          .sort()
          .reverse()
      );
    });
    it('denies outsider confirmed detail without exposing the group', async () => {
      const reader = await vi.importActual<
        typeof import('../src/features/statistics/statistics-history.server')
      >('../src/features/statistics/statistics-history.server');
      const outsider = await kit.actor();
      expect(
        await reader.readStatisticsGroupDetail(outsider.client, {
          eventId: fixtureEventId,
          groupId: confirmed
        })
      ).toEqual({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    });
  }
);
