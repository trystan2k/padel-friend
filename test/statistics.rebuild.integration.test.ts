import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import {
  createRankedResultFixtures,
  playedAt,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { setResultReviewDeadlineOffset } from './helpers/match-result-processing-fixtures';
import { openDedicatedSqlConnection } from './helpers/sql-transport';
import {
  GOLDEN_COMMUNITY,
  GOLDEN_FOCAL,
  GOLDEN_OPPONENT,
  GOLDEN_SCORES
} from './helpers/statistics-golden-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const nil = '00000000-0000-0000-0000-000000000000';
const columns =
  'confirmed_groups, wins, losses, draws, incomplete_groups, competitive_groups, friendly_groups, sets_won, sets_lost, games_won, games_lost';

describe.skipIf(!environment.env)(
  'independent scoring and rebuild golden',
  { timeout: 300_000 },
  () => {
    let kit: RankedResultKit;
    const ids: string[] = [];
    const id = (index: number) => sqlText(kit.players[index]!.id);
    const community = () => sqlText(kit.communityId);
    async function summary(kind: string, a: string, b: string) {
      const rows = await sqlRows(
        'select ' +
          columns +
          ' from public.statistics_scope_summaries where subject_kind = ' +
          sqlText(kind) +
          ' and subject_a = ' +
          a +
          ' and subject_b = ' +
          b +
          " and scope_kind = 'community' and scope_id = " +
          community() +
          " and match_type = 'all'"
      );
      expect(rows).toHaveLength(1);
      return rows[0];
    }
    async function checkGolden() {
      const pair = 'public.statistics_pair_id(' + id(0) + '::uuid, ' + id(1) + '::uuid)';
      expect(await summary('player', id(0), sqlText(nil))).toEqual(GOLDEN_FOCAL);
      expect(await summary('player', id(2), sqlText(nil))).toEqual(GOLDEN_OPPONENT);
      expect(await summary('pair', pair, sqlText(nil))).toEqual(GOLDEN_FOCAL);
      expect(await summary('opponent', id(0), id(2))).toEqual(GOLDEN_FOCAL);
      expect(await summary('opponent', id(2), id(0))).toEqual(GOLDEN_OPPONENT);
      expect(await summary('community', community(), sqlText(nil))).toEqual(GOLDEN_COMMUNITY);
    }
    beforeAll(async () => {
      kit = await createRankedResultFixtures(environment.env!);
      for (const [index, score] of GOLDEN_SCORES.entries()) {
        const event = await kit.event(null, score.type);
        const submitted = await kit.submit(event, playedAt(1000 - index * 100).played, {
          sets: score.sets
        });
        if (submitted.error) throw submitted.error;
        const proposal = String(asRecord(submitted.data)['proposal_id']);
        const approved = await kit.approve(proposal);
        if (approved.error) throw approved.error;
        ids.push(proposal);
      }
    });
    afterAll(async () => {
      if (!kit) return;
      const players = kit.players.map((player) => sqlText(player.id)).join(',');
      await fixtureSql(
        'delete from public.statistics_scope_summaries where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          community() +
          '; delete from public.statistics_daily_buckets where subject_players && array[' +
          players +
          ']::uuid[] or subject_a = ' +
          community() +
          ';'
      );
      await kit.cleanup();
    });
    it('matches explicit facts and subject totals including an unfinished third and an incomplete group', async () => {
      for (const [index, score] of GOLDEN_SCORES.entries()) {
        const [row] = await sqlRows(
          'select classification, sets_a, sets_b, games_a, games_b from public.statistics_group_facts where game_group_id = ' +
            sqlText(ids[index]!)
        );
        expect(row).toEqual({
          classification: score.classification,
          sets_a: score.sets_a,
          sets_b: score.sets_b,
          games_a: score.games_a,
          games_b: score.games_b
        });
      }
      await checkGolden();
      const [competitive] = await sqlRows(
        "select confirmed_groups, wins, draws, incomplete_groups from public.statistics_scope_summaries where subject_kind = 'player' and subject_a = " +
          id(0) +
          " and scope_kind = 'community' and scope_id = " +
          community() +
          " and match_type = 'competitive'"
      );
      expect(competitive).toEqual({ confirmed_groups: 3, wins: 2, draws: 0, incomplete_groups: 1 });
      const [pairs] = await sqlRows(
        'select public.statistics_pair_id(' +
          id(0) +
          '::uuid,' +
          id(1) +
          '::uuid) = public.statistics_pair_id(' +
          id(1) +
          '::uuid,' +
          id(0) +
          '::uuid) as same'
      );
      expect(pairs?.['same']).toBe(true);
    });
    it('repairs corruption and remains idempotent on consecutive rebuilds', async () => {
      const snapshot = async () => {
        const [row] = await sqlRows(
          "select md5(coalesce(string_agg(data::text, '|' order by data::text), '')) as digest from (" +
            "select to_jsonb(s) - 'updated_at' as data from public.statistics_scope_summaries s where s.subject_players && array[" +
            kit.players.map((player) => sqlText(player.id)).join(',') +
            ']::uuid[] or s.subject_a = ' +
            community() +
            " union all select to_jsonb(d) - 'updated_at' from public.statistics_daily_buckets d where d.subject_players && array[" +
            kit.players.map((player) => sqlText(player.id)).join(',') +
            ']::uuid[] or d.subject_a = ' +
            community() +
            ') q'
        );
        return row;
      };
      const online = await snapshot();
      const [revision] = await sqlRows('select revision from public.statistics_projection_control');
      await fixtureSql('select public.rebuild_statistics(' + community() + '::uuid)');
      expect(await snapshot()).toEqual(online);
      const [unchanged] = await sqlRows(
        'select revision from public.statistics_projection_control'
      );
      expect(unchanged).toEqual(revision);
      await fixtureSql(
        "update public.statistics_scope_summaries set games_won = games_won + 1 where subject_kind = 'player' and subject_a = " +
          id(0) +
          " and scope_kind = 'community' and scope_id = " +
          community() +
          " and match_type = 'all'"
      );
      await fixtureSql('select public.rebuild_statistics(' + community() + '::uuid)');
      await checkGolden();
      expect(await snapshot()).toEqual(online);
      const [first] = await sqlRows('select revision from public.statistics_projection_control');
      await fixtureSql('select public.rebuild_statistics(' + community() + '::uuid)');
      const [second] = await sqlRows('select revision from public.statistics_projection_control');
      expect(second).toEqual(first);
      await checkGolden();
    });
    it('resolver-seam replacement subtracts old dimensions and matches golden expectations', async () => {
      const other = await createRankedResultFixtures(environment.env!);
      const connection = await openDedicatedSqlConnection();
      try {
        await connection.query('begin');
        const [definition] = (
          await connection.query(
            "select pg_get_functiondef('public.statistics_official_groups(uuid[])'::regprocedure) as body"
          )
        ).rows;
        if (typeof definition?.['body'] !== 'string') throw new Error('Missing resolver');
        const group = sqlText(ids[0]!);
        const [originalDay] = (
          await connection.query(
            'select played_day::text as day from public.statistics_group_facts where game_group_id = ' +
              group
          )
        ).rows;
        const oldDay = sqlText(String(originalDay?.['day']));
        const bucketQuery =
          "select confirmed_groups from public.statistics_daily_buckets where subject_kind = 'player' and subject_a = " +
          id(0) +
          " and scope_kind = 'community' and scope_id = " +
          community() +
          " and match_type = 'competitive' and played_day = " +
          oldDay +
          '::date';
        const [originalBucket] = (await connection.query(bucketQuery)).rows;
        const newCommunity = sqlText(other.communityId);
        const replacementTeams = sqlText(
          JSON.stringify({
            team_a: [kit.players[0]!.id, kit.players[2]!.id],
            team_b: [kit.players[4]!.id, kit.players[3]!.id]
          })
        );
        const replacementSets = sqlText(
          JSON.stringify([
            { position: 1, team_a_games: 6, team_b_games: 0, completed: true },
            { position: 2, team_a_games: 6, team_b_games: 0, completed: true }
          ])
        );
        const sourceCondition = 's.game_group_id = ' + group + '::uuid';
        const replacements: [string, string][] = [
          [
            's.game_group_id, s.confirmation_id, s.proposal_version, c.match_event_id',
            's.game_group_id, s.confirmation_id, case when ' +
              sourceCondition +
              ' then 2::bigint else s.proposal_version end, c.match_event_id'
          ],
          [
            'e.community_id, e.event_type::text, e.league_id,',
            'case when ' +
              sourceCondition +
              ' then ' +
              newCommunity +
              '::uuid else e.community_id end, case when ' +
              sourceCondition +
              " then 'friendly' else e.event_type::text end, e.league_id,"
          ],
          [
            "c.ratable_eligible and public.rating_v1_is_ratable(c.event_type::text, v.classification, 'confirmed'),",
            'case when ' +
              sourceCondition +
              " then false else c.ratable_eligible and public.rating_v1_is_ratable(c.event_type::text, v.classification, 'confirmed') end,"
          ],
          [
            'v.played_at_utc, v.classification::text, c.source,',
            'case when ' +
              sourceCondition +
              " then v.played_at_utc - interval '30 days' else v.played_at_utc end, v.classification::text, c.source,"
          ],
          [
            'v.teams, v.sets',
            'case when ' +
              sourceCondition +
              ' then ' +
              replacementTeams +
              '::jsonb else v.teams end, case when ' +
              sourceCondition +
              ' then ' +
              replacementSets +
              '::jsonb else v.sets end'
          ]
        ];
        let replacement = definition['body'];
        for (const [needle, value] of replacements) {
          if (!replacement.includes(needle)) throw new Error('Unexpected resolver definition');
          replacement = replacement.replace(needle, value);
        }
        await connection.query(replacement);
        await connection.query('select public.rebuild_statistics(null)');
        const query = async (sql: string) => (await connection.query(sql)).rows;
        const rows = await query(
          'select community_id::text, proposal_version, match_type, games_a, games_b, (played_at at time zone ' +
            sqlText('UTC') +
            ')::date::text as day from public.statistics_group_facts where game_group_id = ' +
            group
        );
        expect(rows).toMatchObject([
          {
            community_id: other.communityId,
            proposal_version: 2,
            match_type: 'friendly',
            games_a: 12,
            games_b: 0
          }
        ]);
        const oldFacts = await query(
          'select count(*)::integer as n from public.statistics_participant_facts where game_group_id = ' +
            group +
            ' and user_id = ' +
            id(1)
        );
        expect(oldFacts[0]?.['n']).toBe(0);
        const newFacts = await query(
          'select count(*)::integer as n from public.statistics_participant_facts where game_group_id = ' +
            group +
            ' and user_id = ' +
            id(4)
        );
        expect(newFacts[0]?.['n']).toBe(1);
        const edges = await query(
          'select player_low::text, player_high::text from public.statistics_opponent_facts where game_group_id = ' +
            group
        );
        const edgeSet = edges.map((edge) =>
          [String(edge['player_low']), String(edge['player_high'])].sort().join(':')
        );
        expect(edgeSet).not.toContain([kit.players[0]!.id, kit.players[2]!.id].sort().join(':'));
        expect(edgeSet).toContain([kit.players[0]!.id, kit.players[4]!.id].sort().join(':'));
        const oldPair = 'public.statistics_pair_id(' + id(0) + '::uuid,' + id(1) + '::uuid)';
        const newPair = 'public.statistics_pair_id(' + id(0) + '::uuid,' + id(2) + '::uuid)';
        const counts = await query(
          'select pair_id::text from public.statistics_pair_facts where game_group_id = ' + group
        );
        const [pairIds] = await query(
          'select ' + oldPair + '::text as old, ' + newPair + '::text as new'
        );
        expect(counts.map((row) => row['pair_id'])).not.toContain(pairIds?.['old']);
        expect(counts.map((row) => row['pair_id'])).toContain(pairIds?.['new']);
        const [remainingBucket] = await query(bucketQuery);
        expect(Number(remainingBucket?.['confirmed_groups'] ?? 0)).toBe(
          Number(originalBucket?.['confirmed_groups']) - 1
        );
        const [newBucket] = await query(
          "select confirmed_groups from public.statistics_daily_buckets where subject_kind = 'player' and subject_a = " +
            id(0) +
            " and scope_kind = 'community' and scope_id = " +
            newCommunity +
            " and match_type = 'friendly' and played_day = " +
            sqlText(String(rows[0]?.['day'])) +
            '::date'
        );
        expect(newBucket?.['confirmed_groups']).toBe(1);
        const [oldPairSummary] = await query(
          "select confirmed_groups from public.statistics_scope_summaries where subject_kind = 'pair' and subject_a = " +
            oldPair +
            " and scope_kind = 'community' and scope_id = " +
            community() +
            " and match_type = 'all'"
        );
        expect(oldPairSummary?.['confirmed_groups']).toBe(4);
        const [newPairSummary] = await query(
          "select confirmed_groups, wins, games_won, games_lost from public.statistics_scope_summaries where subject_kind = 'pair' and subject_a = " +
            newPair +
            " and scope_kind = 'community' and scope_id = " +
            newCommunity +
            " and match_type = 'friendly'"
        );
        expect(newPairSummary).toEqual({
          confirmed_groups: 1,
          wins: 1,
          games_won: 12,
          games_lost: 0
        });
        const [newOpponent] = await query(
          "select confirmed_groups, wins from public.statistics_scope_summaries where subject_kind = 'opponent' and subject_a = " +
            id(0) +
            ' and subject_b = ' +
            id(4) +
            " and scope_kind = 'community' and scope_id = " +
            newCommunity +
            " and match_type = 'friendly'"
        );
        expect(newOpponent).toEqual({ confirmed_groups: 1, wins: 1 });
        const scopes = await query(
          "select subject_a::text as id, confirmed_groups, wins, draws, incomplete_groups, competitive_groups, friendly_groups, games_won from public.statistics_scope_summaries where subject_kind = 'community' and scope_kind = 'community' and subject_a = scope_id and match_type = 'all' and scope_id in (" +
            community() +
            ',' +
            newCommunity +
            ') order by subject_a'
        );
        expect(scopes).toEqual(
          expect.arrayContaining([
            {
              id: kit.communityId,
              confirmed_groups: 4,
              wins: 1,
              draws: 2,
              incomplete_groups: 1,
              competitive_groups: 2,
              friendly_groups: 2,
              games_won: 83
            },
            {
              id: other.communityId,
              confirmed_groups: 1,
              wins: 1,
              draws: 0,
              incomplete_groups: 0,
              competitive_groups: 0,
              friendly_groups: 1,
              games_won: 12
            }
          ])
        );
        const newSummary = await query(
          "select confirmed_groups, wins, games_won, games_lost from public.statistics_scope_summaries where subject_kind = 'player' and subject_a = " +
            id(4) +
            " and scope_kind = 'community' and scope_id = " +
            newCommunity +
            " and match_type = 'all'"
        );
        expect(newSummary).toEqual([
          { confirmed_groups: 1, wins: 0, games_won: 0, games_lost: 12 }
        ]);
      } finally {
        // Closing the dedicated session rolls back even when a SQL error aborted its transaction.
        await connection.close();
        await other.cleanup();
      }
      await checkGolden();
    });
    it('excludes a disputed result and counts manual and automatic confirmations identically', async () => {
      const makeProposal = async () => {
        const event = await kit.event(null, 'friendly');
        const submitted = await kit.submit(event, playedAt(60).played, {
          sets: GOLDEN_SCORES[0].sets
        });
        if (submitted.error) throw submitted.error;
        return String(asRecord(submitted.data)['proposal_id']);
      };
      const disputed = await makeProposal();
      const rejection = await kit.rpc(kit.players[1]!, 'review_match_event_result', {
        p_proposal_id: disputed,
        p_expected_version: 1,
        p_decision: 'reject',
        p_reason_code: 'SCORE_INCORRECT',
        p_request_id: crypto.randomUUID()
      });
      if (rejection.error) throw rejection.error;
      const [absent] = await sqlRows(
        'select count(*)::integer as n from public.statistics_group_facts where game_group_id = ' +
          sqlText(disputed)
      );
      expect(absent?.['n']).toBe(0);
      const manual = await makeProposal();
      const approved = await kit.approve(manual);
      if (approved.error) throw approved.error;
      const automatic = await makeProposal();
      await setResultReviewDeadlineOffset(automatic, 1, -1);
      const [receipt] = await sqlRows(
        'select public.try_auto_confirm_match_event_result(' +
          sqlText(automatic) +
          '::uuid, 1) as result'
      );
      expect(asRecord(receipt?.['result'])['reason']).toBe('confirmed');
      for (const proposal of [manual, automatic]) {
        const [row] = await sqlRows(
          'select classification, sets_a, sets_b, games_a, games_b, match_type from public.statistics_group_facts where game_group_id = ' +
            sqlText(proposal)
        );
        expect(row).toEqual({
          classification: 'team_a',
          sets_a: 2,
          sets_b: 0,
          games_a: 12,
          games_b: 7,
          match_type: 'friendly'
        });
      }
      const [total] = await sqlRows(
        "select confirmed_groups from public.statistics_scope_summaries where subject_kind = 'community' and subject_a = " +
          community() +
          " and scope_kind = 'community' and scope_id = " +
          community() +
          " and match_type = 'all'"
      );
      expect(total?.['confirmed_groups']).toBe(7);
    });
  }
);
