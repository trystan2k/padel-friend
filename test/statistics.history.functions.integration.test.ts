import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  readStatisticsGroupDetail,
  readStatisticsHistory
} from '../src/features/statistics/statistics-history.server';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { validateStatisticsHistoryInput } from '../src/features/statistics/statistics.validators';

const environment = localSupabaseEnv();
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
      const input = validateStatisticsHistoryInput({ communityId: kit.communityId, limit: 1 });
      const first = await readStatisticsHistory(kit.players[0]!.client, input);
      expect(first.status).toBe('ok');
      if (first.status !== 'ok' || !first.value.next_cursor)
        throw new Error('Expected first page cursor');
      const next = { ...input, cursor: first.value.next_cursor };
      const one = await readStatisticsHistory(kit.players[0]!.client, next);
      const two = await readStatisticsHistory(kit.players[0]!.client, next);
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
      const outsider = await kit.actor();
      expect(
        await readStatisticsGroupDetail(outsider.client, {
          eventId: fixtureEventId,
          groupId: confirmed
        })
      ).toEqual({ status: 'error', code: 'STATISTICS_NOT_FOUND' });
    });
  }
);
