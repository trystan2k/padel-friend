import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import { createRankedResultFixtures } from './helpers/ranked-result-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe.skipIf(!environment.env)('lifecycle event cursor ordering', { timeout: 300_000 }, () => {
  it('pages by proposal stable ID rather than its event ID', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    const connection = await openDedicatedSqlConnection();
    try {
      const event = await kit.event();
      const user = kit.players[0]!.id;
      const stable = '00000000-0000-4000-8000-000000000000';
      await connection.query('begin');
      await connection.query(
        `delete from public.statistics_participant_lifecycle where event_id = ${sqlText(event)} and user_id = ${sqlText(user)}`
      );
      await connection.query(
        `insert into public.statistics_participant_lifecycle(user_id, stable_id, sort_at, event_id, community_id, lifecycle_status, entry_kind, group_number, played_at, viewer_side, match_type) select ${sqlText(user)}::uuid, ${sqlText(stable)}::uuid, starts_at, id, community_id, 'pending', 'group', 1, starts_at, 'team_a', event_type::text from public.match_events where id = ${sqlText(event)}`
      );
      const [eventRow] = (
        await connection.query(
          `select starts_at::text as starts_at from public.match_events where id = ${sqlText(event)}`
        )
      ).rows;
      const at = String(eventRow?.['starts_at']);
      await connection.query('set local role authenticated');
      await connection.query(
        `select set_config('request.jwt.claims', '{"sub":"${user}","role":"authenticated"}', true)`
      );
      const result = await connection.query(
        `select public.list_statistics_history(${sqlText(kit.communityId)}::uuid, null, 'all', null, null, 5, ${sqlText(at)}::timestamptz, ${sqlText(event)}) as page`
      );
      const page = asRecord(result.rows[0]?.['page']);
      expect(page['items']).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ key: 'g:' + stable, event_id: event, status: 'pending' })
        ])
      );
    } finally {
      await connection.query('rollback');
      await connection.close();
      await kit.cleanup();
    }
  });
  it('cannot substitute event IDs for proposal IDs at equal timestamps', async () => {
    const [row] = await sqlRows(`select
      (t, 'ffffffff-ffff-4fff-8fff-ffffffffffff'::uuid) < (t, '88888888-8888-4888-8888-888888888888'::uuid) as event_selected,
      (t, '11111111-1111-4111-8111-111111111111'::uuid) < (t, '88888888-8888-4888-8888-888888888888'::uuid) as proposal_selected
      from (select '2030-01-01T00:00:00Z'::timestamptz as t) sample`);
    expect(row).toMatchObject({ event_selected: false, proposal_selected: true });
  });
});
