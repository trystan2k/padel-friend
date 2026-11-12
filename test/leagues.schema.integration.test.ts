import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { decodeLeagueDetail } from '../src/features/leagues/league-decoders';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  insertLeague,
  leagueRow,
  leagueWorld,
  sqlRows,
  type LeagueWorld
} from './helpers/league-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import {
  executeTrustedSql,
  openDedicatedSqlConnection,
  queryTrustedSql
} from './helpers/sql-transport';

const environment = localSupabaseEnv();

const PUBLIC_COMMANDS = [
  'activate_league',
  'close_league',
  'create_league',
  'get_league',
  // PAF-11 U4: read-only per-player counters over confirmed eligible Ranked results.
  'get_league_counters',
  // PAF-12 U2: live standings with shared positions and award eligibility.
  'get_league_standings',
  // PAF-12 U3: member-safe version history and owner/Admin audit of final standings.
  'get_league_standings_audit',
  'list_league_standings_versions',
  'list_leagues',
  // PAF-11 U2: eligible League options for the create-match schedule.
  'list_match_league_options',
  'update_league'
];
const INTERNAL_FUNCTIONS = [
  'league_actor_can_manage(uuid,uuid)',
  'league_community_dto(uuid)',
  'league_dto(leagues)',
  'league_has_published_events(uuid)',
  'league_lock_for_command(uuid,integer)',
  'league_period_instants(text,text,date,date)',
  'league_process_community_locked(uuid,timestamp with time zone)',
  'league_utc_text(timestamp with time zone)',
  'league_valid_text(text,integer)',
  'process_due_leagues(integer,timestamp with time zone)',
  'valid_league_timezone(text)',
  'touch_league()',
  'guard_league_identity()',
  'guard_league_events_immutable()',
  // PAF-11 U4: result-time Ranked eligibility helpers.
  'match_result_fact_quartet(jsonb)',
  'match_result_ranked_ineligibility(uuid,uuid[],timestamp with time zone)',
  // PAF-12 U2: shared sporting rank (live reader now, snapshot builder later).
  'league_standings_entries(uuid)',
  // PAF-12 U3: snapshot publication, canonical aggregation and the shared rank function.
  'league_counter_rows_through(uuid,timestamp with time zone)',
  'league_rank_counters(jsonb,integer)',
  'league_publish_standings(uuid,text,uuid,timestamp with time zone,text)',
  'league_publish_late_confirmation(uuid,uuid,timestamp with time zone,text)',
  'league_repair_closed_standings(uuid)',
  'league_reconstruct_standings(uuid)',
  'guard_league_standings_snapshots_immutable()',
  // PAF-12 review fix: closed-League rebuilds repair the final.
  'league_rebuild_counters_core(uuid)',
  'league_publish_repair_if_needed(uuid)'
];

