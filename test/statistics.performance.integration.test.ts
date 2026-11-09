import { describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import { openDedicatedSqlConnection, queryTrustedSql } from './helpers/sql-transport';
import {
  createRankedResultFixtures,
  playedAt,
  rankedSets,
  type RankedResultKit
} from './helpers/ranked-result-fixtures';
import { runPool } from './helpers/promise-pool';
import { sqlText } from './helpers/provisional-player-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
// Slow CI runners exceed the transport's 30s per-statement default on analyze/explain; the test's own
// 900s vitest timeout still bounds the run, so only the environment-dependent per-statement kill moves.
const STATEMENT_OPTIONS = { timeoutMs: 300_000 };

/** Recursively flatten PostgreSQL JSON plan nodes without relying on timings. */
function planNodes(value: unknown): Record<string, unknown>[] {
  const node = asRecord(value);
  const children = node['Plans'];
  if (children !== undefined && !Array.isArray(children)) throw new Error('Invalid child plans');
  return [
    node,
    ...(Array.isArray(children) ? children.flatMap((child: unknown) => planNodes(child)) : [])
  ];
}

/** Reader bodies must never rebuild statistics or replay official result sources at request time. */
describe.skipIf(!environment.env)('statistics reader performance contract', () => {
  it('uses indexed paths for scoped statistics readers under confirmed history', async () => {
    const kits: RankedResultKit[] = [];
    try {
      for (let i = 0; i < 4; i += 1) kits.push(await createRankedResultFixtures(environment.env!));
      const today = new Date().toISOString().slice(0, 10);
      const midnight = Date.parse(today + 'T00:00:00Z');
      // Same-kit chains share actors and rating history, so each kit is one ordered lane;
      // independent kits run concurrently through a bounded pool.
      const buildHistory = async (i: number) => {
        const kit = kits[i % kits.length]!;
        const event = await kit.event(
          null,
          Math.floor(i / kits.length) % 2 === 0 ? 'competitive' : 'friendly'
        );
        const playedNoon = midnight - ((i % 14) + 1) * 86_400_000 + 12 * 3_600_000;
        const played = playedAt(Math.floor((Date.now() - playedNoon) / 1000)).played;
        // Submit and approve run the real command functions as the acting players inside one trusted
        // transaction: PostgREST would cap each call at the authenticated role's 8s statement_timeout,
        // which the growing projection cost eventually exceeds, while trusted SQL honors STATEMENT_OPTIONS.
        const asPlayer = (id: string) =>
          "perform set_config('request.jwt.claims', " +
          sqlText(JSON.stringify({ sub: id, role: 'authenticated' })) +
          ', true);';
        await queryTrustedSql(
          'do $paf$ declare v_proposal uuid; begin ' +
            asPlayer(kit.players[0]!.id) +
            ' v_proposal := (public.submit_match_event_result(' +
            [
              sqlText(event) + '::uuid',
              '1',
              sqlText(JSON.stringify(kit.teamsOf(1))) + '::jsonb',
              sqlText(JSON.stringify(rankedSets)) + '::jsonb',
              sqlText(JSON.stringify(played)) + '::jsonb',
              "'Court 1'",
              sqlText(crypto.randomUUID()) + '::uuid'
            ].join(', ') +
            ")->>'proposal_id')::uuid; " +
            asPlayer(kit.players[2]!.id) +
            ' perform public.review_match_event_result(v_proposal, 1, ' +
            sqlText('approve') +
            ', null, null, ' +
            sqlText(crypto.randomUUID()) +
            '::uuid); end $paf$;',
          STATEMENT_OPTIONS
        );
      };
      await runPool(
        kits.map((_, lane) => async () => {
          for (let i = lane; i < 150; i += kits.length) await buildHistory(i);
        }),
        8
      );
      await queryTrustedSql(
        'analyze public.statistics_scope_summaries; analyze public.statistics_daily_buckets; analyze public.statistics_group_facts; analyze public.statistics_pair_facts; analyze public.statistics_opponent_facts',
        STATEMENT_OPTIONS
      );
      const focal = kits[0]!;
      const [matchup] = await sqlRows(
        'select matchup_id::text as id from public.statistics_group_facts where community_id = ' +
          sqlText(focal.communityId) +
          ' limit 1',
        STATEMENT_OPTIONS
      );
      if (typeof matchup?.['id'] !== 'string') throw new Error('Missing matchup fixture');
      const matchupSql =
        'explain (format json) select g.team_a_players, g.team_b_players from public.statistics_group_facts g where g.matchup_id = ' +
        sqlText(matchup['id']) +
        '::uuid limit 1';
      // A small table plans Seq Scan whatever indexes exist, so timings or plan shape at 150 groups
      // prove nothing about scale. Instead assert the matchup predicate is servable by the dedicated
      // index: with sequential scans disabled (rolled-back transaction) the planner must pick it.
      const connection = await openDedicatedSqlConnection();
      try {
        await connection.query('begin', STATEMENT_OPTIONS);
        await connection.query('set local enable_seqscan = off', STATEMENT_OPTIONS);
        const planned = await connection.query(matchupSql, STATEMENT_OPTIONS);
        const plan = planned.rows[0]?.['QUERY PLAN'];
        if (!Array.isArray(plan) || plan.length !== 1) throw new Error('Invalid explain output');
        const nodes = planNodes(asRecord(asRecord(plan[0])['Plan']));
        expect(
          nodes
            .filter((node) => node['Relation Name'] === 'statistics_group_facts')
            .map((node) => [node['Node Type'], node['Index Name']])
        ).toEqual([['Index Scan', 'statistics_group_facts_matchup_id']]);
      } finally {
        await connection.query('rollback', STATEMENT_OPTIONS);
        await connection.close();
      }
      const community = sqlText(focal.communityId) + '::uuid';
      const player = sqlText(focal.players[0]!.id) + '::uuid';
      const opponent = sqlText(focal.players[2]!.id) + '::uuid';
      const pair =
        'public.statistics_pair_id(' + player + ', ' + sqlText(focal.players[1]!.id) + '::uuid)';
      const nil = "'00000000-0000-0000-0000-000000000000'::uuid";
      const scope =
        "scope_kind = 'community' and scope_id = " + community + " and match_type = 'all'";
      const day = 'played_day >= current_date - 14 and played_day <= current_date';
      const read = (
        table: string,
        kind: string,
        first: string,
        second: string,
        dated = false,
        column = 'confirmed_groups'
      ) =>
        'select ' +
        column +
        ' from public.' +
        table +
        " where subject_kind = '" +
        kind +
        "' and subject_a = " +
        first +
        ' and subject_b = ' +
        second +
        ' and ' +
        scope +
        (dated ? ' and ' + day : '');
      const summaries = 'statistics_scope_summaries';
      const buckets = 'statistics_daily_buckets';
      const queries = [
        ['community lifetime', read(summaries, 'community', community, nil)],
        ['community date', read(buckets, 'community', community, nil, true)],
        ['player lifetime', read(summaries, 'player', player, nil)],
        ['player date', read(buckets, 'player', player, nil, true)],
        ['pair', read(summaries, 'pair', pair, nil)],
        ['opponent', read(summaries, 'opponent', player, opponent)],
        ['partner records', read(summaries, 'player', player, nil, false, 'relations')]
      ] as const;
      const largeTables = [
        'statistics_scope_summaries',
        'statistics_daily_buckets',
        'statistics_group_facts',
        'statistics_pair_facts',
        'statistics_opponent_facts'
      ];
      for (const [name, sql] of queries) {
        const result = await queryTrustedSql('explain (format json) ' + sql, STATEMENT_OPTIONS);
        const plans = result.rows[0]?.['QUERY PLAN'];
        if (!Array.isArray(plans) || plans.length !== 1) throw new Error('Invalid explain output');
        const top = asRecord(asRecord(plans[0])['Plan']);
        const nodes = planNodes(top);
        console.info(name, top['Node Type'], 'rows', top['Plan Rows']);
        expect(
          nodes.filter(
            (node) =>
              node['Node Type'] === 'Seq Scan' &&
              largeTables.includes(String(node['Relation Name']))
          )
        ).toEqual([]);
        expect(
          !name.endsWith('date') ||
            nodes.some(
              (node) =>
                node['Relation Name'] === buckets && String(node['Node Type']).includes('Index')
            )
        ).toBe(true);
      }
    } finally {
      for (const kit of kits.reverse()) await kit.cleanup();
    }
  }, 900000);

  it('captures the actual matchup lookup plan without imposing an empty-table scan policy', async () => {
    const result = await queryTrustedSql(
      "explain (analyze, buffers, format json) select g.team_a_players, g.team_b_players from public.statistics_group_facts g where g.matchup_id = '11111111-1111-4111-8111-111111111111'::uuid limit 1"
    );
    const plans = result.rows[0]?.['QUERY PLAN'];
    if (!Array.isArray(plans) || plans.length !== 1) throw new Error('Invalid explain output');
    const top = asRecord(asRecord(plans[0])['Plan']);
    const nodes = planNodes(top);
    if (process.env['DEBUG']) console.info('matchup lookup plan', JSON.stringify(plans));
    expect(typeof top['Node Type']).toBe('string');
    expect(nodes.some((node) => node['Relation Name'] === 'statistics_group_facts')).toBe(true);
  });

  it('keeps community, player, relationship and history entry points independent of rebuilds', async () => {
    const names = [
      'get_community_statistics',
      'get_player_statistics',
      'get_pair_statistics',
      'get_opponent_statistics',
      'list_statistics_history'
    ];
    const rows = await sqlRows(
      "select p.proname, pg_get_functiondef(p.oid) as definition from pg_proc p join pg_namespace n on n.oid = p.pronamespace where n.nspname = 'public' and p.proname = any(array['get_community_statistics','get_player_statistics','get_pair_statistics','get_opponent_statistics','list_statistics_history'])"
    );
    expect(rows.map((row) => String(row['proname'])).sort((a, b) => a.localeCompare(b))).toEqual(
      names.sort((a, b) => a.localeCompare(b))
    );
    for (const row of rows) {
      expect(String(row['definition'])).not.toMatch(/statistics_official_|rebuild_statistics/i);
    }
  });
});
