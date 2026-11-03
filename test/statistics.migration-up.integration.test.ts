import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';
import { GOLDEN_SCORES } from './helpers/statistics-golden-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

// db:reset exercises the fresh migration chain. Since it cannot pause before statistics migrations,
// this proves current-schema backfill equivalence, not an in-place per-migration upgrade.
describe.skipIf(!environment.env)('statistics backfill equivalence', () => {
  it('replays the official resolver over mixed confirmed history and restores removed projections', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    const community = sqlText(kit.communityId);
    const players = kit.players.map((player) => sqlText(player.id)).join(',');
    try {
      const ids: string[] = [];
      for (const [index, score] of GOLDEN_SCORES.entries()) {
        const event = await kit.event(null, score.type);
        const submitted = await kit.submit(event, playedAt(1000 - index * 100).played, {
          sets: score.sets
        });
        if (submitted.error) throw submitted.error;
        const id = String(asRecord(submitted.data)['proposal_id']);
        const approved = await kit.approve(id);
        if (approved.error) throw approved.error;
        ids.push(id);
      }
      const idList = ids.map(sqlText).join(',');
      const source = async () =>
        sqlRows(
          'select game_group_id::text, confirmation_id::text, proposal_version, match_type, classification from public.statistics_official_groups(array[' +
            idList +
            ']::uuid[]) order by game_group_id'
        );
      const facts = async () =>
        sqlRows(
          'select game_group_id::text, confirmation_id::text, proposal_version, match_type, classification from public.statistics_group_facts where community_id = ' +
            community +
            ' order by game_group_id'
        );
      const summary = async () =>
        sqlRows(
          "select confirmed_groups, wins, draws, incomplete_groups, games_won from public.statistics_scope_summaries where subject_kind = 'community' and subject_a = " +
            community +
            " and scope_kind = 'community' and scope_id = " +
            community +
            " and match_type = 'all'"
        );
      const beforeSource = await source();
      const beforeFacts = await facts();
      const beforeSummary = await summary();
      expect(beforeSource).toHaveLength(5);
      expect(beforeFacts).toEqual(beforeSource);
      expect(beforeSummary).toEqual([
        { confirmed_groups: 5, wins: 2, draws: 2, incomplete_groups: 1, games_won: 102 }
      ]);
      await fixtureSql(
        'delete from public.statistics_group_facts where community_id = ' +
          community +
          '; delete from public.statistics_scope_summaries where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          community +
          '; delete from public.statistics_daily_buckets where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          community +
          ';'
      );
      expect(await facts()).toEqual([]);
      await fixtureSql('select public.rebuild_statistics(null)');
      expect(await source()).toEqual(beforeSource);
      expect(await facts()).toEqual(beforeFacts);
      expect(await summary()).toEqual(beforeSummary);
    } finally {
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
