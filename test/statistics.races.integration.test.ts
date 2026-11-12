import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';
import { setResultReviewDeadlineOffset } from './helpers/match-result-processing-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { openDedicatedSqlConnection, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();

describe.skipIf(!environment.env)('statistics concurrent publication', () => {
  it('serializes a finalizer against rebuild, retries idempotently, and rolls back failed publication', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    const community = sqlText(kit.communityId);
    const players = kit.players.map((player) => sqlText(player.id)).join(',');
    const writer = await openDedicatedSqlConnection();
    const rebuilder = await openDedicatedSqlConnection();
    try {
      const proposal = async () => {
        const event = await kit.event(null, 'friendly');
        const result = await kit.submit(event, playedAt(300).played);
        if (result.error) throw result.error;
        const id = String(asRecord(result.data)['proposal_id']);
        await setResultReviewDeadlineOffset(id, 1, -1);
        return id;
      };
      const first = await proposal();
      const finalize = (id: string) =>
        'select public.finalize_match_event_result_locked(' +
        sqlText(id) +
        "::uuid, 1, 'AUTO_48H', null)::text as id";
      const snapshot = async () =>
        sqlRows(
          'select k.revision, k.rating_revision = r.committed_revision as aligned, (select count(*)::integer from public.statistics_group_facts where community_id = ' +
            community +
            ') as facts, (select count(*)::integer from public.match_event_result_confirmations where match_event_id in (select id from public.match_events where community_id = ' +
            community +
            ')) as confirmations from public.statistics_projection_control k cross join public.player_rating_projection_control r'
        );
      await writer.query('begin');
      await writer.query(
        'select id from public.communities where id = ' + community + '::uuid for update'
      );
      const pendingRebuild = rebuilder.query(
        'select public.rebuild_statistics(' + community + '::uuid)'
      );
      let blocked = false;
      for (let attempt = 0; attempt < 100 && !blocked; attempt += 1) {
        const observed = await queryTrustedSql(
          'select $1::integer = any(pg_catalog.pg_blocking_pids($2::integer)) as blocked',
          { values: [writer.backendPid, rebuilder.backendPid] }
        );
        blocked = observed.rows[0]?.['blocked'] === true;
      }
      expect(blocked).toBe(true);
      const result = await writer.query(finalize(first));
      expect(result.rows[0]?.['id']).toBeTruthy();
      await writer.query('commit');
      await pendingRebuild;
      const after = await snapshot();
      expect(after).toMatchObject([{ aligned: true, facts: 1, confirmations: 1 }]);
      await writer.query(finalize(first));
      expect(await snapshot()).toEqual(after);
      const second = await proposal();
      const beforeFailure = await snapshot();
      await writer.query('begin');
      await writer.query(
        'do $$ begin perform public.finalize_match_event_result_locked(' +
          sqlText(second) +
          "::uuid, 1, 'AUTO_48H', null); perform 1 / 0; exception when division_by_zero then null; end $$"
      );
      await writer.query('commit');
      expect(await snapshot()).toEqual(beforeFailure);
      const [source] = await sqlRows(
        'select status::text as status from public.match_event_result_proposals where id = ' +
          sqlText(second)
      );
      expect(source?.['status']).toBe('pending');
      const third = await proposal();
      const beforePublishFailure = await snapshot();
      const sourceRows = () =>
        sqlRows(
          'select to_jsonb(v) as source from public.match_event_result_proposal_versions v where proposal_id = ' +
            sqlText(third) +
            ' order by version'
        );
      const sourceBefore = await sourceRows();
      const summaries = () =>
        sqlRows(
          "select coalesce(md5(string_agg((to_jsonb(s) - 'updated_at')::text, '|' order by (to_jsonb(s) - 'updated_at')::text)), '') as digest from public.statistics_scope_summaries s where subject_players && array[" +
            players +
            ']::uuid[] or subject_a = ' +
            community
        );
      const summariesBefore = await summaries();
      await writer.query('begin');
      await writer.query(
        "create function pg_temp.fail_statistics_write() returns trigger language plpgsql as $$ begin raise exception 'TEST_STATISTICS_MID_PUBLISH'; end $$"
      );
      await writer.query(
        'create trigger test_statistics_mid_publish before insert or update on public.statistics_scope_summaries for each row execute function pg_temp.fail_statistics_write()'
      );
      await writer.query(
        'do $$ begin perform public.finalize_match_event_result_locked(' +
          sqlText(third) +
          "::uuid, 1, 'AUTO_48H', null); raise exception 'Expected test trigger'; exception when raise_exception then if sqlerrm <> 'TEST_STATISTICS_MID_PUBLISH' then raise; end if; end $$"
      );
      await writer.query(
        'drop trigger test_statistics_mid_publish on public.statistics_scope_summaries'
      );
      await writer.query('commit');
      expect(await snapshot()).toEqual(beforePublishFailure);
      expect(await sourceRows()).toEqual(sourceBefore);
      expect(await summaries()).toEqual(summariesBefore);
      const [thirdStatus] = await sqlRows(
        'select status::text as status from public.match_event_result_proposals where id = ' +
          sqlText(third)
      );
      expect(thirdStatus?.['status']).toBe('pending');
    } finally {
      await writer.close();
      await rebuilder.close();
      await fixtureSql(
        'delete from public.statistics_scope_summaries where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          community +
          '; delete from public.statistics_daily_buckets where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          community +
          ';'
      );
      await kit.cleanup();
    }
  }, 300000);
});
