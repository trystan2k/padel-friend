import { beforeAll, describe, expect, it } from 'vitest';
import { localSupabaseEnv } from './helpers/local-supabase-env';
import {
  levelReviewRow,
  levelReviewWorld,
  submitRequest,
  type LevelReviewWorld
} from './helpers/level-review-fixtures';
import { sqlText } from './helpers/provisional-player-fixtures';
import { executeTrustedSql, queryTrustedSql } from './helpers/sql-transport';

const environment = localSupabaseEnv();

const PUBLIC_RPCS = [
  'cancel_level_review_request',
  'get_level_review_access',
  'get_level_review_adjustment_preview',
  'get_level_review_admin_detail',
  'get_my_level_review_request',
  'list_level_review_queue',
  'list_my_level_review_requests',
  'mark_level_review_under_review',
  'resolve_level_review_request',
  'submit_level_review_request'
];

describe('level review schema', { timeout: 120_000 }, () => {
  let world: LevelReviewWorld;
  beforeAll(async () => {
    if (environment.env) world = await levelReviewWorld(environment.env, 'lrschema');
  });

  it.skipIf(!environment.env)(
    'enables RLS and withholds every write and role-table privilege from runtime roles',
    async () => {
      const tables = await queryTrustedSql(
        `select c.relname, c.relrowsecurity,
            has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as anon_any,
            has_table_privilege('service_role', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') as service_any,
            has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE') as auth_write,
            has_table_privilege('authenticated', c.oid, 'SELECT') as auth_table_select,
            has_any_column_privilege('authenticated', c.oid, 'SELECT') as auth_column_select
           from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('platform_admins', 'player_level_review_requests')
          order by 1`
      );
      expect(tables.rows).toEqual([
        {
          relname: 'platform_admins',
          relrowsecurity: true,
          anon_any: false,
          service_any: false,
          auth_write: false,
          auth_table_select: false,
          auth_column_select: false
        },
        {
          relname: 'player_level_review_requests',
          relrowsecurity: true,
          anon_any: false,
          service_any: false,
          auth_write: false,
          auth_table_select: false,
          auth_column_select: true
        }
      ]);
      const columns = await queryTrustedSql(
        `select a.attname from pg_attribute a
          where a.attrelid = 'public.player_level_review_requests'::regclass and a.attnum > 0
            and not a.attisdropped
            and has_column_privilege('authenticated', a.attrelid, a.attnum, 'SELECT')
          order by 1`
      );
      const readable = columns.rows.map((row) => String(row['attname']));
      for (const hidden of [
        'command_id',
        'fingerprint',
        'decision_actor_id',
        'decision_command_id',
        'decision_fingerprint',
        'under_review_by',
        'snapshot_rating_revision'
      ])
        expect(readable).not.toContain(hidden);
    }
  );

  it.skipIf(!environment.env)(
    'installs restrictive provisional-actor policies on both new tables',
    async () => {
      const policies = await queryTrustedSql(
        `select tablename from pg_policies
          where schemaname = 'public' and policyname = 'provisional actor restricted'
            and permissive = 'RESTRICTIVE'
            and tablename in ('platform_admins', 'player_level_review_requests') order by 1`
      );
      expect(policies.rows.map((row) => row['tablename'])).toEqual([
        'platform_admins',
        'player_level_review_requests'
      ]);
    }
  );

  it.skipIf(!environment.env)(
    'exposes only the ten commands and readers, each a pinned SECURITY DEFINER guarded against provisional actors',
    async () => {
      const rows = await queryTrustedSql(
        `select p.proname, p.prosecdef, p.proconfig = array['search_path=""'] as pinned,
            has_function_privilege('anon', p.oid, 'EXECUTE') as anon_exec,
            has_function_privilege('service_role', p.oid, 'EXECUTE') as service_exec,
            has_function_privilege('authenticated', p.oid, 'EXECUTE') as auth_exec,
            position('assert_actor_not_provisional' in pg_get_functiondef(p.oid)) > 0 as guarded
           from pg_proc p join pg_namespace n on n.oid = p.pronamespace
          where n.nspname = 'public' and (p.proname like '%level%review%' or p.proname = 'is_platform_admin')
          order by 1`
      );
      const executable = rows.rows.filter((row) => row['auth_exec']);
      expect(executable.map((row) => row['proname'])).toEqual(PUBLIC_RPCS);
      for (const row of executable)
        expect(row).toMatchObject({
          prosecdef: true,
          pinned: true,
          guarded: true
        });
      for (const row of rows.rows) {
        expect(row['anon_exec']).toBe(false);
        expect(row['service_exec']).toBe(false);
      }
      const names = rows.rows.map((row) => row['proname']);
      expect(names).toContain('is_platform_admin');
      expect(executable.map((row) => row['proname'])).not.toContain('is_platform_admin');
    }
  );

  it.skipIf(!environment.env)(
    'enforces one active request per owner with a partial unique index',
    async () => {
      const index = await queryTrustedSql(
        `select indexdef from pg_indexes where schemaname = 'public'
          and indexname = 'level_review_one_active_per_owner'`
      );
      expect(String(index.rows[0]?.['indexdef'])).toMatch(
        /UNIQUE.*\(owner_id\).*pending.*under_review/s
      );
      await submitRequest(world.owner);
      await expect(
        executeTrustedSql(`insert into public.player_level_review_requests(owner_id, command_id, fingerprint,
            snapshot_display_level, snapshot_reliability_percent, snapshot_rating_revision,
            requested_min_level, requested_max_level, reason)
          values (${sqlText(world.owner.id)}, gen_random_uuid(), 'x', 4, 10, 0, 4, 5, 'dup')`)
      ).rejects.toThrow(/level_review_one_active_per_owner/);
    }
  );

  it.skipIf(!environment.env)(
    'rejects malformed rows: range, bounds, text shape and approval without an adjustment',
    async () => {
      const insert = (columns: string, values: string) =>
        executeTrustedSql(`insert into public.player_level_review_requests(owner_id, command_id, fingerprint,
            snapshot_display_level, snapshot_reliability_percent, snapshot_rating_revision, ${columns})
          values (${sqlText(world.other.id)}, gen_random_uuid(), 'x', 4, 10, 0, ${values})`);
      const base = 'requested_min_level, requested_max_level, reason';
      await expect(insert(base, "5, 4, 'r'")).rejects.toThrow(/level_review_range_ordered/);
      await expect(insert(base, "4, 7.5, 'r'")).rejects.toThrow(/check constraint/);
      await expect(insert(base, "4, 5, ''")).rejects.toThrow(/check constraint/);
      await expect(insert(base, "4, 5, ' padded '")).rejects.toThrow(/check constraint/);
      await expect(insert(`${base}, evidence`, `4, 5, 'r', '${'e'.repeat(4001)}'`)).rejects.toThrow(
        /check constraint/
      );
      for (const status of ['approved', 'rejected', 'under_review'])
        await expect(insert(`${base}, status`, `4, 5, 'r', '${status}'`)).rejects.toThrow(
          /level_review_status_shape/
        );
    }
  );

  it.skipIf(!environment.env)(
    'guards the lifecycle in the database: immutable submission, forward-only status, no delete or truncate',
    async () => {
      const id = await submitRequest(world.other);
      const update = (set: string) =>
        executeTrustedSql(
          `update public.player_level_review_requests set ${set} where id = ${sqlText(id)}`
        );
      await expect(update("reason = 'changed'")).rejects.toThrow(
        /LEVEL_REVIEW_SUBMISSION_IMMUTABLE/
      );
      await expect(update('requested_max_level = 6')).rejects.toThrow(
        /LEVEL_REVIEW_SUBMISSION_IMMUTABLE/
      );
      await expect(update(`owner_id = ${sqlText(world.owner.id)}`)).rejects.toThrow(
        /LEVEL_REVIEW_SUBMISSION_IMMUTABLE/
      );
      await expect(update("status = 'pending'")).rejects.toThrow(/LEVEL_REVIEW_INVALID_TRANSITION/);
      await expect(
        executeTrustedSql(
          `delete from public.player_level_review_requests where id = ${sqlText(id)}`
        )
      ).rejects.toThrow(/LEVEL_REVIEW_EVIDENCE_IMMUTABLE/);
      await expect(
        // CASCADE: adjustments now reference requests, so a plain TRUNCATE fails earlier on the FK.
        executeTrustedSql('truncate public.player_level_review_requests cascade')
      ).rejects.toThrow(/LEVEL_REVIEW_EVIDENCE_IMMUTABLE/);

      const canceled = await world.other.client.rpc('cancel_level_review_request', {
        p_request_id: id
      });
      expect(canceled.error).toBeNull();
      await expect(update("status = 'pending'")).rejects.toThrow(/LEVEL_REVIEW_TERMINAL_IMMUTABLE/);
      await expect(
        update(
          `status = 'under_review', under_review_at = now(), under_review_by = ${sqlText(world.platformAdmin.id)}`
        )
      ).rejects.toThrow(/LEVEL_REVIEW_TERMINAL_IMMUTABLE/);
      expect(await levelReviewRow(id)).toMatchObject({ status: 'canceled' });
    }
  );
});
