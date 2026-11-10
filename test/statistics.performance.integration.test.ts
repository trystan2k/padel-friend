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
import {
  insertBulkConfirmedGroups,
  rebuildCommunityStatistics,
  type BulkConfirmedGroup
} from './helpers/statistics-bulk-history-fixtures';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
// Slow CI runners exceed the transport's 30s per-statement default on analyze/explain; the test's own
// 900s vitest timeout still bounds the run, so only the environment-dependent per-statement kill moves.
const STATEMENT_OPTIONS = { timeoutMs: 300_000 };

const KIT_COUNT = 4;
const GROUP_COUNT = 150;
// Per kit, the first groups are confirmed through the real submit/review commands (lifecycle and
// projection invariant, proven end to end); the rest of the history is bulk-prepared.
const REAL_GROUPS_PER_KIT = 2;

/** Match type and played instant of history group `i`; shared by the real and bulk preparation. */
function historyGroup(i: number, midnight: number) {
  const eventType = Math.floor(i / KIT_COUNT) % 2 === 0 ? 'competitive' : 'friendly';
  const playedNoon = midnight - ((i % 14) + 1) * 86_400_000 + 12 * 3_600_000;
  return { eventType, played: playedAt(Math.floor((Date.now() - playedNoon) / 1000)) } as const;
}

/**
 * Confirms one group-one result through the real commands. Submit and approve run the real command
 * functions as the acting players inside one trusted transaction: PostgREST would cap each call at
 * the authenticated role's 8s statement_timeout, which the growing projection cost eventually
 * exceeds, while trusted SQL honors STATEMENT_OPTIONS.
 */
async function confirmRealGroup(
  kit: RankedResultKit,
  group: ReturnType<typeof historyGroup>
): Promise<string> {
  const event = await kit.event(null, group.eventType);
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
        sqlText(JSON.stringify(group.played.played)) + '::jsonb',
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
  return event;
}

const bulkSpec = (group: ReturnType<typeof historyGroup>): BulkConfirmedGroup => ({
  eventType: group.eventType,
  playedAtIso: group.played.iso
});

// Columns that identify a group or carry timestamps/provenance; they differ between any two groups.
const IDENTITY_COLUMNS = [
  'game_group_id',
  'confirmation_id',
  'match_event_id',
  'confirmed_at',
  'audit_event_id',
  'source_hash',
  'projected_at',
  'updated_at'
];
// Rating-ledger-derived columns: real Competitive confirmations project rating events, the bulk
// path deliberately does not (the plan-shape readers never depend on their values).
const RATING_COLUMNS = [
  'rating_revision',
  'rating_calc_revision',
  'rating_delta',
  'expected_score',
  'own_team_strength',
  'opponent_team_strength',
  'before_level',
  'after_level',
  'before_reliability',
  'after_reliability',
  'low_rating_delta',
  'high_rating_delta',
  'low_expected_score',
  'high_expected_score',
  'low_opponent_strength',
  'high_opponent_strength'
];

