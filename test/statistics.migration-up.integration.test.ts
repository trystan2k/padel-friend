import { afterAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { createRankedResultFixtures, playedAt } from './helpers/ranked-result-fixtures';
import {
  GOLDEN_COMMUNITY,
  GOLDEN_FOCAL,
  GOLDEN_OPPONENT,
  GOLDEN_SCORES
} from './helpers/statistics-golden-fixtures';
import {
  createUpgradeDatabase,
  seedConfirmedHistory,
  statisticsSnapshot,
  type UpgradeDatabase
} from './helpers/statistics-upgrade-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });

// db:reset exercises the fresh migration chain, so this block proves current-schema backfill
// equivalence only. The in-place upgrade over pre-existing history is proven by the next describe.
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

const nil = '00000000-0000-0000-0000-000000000000';
const SUMMARY_COLUMNS = [
  'confirmed_groups',
  'wins',
  'losses',
  'draws',
  'incomplete_groups',
  'competitive_groups',
  'friendly_groups',
  'sets_won',
  'sets_lost',
  'games_won',
  'games_lost'
];
const SUMMARY_SELECT = SUMMARY_COLUMNS.map((column) => column + '::int as ' + column).join(', ');

// Applies the statistics migrations OVER a database that already holds confirmed history, in a
// scratch database on the same local Postgres (db:reset cannot pause before the statistics chain).
describe.skipIf(!environment.env)('statistics migrations applied over existing history', () => {
  let database: UpgradeDatabase | undefined;
  afterAll(async () => {
    await database?.drop();
  });

  it('backfills confirmed Friendly, Competitive and Incomplete history when the statistics migrations run', async (context) => {
    const created = await createUpgradeDatabase();
    if ('skipReason' in created) {
      console.warn('SKIP statistics upgrade proof (not counted as proof): ' + created.skipReason);
      context.skip(created.skipReason);
      return;
    }
    database = created.database;
    const { client } = database;
    const rows = async (sql: string) => (await client.query(sql)).rows.map(asRecord);
    const scalar = async (sql: string) => Object.values((await rows(sql))[0]!)[0];

    // Phase 1: the schema as it was before PAF-13, then real confirmed history.
    const before = await database.applyMigrations('pre-statistics');
    expect(before.length).toBeGreaterThan(80);
    expect(await scalar("select to_regclass('public.statistics_group_facts')::text")).toBeNull();
    const seed = await seedConfirmedHistory(client);
    const proposalIds = seed.groups.map((group) => group.proposalId);
    expect(seed.groups).toHaveLength(6);
    console.log(
      JSON.stringify(
        await rows(
          'select p.id::text, p.group_number, p.status::text, (select count(*) from public.match_event_result_confirmations c where c.proposal_id = p.id) n from public.match_event_result_proposals p order by 2'
        )
      )
    );
    expect(await scalar('select count(*)::int from public.match_event_result_confirmations')).toBe(
      6
    );
    expect(await scalar("select to_regclass('public.statistics_group_facts')::text")).toBeNull();

    // Phase 2: the statistics migrations run over that history.
    const applied = await database.applyMigrations('statistics');
    expect(applied[0]).toBe('20261102100000_statistics_domain.sql');
    // Later non-statistics migrations also run in this phase; the statistics set must end here.
    expect(applied.filter((file) => file.includes('_statistics_')).at(-1)).toBe(
      '20261111093000_statistics_player_rank_earned_scope.sql'
    );

    // Backfill coverage: every pre-existing confirmed group is projected with its exact facts.
    const community = "'" + seed.communityId + "'";
    const facts = await rows(
      'select game_group_id::text as id, match_type::text as match_type, classification::text as classification, confirmation_id::text as confirmation_id, proposal_version::int as version from public.statistics_group_facts where community_id = ' +
        community
    );
    expect(facts).toHaveLength(6);
    const confirmations = await rows(
      'select proposal_id::text as id, id::text as confirmation_id from public.match_event_result_confirmations'
    );
    for (const group of seed.groups) {
      const score = GOLDEN_SCORES[group.scoreIndex]!;
      const fact = facts.find((row) => row['id'] === group.proposalId);
      expect(fact).toMatchObject({
        match_type: score.type,
        classification: score.classification,
        version: 1
      });
      expect(fact?.['confirmation_id']).toBe(
        confirmations.find((row) => row['id'] === group.proposalId)?.['confirmation_id']
      );
    }
    for (const [table, perGroup] of [
      ['statistics_participant_facts', 4],
      ['statistics_pair_facts', 2],
      ['statistics_opponent_facts', 4]
    ] as const) {
      const counts = await rows(
        'select game_group_id::text as id, count(*)::int as n from public.' +
          table +
          ' where game_group_id = any(array[' +
          proposalIds.map((id) => "'" + id + "'").join(',') +
          ']::uuid[]) group by 1'
      );
      expect(counts).toHaveLength(6);
      expect(counts.every((row) => row['n'] === perGroup)).toBe(true);
    }

    // Hand-calculated oracle: the first quartet plays the five golden groups.
    const summary = async (kind: string, a: string, b: string) => {
      const found = await rows(
        'select ' +
          SUMMARY_SELECT +
          ' from public.statistics_scope_summaries where subject_kind = ' +
          "'" +
          kind +
          "'" +
          ' and subject_a = ' +
          a +
          ' and subject_b = ' +
          b +
          " and scope_kind = 'community' and scope_id = " +
          community +
          " and match_type = 'all'"
      );
      expect(found).toHaveLength(1);
      return found[0];
    };
    const player = (index: number) => "'" + seed.players[index] + "'::uuid";
    const pair = 'public.statistics_pair_id(' + player(0) + ', ' + player(1) + ')';
    const none = "'" + nil + "'::uuid";
    expect(await summary('player', player(0), none)).toEqual(GOLDEN_FOCAL);
    expect(await summary('player', player(2), none)).toEqual(GOLDEN_OPPONENT);
    expect(await summary('pair', pair, none)).toEqual(GOLDEN_FOCAL);
    expect(await summary('opponent', player(0), player(2))).toEqual(GOLDEN_FOCAL);
    expect(await summary('opponent', player(2), player(0))).toEqual(GOLDEN_OPPONENT);
    // The second quartet's competitive 12-7 group adds one win, 2 sets and 19 games to the community.
    expect(await summary('community', community, none)).toEqual({
      ...GOLDEN_COMMUNITY,
      confirmed_groups: GOLDEN_COMMUNITY.confirmed_groups + 1,
      wins: GOLDEN_COMMUNITY.wins + 1,
      competitive_groups: GOLDEN_COMMUNITY.competitive_groups + 1,
      sets_won: GOLDEN_COMMUNITY.sets_won + 2,
      games_won: GOLDEN_COMMUNITY.games_won + 19
    });

    // The migration backfill equals a from-scratch rebuild of the same history (business values).
    const migrated = await statisticsSnapshot(client);
    for (const table of Object.keys(migrated)) expect(migrated[table]!.length).toBeGreaterThan(0);
    await client.query('select public.rebuild_statistics(null)');
    expect(await statisticsSnapshot(client)).toEqual(migrated);

    // The upgraded schema equals the fresh db:reset schema (same functions, columns and indexes).
    const schemaSql =
      "select 'fn' as kind, p.oid::regprocedure::text as name, md5(pg_get_functiondef(p.oid)) as def from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.prokind = 'f' union all select 'col', table_name || '.' || column_name, data_type || ':' || is_nullable from information_schema.columns where table_schema = 'public' and table_name like 'statistics\\_%' union all select 'idx', indexname, indexdef from pg_indexes where schemaname = 'public' and tablename like 'statistics\\_%' order by 1, 2";
    const upgraded = await rows(schemaSql);
    expect(upgraded.length).toBeGreaterThan(100);
    expect(upgraded).toEqual(await sqlRows(schemaSql));
  }, 120_000);
});
