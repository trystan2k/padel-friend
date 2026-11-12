import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';
import { setRatingProjectionActive } from './helpers/rating-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv();

describe.skipIf(!environment.env)('statistics rating activation replay', () => {
  it('publishes replayed rating evidence and aligned revisions before readers return', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    try {
      await setRatingProjectionActive(false);
      const event = await kit.event();
      const submitted = await kit.submit(event, playedAt(300).played);
      if (submitted.error) throw submitted.error;
      const group = String(asRecord(submitted.data)['proposal_id']);
      const approved = await kit.approve(group);
      if (approved.error) throw approved.error;
      const [before] = await sqlRows(
        'select rating_delta from public.statistics_participant_facts where game_group_id = ' +
          sqlText(group) +
          ' and user_id = ' +
          sqlText(kit.players[0]!.id)
      );
      expect(before?.['rating_delta']).toBeNull();
      const [activation] = await sqlRows(
        'select public.activate_global_rating_projection() as result'
      );
      expect(asRecord(activation?.['result'])['changed']).toBe(true);
      const [evidence] = await sqlRows(
        'select s.rating_revision = r.committed_revision as aligned, p.rating_delta, c.explanation ->> $$applied_delta$$ as expected from public.statistics_projection_control s cross join public.player_rating_projection_control r join public.statistics_participant_facts p on p.game_group_id = ' +
          sqlText(group) +
          ' and p.user_id = ' +
          sqlText(kit.players[0]!.id) +
          ' join public.player_rating_events e on e.game_group_id = p.game_group_id and e.user_id = p.user_id join public.player_rating_event_calculations c on c.rating_event_id = e.id and c.projection_revision = r.committed_revision'
      );
      expect(evidence?.['aligned']).toBe(true);
      expect(Number(evidence?.['rating_delta'])).toBeCloseTo(Number(evidence?.['expected']), 8);
      expect(Number(evidence?.['rating_delta'])).not.toBe(0);
      const [summary] = await sqlRows(
        "select rating_delta_sum, extrema -> 'biggest_gain' ->> 'v' as gain from public.statistics_scope_summaries where subject_kind = 'player' and subject_a = " +
          sqlText(kit.players[0]!.id) +
          " and scope_kind = 'community' and scope_id = " +
          sqlText(kit.communityId) +
          " and match_type = 'all'"
      );
      expect(Number(summary?.['rating_delta_sum'])).toBeCloseTo(Number(evidence?.['expected']), 8);
      expect(Number(summary?.['gain'])).toBeCloseTo(Number(evidence?.['expected']), 8);
      const result = await kit.rpc(kit.players[0]!, 'get_player_statistics', {
        p_player_id: kit.players[0]!.id,
        p_community_id: kit.communityId
      });
      expect(result.error).toBeNull();
      // Confirming an older group forces a replay of the already-published later group.
      const earlierEvent = await kit.event();
      const earlier = await kit.submit(earlierEvent, playedAt(600).played);
      if (earlier.error) throw earlier.error;
      const earlierGroup = String(asRecord(earlier.data)['proposal_id']);
      const earlierApproval = await kit.approve(earlierGroup);
      if (earlierApproval.error) throw earlierApproval.error;
      const [replayed] = await sqlRows(
        'select p.rating_delta, k.rating_revision = r.committed_revision as aligned from public.statistics_participant_facts p cross join public.statistics_projection_control k cross join public.player_rating_projection_control r where p.game_group_id = ' +
          sqlText(group) +
          ' and p.user_id = ' +
          sqlText(kit.players[0]!.id)
      );
      expect(replayed?.['aligned']).toBe(true);
      expect(Number(replayed?.['rating_delta'])).not.toBe(Number(evidence?.['rating_delta']));
      for (const [index, key, operation] of [
        [0, 'biggest_gain', 'max'],
        [2, 'biggest_loss', 'min']
      ] as const) {
        const player = sqlText(kit.players[index]!.id);
        const [extremum] = await sqlRows(
          'select s.extrema -> ' +
            sqlText(key) +
            " ->> 'v' as actual, (select " +
            operation +
            "((c.explanation ->> 'applied_delta')::numeric) from public.rating_current_calculations(" +
            player +
            "::uuid, r.committed_revision) c) as expected from public.statistics_scope_summaries s cross join public.player_rating_projection_control r where s.subject_kind = 'player' and s.subject_a = " +
            player +
            " and s.scope_kind = 'community' and s.scope_id = " +
            sqlText(kit.communityId) +
            " and s.match_type = 'all'"
        );
        expect(Number(extremum?.['actual'])).toBeCloseTo(Number(extremum?.['expected']), 8);
      }
    } finally {
      // Restore first so a mid-suite failure never leaks a dormant projector to later suites.
      await setRatingProjectionActive(true);
      await fixtureSql('select public.activate_global_rating_projection()');
      const players = kit.players.map((player) => sqlText(player.id)).join(',');
      await fixtureSql(
        'delete from public.statistics_scope_summaries where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          sqlText(kit.communityId) +
          '; delete from public.statistics_daily_buckets where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          sqlText(kit.communityId)
      );
      await kit.cleanup();
    }
  }, 300000);
});