/** Every projected fact row of one group, minus identity (and optionally rating-derived) columns. */
async function groupFacts(proposalId: string, ignoreRating: boolean) {
  const strip = sqlText(
    '{' + [...IDENTITY_COLUMNS, ...(ignoreRating ? RATING_COLUMNS : [])].join(',') + '}'
  );
  const facts = (table: string, order: string) =>
    sqlRows(
      'select to_jsonb(f) - ' +
        strip +
        '::text[] as fact from public.' +
        table +
        ' f where game_group_id = ' +
        sqlText(proposalId) +
        '::uuid order by ' +
        order,
      STATEMENT_OPTIONS
    ).then((rows) => rows.map((row) => row['fact']));
  return {
    group: await facts('statistics_group_facts', 'game_group_id'),
    participants: await facts('statistics_participant_facts', 'user_id'),
    pairs: await facts('statistics_pair_facts', 'side'),
    opponents: await facts('statistics_opponent_facts', 'player_low, player_high')
  };
}

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
      for (let i = 0; i < KIT_COUNT; i += 1)
        kits.push(await createRankedResultFixtures(environment.env!));
      const today = new Date().toISOString().slice(0, 10);
      const midnight = Date.parse(today + 'T00:00:00Z');
      // Same-kit chains share actors and rating history, so each kit is one ordered lane;
      // independent kits run concurrently through a bounded pool.
      await runPool(
        kits.map((kit, lane) => async () => {
          for (let i = lane; i < REAL_GROUPS_PER_KIT * KIT_COUNT; i += KIT_COUNT)
            await confirmRealGroup(kit, historyGroup(i, midnight));
        }),
        8
      );
      // The remaining ~150-group history is bulk-prepared with every guard enabled, then each
      // community is rebuilt once through the supported rebuild entry point (see
      // statistics-bulk-history-fixtures.ts). Row volumes per kit are unchanged.
      for (const [lane, kit] of kits.entries()) {
        const groups: BulkConfirmedGroup[] = [];
        for (let i = lane + REAL_GROUPS_PER_KIT * KIT_COUNT; i < GROUP_COUNT; i += KIT_COUNT)
          groups.push(bulkSpec(historyGroup(i, midnight)));
        await insertBulkConfirmedGroups(kit, groups, STATEMENT_OPTIONS);
        await rebuildCommunityStatistics(kit.communityId, STATEMENT_OPTIONS);
      }
      const [volume] = await sqlRows(
        'select count(*)::int as groups from public.statistics_group_facts where community_id = any(' +
          sqlText('{' + kits.map((kit) => kit.communityId).join(',') + '}') +
          '::uuid[])',
        STATEMENT_OPTIONS
      );
      expect(volume?.['groups']).toBe(GROUP_COUNT);
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

  it('bulk-prepared groups project the same statistics facts as real confirmations', async () => {
    const kit = await createRankedResultFixtures(environment.env!);
    try {
      const midnight = Date.parse(new Date().toISOString().slice(0, 10) + 'T00:00:00Z');
      for (const eventType of ['friendly', 'competitive'] as const) {
        const group = { eventType, played: historyGroup(3, midnight).played } as const;
        const real = await kit.proposalId(await confirmRealGroup(kit, group));
        // Friendly groups take no part in rating, so every fact column must match exactly;
        // Competitive ones differ only in the rating-ledger-derived columns.
        const ignoreRating = eventType === 'competitive';
        // The real-command projections are snapshotted BEFORE any rebuild runs, so they stay an
        // oracle independent of rebuild_statistics (a rebuild defect cannot hide on both sides).
        const realFacts = await groupFacts(real, ignoreRating);
        const [bulk] = await insertBulkConfirmedGroups(kit, [bulkSpec(group)], STATEMENT_OPTIONS);
        await rebuildCommunityStatistics(kit.communityId, STATEMENT_OPTIONS);
        expect(realFacts.group).toHaveLength(1);
        expect(realFacts.participants).toHaveLength(4);
        expect(realFacts.pairs).toHaveLength(2);
        expect(realFacts.opponents).toHaveLength(4);
        expect(await groupFacts(bulk!.proposalId, ignoreRating)).toEqual(realFacts);
        const official = await sqlRows(
          'select classification, league_eligible, rating_expected, match_event_id::text as event from public.statistics_official_groups(array[' +
            [real, bulk!.proposalId].map((id) => sqlText(id) + '::uuid').join(',') +
            '])',
          STATEMENT_OPTIONS
        );
        expect(official).toHaveLength(2);
        expect(new Set(official.map((row) => row['rating_expected'])).size).toBe(1);
      }
      // Summaries fold real and bulk groups alike: 2 Friendly + 2 Competitive, all won by team A.
      const [summary] = await sqlRows(
        "select confirmed_groups, friendly_groups, competitive_groups, wins, losses from public.statistics_scope_summaries where subject_kind = 'player' and subject_a = " +
          sqlText(kit.players[0]!.id) +
          "::uuid and scope_kind = 'community' and scope_id = " +
          sqlText(kit.communityId) +
          "::uuid and match_type = 'all'",
        STATEMENT_OPTIONS
      );
      expect(summary).toMatchObject({
        confirmed_groups: 4,
        friendly_groups: 2,
        competitive_groups: 2,
        wins: 4,
        losses: 0
      });
    } finally {
      await kit.cleanup();
    }
  }, 300000);

  it('bulk fixtures roll back atomically and cleanup removes only the owning kit rows', async () => {
    const owner = await createRankedResultFixtures(environment.env!);
    const bystander = await createRankedResultFixtures(environment.env!);
    const owned = (kit: RankedResultKit) =>
      sqlRows(
        `select
          (select count(*)::int from public.match_events where community_id = ${sqlText(kit.communityId)}) as events,
          (select count(*)::int from public.match_event_result_proposals p
             join public.match_events e on e.id = p.match_event_id where e.community_id = ${sqlText(kit.communityId)}) as proposals,
          (select count(*)::int from public.match_event_result_confirmations c
             join public.match_events e on e.id = c.match_event_id where e.community_id = ${sqlText(kit.communityId)}) as confirmations,
          (select count(*)::int from public.match_event_result_official_state s
             join public.match_events e on e.id = s.match_event_id where e.community_id = ${sqlText(kit.communityId)}) as official,
          (select count(*)::int from public.statistics_group_facts where community_id = ${sqlText(kit.communityId)}) as facts,
          (select count(*)::int from storage.objects o
             join public.match_events e on o.name = e.photo_path where e.community_id = ${sqlText(kit.communityId)}) as photos`,
        STATEMENT_OPTIONS
      ).then((rows) => rows[0]);
    const played = historyGroup(1, Date.now()).played.iso;
    const spec = (eventType: BulkConfirmedGroup['eventType']) => ({
      eventType,
      playedAtIso: played
    });
    try {
      // A bad row in the batch rolls the whole statement back: nothing is left to clean.
      await expect(
        insertBulkConfirmedGroups(
          owner,
          [spec('friendly'), { eventType: 'friendly', playedAtIso: 'not-a-timestamp' }],
          STATEMENT_OPTIONS
        )
      ).rejects.toThrow(/timestamp/i);
      expect(await owned(owner)).toEqual({
        events: 0,
        proposals: 0,
        confirmations: 0,
        official: 0,
        facts: 0,
        photos: 0
      });
      await insertBulkConfirmedGroups(
        owner,
        [spec('friendly'), spec('competitive'), spec('friendly')],
        STATEMENT_OPTIONS
      );
      await insertBulkConfirmedGroups(
        bystander,
        [spec('friendly'), spec('competitive')],
        STATEMENT_OPTIONS
      );
      await rebuildCommunityStatistics(owner.communityId, STATEMENT_OPTIONS);
      await rebuildCommunityStatistics(bystander.communityId, STATEMENT_OPTIONS);
      expect(await owned(owner)).toEqual({
        events: 3,
        proposals: 3,
        confirmations: 3,
        official: 3,
        facts: 3,
        photos: 3
      });
      const bystanderRows = await owned(bystander);
      expect(bystanderRows).toMatchObject({ events: 2, facts: 2, photos: 2 });
      await owner.cleanup();
      expect(await owned(owner)).toEqual({
        events: 0,
        proposals: 0,
        confirmations: 0,
        official: 0,
        facts: 0,
        photos: 0
      });
      expect(await owned(bystander)).toEqual(bystanderRows);
    } finally {
      await owner.cleanup();
      await bystander.cleanup();
    }
  }, 300000);

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