describe('League schema', { timeout: 120_000 }, () => {
  let world: LeagueWorld;
  let communityId: string;

  const seed = (overrides: Partial<Parameters<typeof insertLeague>[0]>) =>
    insertLeague({
      communityId,
      ownerId: world.owner.id,
      startAt: '2031-01-01T00:00:00Z',
      endAt: '2031-02-01T00:00:00Z',
      ...overrides
    });
  const rejects = async (sql: string, message: RegExp) => {
    await expect(executeTrustedSql(sql)).rejects.toThrow(message);
  };

  beforeAll(async () => {
    if (!environment.env) return;
    world = await leagueWorld(environment.env, 'schema');
    communityId = await world.newCommunity(world.admin.id);
  });

  it.skipIf(!environment.env)(
    'enforces end-mode, period and text integrity in the table itself',
    async () => {
      const base = (columns: string) => `
      insert into public.leagues(community_id, owner_id, name, timezone, start_at, end_mode, end_at, status,
          create_request_id, create_input ${columns.split('|')[0]})
        values (${sqlText(communityId)}, ${sqlText(world.owner.id)}, ${columns.split('|')[1]})`;
      const row = (parts: {
        name?: string;
        timezone?: string;
        mode?: string;
        end?: string | null;
        status?: string;
        extra?: string;
        extraValues?: string;
      }) =>
        base(
          `${parts.extra ?? ''}|${sqlText(parts.name ?? 'Schema league')}, ${sqlText(parts.timezone ?? 'UTC')},
          '2031-01-01T00:00:00Z', ${sqlText(parts.mode ?? 'fixed_date')},
          ${parts.end === undefined ? "'2031-02-01T00:00:00Z'" : parts.end === null ? 'null' : sqlText(parts.end)},
          ${sqlText(parts.status ?? 'upcoming')}, gen_random_uuid(), '{}'::jsonb ${parts.extraValues ?? ''}`
        );

      await expect(executeTrustedSql(row({}))).resolves.toBeUndefined();
      await rejects(row({ end: null }), /leagues_end_mode_consistent/);
      await rejects(row({ end: '2031-01-01T00:00:00Z' }), /leagues_end_mode_consistent/);
      await rejects(row({ end: '2030-12-01T00:00:00Z' }), /leagues_end_mode_consistent/);
      await rejects(row({ mode: 'manual' }), /leagues_end_mode_consistent/);
      await expect(executeTrustedSql(row({ mode: 'manual', end: null }))).resolves.toBeUndefined();
      await rejects(row({ name: '' }), /leagues_name_check/);
      await rejects(row({ name: ' padded' }), /leagues_name_check/);
      await rejects(row({ name: 'x'.repeat(81) }), /leagues_name_check/);
      await rejects(row({ timezone: 'America/Sao_Paulo' }), /leagues_timezone_check/);
      await rejects(row({ timezone: 'Not/AZone' }), /leagues_timezone_check/);
      await rejects(row({ status: 'draft' }), /invalid input value for enum/);
      await rejects(row({ status: 'archived' }), /invalid input value for enum/);
      await rejects(
        row({ extra: ', description', extraValues: ", ''" }),
        /leagues_description_check/
      );
      await rejects(
        row({ extra: ', minimum_matches_for_final_award', extraValues: ', 0' }),
        /minimum_matches_for_final_award_check/
      );
      await rejects(
        row({ extra: ', minimum_matches_for_final_award', extraValues: ', 101' }),
        /minimum_matches_for_final_award_check/
      );
      // Status evidence: an Active League needs activated_at; blocked marks only Upcoming Leagues.
      await rejects(row({ status: 'active' }), /leagues_status_evidence/);
      await rejects(row({ status: 'closed' }), /leagues_status_evidence/);
      await rejects(
        row({
          extra: ', activation_blocked_at, activated_at',
          extraValues: ', now(), now()',
          status: 'active'
        }),
        /leagues_status_evidence|leagues_blocked_only_upcoming/
      );
      await rejects(
        row({
          status: 'closed',
          extra: ', closed_at, closed_reason',
          extraValues: ", now(), 'manual'"
        }),
        /leagues_status_evidence/
      );
    }
  );

  it.skipIf(!environment.env)('defaults the minimum to 1 and starts at version 1', async () => {
    const id = await seed({});
    expect(await leagueRow(id)).toMatchObject({ minimum_matches_for_final_award: 1, version: 1 });
  });

  it.skipIf(!environment.env)(
    'allows one Active League per community through a partial unique index without volatile predicates',
    async () => {
      const community = await world.newCommunity(world.admin.id);
      const other = await world.newCommunity(world.admin.id);
      await seed({ communityId: community, status: 'active', endAt: null });
      await seed({ communityId: community, status: 'upcoming' });
      await seed({ communityId: community, status: 'upcoming' });
      await seed({
        communityId: community,
        status: 'closed',
        closedAt: '2030-01-02T00:00:00Z',
        startAt: '2030-01-01T00:00:00Z',
        endAt: '2030-01-02T00:00:00Z'
      });
      await seed({ communityId: other, status: 'active', endAt: null });
      await expect(seed({ communityId: community, status: 'active', endAt: null })).rejects.toThrow(
        /leagues_one_active_per_community/
      );
      const [index] = await sqlRows(
        `select indexdef from pg_indexes where schemaname = 'public' and indexname = 'leagues_one_active_per_community'`
      );
      expect(String(index?.['indexdef'])).toMatch(
        /CREATE UNIQUE INDEX .* \(community_id\) WHERE \(status = 'active'::league_status\)/
      );
      expect(String(index?.['indexdef'])).not.toMatch(/now\(|clock_timestamp|current_/i);
    }
  );

  it.skipIf(!environment.env)(
    'keeps League identity immutable, closed Leagues frozen and audit rows append-only',
    async () => {
      expect.hasAssertions();
      const id = await seed({ endAt: null });
      for (const column of [
        `community_id = ${sqlText(world.communityId)}`,
        `owner_id = ${sqlText(world.member.id)}`,
        `timezone = 'Europe/Madrid'`,
        `create_request_id = gen_random_uuid()`,
        `create_input = '{"x":1}'::jsonb`,
        `created_at = now()`
      ])
        await rejects(
          `update public.leagues set ${column} where id = ${sqlText(id)}`,
          /LEAGUE_IDENTITY_IMMUTABLE|violates|violate/
        );

      const closed = await seed({
        status: 'closed',
        closedAt: '2031-01-15T00:00:00Z',
        closedBy: world.owner.id,
        endAt: null
      });
      await rejects(
        `update public.leagues set name = 'renamed' where id = ${sqlText(closed)}`,
        /LEAGUE_CLOSED_IMMUTABLE/
      );

      await executeTrustedSql(
        `insert into public.league_events(league_id, community_id, action, actor_id)
         values (${sqlText(id)}, ${sqlText(communityId)}, 'created', ${sqlText(world.owner.id)})`
      );
      await rejects(
        `update public.league_events set details = '{"x":1}' where league_id = ${sqlText(id)}`,
        /LEAGUE_EVENTS_IMMUTABLE/
      );
      await rejects(
        `delete from public.league_events where league_id = ${sqlText(id)}`,
        /LEAGUE_EVENTS_IMMUTABLE/
      );
      // An event must be a human actor XOR a system reason, and belong to the League's own community.
      await rejects(
        `insert into public.league_events(league_id, community_id, action) values (${sqlText(id)}, ${sqlText(communityId)}, 'created')`,
        /league_events_actor_or_system/
      );
      await rejects(
        `insert into public.league_events(league_id, community_id, action, actor_id)
         values (${sqlText(id)}, ${sqlText(world.communityId)}, 'created', ${sqlText(world.owner.id)})`,
        /league_events_league_fk/
      );
    }
  );

  it.skipIf(!environment.env)(
    'protects tables with RLS, narrow grants and restrictive provisional policies',
    async () => {
      const tables = await sqlRows(
        `select c.relname, c.relrowsecurity,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as anon_any,
          has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') as auth_write,
          has_table_privilege('authenticated', c.oid, 'SELECT') as auth_select,
          has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE') as service_any
         from pg_class c join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname in ('leagues', 'league_events') order by 1`
      );
      expect(tables).toEqual([
        {
          relname: 'league_events',
          relrowsecurity: true,
          anon_any: false,
          auth_write: false,
          auth_select: false,
          service_any: false
        },
        {
          relname: 'leagues',
          relrowsecurity: true,
          anon_any: false,
          auth_write: false,
          auth_select: true,
          service_any: false
        }
      ]);
      const policies = await sqlRows(
        `select policyname, permissive, cmd from pg_policies where schemaname = 'public' and tablename = 'leagues' order by 1`
      );
      expect(policies).toEqual([
        { policyname: 'league member select', permissive: 'PERMISSIVE', cmd: 'SELECT' },
        { policyname: 'provisional actor restricted', permissive: 'RESTRICTIVE', cmd: 'ALL' }
      ]);
      expect(
        await sqlRows(
          `select 1 from pg_policies where schemaname = 'public' and tablename = 'league_events'`
        )
      ).toEqual([]);
    }
  );

  it.skipIf(!environment.env)(
    'exposes only the League commands and readers to signed-in users and no internal helper to any runtime role',
    async () => {
      const granted = await sqlRows(
        `select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'EXECUTE')
          and (p.proname ~ '(^|_)league' or p.proname in ('process_due_leagues', 'valid_league_timezone'))
        order by 1`
      );
      expect(granted.map((row) => row['proname'])).toEqual(PUBLIC_COMMANDS);
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
      // Every command is SECURITY DEFINER with an empty search_path and guards provisional actors.
      const commands = await queryTrustedSql(
        `select p.proname, p.prosecdef, p.proconfig::text as config,
          position('assert_actor_not_provisional' in pg_get_functiondef(p.oid)) > 0 as guarded
         from pg_proc p join pg_namespace n on n.oid = p.pronamespace
        where n.nspname = 'public' and p.proname = any($1::text[]) order by 1`,
        { values: [PUBLIC_COMMANDS] }
      );
      expect(commands.rows.map((row) => row['proname'])).toEqual(PUBLIC_COMMANDS);
      for (const row of commands.rows) {
        expect({ fn: row['proname'], definer: row['prosecdef'] }).toEqual({
          fn: row['proname'],
          definer: true
        });
        expect(String(row['config'])).toMatch(/search_path=\\?"\\?"/);
        expect({ fn: row['proname'], guarded: row['guarded'] }).toEqual({
          fn: row['proname'],
          guarded: true
        });
      }
    }
  );

  it.skipIf(!environment.env)(
    'lets browser clients read their community Leagues and write nothing directly',
    async () => {
      const community = await world.newCommunity(world.admin.id);
      await executeTrustedSql(
        `insert into public.community_members(community_id, user_id, role, status, valid_from)
         values (${sqlText(community)}, ${sqlText(world.member.id)}, 'member', 'active', now() - interval '1 day')`
      );
      const id = await seed({ communityId: community, endAt: null });

      const asMember = await world.member.client.from('leagues').select('id,name');
      expect(asMember.error).toBeNull();
      expect(asMember.data?.map((row) => row.id)).toEqual([id]);
      for (const actor of [world.outsider, world.former, world.provisional]) {
        const result = await actor.client
          .from('leagues')
          .select('id')
          .eq('community_id', community);
        expect(result.error).toBeNull();
        expect(result.data).toEqual([]);
      }
      expect((await world.admin.client.from('league_events').select('id')).error).not.toBeNull();
      const insert = await world.member.client.from('leagues').insert({
        community_id: community,
        owner_id: world.member.id,
        name: 'Direct write',
        timezone: 'UTC',
        start_at: '2031-01-01T00:00:00Z',
        end_mode: 'manual',
        status: 'upcoming',
        create_request_id: crypto.randomUUID(),
        create_input: {}
      });
      expect(insert.error).not.toBeNull();
      const update = await world.admin.client
        .from('leagues')
        .update({ name: 'Hijacked' })
        .eq('id', id);
      expect(update.error).not.toBeNull();
      expect((await leagueRow(id))['name']).not.toBe('Hijacked');
    }
  );

  it.skipIf(!environment.env)(
    'returns DTOs the TypeScript decoder accepts from the real database',
    async () => {
      const community = await world.newCommunity(world.admin.id);
      const id = await seed({
        communityId: community,
        ownerId: world.admin.id,
        timezone: 'Europe/Madrid'
      });
      const result = await world.admin.client.rpc('get_league', { p_league_id: id });
      expect(result.error).toBeNull();
      expect(decodeLeagueDetail(result.data).league).toMatchObject({
        id,
        status: 'upcoming',
        can_manage: true,
        period_locked: false
      });
    }
  );

  it.skipIf(!environment.env)(
    'preserves populated data when the League migrations are applied over it',
    async () => {
      const drop = `
      do $$ declare r record; begin
        for r in select p.oid::regprocedure as sig from pg_proc p join pg_namespace n on n.oid = p.pronamespace
            where n.nspname = 'public' and (p.proname like 'league\\_%' or p.proname like 'guard\\_league\\_%' or p.proname in ('create_league', 'list_leagues',
              'get_league', 'update_league', 'activate_league', 'close_league', 'process_due_leagues',
              'valid_league_timezone', 'touch_league')) loop
          execute 'drop function ' || r.sig || ' cascade';
        end loop;
      end $$;
      drop table public.league_events, public.leagues cascade;
      drop type public.league_end_mode, public.league_status;`;
      const strip = (name: string) =>
        readFileSync(resolve(process.cwd(), 'supabase/migrations', name), 'utf8')
          .replace(/^begin;\s*/m, '')
          .replace(/commit;\s*$/m, '');
      const snapshot = async (run: (sql: string) => Promise<{ rows: Record<string, unknown>[] }>) =>
        (
          await run(
            `select (select count(*) from public.communities) as communities,
                  (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.communities x) as communities_hash,
                  (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.community_members x) as members_hash,
                  (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.match_events x) as events_hash,
                  (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.player_profiles x) as profiles_hash,
                  (select md5(coalesce(string_agg(x::text, '|' order by x::text), '')) from public.global_player_ratings x) as ratings_hash`
          )
        ).rows[0];
      const before = await snapshot((sql) => queryTrustedSql(sql));
      expect(Number(before?.['communities'])).toBeGreaterThan(0);

      const connection = await openDedicatedSqlConnection();
      try {
        await connection.query('begin');
        await connection.query(drop);
        await connection.query(strip('20261101160000_league_domain.sql'));
        await connection.query(strip('20261101161000_league_commands.sql'));
        expect(await snapshot((sql) => connection.query(sql))).toEqual(before);
        // The rebuilt domain is usable and empty: a default row validates against the new constraints.
        const [count] = (await connection.query('select count(*) as n from public.leagues')).rows;
        expect(Number(count?.['n'])).toBe(0);
      } finally {
        await connection.query('rollback').catch(() => undefined);
        await connection.close();
      }
      // The rollback restored the migrated League objects, data included.
      const [restored] = await sqlRows(`select count(*)::int as n from public.leagues`);
      expect(Number(restored?.['n'])).toBeGreaterThan(0);
    }
  );
});
