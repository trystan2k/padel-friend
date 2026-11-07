import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { sqlText } from './helpers/provisional-player-fixtures';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const UNRELATED_EVENTS = 300;

/**
 * The history lifecycle source is bounded by the viewer's own registrations: a viewer with two
 * registrations pages through a community holding hundreds of newer unrelated events without any
 * scan of the events table.
 */
describe.skipIf(!environment.env)(
  'Statistics history bounded lifecycle',
  { timeout: 300_000 },
  () => {
    let kit: RankedResultKit;
    const viewerEvents: string[] = [];

    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!);
      // Readers fail retryably while statistics lag the committed rating revision. Earlier suites in the shared
      // database may leave that lag; publishing realigns the baseline (and waits out any in-flight publisher).
      await fixtureSql('select public.statistics_publish();');
      for (let i = 0; i < 50; i += 1) viewerEvents.push(await kit.event());
      // Distinct past instants let the cursor walk many pages of the viewer's own history.
      await fixtureSql(`alter table public.match_events disable trigger match_event_immutable;
        ${viewerEvents.map((id, i) => `update public.match_events set starts_at = now() - interval '2 days' - interval '${i} minutes', registration_cutoff_at = now() - interval '3 days' where id = ${sqlText(id)};`).join('\n')}
        alter table public.match_events enable trigger match_event_immutable;`);
      // Unrelated events: clones of a viewer event without registrations, all newer than the viewer's.
      // Each clone gets its own trigger-valid photo key and storage object; only the registration and
      // notification side effects are skipped. Lifecycle projection triggers stay active.
      await fixtureSql(`create temp table unrelated_clones as
        select pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.to_jsonb(e), '{id}', pg_catalog.to_jsonb(c.id)),
            '{starts_at}', pg_catalog.to_jsonb(e.starts_at + g * interval '1 minute')),
            '{photo_path}', pg_catalog.to_jsonb(e.community_id || '/' || c.id || '/' || e.created_by || '/' || gen_random_uuid() || '.webp')) as row_data,
          e.created_by
        from public.match_events e cross join (select gen_random_uuid() as id, g from generate_series(1, ${UNRELATED_EVENTS}) g) c
        where e.id = ${sqlText(viewerEvents[0]!)};
      insert into storage.objects (bucket_id, name, owner_id, metadata)
        select 'match-event-photos', row_data->>'photo_path', created_by::text, '{"size":"1024","mimetype":"image/webp"}'::jsonb from unrelated_clones;
      alter table public.match_events disable trigger match_event_creator_registration;
      alter table public.match_events disable trigger match_event_published_notification;
      insert into public.match_events
      select r.* from jsonb_populate_recordset(null::public.match_events, (select pg_catalog.jsonb_agg(row_data) from unrelated_clones)) r;
      alter table public.match_events enable trigger match_event_creator_registration;
      alter table public.match_events enable trigger match_event_published_notification;
      drop table unrelated_clones;
      -- The lifecycle projection is filled by triggers; without fresh statistics the planner may pick a
      -- seq scan on it (autovacuum analyze timing), which is a planner-choice flake, not a bound violation.
      analyze public.match_events; analyze public.match_event_registrations; analyze public.statistics_participant_lifecycle;`);
    });
    afterAll(async () => {
      if (!kit) return;
      await fixtureSql(
        `alter table public.match_events disable trigger match_event_immutable;
        delete from public.match_events where community_id = ${sqlText(kit.communityId)} and id <> all(array[${viewerEvents.map(sqlText).join(',')}]::uuid[]);
        alter table public.match_events enable trigger match_event_immutable;`
      );
      await kit.cleanup();
    });

    it('walks deep pages with bounded per-page projection reads', async () => {
      const [count] = await sqlRows(
        `select count(*)::int as n from public.match_events where community_id = ${sqlText(kit.communityId)}`
      );
      expect(Number(count?.['n'])).toBeGreaterThanOrEqual(UNRELATED_EVENTS + 50);
      const connection = await openDedicatedSqlConnection();
      try {
        await connection.query('begin');
        await connection.query('set local role authenticated');
        await connection.query(
          `select set_config('request.jwt.claims', '{"sub":"${kit.players[0]!.id}","role":"authenticated"}', true)`
        );
        let cursor: Record<string, unknown> | null = null;
        let previousFetches = 0;
        for (let pageNumber = 0; pageNumber < 4; pageNumber += 1) {
          const position = cursor
            ? `, ${sqlText(String(cursor['at']))}::timestamptz, ${sqlText(String(cursor['key']))}`
            : '';
          const result = await connection.query(
            `select public.list_statistics_history(${sqlText(kit.communityId)}::uuid, null, 'all', null, null, 5${position}) as page`
          );
          const page = asRecord(result.rows[0]?.['page']);
          expect(page['items']).toHaveLength(5);
          cursor = asRecord(page['next_cursor']);
          const [usage] = (
            await connection.query(
              `select seq_scan, idx_tup_fetch from pg_stat_xact_user_tables where relname = 'statistics_participant_lifecycle'`
            )
          ).rows;
          expect(Number(usage?.['seq_scan'])).toBe(0);
          const fetches = Number(usage?.['idx_tup_fetch']);
          expect(fetches - previousFetches).toBeLessThan(100);
          previousFetches = fetches;
        }
      } finally {
        // Closing the session discards the read-only transaction. An explicit rollback would fail with
        // 25P02 after any in-loop SQL error (the transport issues a SET first), masking that error.
        await connection.close();
      }
    });
  }
);
