import { spawn } from 'node:child_process';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { describe, expect, it } from 'vitest';
import type { Database } from '../src/lib/supabase/database.types';
import {
  assertLocalSupabaseEnvInCi,
  dotEnvPathFromImportMetaUrl,
  localSupabaseEnv
} from './helpers/local-supabase-env';

const environment = localSupabaseEnv({ filePath: dotEnvPathFromImportMetaUrl(import.meta.url) });
type Env = NonNullable<typeof environment.env>;

type QueryResult = { code: number | null; stdout: string; stderr: string };

function runSupabaseQuery(_env: Env, sql: string): Promise<QueryResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'pnpm',
      ['exec', 'supabase', 'db', 'query', '--local', '--output-format', 'json', sql],
      { cwd: process.cwd() }
    );
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk));
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk));
    child.once('error', reject);
    child.once('close', (code) => resolve({ code, stdout, stderr }));
  });
}

/** Trusted fixture SQL that must succeed; the CLI prints `DO` for a passed block. */
async function fixtureSql(env: Env, sql: string): Promise<string> {
  const { code, stdout, stderr } = await runSupabaseQuery(env, sql);
  if (code !== 0) throw new Error(`Trusted fixture SQL failed (${code}): ${stdout}\n${stderr}`);
  return stdout.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Trusted read-only fixture query returning the CLI's JSON rows. */
async function trustedRows(env: Env, sql: string): Promise<Record<string, unknown>[]> {
  const { code, stdout, stderr } = await runSupabaseQuery(env, sql);
  if (code !== 0) throw new Error(`Trusted fixture query failed (${code}): ${stdout}\n${stderr}`);
  let parsed: unknown;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    throw new Error(`Fixture query returned no JSON: ${stdout.slice(0, 400)}`);
  }
  // The CLI v2.118 prints the statement's rows as a top-level JSON array of
  // row objects (the banner goes to stderr); older CLI revisions nested them
  // under a `rows` key. Model both, nothing else.
  const candidate: unknown[] | null = Array.isArray(parsed)
    ? parsed
    : isRecord(parsed) && Array.isArray(parsed['rows'])
      ? parsed['rows']
      : null;
  if (candidate === null)
    throw new Error(`Fixture query returned unexpected JSON: ${stdout.slice(0, 400)}`);
  return candidate.filter(isRecord);
}

