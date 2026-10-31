import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { createMatchManagementFixtures } from './helpers/match-management-fixtures';
import { sqlRows } from './helpers/match-registration-sql';
import { queryTrustedSql } from './helpers/sql-transport';
import {
  confirmAuto,
  ledgerOf,
  nextTailPlayedAt,
  ratingProjectionControl,
  setEventType,
  submitPendingGroup,
  toQuartet
} from './helpers/rating-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

describe('rating evidence fixture teardown', { timeout: 120_000 }, () => {
  it.skipIf(!environment.env)(
    'removes projected events, every calculation revision and initialization audit, then restores the immutability guards',
    async () => {
      const f = await createMatchManagementFixtures(environment.env!);
      let cleaned = false;
      try {
        const players = await Promise.all(Array.from({ length: 4 }, () => f.member()));
        for (const [index, player] of players.entries()) {
          const onboarded = await player.client.rpc('onboard_player', {
            p_display_name: `Teardown ${index}`,
            p_preferred_side: 'EITHER',
            p_initial_level: [3, 4, 5, 3.5][index]!
          });
          expect(onboarded.error).toBeNull();
        }
        const ids = toQuartet(players.map((player) => player.id));
        const base = Date.parse(await nextTailPlayedAt());
        const newer = await submitPendingGroup({
          eventId: (await f.event()).id,
          players: ids,
          playedAt: new Date(base + 3_600_000).toISOString(),
          submittedBy: f.creator.id
        });
        const older = await submitPendingGroup({
          eventId: (await f.event()).id,
          players: [ids[0], ids[2], ids[1], ids[3]],
          playedAt: new Date(base).toISOString(),
          submittedBy: f.creator.id,
          classification: 'team_b'
        });
        for (const group of [newer, older]) await setEventType(group.eventId, 'competitive');
        const before = await ratingProjectionControl();
        // Newest first, then the older one: the late insertion appends calculation revisions.
        await confirmAuto(newer);
        await confirmAuto(older);
        const ledger = await ledgerOf([newer.proposalId, older.proposalId]);
        expect(ledger).toHaveLength(8);
        expect(ledger.some((entry) => entry.calculations.length > 1)).toBe(true);
        expect(Number((await ratingProjectionControl())['revision'])).toBeGreaterThan(
          Number(before['revision'])
        );

        await f.cleanup();
        cleaned = true;

        const residue = (
          await queryTrustedSql(
            `select (select count(*)::int from public.player_rating_events where user_id = any($1::uuid[])) as events,
                    (select count(*)::int from public.player_rating_event_calculations c
                      where c.rating_event_id not in (select id from public.player_rating_events)) as orphans,
                    (select count(*)::int from public.player_rating_initializations where user_id = any($1::uuid[])) as inits,
                    (select count(*)::int from public.global_player_ratings where user_id = any($1::uuid[])) as ratings`,
            { values: [ids] }
          )
        ).rows[0];
        expect(residue).toEqual({ events: 0, orphans: 0, inits: 0, ratings: 0 });
        const guards = await sqlRows(
          `select tgname, tgenabled from pg_catalog.pg_trigger
            where tgname in ('player_rating_events_immutable', 'player_rating_calculations_immutable',
                             'player_rating_initializations_immutable')
            order by tgname`
        );
        expect(guards).toEqual([
          { tgname: 'player_rating_calculations_immutable', tgenabled: 'O' },
          { tgname: 'player_rating_events_immutable', tgenabled: 'O' },
          { tgname: 'player_rating_initializations_immutable', tgenabled: 'O' }
        ]);
        // The single projection control row survives teardown.
        const control = await ratingProjectionControl();
        expect(control['activation_enabled']).toBe(true);
      } finally {
        if (!cleaned) await f.cleanup();
      }
    }
  );
});
