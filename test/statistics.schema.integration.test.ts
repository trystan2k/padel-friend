import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { DEFAULT_STATISTICS_THRESHOLDS } from '../src/features/statistics/statistics-config';
import { decodeStatisticsConfig } from '../src/features/statistics/statistics-decoders';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { sqlRows } from './helpers/match-registration-sql';
import { createRankedResultFixtures, type RankedResultKit } from './helpers/ranked-result-fixtures';
import { queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();

const TABLES = [
  'statistics_config',
  'statistics_projection_control',
  'statistics_group_facts',
  'statistics_participant_facts',
  'statistics_pair_facts',
  'statistics_opponent_facts',
  'statistics_scope_summaries',
  'statistics_daily_buckets',
  'statistics_rank_transitions',
  'statistics_league_positions',
  'statistics_rank_control',
  'statistics_rank_dirty',
  'statistics_participant_lifecycle',
  'statistics_lifecycle_dirty'
] as const;
const INTERNAL_FUNCTIONS = [
  'statistics_nil_uuid()',
  'statistics_pair_id(uuid,uuid)',
  'statistics_matchup_id(uuid,uuid)',
  'statistics_quartet_id(uuid[])',
  'statistics_utc_text(timestamp with time zone)',
  'statistics_thresholds_valid(jsonb)',
  'statistics_official_confirmations(uuid[])',
  'statistics_official_groups(uuid[])',
  'statistics_derive_sets(jsonb,text)',
  'statistics_lock()',
  'statistics_pending_init()',
  'statistics_json_add(jsonb,jsonb)',
  'statistics_json_sum(jsonb)',
  'statistics_seq_from(text)',
  'statistics_recent(jsonb)',
  'statistics_cand(numeric,numeric,timestamp with time zone,uuid)',
  'statistics_rating_rows(uuid[],bigint)',
  'statistics_project_source(uuid[])',
  'statistics_apply_summaries(uuid[],uuid[])',
  'statistics_publish(uuid[],uuid[],uuid[],boolean)',
  'statistics_assert_consistent(uuid)',
  'rebuild_statistics(uuid)',
  'statistics_read_actor()',
  'statistics_assert_rating_aligned()',
  'statistics_can_view_event(uuid,uuid)',
  'statistics_rank_compute(uuid)',
  'statistics_rank_rebuild_community(uuid)',
  'statistics_rank_refresh_league(uuid)',
  'statistics_rank_mark_player(uuid,text)',
  'statistics_rank_mark_league(uuid)',
  'statistics_rank_membership_mark()',
  'statistics_rank_refresh()',
  'statistics_rank_dirty_drain()',
  'statistics_rank_rebuild(uuid)',
  'statistics_rank_value(integer,text,timestamp with time zone,uuid,uuid,integer,bigint)',
  'statistics_rank_metric(text,jsonb,text,numeric,numeric,integer)',
  'statistics_player_rank_block(uuid,uuid,uuid)',
  'statistics_lifecycle_refresh_event(uuid)',
  'statistics_lifecycle_mark()',
  'statistics_lifecycle_drain()',
  'statistics_lifecycle_rebuild(uuid)'
];
const INDEXES = [
  'statistics_group_facts_community_chronology',
  'statistics_group_facts_league_chronology',
  'statistics_group_facts_matchup',
  'statistics_participant_lifecycle_user_sort',
  'statistics_participant_facts_player_chronology',
  'statistics_participant_facts_community_player',
  'statistics_pair_facts_low',
  'statistics_pair_facts_high',
  'statistics_pair_facts_pair',
  'statistics_opponent_facts_low',
  'statistics_opponent_facts_high',
  'statistics_scope_summaries_scope',
  'statistics_scope_summaries_players',
  'statistics_daily_buckets_scope',
  'statistics_daily_buckets_players',
  'player_rating_event_calculations_revision'
];

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';
const D = '44444444-4444-4444-8444-444444444444';

const derive = async (sets: unknown, classification: string) => {
  const result = await queryTrustedSql(
    'select * from public.statistics_derive_sets($1::jsonb, $2)',
    { values: [JSON.stringify(sets), classification] }
  );
  return result.rows[0]!;
};
const set = (position: number, a: number, b: number, completed = true) => ({
  position,
  team_a_games: a,
  team_b_games: b,
  completed
});

/** PAF-13 U1: schema, grants, helper identities and the normal-set reductions. */
describe.skipIf(!environment.env)('Statistics schema', { timeout: 120_000 }, () => {
  let kit: RankedResultKit;

  beforeAll(async () => {
    kit = await createRankedResultFixtures(environment.env!);
  });
  afterAll(async () => {
    if (kit) await kit.cleanup();
  });

  it('enables RLS and grants no runtime role any direct table access', async () => {
    for (const table of TABLES) {
      const [row] = await sqlRows(
        `select c.relrowsecurity,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as anon_any,
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as auth_any,
          has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as service_any,
          has_any_column_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE') as auth_column
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = '${table}'`
      );
      expect({ table, ...row }).toEqual({
        table,
        relrowsecurity: true,
        anon_any: false,
        auth_any: false,
        service_any: false,
        auth_column: false
      });
    }
  });

  it('denies a signed-in client direct reads of every internal table', async () => {
    for (const table of TABLES) {
      const result = await kit.players[0]!.client.from(table).select('*');
      expect(result.data ?? []).toEqual([]);
    }
  });

  it('keeps every repair and helper function away from anon, authenticated and service_role', async () => {
    for (const signature of INTERNAL_FUNCTIONS) {
      const [row] = await sqlRows(
        `select has_function_privilege('anon', 'public.${signature}'::regprocedure, 'EXECUTE') as anon_exec,
                has_function_privilege('authenticated', 'public.${signature}'::regprocedure, 'EXECUTE') as auth_exec,
                has_function_privilege('service_role', 'public.${signature}'::regprocedure, 'EXECUTE') as service_exec`
      );
      expect({ signature, ...row }).toEqual({
        signature,
        anon_exec: false,
        auth_exec: false,
        service_exec: false
      });
    }
    const rebuild = await kit.players[0]!.client.rpc('rebuild_statistics', {});
    expect(rebuild.error).not.toBeNull();
  });

  it('exposes only the whitelisted statistics readers to signed-in users, as SECURITY DEFINER with an empty search_path', async () => {
    const granted = await sqlRows(
      `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname ~ 'statistics'
          and has_function_privilege('authenticated', p.oid, 'EXECUTE') order by 1`
    );
    // get_player_partner_records / get_player_opponent_records do not match this name filter;
    // their grants are asserted in statistics.relationships.integration.test.ts.
    expect(granted.map((row) => row['proname'])).toEqual([
      'get_community_statistics',
      'get_opponent_statistics',
      'get_pair_statistics',
      'get_player_statistics',
      'get_player_statistics_rank_history',
      'get_statistics_config',
      'get_statistics_group_detail',
      'list_statistics_history'
    ]);
    const readers = await sqlRows(
      `select p.proname, p.prosecdef, p.proconfig::text as config,
         position('assert_actor_not_provisional' in pg_get_functiondef(p.oid)) > 0 as guarded
        from pg_proc p where p.proname in ('get_player_statistics', 'get_player_statistics_rank_history', 'get_statistics_config', 'get_statistics_group_detail', 'list_statistics_history')`
    );
    expect(readers).toHaveLength(5);
    for (const reader of readers) {
      expect(reader['prosecdef']).toBe(true);
      expect(String(reader['config'])).toMatch(/search_path=\\?"\\?"/);
      expect(reader['guarded']).toBe(true);
    }
    const definers = await sqlRows(
      `select p.proname, p.proconfig::text as config from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname ~ 'statistics' and p.prosecdef`
    );
    for (const row of definers) expect(String(row['config'])).toMatch(/search_path=\\?"\\?"/);
  });

  it('serves the applied thresholds to a signed-in client and refuses anonymous callers', async () => {
    const signedIn = await kit.players[0]!.client.rpc('get_statistics_config');
    expect(signedIn.error).toBeNull();
    const config = decodeStatisticsConfig(signedIn.data);
    expect(config.thresholds).toEqual(DEFAULT_STATISTICS_THRESHOLDS);
    expect(config.rating_aligned).toBe(true);
    const anon = createClient(environment.env!.url, environment.env!.key, {
      auth: { persistSession: false, autoRefreshToken: false }
    });
    expect((await anon.rpc('get_statistics_config')).error).not.toBeNull();
  });

  it('keeps one active configuration version and one control row', async () => {
    expect(await sqlRows('select version, active from public.statistics_config')).toEqual([
      { version: 1, active: true }
    ]);
    const [control] = await sqlRows(
      'select count(*)::int as n from public.statistics_projection_control'
    );
    expect(control?.['n']).toBe(1);
  });

  it('creates every foundation index the readers will rely on', async () => {
    const rows = await sqlRows(
      `select indexname from pg_indexes where schemaname = 'public' and indexname = any($1)`.replace(
        '$1',
        `array[${INDEXES.map((name) => `'${name}'`).join(',')}]`
      )
    );
    const byName = (a: unknown, b: unknown) => String(a).localeCompare(String(b));
    expect(rows.map((row) => row['indexname']).sort(byName)).toEqual([...INDEXES].sort(byName));
  });

  it('only attaches deferred marker triggers to sources without rating projection work', async () => {
    // Membership and lifecycle source triggers append dirty markers only. Deferred drains hold the
    // statistics lock, never acquire a rating lock or project rating facts.
    const [marker] = await sqlRows(
      "select pg_get_functiondef('public.statistics_lifecycle_mark()'::regprocedure) as definition"
    );
    expect(String(marker?.['definition'])).not.toMatch(
      /lock_global_rating|statistics_project_source|player_rating/
    );
    expect(
      await sqlRows(
        `select c.relname, t.tgname from pg_trigger t join pg_proc p on p.oid = t.tgfoid join pg_class c on c.oid = t.tgrelid
          where not t.tgisinternal and p.proname ~ 'statistics' order by 1, 2`
      )
    ).toEqual([
      { relname: 'community_members', tgname: 'statistics_rank_membership_mark' },
      { relname: 'match_event_registrations', tgname: 'statistics_lifecycle_registration_mark' },
      { relname: 'match_event_result_proposals', tgname: 'statistics_lifecycle_proposal_mark' },
      { relname: 'match_events', tgname: 'statistics_lifecycle_event_mark' },
      { relname: 'statistics_lifecycle_dirty', tgname: 'statistics_lifecycle_dirty_drain' },
      { relname: 'statistics_rank_dirty', tgname: 'statistics_rank_dirty_drain' }
    ]);
  });

  it('derives canonical pair, matchup and quartet identities independent of order', async () => {
    const [row] = await sqlRows(
      `select public.statistics_pair_id('${A}','${B}') = public.statistics_pair_id('${B}','${A}') as pair_symmetric,
              public.statistics_pair_id('${A}','${B}') <> public.statistics_pair_id('${A}','${C}') as pair_distinct,
              public.statistics_matchup_id(public.statistics_pair_id('${A}','${B}'), public.statistics_pair_id('${C}','${D}'))
                = public.statistics_matchup_id(public.statistics_pair_id('${D}','${C}'), public.statistics_pair_id('${B}','${A}')) as matchup_symmetric,
              public.statistics_quartet_id(array['${A}','${B}','${C}','${D}']::uuid[])
                = public.statistics_quartet_id(array['${D}','${B}','${A}','${C}']::uuid[]) as quartet_symmetric`
    );
    expect(row).toEqual({
      pair_symmetric: true,
      pair_distinct: true,
      matchup_symmetric: true,
      quartet_symmetric: true
    });
    for (const [sql, token] of [
      [`select public.statistics_pair_id('${A}','${A}')`, 'STATISTICS_PAIR_INVALID'],
      [
        `select public.statistics_matchup_id(public.statistics_pair_id('${A}','${B}'), public.statistics_pair_id('${B}','${A}'))`,
        'STATISTICS_MATCHUP_INVALID'
      ],
      [
        `select public.statistics_quartet_id(array['${A}','${B}','${C}','${A}']::uuid[])`,
        'STATISTICS_QUARTET_INVALID'
      ]
    ] as const)
      await expect(queryTrustedSql(sql)).rejects.toThrow(token);
  });

  describe('normal-set reductions', () => {
    it.each([
      {
        name: 'straight-set win',
        sets: [set(1, 6, 4), set(2, 6, 3)],
        classification: 'team_a',
        expected: {
          set_count: 2,
          sets_a: 2,
          sets_b: 0,
          games_a: 12,
          games_b: 7,
          straight_winner: 'team_a',
          three_set: false,
          incomplete_decider: false,
          deciding_winner: null,
          first_set_winner: 'team_a'
        }
      },
      {
        name: 'draw whose third set is unfinished (games count, no set, still a draw)',
        sets: [set(1, 6, 4), set(2, 3, 6), set(3, 2, 1, false)],
        classification: 'draw',
        expected: {
          set_count: 3,
          sets_a: 1,
          sets_b: 1,
          games_a: 11,
          games_b: 11,
          straight_winner: null,
          three_set: true,
          incomplete_decider: true,
          deciding_winner: null,
          first_set_winner: 'team_a'
        }
      },
      {
        name: 'unfinished third with a leader infers no winner',
        sets: [set(1, 6, 4), set(2, 3, 6), set(3, 5, 2, false)],
        classification: 'draw',
        expected: {
          set_count: 3,
          sets_a: 1,
          sets_b: 1,
          games_a: 14,
          games_b: 12,
          straight_winner: null,
          three_set: true,
          incomplete_decider: true,
          deciding_winner: null,
          first_set_winner: 'team_a'
        }
      },
      {
        name: 'completed third counts games once and decides',
        sets: [set(1, 6, 4), set(2, 3, 6), set(3, 6, 2)],
        classification: 'team_a',
        expected: {
          set_count: 3,
          sets_a: 2,
          sets_b: 1,
          games_a: 15,
          games_b: 12,
          straight_winner: null,
          three_set: true,
          incomplete_decider: false,
          deciding_winner: 'team_a',
          first_set_winner: 'team_a'
        }
      },
      {
        name: 'comeback loss in three sets',
        sets: [set(1, 6, 4), set(2, 3, 6), set(3, 2, 6)],
        classification: 'team_b',
        expected: {
          set_count: 3,
          sets_a: 1,
          sets_b: 2,
          games_a: 11,
          games_b: 16,
          straight_winner: null,
          three_set: true,
          incomplete_decider: false,
          deciding_winner: 'team_b',
          first_set_winner: 'team_a'
        }
      },
      {
        name: 'one completed set is an Incomplete group that keeps its set and games',
        sets: [set(1, 6, 4)],
        classification: 'incomplete',
        expected: {
          set_count: 1,
          sets_a: 1,
          sets_b: 0,
          games_a: 6,
          games_b: 4,
          straight_winner: null,
          three_set: false,
          incomplete_decider: false,
          deciding_winner: null,
          first_set_winner: 'team_a'
        }
      },
      {
        name: 'an unfinished first set awards games but no set and no first-set winner',
        sets: [set(1, 3, 1, false)],
        classification: 'incomplete',
        expected: {
          set_count: 1,
          sets_a: 0,
          sets_b: 0,
          games_a: 3,
          games_b: 1,
          straight_winner: null,
          three_set: false,
          incomplete_decider: false,
          deciding_winner: null,
          first_set_winner: null
        }
      }
    ])('$name', async ({ sets, classification, expected }) => {
      expect(await derive(sets, classification)).toEqual(expected);
    });
  });
});