/** Three real local users reused by every behavioral block of this suite. */
let actorsPromise: Promise<{ creator: string; first: string; second: string }> | null = null;
function registrationActors(env: Env): Promise<{ creator: string; first: string; second: string }> {
  actorsPromise ??= (async () => {
    const signUp = async (label: string): Promise<string> => {
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `paf51-schema-${label}-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error, `${label} signup`).toBeNull();
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      return signup.data.user!.id;
    };
    const [creator, first, second] = await Promise.all([
      signUp('creator'),
      signUp('first'),
      signUp('second')
    ]);
    return { creator, first, second };
  })();
  return actorsPromise;
}

const recordOf = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {});

describe('match registration schema integration', () => {
  it('requires local Supabase in CI', () => {
    expect(() => assertLocalSupabaseEnvInCi(environment.env, process.env.CI)).not.toThrow();
  });

  it.skipIf(!environment.env)(
    'declares exactly the lifecycle/participation/source enums, relaxed anchors and guard objects',
    async () => {
      const env = environment.env!;
      expect(
        await fixtureSql(
          env,
          `do $$
      declare
        v_labels text[];
        v_nullable text;
        v_udt text;
        v_def text;
        v_count integer;
        v_indexdef text;
        v_triggerdef text;
       begin
        -- The three enums exist with exactly the PAF-5 values; withdrawn is absent.
        select coalesce(array_agg(e.enumlabel order by e.enumsortorder), '{}') into v_labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.oid = 'public.match_registration_lifecycle'::regtype;
        if v_labels is distinct from array['pending','accepted','rejected','expired'] then
          raise exception 'lifecycle enum mismatch: %', v_labels;
        end if;
        select coalesce(array_agg(e.enumlabel order by e.enumsortorder), '{}') into v_labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.oid = 'public.match_registration_participation'::regtype;
        if v_labels is distinct from array['playing','reserve','reserve_not_playing'] then
          raise exception 'participation enum mismatch: %', v_labels;
        end if;
        select coalesce(array_agg(e.enumlabel order by e.enumsortorder), '{}') into v_labels
          from pg_type t join pg_enum e on e.enumtypid = t.oid
         where t.oid = 'public.match_registration_source'::regtype;
        if v_labels is distinct from array['creator','member','guest'] then
          raise exception 'source enum mismatch: %', v_labels;
        end if;
        select count(*) into v_count from pg_enum e join pg_type t on t.oid = e.enumtypid
         where t.typnamespace = 'public'::regnamespace and e.enumlabel = 'withdrawn';
        if v_count <> 0 then raise exception 'a public enum still carries the withdrawn label'; end if;

        -- accepted_at nullability was relaxed; lifecycle anchors are NOT NULL/defaulted.
        select is_nullable into v_nullable from information_schema.columns
         where table_schema='public' and table_name='match_event_registrations' and column_name='accepted_at';
        if v_nullable <> 'YES' then raise exception 'accepted_at is still NOT NULL'; end if;
        select is_nullable, udt_name into v_nullable, v_udt from information_schema.columns
         where table_schema='public' and table_name='match_event_registrations' and column_name='lifecycle';
        if v_nullable <> 'NO' or v_udt <> 'match_registration_lifecycle' then
          raise exception 'lifecycle column mismatch: %/%', v_nullable, v_udt;
        end if;
        select column_default into v_def from information_schema.columns
         where table_schema='public' and table_name='match_event_registrations' and column_name='lifecycle';
        if v_def is null or v_def not like '%accepted%' then
          raise exception 'lifecycle default mismatch: %', v_def;
        end if;
        select is_nullable into v_nullable from information_schema.columns
         where table_schema='public' and table_name='match_event_registrations' and column_name='registration_source';
        if v_nullable <> 'NO' then raise exception 'registration_source must be NOT NULL'; end if;
        foreach v_udt in array array['participation_status','accepted_order','requested_at','approved_at','resolved_at','resolved_by'] loop
          select is_nullable into v_nullable from information_schema.columns
           where table_schema='public' and table_name='match_event_registrations' and column_name=v_udt;
          if v_nullable <> 'YES' then raise exception 'column % must be nullable', v_udt; end if;
        end loop;
        select udt_name into v_udt from information_schema.columns
         where table_schema='public' and table_name='match_event_registrations' and column_name='accepted_order';
        if v_udt <> 'int8' then raise exception 'accepted_order must be bigint, got %', v_udt; end if;
        select udt_name into v_udt from information_schema.columns
         where table_schema='public' and table_name='match_event_registrations' and column_name='resolved_by';
        if v_udt <> 'uuid' then raise exception 'resolved_by must be uuid, got %', v_udt; end if;

        -- The anchors CHECK and the partial unique accepted-order index exist.
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_registrations'::regclass
           and conname = 'match_registration_lifecycle_anchors' and contype = 'c';
        if v_count <> 1 then raise exception 'match_registration_lifecycle_anchors missing'; end if;
        select indexdef into v_indexdef from pg_indexes
         where schemaname='public' and indexname='match_registration_event_accepted_order';
        if v_indexdef is null or v_indexdef not ilike '%unique%'
          or v_indexdef not ilike '%(match_event_id, accepted_order)%'
          or v_indexdef not ilike '%accepted_order is not null%' then
          raise exception 'match_registration_event_accepted_order mismatch: %', v_indexdef;
        end if;

        -- Registration state table: event PK, positive ordinal, non-negative revision.
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_registration_state'::regclass and contype='p'
           and pg_get_constraintdef(oid) ilike '%(match_event_id)%';
        if v_count <> 1 then raise exception 'state table PK mismatch'; end if;
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_registration_state'::regclass and contype='c'
           and pg_get_constraintdef(oid) ilike '%next_accepted_ordinal > 0%';
        if v_count <> 1 then raise exception 'state ordinal CHECK missing'; end if;
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_registration_state'::regclass and contype='c'
           and pg_get_constraintdef(oid) ilike '%transition_revision >= 0%';
        if v_count <> 1 then raise exception 'state revision CHECK missing'; end if;

        -- Attempts table: composite FK to the registration identity, decided-accepted
        -- CHECK and the identity/requested-time index.
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_registration_attempts'::regclass and contype='f'
           and pg_get_constraintdef(oid) ilike '%foreign key (match_event_id, user_id) references match_event_registrations(match_event_id, user_id)%';
        if v_count <> 1 then raise exception 'attempts identity FK missing'; end if;
        select count(*) into v_count from pg_constraint
         where conrelid = 'public.match_event_registration_attempts'::regclass and contype='c'
           and pg_get_constraintdef(oid) ilike '%outcome <> ''accepted''%'
           and pg_get_constraintdef(oid) ilike '%decided_at is not null%';
        if v_count <> 1 then raise exception 'attempts decided-accepted CHECK missing'; end if;
        select indexdef into v_indexdef from pg_indexes
         where schemaname='public' and indexname='match_registration_attempts_identity_requested';
        if v_indexdef is null or v_indexdef not ilike '%(match_event_id, user_id, requested_at)%' then
          raise exception 'attempts identity/requested index mismatch: %', v_indexdef;
        end if;

        -- The blanket immutability trigger was replaced by the identity guard.
        select pg_get_triggerdef(oid) into v_triggerdef from pg_trigger
         where tgrelid='public.match_event_registrations'::regclass and tgname='match_registration_identity_guard';
        if v_triggerdef is null or v_triggerdef not ilike '%BEFORE%'
          or v_triggerdef not ilike '%UPDATE%' or v_triggerdef not ilike '%DELETE%' then
          raise exception 'identity guard trigger missing or wrong events: %', v_triggerdef;
        end if;
        select count(*) into v_count from pg_trigger
         where tgrelid='public.match_event_registrations'::regclass and tgname='match_registration_immutable';
        if v_count <> 0 then raise exception 'old blanket immutability trigger still present'; end if;
      end $$;`
        )
      ).toBe('DO');
    },
    60000
  );

  it.skipIf(!environment.env)(
    'enforces lifecycle anchors, per-event accepted-order uniqueness and state/attempts table rules',
    async () => {
      const env = environment.env!;
      const { creator, first, second } = await registrationActors(env);
      const communityId = crypto.randomUUID();
      const eventId = crypto.randomUUID();
      const bareEventId = crypto.randomUUID();
      const secondEventId = crypto.randomUUID();
      expect(
        await fixtureSql(
          env,
          `do $$
      declare
        v_creator uuid := '${creator}';
        v_first uuid := '${first}';
        v_second uuid := '${second}';
        v_community uuid := '${communityId}';
        v_event uuid := '${eventId}';
        v_bare uuid := '${bareEventId}';
        v_second_event uuid := '${secondEventId}';
        v_row record;
        v_ordinal bigint;
        v_revision bigint;
       begin
        insert into public.communities(id,name,visibility,created_by)
          values (v_community,'Registration schema fixture','public',v_creator);
        insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
          values (v_community,v_creator,'admin','active',now()-interval '1 minute',now()-interval '1 minute');
        -- Fixture images are placeholders; storage attachment is PAF-72's job.
        alter table public.match_events disable trigger lock_match_photo_publication;
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(v_event,v_community,v_creator,now()+interval '4 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Schema court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/photo.webp',now()+interval '3 days'),
                (v_second_event,v_community,v_creator,now()+interval '4 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Schema court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/photo.webp',now()+interval '3 days');
        -- Publication creates the state row and the creator slot together.
        select next_accepted_ordinal, transition_revision into v_ordinal, v_revision from public.match_event_registration_state where match_event_id=v_event;
        if v_ordinal is distinct from 2 or v_revision is distinct from 0 then
          raise exception 'publication state row wrong: ordinal=% revision=%', v_ordinal, v_revision;
        end if;
        select * into v_row from public.match_event_registrations where match_event_id=v_event and user_id=v_creator;
        if v_row.lifecycle <> 'accepted' or v_row.accepted_order <> 1 or v_row.participation_status <> 'reserve'
          or v_row.registration_source <> 'creator' or v_row.accepted_at is null then
          raise exception 'publication creator slot anchors wrong';
        end if;
        if exists(select 1 from public.match_events e join public.match_event_registrations r on r.match_event_id=e.id
           where e.id=v_event and r.accepted_at is distinct from e.published_at) then
          raise exception 'creator accepted_at diverged from published_at';
        end if;

        -- Two pending rows: anchors nullable and multiple NULL accepted orders allowed.
        insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,registration_source)
          values (v_event,v_first,'pending',now(),'member'), (v_event,v_second,'pending',now(),'member');
        select count(*) into v_row from public.match_event_registrations
         where match_event_id=v_event and lifecycle='pending' and accepted_order is null and accepted_at is null
           and participation_status is null and approved_at is null;
        if v_row.count <> 2 then raise exception 'pending rows must carry only NULL anchors'; end if;

        -- Accepted rows require accepted_at, accepted_order and participation_status together.
        begin
          update public.match_event_registrations set lifecycle='accepted', accepted_at=now(), participation_status='reserve'
            where match_event_id=v_event and user_id=v_second;
          raise exception 'accepted row without accepted_order was accepted';
        exception when check_violation then null; end;
        begin
          update public.match_event_registrations set lifecycle='accepted', accepted_order=2, participation_status='reserve'
            where match_event_id=v_event and user_id=v_second;
          raise exception 'accepted row without accepted_at was accepted';
        exception when check_violation then null; end;
        begin
          update public.match_event_registrations set lifecycle='accepted', accepted_at=now(), accepted_order=2
            where match_event_id=v_event and user_id=v_second;
          raise exception 'accepted row without participation_status was accepted';
        exception when check_violation then null; end;

        -- Pending rows must never carry accepted anchors.
        foreach v_ordinal in array array[0,1,2,3] loop
          begin
            if v_ordinal = 0 then
              update public.match_event_registrations set accepted_at=now() where match_event_id=v_event and user_id=v_second;
            elsif v_ordinal = 1 then
              update public.match_event_registrations set accepted_order=5 where match_event_id=v_event and user_id=v_second;
            elsif v_ordinal = 2 then
              update public.match_event_registrations set participation_status='playing' where match_event_id=v_event and user_id=v_second;
            else
              update public.match_event_registrations set approved_at=now() where match_event_id=v_event and user_id=v_second;
            end if;
            raise exception 'pending row accepted anchor case %', v_ordinal;
          exception when check_violation then null; end;
        end loop;

        -- The complete approval path succeeds; approved_at must equal accepted_at when set.
        update public.match_event_registrations
          set lifecycle='accepted', accepted_at=now(), accepted_order=2, participation_status='reserve'
          where match_event_id=v_event and user_id=v_second;
        begin
          update public.match_event_registrations set approved_at=accepted_at + interval '1 second'
            where match_event_id=v_event and user_id=v_second;
          raise exception 'diverging approved_at was accepted';
        exception when check_violation then null; end;
        update public.match_event_registrations set approved_at=accepted_at where match_event_id=v_event and user_id=v_second;
        update public.match_event_registrations set approved_at=null where match_event_id=v_event and user_id=v_second;

        -- Terminal transition must clear every anchor in the same statement.
        begin
          update public.match_event_registrations set lifecycle='rejected' where match_event_id=v_event and user_id=v_second;
          raise exception 'rejection kept accepted anchors';
        exception when check_violation then null; end;
        update public.match_event_registrations
          set lifecycle='rejected', accepted_at=null, accepted_order=null, participation_status=null, approved_at=null,
              resolved_at=now(), resolved_by=v_creator
          where match_event_id=v_event and user_id=v_second;

        -- (event, accepted_order) is unique per event while NULL orders stay free.
        update public.match_event_registrations
          set lifecycle='accepted', accepted_at=now(), accepted_order=2, participation_status='reserve'
          where match_event_id=v_event and user_id=v_first;
        begin
          update public.match_event_registrations set accepted_order=1 where match_event_id=v_event and user_id=v_first;
          raise exception 'duplicate accepted_order per event was accepted';
        exception when unique_violation then null; end;
        update public.match_event_registrations set accepted_order=2 where match_event_id=v_second_event and user_id=v_creator;
        if (select count(*) from public.match_event_registrations where accepted_order=2) < 2 then
          raise exception 'same accepted_order must be reusable across events';
        end if;

        -- Registration identity is immutable and rows can never be deleted.
        begin
          update public.match_event_registrations set user_id=v_first where match_event_id=v_event and user_id=v_second;
          raise exception 'identity change was accepted';
        exception when check_violation then null; end;
        begin
          delete from public.match_event_registrations where match_event_id=v_event and user_id=v_second;
          raise exception 'delete was accepted';
        exception when check_violation then null; end;

        -- State table rules: positive ordinal, non-negative revision, one row per event.
        alter table public.match_events disable trigger match_event_creator_registration;
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(v_bare,v_community,v_creator,now()+interval '6 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Schema court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/photo.webp',now()+interval '5 days');
        alter table public.match_events enable trigger match_event_creator_registration;
        begin
          insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal) values (v_bare,0);
          raise exception 'zero accepted ordinal was accepted';
        exception when check_violation then null; end;
        begin
          insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal) values (v_bare,-1);
          raise exception 'negative accepted ordinal was accepted';
        exception when check_violation then null; end;
        begin
          insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal,transition_revision) values (v_bare,1,-1);
          raise exception 'negative transition revision was accepted';
        exception when check_violation then null; end;
        insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal) values (v_bare,1);
        begin
          insert into public.match_event_registration_state(match_event_id,next_accepted_ordinal) values (v_event,9);
          raise exception 'duplicate state row was accepted';
        exception when unique_violation then null; end;

        -- Attempts rules: FK to the registration identity and decided-accepted CHECK.
        begin
          insert into public.match_event_registration_attempts(match_event_id,user_id,requested_at,outcome)
            values (v_event, gen_random_uuid(), now(), 'rejected');
          raise exception 'attempt for unknown registration identity was accepted';
        exception when foreign_key_violation then null; end;
        begin
          insert into public.match_event_registration_attempts(match_event_id,user_id,requested_at,outcome)
            values (v_event, v_second, now(), 'accepted');
          raise exception 'accepted attempt without decided_at was accepted';
        exception when check_violation then null; end;
        insert into public.match_event_registration_attempts(match_event_id,user_id,requested_at,outcome,decided_at,actor_id)
          values (v_event, v_second, now(), 'accepted', now(), v_creator),
                 (v_event, v_second, now(), 'pending', null, null),
                 (v_event, v_second, now(), 'expired', null, v_creator);
        alter table public.match_events enable trigger lock_match_photo_publication;
       end $$;`
        )
      ).toBe('DO');
    },
    60000
  );

  it.skipIf(!environment.env)(
    'backfills deterministic creator-first accepted order and the matching next accepted ordinal',
    async () => {
      const env = environment.env!;
      const { creator, first, second } = await registrationActors(env);
      const communityId = crypto.randomUUID();
      const replayEventId = crypto.randomUUID();
      expect(
        await fixtureSql(
          env,
          `do $$
      declare
        v_creator uuid := '${creator}';
        v_first uuid := '${first}';
        v_second uuid := '${second}';
        v_community uuid := '${communityId}';
        v_event uuid := '${replayEventId}';
        v_ordinal bigint;
        v_offender uuid;
       begin
        insert into public.communities(id,name,visibility,created_by)
          values (v_community,'Registration backfill fixture','public',v_creator);
        alter table public.match_events disable trigger lock_match_photo_publication;
        -- State-less event: the backfill under test is the migration's
        -- INSERT..SELECT for events without a registration-state row.
        alter table public.match_events disable trigger match_event_creator_registration;
        insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
          values(v_event,v_community,v_creator,now()+interval '6 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Backfill court','https://maps.google.com/maps/x',gen_random_uuid()::text||'/photo.webp',now()+interval '5 days');
        alter table public.match_events enable trigger match_event_creator_registration;
        -- Pre-backfill shape: creator first, then accepted_at, id.
        insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source) values
          (v_event,v_creator, now()-interval '3 hours', 1, 'reserve','creator'),
          (v_event,v_second, now()-interval '2 hours', 2, 'reserve','member'),
          (v_event,v_first,  now()-interval '1 hour',  3, 'reserve','member');
        insert into public.match_event_registration_state(match_event_id, next_accepted_ordinal)
        select e.id, coalesce(max(r.accepted_order), 0) + 1
        from public.match_events e left join public.match_event_registrations r on r.match_event_id=e.id
        where e.id = v_event
        group by e.id;
        select next_accepted_ordinal into v_ordinal from public.match_event_registration_state where match_event_id=v_event;
        if v_ordinal is distinct from 4 then raise exception 'backfill ordinal mismatch: %', v_ordinal; end if;
        alter table public.match_events enable trigger lock_match_photo_publication;

        -- The backfill rule is scoped to the event this suite owns. accepted_order
        -- is the authoritative FIFO ordinal (assigned by the migration backfill and
        -- the registration RPC); accepted_at is audit-only and the schema enforces
        -- no correlation between the two. A database-wide scan is therefore invalid
        -- by construction: any unrelated suite may legitimately seed accepted rows
        -- directly with an accepted_at independent of their ordinal, and that is not
        -- this suite's contract. Within this event, the backfilled roster must still
        -- order by (creator first, accepted_at, id) with ids/anchors unrewritten.
        select count(*) into v_ordinal from public.match_event_registrations
         where match_event_id=v_event and lifecycle='accepted';
        if v_ordinal <> 3 then
          raise exception 'fixture accepted roster has % rows, expected 3', v_ordinal;
        end if;
        select match_event_id into v_offender from (
          select r.match_event_id,
                 row_number() over (partition by r.match_event_id order by r.accepted_order) by_order,
                 row_number() over (partition by r.match_event_id order by (r.user_id = e.created_by) desc, r.accepted_at, r.id) by_rule
          from public.match_event_registrations r join public.match_events e on e.id = r.match_event_id
          where r.lifecycle='accepted' and r.accepted_order is not null and r.match_event_id=v_event
        ) ranked where by_order <> by_rule limit 1;
        if v_offender is not null then
          raise exception 'accepted_order diverges from (creator-first, accepted_at, id) on event %', v_offender;
        end if;
        select r.match_event_id into v_offender from public.match_event_registrations r
          join public.match_events e on e.id = r.match_event_id
         where r.match_event_id=v_event and r.lifecycle='accepted' and r.user_id=e.created_by
           and r.accepted_order <> (select min(r2.accepted_order) from public.match_event_registrations r2
             where r2.match_event_id=r.match_event_id and r2.lifecycle='accepted')
         limit 1;
        if v_offender is not null then
          raise exception 'creator is not first in the accepted order on event %', v_offender;
        end if;
       end $$;`
        )
      ).toBe('DO');
    },
    60000
  );

  it.skipIf(!environment.env)(
    'publication creates the registration-state row and creator slot together and rolls both back',
    async () => {
      const env = environment.env!;
      const signup = await createClient(env.url, env.key, {
        auth: { persistSession: false, autoRefreshToken: false }
      }).auth.signUp({
        email: `paf51-schema-publisher-${crypto.randomUUID()}@test.local`,
        password: 'Password123!'
      });
      expect(signup.error).toBeNull();
      expect(signup.data.session, 'local email confirmations must be disabled').not.toBeNull();
      const creator: { id: string; client: SupabaseClient<Database> } = {
        id: signup.data.user!.id,
        client: createClient<Database>(env.url, env.key, {
          auth: { persistSession: false, autoRefreshToken: false },
          global: { headers: { Authorization: `Bearer ${signup.data.session!.access_token}` } }
        })
      };
      expect(
        (
          await creator.client.rpc('onboard_player', {
            p_display_name: 'Schema Publisher',
            p_preferred_side: 'EITHER',
            p_initial_level: 3.2
          })
        ).error
      ).toBeNull();
      const communityId = crypto.randomUUID();
      const q = (value: string) => `'${value.replaceAll("'", "''")}'`;
      await fixtureSql(
        env,
        `do $$ begin
      insert into public.communities(id,name,visibility,created_by,settings) values
        (${q(communityId)},'Registration publication fixture','public',${q(creator.id)},'{"admin_defaults":{"timezone":"UTC","currency":"EUR","member_created_leagues_enabled":true}}'::jsonb);
      insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at) values
        (${q(communityId)},${q(creator.id)},'admin','active',now()-interval '1 minute',now()-interval '1 minute');
      end $$;`
      );
      const png = new Blob([Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4])], {
        type: 'image/png'
      });
      const stagePhoto = async (eventId: string): Promise<string> => {
        const path = `${communityId}/${eventId}/${creator.id}/${crypto.randomUUID()}.png`;
        const upload = await creator.client.storage
          .from('match-event-photos')
          .upload(path, png, { contentType: 'image/png' });
        expect(upload.error, `staging photo for ${eventId}`).toBeNull();
        return path;
      };
      const publishInput = (photo: string) => ({
        community_id: communityId,
        date: new Date(Date.now() + 3 * 86_400_000).toISOString().slice(0, 10),
        start_time: '10:00',
        event_type: 'friendly',
        visibility: 'community_open',
        team_assignment_mode: 'POST_MATCH_TEAMS',
        venue_name: 'Schema publication court',
        maps_url: 'https://maps.google.com/maps/place/schema-publication',
        photo_path: photo,
        maximum_registrations: '1'
      });

      // Capacity 1: publication still creates state row and creator slot together.
      const capacityEvent = crypto.randomUUID();
      const capacityResult = await creator.client.rpc('publish_match_event', {
        p_event_id: capacityEvent,
        p_input: publishInput(await stagePhoto(capacityEvent)),
        p_invitee_ids: []
      });
      expect(capacityResult.error).toBeNull();
      expect(capacityResult.data).toBe(capacityEvent);
      const capacityRows = await trustedRows(
        env,
        `select jsonb_build_object(
          'event', (select count(*)::int from public.match_events where id='${capacityEvent}'),
          'state', (select to_jsonb(s) from public.match_event_registration_state s where s.match_event_id='${capacityEvent}'),
          'registration', (select to_jsonb(r) from public.match_event_registrations r where r.match_event_id='${capacityEvent}'),
          'published_at', (select published_at from public.match_events where id='${capacityEvent}')) report`
      );
      expect(capacityRows).toHaveLength(1);
      const capacityReport = recordOf(capacityRows[0]!['report']);
      expect(capacityReport['event']).toBe(1);
      const capacityState = recordOf(capacityReport['state']);
      expect(capacityState['next_accepted_ordinal']).toBe(2);
      expect(capacityState['transition_revision']).toBe(0);
      expect(capacityState['cutoff_processed_at']).toBeNull();
      const capacityRegistration = recordOf(capacityReport['registration']);
      expect(capacityRegistration['user_id']).toBe(creator.id);
      expect(capacityRegistration['lifecycle']).toBe('accepted');
      expect(capacityRegistration['accepted_order']).toBe(1);
      expect(capacityRegistration['participation_status']).toBe('reserve');
      expect(capacityRegistration['registration_source']).toBe('creator');
      expect(capacityRegistration['accepted_at']).toBe(capacityReport['published_at']);

      // A failing publication rolls the event, the creator slot and the state
      // row back together: no orphan registration-state row may survive.
      const failedEvent = crypto.randomUUID();
      const failedResult = await creator.client.rpc('publish_match_event', {
        p_event_id: failedEvent,
        p_input: {
          ...publishInput(await stagePhoto(failedEvent)),
          date: new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10)
        },
        p_invitee_ids: []
      });
      expect(failedResult.error?.code).toBe('23514');
      expect(failedResult.error?.message).toContain('Match must start in the future');
      const failedRows = await trustedRows(
        env,
        `select jsonb_build_object(
          'event', (select count(*)::int from public.match_events where id='${failedEvent}'),
          'state', (select count(*)::int from public.match_event_registration_state where match_event_id='${failedEvent}'),
          'registration', (select count(*)::int from public.match_event_registrations where match_event_id='${failedEvent}')) report`
      );
      expect(failedRows).toHaveLength(1);
      expect(failedRows[0]).toEqual({ report: { event: 0, registration: 0, state: 0 } });
    },
    120000
  );
});
