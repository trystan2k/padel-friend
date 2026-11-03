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
      for (let i = 0; i < 2; i += 1) viewerEvents.push(await kit.event());
      // Started events show as awaiting a result; the unrelated clones are all newer.
      await fixtureSql(`alter table public.match_events disable trigger match_event_immutable;
        update public.match_events set starts_at = now() - interval '2 days', registration_cutoff_at = now() - interval '3 days' where id = ${sqlText(viewerEvents[0]!)};
        update public.match_events set starts_at = now() - interval '4 days', registration_cutoff_at = now() - interval '5 days' where id = ${sqlText(viewerEvents[1]!)};
        alter table public.match_events enable trigger match_event_immutable;`);
      // Unrelated events: clones of a viewer event without registrations, all newer than the viewer's.
      await fixtureSql(`alter table public.match_events disable trigger user;
      insert into public.match_events
      select r.* from jsonb_populate_recordset(null::public.match_events, (
        select pg_catalog.jsonb_agg(pg_catalog.jsonb_set(pg_catalog.jsonb_set(pg_catalog.to_jsonb(e), '{id}',
            pg_catalog.to_jsonb(gen_random_uuid())), '{starts_at}', pg_catalog.to_jsonb(e.starts_at + g * interval '1 minute')))
          from public.match_events e cross join generate_series(1, ${UNRELATED_EVENTS}) g
         where e.id = ${sqlText(viewerEvents[0]!)})) r;
      alter table public.match_events enable trigger user;
      analyze public.match_events; analyze public.match_event_registrations;`);
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

    it('reads history pages without scanning unrelated community events', async () => {
      const [count] = await sqlRows(
        `select count(*)::int as n from public.match_events where community_id = ${sqlText(kit.communityId)}`
      );
      expect(Number(count?.['n'])).toBeGreaterThanOrEqual(UNRELATED_EVENTS);
      const connection = await openDedicatedSqlConnection();
      try {
        await connection.query('begin');
        await connection.query('set local role authenticated');
        await connection.query(
          `select set_config('request.jwt.claims', '{"sub":"${kit.players[0]!.id}","role":"authenticated"}', true)`
        );
        const page = await connection.query(
          `select public.list_statistics_history(${sqlText(kit.communityId)}::uuid, null, 'all', null, null, 1) as page`
        );
        const first = asRecord(page.rows[0]?.['page']);
        expect(Array.isArray(first['items']) ? first['items'].length : -1).toBe(1);
        const cursor = asRecord(first['next_cursor']);
        const next = await connection.query(
          `select public.list_statistics_history(${sqlText(kit.communityId)}::uuid, null, 'all', null, null, 1, ${sqlText(String(cursor['at']))}::timestamptz, ${sqlText(String(cursor['key']))}) as page`
        );
        expect(asRecord(next.rows[0]?.['page'])['items']).toHaveLength(1);
        const [usage] = (
          await connection.query(
            `select seq_scan, idx_tup_fetch from pg_stat_xact_user_tables where relname = 'match_events'`
          )
        ).rows;
        // Registration-driven: no sequential pass, and index fetches stay near the viewer's own events
        // (two pages) instead of growing with the unrelated community history.
        expect(Number(usage?.['seq_scan'])).toBe(0);
        expect(Number(usage?.['idx_tup_fetch'])).toBeLessThan(50);
      } finally {
        await connection.query('rollback');
        await connection.close();
      }
    });
  }
);
