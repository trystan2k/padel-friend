import { createClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import { classifyPrivilegeViolations, readPrivilegeCatalog } from './helpers/privilege-guard';
import { openDedicatedSqlConnection, queryTrustedSql } from './helpers/sql-transport';
import type { Database } from '../src/lib/supabase/database.types';

const environment = localSupabaseEnv();
if (!environment.env)
  throw new Error(`Privilege suite requires live local Supabase: ${environment.reason}`);
const { url, key } = environment.env;

/** Runs `body` on one backend inside a transaction that is always rolled back. */
async function inRolledBackTransaction<T>(
  body: (query: (sql: string) => ReturnType<typeof queryTrustedSql>) => Promise<T>
): Promise<T> {
  const connection = await openDedicatedSqlConnection();
  try {
    await connection.query('begin');
    try {
      return await body((sql) => connection.query(sql));
    } finally {
      await connection.query('rollback');
    }
  } finally {
    await connection.close();
  }
}

describe('database privilege guard (live catalog)', () => {
  it('has no anon-executable SECURITY DEFINER functions, RLS-less public tables or anon grants', async () => {
    const catalog = await readPrivilegeCatalog((sql) => queryTrustedSql(sql));
    expect(classifyPrivilegeViolations(catalog)).toEqual([]);
  });

  it('detects each violation class on injected temporary objects and cleans up', async () => {
    const violations = await inRolledBackTransaction(async (query) => {
      await query(`create table public.zz_guard_probe (id int, secret text)`);
      await query(`grant truncate on public.zz_guard_probe to anon`);
      await query(`grant select (secret) on public.zz_guard_probe to anon`);
      await query(
        `create function public.zz_guard_definer(p_id uuid) returns int language sql security definer set search_path = '' as 'select 1'`
      );
      await query(`grant execute on function public.zz_guard_definer(uuid) to anon`);
      await query(
        `create function public.zz_guard_public_definer() returns int language sql security definer set search_path = '' as 'select 1'`
      );
      await query(`grant execute on function public.zz_guard_public_definer() to public`);
      return classifyPrivilegeViolations(await readPrivilegeCatalog(query));
    });
    expect(violations).toEqual(
      expect.arrayContaining([
        { rule: 'no-rls', subject: 'public.zz_guard_probe' },
        { rule: 'anon-grant', subject: 'public.zz_guard_probe:TRUNCATE' },
        { rule: 'anon-grant', subject: 'public.zz_guard_probe.secret:SELECT' },
        { rule: 'anon-definer-execute', subject: 'public.zz_guard_definer(p_id uuid)' },
        { rule: 'anon-definer-execute', subject: 'public.zz_guard_public_definer()' }
      ])
    );
    expect(violations).toHaveLength(5);
    const after = await readPrivilegeCatalog((sql) => queryTrustedSql(sql));
    expect(classifyPrivilegeViolations(after)).toEqual([]);
    const leftovers = await queryTrustedSql(
      `select to_regclass('public.zz_guard_probe') as t, to_regprocedure('public.zz_guard_definer(uuid)') as f`
    );
    expect(leftovers.rows[0]).toEqual({ t: null, f: null });
  });

  it('denies future tables, sequences and functions created by the migration owner', async () => {
    const probe = await inRolledBackTransaction(async (query) => {
      await query(`create table public.zz_default_probe (id serial primary key)`);
      await query(`create function public.zz_default_fn() returns int language sql as 'select 1'`);
      return query(`select
        (select current_user) as owner,
        has_table_privilege('anon', 'public.zz_default_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as anon_table,
        has_table_privilege('authenticated', 'public.zz_default_probe', 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') as auth_table,
        has_sequence_privilege('anon', 'public.zz_default_probe_id_seq', 'USAGE,SELECT,UPDATE') as anon_seq,
        has_sequence_privilege('authenticated', 'public.zz_default_probe_id_seq', 'USAGE,SELECT,UPDATE') as auth_seq,
        has_function_privilege('anon', 'public.zz_default_fn()', 'EXECUTE') as anon_fn,
        has_function_privilege('authenticated', 'public.zz_default_fn()', 'EXECUTE') as auth_fn,
        exists (select 1 from pg_proc p, aclexplode(p.proacl) a
          where p.oid = 'public.zz_default_fn()'::regprocedure and a.grantee = 0) as public_fn,
        has_table_privilege('service_role', 'public.zz_default_probe', 'SELECT') as service_table`);
    });
    expect(probe.rows[0]).toEqual({
      owner: 'postgres',
      anon_table: false,
      auth_table: false,
      anon_seq: false,
      auth_seq: false,
      anon_fn: false,
      auth_fn: false,
      public_fn: false,
      service_table: true
    });
  });

  it('keeps existing explicit authenticated access and the profile updated_at trigger working', async () => {
    const anon = createClient(url, key, { auth: { persistSession: false } });
    const signup = await anon.auth.signUp({
      email: `${crypto.randomUUID()}@example.test`,
      password: 'Password123!'
    });
    expect(signup.data.session).toBeTruthy();
    const client = createClient<Database>(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
    });
    expect(
      (
        await client.rpc('onboard_player', {
          p_display_name: 'Privilege Probe',
          p_preferred_side: 'EITHER',
          p_initial_level: 3.2
        })
      ).error
    ).toBeNull();
    const userId = signup.data.user!.id;
    const before = await client
      .from('player_profiles')
      .select('updated_at')
      .eq('user_id', userId)
      .single();
    expect(before.error).toBeNull();
    const updated = await client
      .from('player_profiles')
      .update({ bio: 'trigger probe' })
      .eq('user_id', userId)
      .select('bio, updated_at')
      .single();
    expect(updated.error).toBeNull();
    expect(updated.data?.bio).toBe('trigger probe');
    expect(new Date(updated.data!.updated_at).getTime()).toBeGreaterThan(
      new Date(before.data!.updated_at).getTime()
    );
    const trigger = await queryTrustedSql(
      `select has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
         has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_exec,
         p.prosecdef
       from pg_proc p where p.oid = 'public.touch_player_updated_at()'::regprocedure`
    );
    expect(trigger.rows[0]).toEqual({
      anon_exec: false,
      authenticated_exec: false,
      prosecdef: false
    });
  }, 60000);

  it('no longer has the legacy public.notes table', async () => {
    const result = await queryTrustedSql(`select to_regclass('public.notes') as t`);
    expect(result.rows[0]).toEqual({ t: null });
  });
});
