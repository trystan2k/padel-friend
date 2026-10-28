import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createMatchManagementFixtures,
  type ManagementActor
} from './helpers/match-management-fixtures';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';
import { fixtureSql, sqlRows, startSql, withDeadline } from './helpers/match-registration-sql';
import { matchPhotoFixture } from './helpers/match-photo-fixtures';

// PAF-7 / PAF-118 — result proposal and confirmation schema contracts.
//
// Proves the exact result-table constraints, transition guard, RLS/grants,
// preserved fact CHECKs and migration-history stability on real local Supabase.

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
const MIGRATION_VERSION = '20261028180302';
const PROBE_OK = 'PAF7_RESULTS_SCHEMA_PROBE_OK';

const q = (value: string) => `'${value.replaceAll("'", "''")}'`;

function runCli(args: string[]): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn('pnpm', ['exec', 'supabase', ...args], { cwd: process.cwd() });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

// Valid fact-set literals shared by the behavioral probe. Boundary played_at
// pairs use hand-verified literals so a sign flip in the consistency CHECK
// could never pass by construction.
const TEAMS_OK = (p: string[]) =>
  `'{"team_a":["${p[0]}","${p[1]}"],"team_b":["${p[2]}","${p[3]}"]}'::jsonb`;
const SET_OK = (position: number, a: number, b: number, completed: boolean) =>
  `{"position":${position},"team_a_games":${a},"team_b_games":${b},"completed":${completed}}`;
const SETS_OK = `'[${SET_OK(1, 6, 4, true)},${SET_OK(2, 4, 6, true)},${SET_OK(3, 5, 3, false)}]'::jsonb`;

const PROPOSAL_INSERT = (
  eventId: string,
  submitter: string,
  overrides: {
    group?: number;
    status?: string | null;
    activeVersion?: number | null;
    deadline?: string | null;
  } = {}
) =>
  `insert into public.match_event_result_proposals(match_event_id,group_number,status,active_version,review_deadline_at,submitted_by) values ('${eventId}',${overrides.group ?? 1},${overrides.status === null ? 'null' : q(overrides.status ?? 'pending')},${overrides.activeVersion === null ? 'null' : (overrides.activeVersion ?? 1)},${overrides.deadline === null ? 'null' : (overrides.deadline ?? `now() + interval '48 hours'`)},'${submitter}')`;

const VERSION_INSERT = (
  proposalId: string,
  players: string[],
  overrides: {
    version?: number | null;
    teams?: string;
    sets?: string;
    classification?: string | null;
    utc?: string | null;
    local?: string | null;
    offset?: number | null;
    court?: string | null;
    /** Raw SQL expression for court_label, for cases the CHECK must reject. */
    courtRaw?: string;
  } = {}
) =>
  `insert into public.match_event_result_proposal_versions(proposal_id,version,submitted_by,submitted_at,review_deadline_at,teams,sets,classification,played_at_utc,played_at_local,played_at_offset_seconds,court_label)
    select '${proposalId}',${overrides.version === null ? 'null' : (overrides.version ?? 50)},
      coalesce((select submitted_by from public.match_event_result_proposals where id='${proposalId}'),'${players[0]}'),
      coalesce((select submitted_at from public.match_event_result_proposals where id='${proposalId}'),'2030-06-13 18:30:00+00'::timestamptz),
      coalesce((select review_deadline_at from public.match_event_result_proposals where id='${proposalId}'),'2030-06-15 18:30:00+00'::timestamptz),
      ${overrides.teams ?? TEAMS_OK(players)},${overrides.sets ?? SETS_OK},${overrides.classification === null ? 'null' : q(overrides.classification ?? 'team_b')},${overrides.utc === null ? 'null' : q(overrides.utc ?? '2030-06-15 18:30:00+00') + '::timestamptz'},${overrides.local === null ? 'null' : q(overrides.local ?? '2030-06-15 20:30:00') + '::timestamp'},${overrides.offset === null ? 'null' : (overrides.offset ?? 7200)},${overrides.courtRaw ?? (overrides.court === undefined ? q('Court 3') : overrides.court === null ? 'null' : q(overrides.court))};`;

type RejectionCase = {
  label: string;
  kind: 'check' | 'unique' | 'foreign' | 'not_null';
  stmt: string;
};

describe('match result proposal schema integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'declares exactly the proposal catalog, RLS topology, grants matrix and command action extension',
    async () => {
      await expect(
        fixtureSql(`do $$
      declare
        v_count integer;
        v_def text;
        v_text text;
        v_triggerdef text;
        v_role text;
        v_operation text;
        v_allowed boolean;
        v_column record;
       begin
         -- Result facts and evidence relations, RLS enabled but not forced.
         select count(*) into v_count from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public'
            and c.relname in ('match_event_result_proposals', 'match_event_result_proposal_versions',
              'match_event_result_reviews', 'match_event_result_confirmations',
              'match_event_result_processing_state')
            and c.relkind = 'r';
         if v_count <> 5 then raise exception 'expected five result relations, got %', v_count; end if;
         if exists (
           select 1 from pg_class c join pg_namespace n on n.oid = c.relnamespace
          where n.nspname = 'public' and c.relname in ('match_event_result_proposals',
            'match_event_result_proposal_versions', 'match_event_result_reviews',
            'match_event_result_confirmations', 'match_event_result_processing_state')
            and (not c.relrowsecurity or c.relforcerowsecurity or pg_get_userbyid(c.relowner) <> 'postgres')
         ) then raise exception 'result tables must be RLS-enabled, unforced, owner postgres'; end if;

        -- Proposals: exactly one SELECT policy for authenticated; no other policies.
        select count(*) into v_count from pg_policies
         where schemaname = 'public' and tablename = 'match_event_result_proposals';
        if v_count <> 1 then raise exception 'proposals must carry exactly one policy, got %', v_count; end if;
        select cmd, roles::text into v_def, v_text from pg_policies
         where schemaname = 'public' and tablename = 'match_event_result_proposals';
        if v_def <> 'SELECT' or v_text is distinct from '{authenticated}' then
          raise exception 'proposal policy must be SELECT for authenticated only, got %/%', v_def, v_text;
        end if;
        select policyname into v_def from pg_policies
         where schemaname = 'public' and tablename = 'match_event_result_proposals'
           and qual ilike '%is_community_admin%'
           and qual ilike '%created_by%'
           and qual ilike '%match_event_registrations%'
           and qual ilike '%lifecycle = ''accepted''%';
        if v_def is null then raise exception 'proposal policy misses creator/admin/accepted-participant branches'; end if;
         if exists (
           select 1 from pg_policies
          where schemaname = 'public' and tablename = 'match_event_result_proposal_versions'
         ) then raise exception 'versions must have no policies'; end if;
         foreach v_def in array array['match_event_result_reviews', 'match_event_result_confirmations'] loop
           select count(*) into v_count from pg_policies
            where schemaname = 'public' and tablename = v_def and cmd = 'SELECT'
              and roles::text = '{authenticated}';
           if v_count <> 1 then raise exception '% must have one authorized SELECT policy', v_def; end if;
         end loop;
         if exists (select 1 from pg_policies where schemaname = 'public'
           and tablename = 'match_event_result_processing_state') then
           raise exception 'processing state must be internal-only';
         end if;

        -- Grants matrix: authenticated may only SELECT proposals; nothing else anywhere.
        foreach v_role in array array['anon', 'authenticated', 'public'] loop
          foreach v_operation in array array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER'] loop
            select has_table_privilege(v_role, 'public.match_event_result_proposals', v_operation) into v_allowed;
            if v_allowed is distinct from (v_role = 'authenticated' and v_operation = 'SELECT') then
              raise exception 'proposal grant matrix violated for % %', v_role, v_operation;
            end if;
             select has_table_privilege(v_role, 'public.match_event_result_proposal_versions', v_operation) into v_allowed;
             if v_allowed then raise exception 'versions must grant nothing: % %', v_role, v_operation; end if;
             select has_table_privilege(v_role, 'public.match_event_result_reviews', v_operation) into v_allowed;
             if v_allowed is distinct from (v_role = 'authenticated' and v_operation = 'SELECT') then
               raise exception 'review grant matrix violated for % %', v_role, v_operation;
             end if;
             select has_table_privilege(v_role, 'public.match_event_result_confirmations', v_operation) into v_allowed;
             if v_allowed is distinct from (v_role = 'authenticated' and v_operation = 'SELECT') then
               raise exception 'confirmation grant matrix violated for % %', v_role, v_operation;
             end if;
             select has_table_privilege(v_role, 'public.match_event_result_processing_state', v_operation) into v_allowed;
             if v_allowed then raise exception 'processing state must grant nothing: % %', v_role, v_operation; end if;
           end loop;
         end loop;

        -- Proposals catalog: identity, pointer facts, uniqueness and FKs.
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposals'::regclass and contype = 'p';
        if v_def is null or v_def not ilike '%primary key%(id)%' then raise exception 'proposals PK mismatch: %', v_def; end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposals'::regclass and contype = 'u';
        if v_def is null or v_def not ilike '%unique%(match_event_id, group_number)%' then
          raise exception 'proposals active-pointer uniqueness missing: %', v_def;
        end if;
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_result_proposals'::regclass and contype = 'f'
           and pg_get_constraintdef(oid) ilike '%foreign key (match_event_id) references match_events(id) on delete restrict%';
        if v_count <> 1 then raise exception 'proposals event FK must be RESTRICT'; end if;
         select count(*) into v_count from pg_constraint
          where conrelid = 'public.match_event_result_proposals'::regclass and contype = 'f'
            and pg_get_constraintdef(oid) ilike '%foreign key (submitted_by) references auth.users(id) on delete restrict%';
         if v_count <> 1 then raise exception 'proposals submitter FK must be RESTRICT'; end if;
         select count(*) into v_count from pg_constraint
          where conrelid = 'public.match_event_result_proposals'::regclass
            and conname = 'match_result_proposal_active_version_fk' and condeferrable and condeferred;
         if v_count <> 1 then raise exception 'active-version FK must be deferred'; end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposals'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%group_number%';
        if v_def is null or v_def not ilike '%group_number >= 1%' or v_def not ilike '%9007199254740991%' then
          raise exception 'group_number bounds missing: %', v_def;
        end if;
         select pg_get_constraintdef(oid) into v_def from pg_constraint
          where conrelid = 'public.match_event_result_proposals'::regclass
            and conname = 'match_event_result_proposals_status_check';
         foreach v_text in array array['pending', 'disputed', 'confirmed'] loop
           if v_def is null or position(quote_literal(v_text) in v_def) = 0 then
             raise exception 'status CHECK misses %: %', v_text, v_def;
           end if;
         end loop;
        foreach v_def in array array['status', 'active_version', 'review_deadline_at', 'submitted_by', 'submitted_at', 'group_number', 'match_event_id'] loop
          select is_nullable, column_default into v_text, v_triggerdef from information_schema.columns
           where table_schema = 'public' and table_name = 'match_event_result_proposals' and column_name = v_def;
          if v_text <> 'NO' then raise exception 'proposals.% must be NOT NULL', v_def; end if;
          if v_def = 'submitted_at' and (v_triggerdef is null or v_triggerdef not ilike '%now()%') then
            raise exception 'submitted_at must default to now()';
          end if;
        end loop;
        select udt_name into v_text from information_schema.columns
         where table_schema = 'public' and table_name = 'match_event_result_proposals' and column_name = 'group_number';
        if v_text <> 'int8' then raise exception 'group_number must be bigint'; end if;

        -- Versions catalog: composite PK, RESTRICT FK, shapes and played_at triple.
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'p';
        if v_def is null or v_def not ilike '%primary key%(proposal_id, version)%' then
          raise exception 'versions PK mismatch: %', v_def;
        end if;
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'f'
           and pg_get_constraintdef(oid) ilike '%foreign key (proposal_id) references match_event_result_proposals(id) on delete restrict%';
        if v_count <> 1 then raise exception 'versions FK must be RESTRICT'; end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%version >= 1%';
        if v_def is null then raise exception 'version positivity CHECK missing'; end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) ilike '%jsonb_typeof(teams)%';
        if v_def is null or v_def not ilike '%[0-9a-f]{8}%' or v_def not ilike '%{12}$%' then
          raise exception 'teams shape CHECK missing or not uuid-canonical: %', v_def;
        end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%position%' and pg_get_constraintdef(oid) ilike '%completed%';
        if v_def is null or v_def not ilike '%^[0-7]$%' or v_def not ilike '%''1''%' or v_def not ilike '%''3''%' then
          raise exception 'sets shape CHECK missing: %', v_def;
        end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%classification%';
        foreach v_text in array array['team_a', 'team_b', 'draw', 'incomplete'] loop
          if v_def is null or position(quote_literal(v_text) in v_def) = 0 then
            raise exception 'classification CHECK misses %: %', v_text, v_def;
          end if;
        end loop;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
            and pg_get_constraintdef(oid) ilike '%played_at_offset_seconds >=%';
        if v_def is null or v_def not ilike '%60)%' then raise exception 'offset bounds/alignment CHECK missing: %', v_def; end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%btrim%';
        if v_def is null or v_def not ilike '%100%' or v_def not ilike '%cntrl%' then
          raise exception 'court_label CHECK missing: %', v_def;
        end if;
        select pg_get_constraintdef(oid) into v_def from pg_constraint
         where conrelid = 'public.match_event_result_proposal_versions'::regclass and contype = 'c'
           and pg_get_constraintdef(oid) ilike '%make_interval%';
        if v_def is null or v_def not ilike '%at time zone ''UTC''%' then
          raise exception 'played_at triple consistency CHECK missing: %', v_def;
        end if;
         for v_column in select * from (values
           ('teams', 'jsonb', 'NO'), ('sets', 'jsonb', 'NO'),
           ('played_at_utc', 'timestamptz', 'NO'), ('played_at_local', 'timestamp', 'NO'),
           ('played_at_offset_seconds', 'int4', 'NO'), ('classification', 'text', 'NO'),
           ('court_label', 'text', 'YES'), ('version', 'int8', 'NO'), ('proposal_id', 'uuid', 'NO'),
           ('submitted_by', 'uuid', 'NO'), ('submitted_at', 'timestamptz', 'NO'),
           ('review_deadline_at', 'timestamptz', 'NO')
        ) as c(column_name, udt_name, nullability) loop
          select udt_name, is_nullable into v_text, v_triggerdef from information_schema.columns
           where table_schema = 'public' and table_name = 'match_event_result_proposal_versions'
             and column_name = v_column.column_name;
          if v_text is distinct from v_column.udt_name or v_triggerdef is distinct from v_column.nullability then
            raise exception 'versions.% expected %/%, got %/%', v_column.column_name, v_column.udt_name,
              v_column.nullability, v_text, v_triggerdef;
          end if;
        end loop;

         -- Pointer transitions are narrow; immutable fact versions remain append-only.
         foreach v_triggerdef in array array[
           'match_result_proposal_transition_guard', 'match_result_proposal_version_immutable'
         ] loop
          select pg_get_triggerdef(oid) into v_def from pg_trigger
           where tgrelid in ('public.match_event_result_proposals'::regclass, 'public.match_event_result_proposal_versions'::regclass)
             and tgname = v_triggerdef and not tgisinternal;
           if v_def is null or v_def not ilike '%BEFORE DELETE OR UPDATE%' then
             raise exception 'result guard % missing or wrong events: %', v_triggerdef, v_def;
           end if;
         end loop;
          if has_function_privilege('anon', 'public.finalize_match_event_result_locked(uuid,bigint,text,uuid)', 'EXECUTE')
            or has_function_privilege('authenticated', 'public.finalize_match_event_result_locked(uuid,bigint,text,uuid)', 'EXECUTE') then
            raise exception 'internal finalizer EXECUTE must be denied to browser roles';
          end if;
          foreach v_def in array array[
            'public.guard_match_result_review_immutable()',
            'public.guard_match_event_result_confirmation_insert()',
            'public.guard_match_result_proposal_transition()',
            'public.check_match_result_proposal_pointer()',
            'public.check_match_result_confirmation_pointer()',
            'public.has_match_event_result_approval_coverage(uuid,bigint,uuid)',
            'public.guard_match_event_audit()'
          ] loop
            if has_function_privilege('anon', v_def, 'EXECUTE')
              or has_function_privilege('authenticated', v_def, 'EXECUTE') then
              raise exception 'internal function EXECUTE must be denied to browser roles: %', v_def;
            end if;
          end loop;
          if has_function_privilege('anon', 'public.get_match_event_official_results(uuid)', 'EXECUTE')
            or not has_function_privilege('authenticated', 'public.get_match_event_official_results(uuid)', 'EXECUTE') then
            raise exception 'official result reader grants must be authenticated-only';
          end if;

        -- The migration documents the PAF-102 protection contract it fulfills.
        if obj_description('public.match_event_result_proposals'::regclass) not ilike '%protect_match_event_results%'
          or obj_description('public.match_event_result_proposal_versions'::regclass) not ilike '%protect_match_event_results%' then
          raise exception 'table comments must state the PAF-102 protection contract';
        end if;

         -- Command-ledger and audit vocabulary extended additively.
         select pg_get_constraintdef(oid) into v_def from pg_constraint
          where conrelid = 'public.match_event_management_commands'::regclass
            and conname = 'match_event_management_commands_action_check';
         if v_def is null then raise exception 'command action CHECK missing'; end if;
         foreach v_text in array array['withdraw', 'remove', 'transfer', 'cancel', 'edit', 'reconfirm',
           'submit_result', 'review_result', 'correct_result'] loop
           if position(quote_literal(v_text) in v_def) = 0 then
             raise exception 'command action CHECK lost %: %', v_text, v_def;
           end if;
         end loop;
         select pg_get_constraintdef(oid) into v_def from pg_constraint
          where conrelid = 'public.match_event_audit_log'::regclass
            and conname = 'match_event_audit_log_action_check';
         foreach v_text in array array['result_approved', 'result_disputed', 'result_corrected', 'result_confirmed'] loop
           if v_def is null or position(quote_literal(v_text) in v_def) = 0 then
             raise exception 'audit action CHECK lost %: %', v_text, v_def;
           end if;
         end loop;
       end $$;`)
      ).resolves.toBeUndefined();
    },
    60000
  );

  it.skipIf(!environment.env)(
    'enforces proposal facts, played_at consistency, jsonb shapes and append-only guards with exact SQLSTATEs',
    async () => {
      const players = Array.from({ length: 4 }, () => crypto.randomUUID());
      const communityId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const proposalId = crypto.randomUUID();

      const rejections: RejectionCase[] = [
        {
          label: 'group zero',
          kind: 'check',
          stmt: PROPOSAL_INSERT(eventId, players[0]!, { group: 0 })
        },
        {
          label: 'group above js-safe maximum',
          kind: 'check',
          stmt: PROPOSAL_INSERT(eventId, players[0]!, { group: 9007199254740992 })
        },
        {
          label: 'status null',
          kind: 'not_null',
          stmt: PROPOSAL_INSERT(eventId, players[0]!, { status: null })
        },
        {
          label: 'active_version null',
          kind: 'not_null',
          stmt: PROPOSAL_INSERT(eventId, players[0]!, { activeVersion: null })
        },
        {
          label: 'review deadline null',
          kind: 'not_null',
          stmt: PROPOSAL_INSERT(eventId, players[0]!, { deadline: null })
        },
        {
          label: 'submitter null',
          kind: 'not_null',
          stmt: PROPOSAL_INSERT(eventId, players[0]!).replace(`,'${players[0]!}'`, ',null')
        },
        {
          label: 'event null',
          kind: 'not_null',
          stmt: PROPOSAL_INSERT(eventId, players[0]!).replace(`'${eventId}'`, 'null')
        },
        {
          label: 'unknown event',
          kind: 'foreign',
          stmt: PROPOSAL_INSERT(crypto.randomUUID(), players[0]!)
        },
        {
          label: 'unknown submitter',
          kind: 'foreign',
          stmt: PROPOSAL_INSERT(eventId, crypto.randomUUID())
        },
        {
          label: 'duplicate active proposal per event and group',
          kind: 'unique',
          stmt: PROPOSAL_INSERT(eventId, players[1]!, { group: 2 })
        },
        {
          label: 'proposal delete rejected',
          kind: 'check',
          stmt: `delete from public.match_event_result_proposals where id = '${proposalId}'`
        }
      ];
      const versionCases: RejectionCase[] = [
        {
          label: 'teams not an object',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { teams: `'[]'::jsonb` })
        },
        {
          label: 'teams missing team_b key',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]}","${players[1]}"]}'::jsonb`
          })
        },
        {
          label: 'teams extra key',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]}","${players[1]}"],"team_b":["${players[2]}","${players[3]}"],"bye":1}'::jsonb`
          })
        },
        {
          label: 'team_a with three players',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]}","${players[1]}","${players[2]}"],"team_b":["${players[2]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'team_a with one player',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]}"],"team_b":["${players[2]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'team element not a uuid',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["not-a-uuid","${players[1]}"],"team_b":["${players[2]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'team element numeric',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":[1,2],"team_b":["${players[2]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'duplicate player across teams',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]}","${players[1]}"],"team_b":["${players[0]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'duplicate player within team_b',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]}","${players[1]}"],"team_b":["${players[2]}","${players[2]}"]}'::jsonb`
          })
        },
        {
          label: 'uppercase uuid rejected outside canonical form',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":["${players[0]!.toUpperCase()}","${players[1]}"],"team_b":["${players[2]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'JSON null player',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'${JSON.stringify({ team_a: [null, players[1]], team_b: [players[2], players[3]] })}'::jsonb`
          })
        },
        {
          label: 'SQL null teams',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { teams: 'null' })
        },
        {
          label: 'SQL null sets',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { sets: 'null' })
        },
        {
          label: 'team_a not an array',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            teams: `'{"team_a":"${players[0]}","team_b":["${players[2]}","${players[3]}"]}'::jsonb`
          })
        },
        {
          label: 'sets not an array',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { sets: `'{}'::jsonb` })
        },
        {
          label: 'sets empty',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { sets: `'[]'::jsonb` })
        },
        {
          label: 'four set rows',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[${SET_OK(1, 6, 4, true)},${SET_OK(2, 4, 6, true)},${SET_OK(3, 5, 3, false)},${SET_OK(4, 6, 0, true)}]'::jsonb`
          })
        },
        {
          label: 'set row missing completed',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[{"position":1,"team_a_games":6,"team_b_games":4}]'::jsonb`
          })
        },
        {
          label: 'set row extra key',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true,"tiebreak":true}]'::jsonb`
          })
        },
        {
          label: 'position zero',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { sets: `'[${SET_OK(0, 6, 4, true)}]'::jsonb` })
        },
        {
          label: 'position four',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { sets: `'[${SET_OK(4, 6, 4, true)}]'::jsonb` })
        },
        {
          label: 'position as string',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[{"position":"1","team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb`
          })
        },
        {
          label: 'position decimal',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[{"position":1.0,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb`
          })
        },
        {
          label: 'games eight',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { sets: `'[${SET_OK(1, 8, 4, true)}]'::jsonb` })
        },
        {
          label: 'games negative',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[${SET_OK(1, -1, 4, true)}]'::jsonb`
          })
        },
        {
          label: 'games as string',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[{"position":1,"team_a_games":"6","team_b_games":4,"completed":true}]'::jsonb`
          })
        },
        {
          label: 'completed as string',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, {
            sets: `'[{"position":1,"team_a_games":6,"team_b_games":4,"completed":"true"}]'::jsonb`
          })
        },
        {
          label: 'set row not an object',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { sets: `'[6]'::jsonb` })
        },
        {
          label: 'classification outside the closed list',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { classification: 'win' })
        },
        {
          label: 'classification null',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { classification: null })
        },
        {
          label: 'offset above bound',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { offset: 50401 })
        },
        {
          label: 'offset below bound',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { offset: -50401 })
        },
        {
          label: 'offset not minute aligned',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { offset: 61 })
        },
        {
          label: 'offset null',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { offset: null })
        },
        {
          label: 'played_at_local null',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { local: null })
        },
        {
          label: 'played_at_utc null',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { utc: null })
        },
        {
          label: 'utc instant off by one second',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { utc: '2030-06-15 18:30:01+00' })
        },
        {
          label: 'utc instant with sign-flipped offset',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { utc: '2030-06-15 22:30:00+00' })
        },
        {
          label: 'court label longer than 100 trimmed characters',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { court: 'C'.repeat(101) })
        },
        {
          label: 'court label blank after trimming',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { court: '   ' })
        },
        {
          label: 'court label not trimmed',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { court: ' Court 3 ' })
        },
        {
          label: 'court label with control character',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { courtRaw: `'Court ' || chr(1)` })
        },
        {
          label: 'version zero',
          kind: 'check',
          stmt: VERSION_INSERT(proposalId, players, { version: 0 })
        },
        {
          label: 'version null',
          kind: 'not_null',
          stmt: VERSION_INSERT(proposalId, players, { version: null })
        },
        {
          label: 'unknown proposal',
          kind: 'foreign',
          stmt: VERSION_INSERT(crypto.randomUUID(), players)
        },
        {
          label: 'duplicate proposal version',
          kind: 'unique',
          stmt: VERSION_INSERT(proposalId, players, { version: 1 })
        },
        {
          label: 'version update rejected',
          kind: 'check',
          stmt: `update public.match_event_result_proposal_versions set classification = 'draw' where proposal_id = '${proposalId}' and version = 1`
        },
        {
          label: 'version delete rejected',
          kind: 'check',
          stmt: `delete from public.match_event_result_proposal_versions where proposal_id = '${proposalId}' and version = 1`
        }
      ];

      const caseValues = [...rejections, ...versionCases]
        .map((entry) => `(${q(entry.label)},${q(entry.kind)},${q(entry.stmt)})`)
        .join(',\n        ');

      const photo = matchPhotoFixture(communityId, eventId, players[0]!);
      const probe = startSql(`do $probe$
      declare
        v_players uuid[] := array['${players[0]}','${players[1]}','${players[2]}','${players[3]}']::uuid[];
        v_case record;
        v_stored record;
       begin
        insert into auth.users(id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
          select u, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
            'paf71-results-' || u || '@test.local', 'x', now(), now(), now()
          from unnest(v_players) u;
        insert into public.communities(id, name, visibility, created_by)
          values ('${communityId}', 'Result schema fixture', 'public', '${players[0]}');
        -- Storage metadata is rolled back together with this constraint probe.
        ${photo.sql}
        alter table public.match_events disable trigger match_event_creator_registration;
        insert into public.match_events(id, community_id, created_by, starts_at, timezone, event_type, visibility,
            team_assignment_mode, venue_name, maps_url, photo_path, registration_cutoff_at, published_at, status)
          values ('${eventId}', '${communityId}', '${players[0]}', now() + interval '2 days', 'UTC', 'friendly',
            'community_open', 'POST_MATCH_TEAMS', 'Result court', 'https://maps.google.com/maps/x',
            '${photo.path}', now() + interval '1 day', now(), 'open');
        alter table public.match_events enable trigger match_event_creator_registration;

        -- Valid pointer row: defaults and anchors stored verbatim.
         insert into public.match_event_result_proposals(id, match_event_id, group_number, status, active_version,
             review_deadline_at, submitted_by, submitted_at)
           values ('${proposalId}', '${eventId}', 2, 'pending', 7, '2030-06-20 12:00:00+00'::timestamptz,
             '${players[0]}', '2030-06-18 12:00:00+00'::timestamptz);
        select * into v_stored from public.match_event_result_proposals where id = '${proposalId}';
        if v_stored.submitted_at is null or v_stored.status <> 'pending' or v_stored.group_number <> 2
          or v_stored.active_version <> 7 then
          raise exception 'valid proposal row stored wrong';
        end if;

        -- Valid version rows: canonical facts, trimmed court label stored verbatim,
        -- and both offset boundaries (+/-14h) with hand-verified UTC literals.
        ${VERSION_INSERT(proposalId, players, { version: 1, court: 'Court 3' })}
        ${VERSION_INSERT(proposalId, players, {
          version: 2,
          classification: 'incomplete',
          sets: `'[${SET_OK(1, 6, 4, true)}]'::jsonb`,
          utc: '2030-06-01 22:00:00+00',
          local: '2030-06-02 12:00:00',
          offset: 50400,
          court: null
        })}
        ${VERSION_INSERT(proposalId, players, {
          version: 3,
          classification: 'draw',
          sets: `'[${SET_OK(1, 6, 4, true)},${SET_OK(2, 4, 6, true)}]'::jsonb`,
          utc: '2030-06-02 22:00:00+00',
          local: '2030-06-02 08:00:00',
          offset: -50400,
          court: 'C'.repeat(100)
        })}
        ${VERSION_INSERT(proposalId, players, { version: 7 })}
        select court_label into v_stored from public.match_event_result_proposal_versions
         where proposal_id = '${proposalId}' and version = 1;
        if v_stored.court_label is distinct from 'Court 3' then
          raise exception 'court label must be stored verbatim, got %', v_stored.court_label;
        end if;

        -- Every malformed fact must be rejected with exactly the expected SQLSTATE.
        for v_case in select * from (values
        ${caseValues}
        ) as c(label, kind, stmt) loop
          begin
            execute v_case.stmt;
            raise exception 'constraint failed to reject case: %', v_case.label;
          exception
            when check_violation then
              if v_case.kind <> 'check' then
                raise exception 'case % expected % but violated check', v_case.label, v_case.kind;
              end if;
            when unique_violation then
              if v_case.kind <> 'unique' then
                raise exception 'case % expected % but violated unique', v_case.label, v_case.kind;
              end if;
            when foreign_key_violation then
              if v_case.kind <> 'foreign' then
                raise exception 'case % expected % but violated foreign key', v_case.label, v_case.kind;
              end if;
            when not_null_violation then
              if v_case.kind <> 'not_null' then
                raise exception 'case % expected % but violated not null', v_case.label, v_case.kind;
              end if;
          end;
        end loop;

        raise exception '${PROBE_OK}' using errcode = 'P0001';
       end $probe$;`);
      try {
        const result = await withDeadline(probe.done, 30000, 'rollback-only schema probe');
        expect(result.code).not.toBe(0);
        expect(result.stdout + result.stderr).toContain(PROBE_OK);
      } finally {
        await probe.stop();
      }
    },
    120000
  );

  describe('reads and writes on the live API', () => {
    let f: Awaited<ReturnType<typeof createMatchManagementFixtures>>;

    beforeAll(async () => {
      if (!environment.env) return;
      f = await createMatchManagementFixtures(environment.env);
    });
    afterAll(async () => {
      if (f) await f.cleanup();
    });

    async function readProposals(actor: ManagementActor, proposalId: string) {
      const result = await actor.client
        .from('match_event_result_proposals')
        .select('*')
        .eq('id', proposalId);
      return { error: result.error?.code ?? null, rows: (result.data ?? []).length };
    }

    it.skipIf(!environment.env)(
      'allows creator, accepted participant and community admin reads; denies everyone and every client write',
      async () => {
        const e = await f.protectedEightPlayerEvent();
        const participant = e.players[1]!;
        const admin = await f.member();
        const outsider = await f.member();
        await fixtureSql(
          `update public.community_members set role = 'admin' where community_id = '${f.communityId}' and user_id = '${admin.id}'`
        );
        const proposalId = crypto.randomUUID();
        await fixtureSql(`do $fixture$ begin
        insert into public.match_event_result_proposals(id, match_event_id, group_number, status, active_version, review_deadline_at, submitted_by)
          values ('${proposalId}', '${e.id}', 1, 'pending', 1, now() + interval '48 hours', '${f.creator.id}');
        insert into public.match_event_result_proposal_versions(proposal_id, version, submitted_by, submitted_at, review_deadline_at, teams, sets, classification, played_at_utc, played_at_local, played_at_offset_seconds, court_label)
          select '${proposalId}', 1, p.submitted_by, p.submitted_at, p.review_deadline_at,
            '{"team_a":["${f.creator.id}","${participant.id}"],"team_b":["${admin.id}","${outsider.id}"]}'::jsonb,
            '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb,
            'incomplete', '2030-06-15 18:30:00+00'::timestamptz, '2030-06-15 20:30:00'::timestamp, 7200, 'Court 3'
            from public.match_event_result_proposals p where p.id = '${proposalId}';
      end $fixture$;`);

        // Authorized readers see the pending pointer with its facts.
        for (const actor of [f.creator, participant, admin]) {
          expect(await readProposals(actor, proposalId)).toEqual({ error: null, rows: 1 });
        }
        const creatorRow = await f.creator.client
          .from('match_event_result_proposals')
          .select('*')
          .eq('id', proposalId);
        expect(creatorRow.data?.[0]).toMatchObject({
          id: proposalId,
          match_event_id: e.id,
          group_number: 1,
          status: 'pending',
          active_version: 1,
          submitted_by: f.creator.id
        });

        // Same-community non-participant: RLS hides the row entirely.
        expect(await readProposals(outsider, proposalId)).toEqual({ error: null, rows: 0 });

        // Anonymous: denied at the ACL (no grant at all).
        const anon = createClient(environment.env!.url, environment.env!.key, {
          auth: { persistSession: false, autoRefreshToken: false }
        });
        expect((await anon.from('match_event_result_proposals').select('*')).error?.code).toBe(
          '42501'
        );

        // No client writes anywhere: proposals and versions are RPC-only surfaces.
        const writeDenied = async (probe: Promise<{ error: { code: string | null } | null }>) =>
          expect((await probe).error?.code).toBe('42501');
        await writeDenied(
          Promise.resolve(
            f.creator.client.from('match_event_result_proposals').insert({
              id: crypto.randomUUID(),
              match_event_id: e.id,
              group_number: 2,
              status: 'pending',
              active_version: 1,
              review_deadline_at: new Date('2030-06-20T12:00:00Z').toISOString(),
              submitted_by: f.creator.id
            })
          )
        );
        await writeDenied(
          Promise.resolve(
            f.creator.client
              .from('match_event_result_proposals')
              .update({ status: 'confirmed' })
              .eq('id', proposalId)
          )
        );
        await writeDenied(
          Promise.resolve(
            f.creator.client.from('match_event_result_proposals').delete().eq('id', proposalId)
          )
        );
        await writeDenied(
          Promise.resolve(f.creator.client.from('match_event_result_proposal_versions').select('*'))
        );
        await writeDenied(
          Promise.resolve(
            f.creator.client.from('match_event_result_proposal_versions').insert({
              proposal_id: proposalId,
              version: 9,
              submitted_by: f.creator.id,
              submitted_at: new Date().toISOString(),
              review_deadline_at: new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString(),
              teams: { team_a: [f.creator.id, participant.id], team_b: [admin.id, outsider.id] },
              sets: [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }],
              classification: 'team_a',
              played_at_utc: '2030-06-15T18:30:00Z',
              played_at_local: '2030-06-15 20:30:00',
              played_at_offset_seconds: 7200
            })
          )
        );
        await writeDenied(
          Promise.resolve(
            f.creator.client
              .from('match_event_result_proposal_versions')
              .update({ classification: 'draw' })
              .eq('proposal_id', proposalId)
          )
        );
        await writeDenied(
          Promise.resolve(
            f.creator.client
              .from('match_event_result_proposal_versions')
              .delete()
              .eq('proposal_id', proposalId)
          )
        );

        for (const actor of [f.creator, participant, admin]) {
          const reviews = await actor.client
            .from('match_event_result_reviews')
            .select('id')
            .eq('proposal_id', proposalId);
          const confirmations = await actor.client
            .from('match_event_result_confirmations')
            .select('id')
            .eq('proposal_id', proposalId);
          expect(reviews.error).toBeNull();
          expect(reviews.data).toEqual([]);
          expect(confirmations.error).toBeNull();
          expect(confirmations.data).toEqual([]);
        }
        expect(
          (
            await outsider.client
              .from('match_event_result_reviews')
              .select('id')
              .eq('proposal_id', proposalId)
          ).data
        ).toEqual([]);
        expect(
          (
            await outsider.client
              .from('match_event_result_confirmations')
              .select('id')
              .eq('proposal_id', proposalId)
          ).data
        ).toEqual([]);

        await writeDenied(
          Promise.resolve(
            f.creator.client.from('match_event_result_reviews').insert({
              proposal_id: proposalId,
              proposal_version: 1,
              reviewer_user_id: participant.id,
              decision: 'approve',
              request_id: crypto.randomUUID()
            })
          )
        );
        await writeDenied(
          Promise.resolve(
            f.creator.client.from('match_event_result_confirmations').insert({
              proposal_id: proposalId,
              proposal_version: 1,
              match_event_id: e.id,
              group_number: 1,
              source: 'MANUAL',
              effective_at: new Date().toISOString(),
              actor_id: participant.id,
              event_type: 'friendly',
              ratable_eligible: false
            })
          )
        );
        const processingRead = await f.creator.client
          .from('match_event_result_processing_state')
          .select('proposal_id')
          .eq('proposal_id', proposalId);
        expect(processingRead.error?.code).toBe('42501');
        await writeDenied(
          Promise.resolve(
            f.creator.client.from('match_event_result_processing_state').insert({
              proposal_id: proposalId
            })
          )
        );
      },
      120000
    );
  });

  it.skipIf(!environment.env)(
    'records the migration exactly once and stays stable under repeat-up',
    async () => {
      const historySql = `select version::text as version, (select max(version)::text from supabase_migrations.schema_migrations) as latest from supabase_migrations.schema_migrations where version = '${MIGRATION_VERSION}'`;
      const before = await sqlRows(historySql);
      expect(before).toHaveLength(1);
      expect(before[0]?.['version']).toBe(MIGRATION_VERSION);
      expect(String(before[0]?.['latest']) >= MIGRATION_VERSION).toBe(true);

      const repeat = await runCli(['migration', 'up', '--local']);
      expect(repeat.code, `repeat-up failed: ${repeat.stderr}`).toBe(0);

      const after = await sqlRows(historySql);
      expect(after).toEqual(before);
      const catalog = await sqlRows(`select
        (select count(*) from pg_policies where schemaname = 'public' and tablename = 'match_event_result_proposals') as policies,
        has_table_privilege('authenticated', 'public.match_event_result_proposals', 'SELECT') as read_granted,
        has_table_privilege('authenticated', 'public.match_event_result_proposals', 'INSERT') as write_granted,
        has_table_privilege('authenticated', 'public.match_event_result_proposal_versions', 'SELECT') as versions_granted,
        has_table_privilege('authenticated', 'public.match_event_result_reviews', 'SELECT') as reviews_granted,
        has_table_privilege('authenticated', 'public.match_event_result_reviews', 'INSERT') as reviews_write_granted,
        has_table_privilege('authenticated', 'public.match_event_result_confirmations', 'SELECT') as confirmations_granted,
        has_table_privilege('authenticated', 'public.match_event_result_confirmations', 'INSERT') as confirmations_write_granted,
        has_table_privilege('authenticated', 'public.match_event_result_processing_state', 'SELECT') as processing_granted`);
      expect(catalog).toEqual([
        {
          policies: 1,
          read_granted: true,
          write_granted: false,
          versions_granted: false,
          reviews_granted: true,
          reviews_write_granted: false,
          confirmations_granted: true,
          confirmations_write_granted: false,
          processing_granted: false
        }
      ]);
    },
    60000
  );
});
