begin;

-- PAF-199 review round 3 (F15-F20): irreversibility, producer pause, restore reconciliation, bounded wait.
--   F15  monotonic destructive_started_at: no withdraw/restart/refusal once frozen; stale verification restarts
--        from any unconsumed stale blocker; after the destructive start an address change is recorded, not blocking
--   F16  durable per-case producer pause (actor AND target/recipient); honest external_followup flag instead of an
--        unprovable external-call quiescence claim
--   F17  restore gate row with real reconciliation (the erasure seam replayed on the restored subject) + evidence
--   F18  bounded quiescence wait: persisted attempts, cap, blocked QUIESCENCE_TIMEOUT (freeze preserved)
--   F19  challenge/verified address digests cleared at consumption, cancellation, expiry and every terminal state
--   F20  exact source->target FK mapping registry for identity-bearing edges

-- Table shape ----------------------------------------------------------------------------------------------
alter table privacy_internal.privacy_cases
  add column destructive_started_at timestamptz,
  add column quiescence_attempts smallint not null default 0;

-- Cases already past the freeze are past the point of no return.
update privacy_internal.privacy_cases set destructive_started_at = coalesce(armed_consumed_at, updated_at)
  where last_phase is not null and destructive_started_at is null;
-- Terminal cases keep no address digests (data minimization).
update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null,
    challenge_address_digest = null, verified_address_digest = null
  where state in ('closed', 'withdrawn')
    and (challenge_digest is not null or challenge_address_digest is not null or verified_address_digest is not null);

alter table privacy_internal.privacy_cases drop constraint privacy_cases_blocker_code_check;
alter table privacy_internal.privacy_cases add constraint privacy_cases_blocker_code_check check (blocker_code in (
  'PLAN_MISMATCH', 'BLOCKED_PRECONDITION', 'PLATFORM_ADMIN_GRANT', 'SUCCESSOR_INVALID', 'UNCLASSIFIED_DEPENDENCY',
  'REGISTRY_DRIFT', 'SUBJECT_NOT_LIVE', 'RESIDUAL_REFERENCE', 'ENVIRONMENT_MISMATCH', 'STORAGE_FAILED', 'STORAGE_RESIDUE',
  'AUTH_DELETE_FAILED', 'AUTH_UNVERIFIED', 'RETRIES_EXHAUSTED', 'SEAM_FAILED', 'FREEZE_FAILED', 'ARM_EXPIRED',
  'VERIFICATION_STALE', 'QUIESCENCE_TIMEOUT'));

-- F16: durable per-case producer pause ---------------------------------------------------------------------
create table privacy_internal.case_producer_pause (
  case_id uuid primary key references privacy_internal.privacy_cases (id) on delete cascade,
  subject_id uuid not null unique,
  active boolean not null default true,
  since timestamptz not null default pg_catalog.clock_timestamp(),
  -- Monotonic: subject-scoped external work (leased push job, dispatch attempt) was seen while the case ran.
  activity_observed boolean not null default false
);
alter table privacy_internal.case_producer_pause enable row level security;
revoke all on privacy_internal.case_producer_pause from public, anon, authenticated, service_role;
insert into privacy_internal.case_producer_pause (case_id, subject_id, since)
  select f.case_id, f.subject_id, f.frozen_at from privacy_internal.frozen_subjects f
    join privacy_internal.privacy_cases c on c.id = f.case_id on conflict do nothing;

-- F17: restore gate row ------------------------------------------------------------------------------------
create table privacy_internal.restore_gate (
  singleton boolean primary key default true check (singleton),
  status text not null check (status in ('pending', 'reconciled', 'closed')),
  evidence_ref text check (evidence_ref is null or pg_catalog.length(evidence_ref) between 1 and 200),
  reconciled_at timestamptz,
  reconciled_subject uuid,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table privacy_internal.restore_gate enable row level security;
revoke all on privacy_internal.restore_gate from public, anon, authenticated, service_role;
insert into privacy_internal.restore_gate (status)
  select case when s.value = 'pending' then 'pending' else 'closed' end
    from privacy_internal.privacy_settings s where s.key = 'restore_gate';

-- Settings: the gate moves to its own row; the quiescence cap is tunable.
alter table privacy_internal.privacy_settings drop constraint privacy_settings_key_check;
alter table privacy_internal.privacy_settings drop constraint privacy_settings_value_check;
delete from privacy_internal.privacy_settings where key = 'restore_gate';
alter table privacy_internal.privacy_settings
  add constraint privacy_settings_key_check check (key in ('intake_enabled', 'executor_enabled',
    'freeze_quiescence_seconds', 'privacy_quiescence_max_attempts')),
  add constraint privacy_settings_value_check check (value ~ '^(true|false|[0-9]{1,4})$');
insert into privacy_internal.privacy_settings values ('privacy_quiescence_max_attempts', '12');

-- F20: exact FK mapping registry ----------------------------------------------------------------------------
create function privacy_internal.fk_columns(p_rel oid, p_keys smallint[]) returns jsonb
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(a.attname::text order by k.ord), '[]'::jsonb)
    from pg_catalog.unnest(p_keys) with ordinality as k(attnum, ord)
    join pg_catalog.pg_attribute a on a.attrelid = p_rel and a.attnum = k.attnum;
$$;

create table privacy_internal.erasure_fk_registry (
  source_schema text not null,
  source_table text not null,
  source_columns jsonb not null check (pg_catalog.jsonb_typeof(source_columns) = 'array'),
  target_schema text not null,
  target_table text not null,
  target_columns jsonb not null check (pg_catalog.jsonb_typeof(target_columns) = 'array'),
  primary key (source_schema, source_table, source_columns, target_schema, target_table, target_columns)
);
alter table privacy_internal.erasure_fk_registry enable row level security;
revoke all on privacy_internal.erasure_fk_registry from public, anon, authenticated, service_role;

do $backfill$
begin
  if exists (
    select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
       and exists (select 1 from pg_catalog.unnest(c.conkey) as k(attnum)
         join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where not exists (select 1 from privacy_internal.erasure_dispositions d
          where d.schema_name = 'public' and d.table_name = t.relname and d.column_name = a.attname))) then
    raise exception 'Cannot backfill the FK registry: an identity edge is unclassified';
  end if;
  insert into privacy_internal.erasure_fk_registry
    select tn.nspname, t.relname, privacy_internal.fk_columns(c.conrelid, c.conkey),
        rn.nspname, r.relname, privacy_internal.fk_columns(c.confrelid, c.confkey)
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      join pg_catalog.pg_class r on r.oid = c.confrelid
      join pg_catalog.pg_namespace rn on rn.oid = r.relnamespace
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
    on conflict do nothing;
end $backfill$;

create function privacy_internal.identity_edge_unregistered() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
      join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      join pg_catalog.pg_class r on r.oid = c.confrelid
      join pg_catalog.pg_namespace rn on rn.oid = r.relnamespace
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
       and (
         -- The exact ordered source->target mapping must have been reviewed and registered.
         not exists (select 1 from privacy_internal.erasure_fk_registry g
           where g.source_schema = tn.nspname and g.source_table = t.relname
             and g.target_schema = rn.nspname and g.target_table = r.relname
             and g.source_columns = privacy_internal.fk_columns(c.conrelid, c.conkey)
             and g.target_columns = privacy_internal.fk_columns(c.confrelid, c.confkey))
         -- And every source column must carry a disposition.
         or exists (select 1 from pg_catalog.unnest(c.conkey) as k(attnum)
           join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
          where not exists (select 1 from privacy_internal.erasure_dispositions d
            where d.schema_name = tn.nspname and d.table_name = t.relname and d.column_name = a.attname))));
$$;

-- Helpers -----------------------------------------------------------------------------------------------------
create function privacy_internal.case_reversible(p_case privacy_internal.privacy_cases) returns boolean
language sql immutable set search_path = '' as $$
  select p_case.destructive_started_at is null and p_case.armed_consumed_at is null
    and p_case.state in ('received', 'verified', 'ready', 'blocked');
$$;

create function privacy_internal.producer_paused(p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from privacy_internal.case_producer_pause p where p.subject_id = p_subject and p.active)
    or exists (select 1 from privacy_internal.frozen_subjects f where f.subject_id = p_subject);
$$;

-- Player-add work is paused when the actor, the resolved target OR the invited address belongs to a paused subject.
create function privacy_internal.player_add_paused(p_actor uuid, p_target uuid, p_email text) returns boolean
language sql stable security definer set search_path = '' as $$
  select privacy_internal.producer_paused(p_actor)
    or (p_target is not null and privacy_internal.producer_paused(p_target))
    or (p_email is not null and exists (
      select 1 from (select p.subject_id from privacy_internal.case_producer_pause p where p.active
          union select f.subject_id from privacy_internal.frozen_subjects f) s
        join auth.users u on u.id = s.subject_id where pg_catalog.lower(u.email) = p_email));
$$;

create function privacy_internal.subject_external_activity(p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.notification_push_jobs j join public.notifications n on n.id = j.notification_id
      where n.recipient_user_id = p_subject and j.status = 'leased')
    or exists (select 1 from public.match_player_add_operations o
      where o.dispatch_state = 'pending' and o.dispatch_attempt is not null
        and (o.actor_id = p_subject or o.target_user_id = p_subject
          or o.email = (select pg_catalog.lower(u.email) from auth.users u where u.id = p_subject)));
$$;

create function privacy_internal.case_address_changed(p_case privacy_internal.privacy_cases) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_case.verified_address_digest is not null and exists (select 1 from auth.users u
    where u.id = p_case.subject_id
      and p_case.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(pg_catalog.lower(u.email), 'UTF8')));
$$;

create function privacy_internal.subject_residue(p_subject uuid) returns text[]
language plpgsql security definer set search_path = '' as $$
declare r record; v_n bigint; v_out text[] := '{}';
begin
  for r in select n.nspname::text as s, c.relname::text as t from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
     where c.relkind in ('r', 'p') and n.nspname = 'public' order by 1, 2 loop
    execute pg_catalog.format('select pg_catalog.count(*) from %I.%I x where x::text like $1', r.s, r.t)
      into v_n using '%' || p_subject::text || '%';
    if v_n > 0 then v_out := pg_catalog.array_append(v_out, r.s || '.' || r.t); end if;
  end loop;
  if exists (select 1 from auth.users u where u.id = p_subject) then v_out := pg_catalog.array_append(v_out, 'auth.users'); end if;
  if exists (select 1 from auth.identities i where i.user_id = p_subject) then v_out := pg_catalog.array_append(v_out, 'auth.identities'); end if;
  if pg_catalog.to_regclass('storage.objects') is not null
      and exists (select 1 from privacy_internal.erasure_storage_objects(p_subject)) then
    v_out := pg_catalog.array_append(v_out, 'storage.objects');
  end if;
  return v_out;
end $$;

revoke all on function privacy_internal.fk_columns(oid, smallint[]), privacy_internal.identity_edge_unregistered(),
  privacy_internal.case_reversible(privacy_internal.privacy_cases), privacy_internal.producer_paused(uuid),
  privacy_internal.player_add_paused(uuid, uuid, text), privacy_internal.subject_external_activity(uuid),
  privacy_internal.case_address_changed(privacy_internal.privacy_cases), privacy_internal.subject_residue(uuid)
  from public, anon, authenticated, service_role;

-- F15 + F19: transition graph -------------------------------------------------------------------------------
create or replace function privacy_internal.guard_privacy_case() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ok boolean;
begin
  if tg_op = 'DELETE' then
    if old.state not in ('closed', 'withdrawn') then
      raise exception 'PRIVACY_CASE_NOT_TERMINAL' using errcode = '23514';
    end if;
    return old;
  end if;
  if new.id is distinct from old.id or new.reference is distinct from old.reference
      or new.received_at is distinct from old.received_at or new.scope is distinct from old.scope then
    raise exception 'PRIVACY_CASE_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  -- The destructive-start marker is monotonic: set once at the first freeze, never cleared or moved.
  if old.destructive_started_at is not null and new.destructive_started_at is distinct from old.destructive_started_at then
    raise exception 'PRIVACY_CASE_IRREVERSIBLE' using errcode = '23514';
  end if;
  if old.state in ('closed', 'withdrawn') and new.state is distinct from old.state then
    raise exception 'PRIVACY_CASE_TERMINAL' using errcode = '23514';
  end if;
  if new.state is distinct from old.state then
    -- After the destructive start only the resume paths remain: no withdrawal, restart, un-verification or refusal.
    if old.destructive_started_at is not null
        and (new.state in ('withdrawn', 'received', 'verified') or (new.state = 'closed' and old.state <> 'supabase_erased')) then
      raise exception 'PRIVACY_CASE_IRREVERSIBLE' using errcode = '23514';
    end if;
    v_ok := case old.state
      when 'received' then new.state in ('verified', 'withdrawn', 'closed')
      when 'verified' then new.state in ('ready', 'received', 'withdrawn', 'closed')
      when 'ready' then new.state in ('executing', 'verified', 'withdrawn', 'blocked', 'closed')
      when 'executing' then (new.state = 'app_data_erased' and new.last_phase = 'relational') or new.state = 'blocked'
      when 'app_data_erased' then (new.state = 'supabase_erased' and new.last_phase = 'auth') or new.state = 'blocked'
      when 'supabase_erased' then new.state in ('closed', 'blocked')
      when 'blocked' then new.state in ('executing', 'app_data_erased', 'supabase_erased', 'ready')
        or (new.state in ('withdrawn', 'closed', 'received') and old.armed_consumed_at is null
          and old.destructive_started_at is null)
      else false end;
    if not coalesce(v_ok, false) then
      raise exception 'PRIVACY_CASE_TRANSITION_INVALID' using errcode = '23514';
    end if;
  end if;
  -- Terminal cases keep no verification material at all (guessable address digests are never retained).
  if new.state in ('closed', 'withdrawn') then
    new.challenge_digest := null; new.challenge_expires_at := null;
    new.challenge_address_digest := null; new.verified_address_digest := null;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;

-- Self-service: withdrawal is closed once the destructive phase began -----------------------------------------
create or replace function privacy_internal.case_receipt(p_case privacy_internal.privacy_cases, p_command uuid, p_replayed boolean)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'command_id', p_command, 'reference', p_case.reference, 'state', p_case.state,
    'received_at', p_case.received_at, 'replayed', p_replayed,
    'can_withdraw', privacy_internal.case_reversible(p_case));
$$;

create or replace function public.get_my_deletion_request() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid()); v_case privacy_internal.privacy_cases;
begin
  if v_uid is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_case from privacy_internal.privacy_cases c where c.subject_id = v_uid
   order by (c.state not in ('closed', 'withdrawn')) desc, c.received_at desc limit 1;
  if not found then return null; end if;
  return pg_catalog.jsonb_build_object('reference', v_case.reference, 'state', v_case.state,
    'received_at', v_case.received_at, 'blocked', v_case.state = 'blocked',
    'can_withdraw', privacy_internal.case_reversible(v_case));
end $$;

create or replace function public.withdraw_my_deletion_request(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_case privacy_internal.privacy_cases; v_cmd privacy_internal.privacy_case_commands;
begin
  if v_uid is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform public.assert_actor_not_provisional();
  if p_command_id is null then raise exception 'Invalid command' using errcode = '22023'; end if;
  perform public.lock_actor_rate_scope('privacy_request', v_uid);
  select * into v_cmd from privacy_internal.privacy_case_commands c where c.subject_id = v_uid and c.command_id = p_command_id;
  if found then
    select * into v_case from privacy_internal.privacy_cases c where c.id = v_cmd.case_id;
    return privacy_internal.case_receipt(v_case, p_command_id, true);
  end if;
  -- The row lock serializes against the executor claim: after the claim the state is executing.
  select * into v_case from privacy_internal.privacy_cases c
   where c.subject_id = v_uid and c.state not in ('closed', 'withdrawn') for update;
  if not found then raise exception 'PRIVACY_REQUEST_NOT_FOUND' using errcode = 'P0001'; end if;
  if not privacy_internal.case_reversible(v_case) then
    raise exception 'PRIVACY_REQUEST_NOT_WITHDRAWABLE' using errcode = 'P0001';
  end if;
  update privacy_internal.privacy_cases set state = 'withdrawn', outcome = 'withdrawn',
      blocker_code = null, next_action = null, challenge_digest = null, challenge_expires_at = null,
      armed_plan = null, armed_plan_hash = null, armed_project_ref = null, armed_environment = null,
      final_response_at = pg_catalog.clock_timestamp(),
      purge_after = pg_catalog.clock_timestamp() + interval '90 days', closed_at = pg_catalog.clock_timestamp()
    where id = v_case.id returning * into v_case;
  insert into privacy_internal.privacy_case_commands (subject_id, command_id, action, case_id)
    values (v_uid, p_command_id, 'withdraw', v_case.id);
  return privacy_internal.case_receipt(v_case, p_command_id, false);
end $$;

-- Operator RPCs ---------------------------------------------------------------------------------------------------
create or replace function public.privacy_op_list_cases() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'reference', c.reference, 'state', c.state, 'received_at', c.received_at, 'last_phase', c.last_phase,
    'blocker_code', c.blocker_code, 'next_action', c.next_action, 'verified', c.verified_at is not null,
    'armed', c.state = 'ready', 'attempts', c.attempt_count,
    'irreversible', c.destructive_started_at is not null,
    'external_followup', coalesce((c.phase_manifest ->> 'external_followup')::boolean, false),
    'response_address_changed', coalesce((c.phase_manifest ->> 'response_address_changed')::boolean, false),
    'purge_after', c.purge_after) order by c.received_at), '[]'::jsonb)
  from privacy_internal.privacy_cases c where c.state not in ('closed', 'withdrawn') or c.final_response_at is null;
$$;

-- F15: a stale or expired unconsumed blocker can always restart verification (nothing irreversible yet).
create or replace function public.privacy_op_start_verification(p_reference text, p_digest bytea, p_ttl_seconds integer default 1800)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if not (v.state in ('received', 'verified')
      or (v.state = 'blocked' and privacy_internal.case_reversible(v) and v.blocker_code in ('ARM_EXPIRED', 'VERIFICATION_STALE'))) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_VERIFIABLE');
  end if;
  if p_digest is null or pg_catalog.octet_length(p_digest) <> 32 or p_ttl_seconds not between 60 and 3600 then
    raise exception 'Invalid challenge' using errcode = '22023';
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
  if v_email is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_VERIFIED_ADDRESS');
  end if;
  update privacy_internal.privacy_cases set challenge_digest = p_digest,
      challenge_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_ttl_seconds),
      challenge_attempts = 0, challenge_consumed_at = null,
      challenge_address_digest = pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')),
      state = case when state in ('verified', 'blocked') then 'received' else state end,
      blocker_code = null, next_action = null,
      armed_plan = null, armed_plan_hash = null, armed_project_ref = null, armed_environment = null,
      armed_at = null, arm_expires_at = null,
      verified_at = null, verified_address_digest = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference,
    'expires_at', v.challenge_expires_at, 'address', v_email);
end $$;

-- F19: consumption clears the challenge address digest (the verified digest is all the claim needs).
create or replace function public.privacy_op_confirm_proof(p_reference text, p_digest bytea, p_operator_confirmed boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if p_operator_confirmed is distinct from true then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'OPERATOR_CONFIRMATION_REQUIRED');
  end if;
  if v.challenge_consumed_at is not null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_CONSUMED');
  end if;
  if v.state <> 'received' or v.challenge_digest is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_OPEN_CHALLENGE');
  end if;
  if v.challenge_expires_at <= pg_catalog.clock_timestamp() then
    update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null,
        challenge_address_digest = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_EXPIRED');
  end if;
  if v.challenge_attempts >= 5 then
    update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null,
        challenge_address_digest = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_ATTEMPTS_EXCEEDED');
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
  if v_email is null
      or v.challenge_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')) then
    update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null,
        challenge_address_digest = null, challenge_attempts = 0 where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'VERIFICATION_STALE');
  end if;
  if p_digest is distinct from v.challenge_digest then
    update privacy_internal.privacy_cases set challenge_attempts = challenge_attempts + 1 where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_INVALID');
  end if;
  update privacy_internal.privacy_cases set state = 'verified', verified_at = pg_catalog.clock_timestamp(),
      challenge_consumed_at = pg_catalog.clock_timestamp(), challenge_digest = null, challenge_expires_at = null,
      verified_address_digest = v.challenge_address_digest, challenge_address_digest = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

-- F15: re-arm never resets the consumed marker; the address is revalidated only before the destructive start.
create or replace function public.privacy_op_arm(p_reference text, p_expected jsonb, p_project_ref text, p_environment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_plan jsonb; v_email text; v_stale boolean; v_flags jsonb := '{}'::jsonb;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if privacy_internal.privacy_setting('executor_enabled') <> 'true' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EXECUTOR_DISABLED');
  end if;
  if p_expected is null or p_project_ref is null or pg_catalog.length(p_project_ref) not between 1 and 64
      or p_environment is null or pg_catalog.length(p_environment) not between 1 and 32
      or not (p_expected ?& array['revision', 'fingerprint', 'impact', 'successors']) then
    raise exception 'Invalid arm request' using errcode = '22023';
  end if;
  if not ((v.state in ('verified', 'ready') and v.armed_consumed_at is null)
      or (v.state = 'blocked' and v.armed_consumed_at is null and v.destructive_started_at is null)
      or (v.state = 'blocked' and v.destructive_started_at is not null and v.last_phase = 'freeze'
        and v.blocker_code in ('PLAN_MISMATCH', 'SUCCESSOR_INVALID', 'ENVIRONMENT_MISMATCH', 'PLATFORM_ADMIN_GRANT', 'ARM_EXPIRED'))) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_ARMABLE');
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
  v_stale := v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8'));
  if v_stale and v.destructive_started_at is null then
    update privacy_internal.privacy_cases set state = case when state = 'verified' then 'received' else state end,
        blocker_code = case when state = 'blocked' then 'VERIFICATION_STALE' end,
        next_action = case when state = 'blocked' then 'operator_review' end,
        verified_at = null, verified_address_digest = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'VERIFICATION_STALE');
  elsif v_stale then
    -- Identity was verified before the freeze and the ban applied: record it for the final-response routing.
    v_flags := pg_catalog.jsonb_build_object('response_address_changed', true);
  end if;
  v_plan := privacy_internal.account_erasure_plan(v.subject_id, p_expected -> 'successors');
  if pg_catalog.jsonb_array_length(v_plan -> 'blockers') > 0 then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'PLAN_BLOCKED', 'blockers', v_plan -> 'blockers');
  end if;
  if (v_plan - 'blockers') is distinct from (p_expected - 'blockers') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'PLAN_MISMATCH');
  end if;
  update privacy_internal.privacy_cases set state = 'ready', blocker_code = null, next_action = null,
      armed_plan = v_plan - 'blockers', armed_plan_hash = pg_catalog.md5((v_plan - 'blockers')::text),
      armed_project_ref = p_project_ref, armed_environment = p_environment,
      armed_at = pg_catalog.clock_timestamp(),
      arm_expires_at = pg_catalog.clock_timestamp() + interval '15 minutes',
      attempt_count = 0, quiescence_attempts = 0, next_attempt_at = null,
      phase_manifest = phase_manifest || v_flags
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state,
    'plan_hash', v.armed_plan_hash, 'arm_expires_at', v.arm_expires_at);
end $$;

create or replace function public.privacy_op_retry(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state <> 'blocked' or v.resume_state is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_RETRYABLE');
  end if;
  -- A resume restarts the phase: attempt counters start fresh (the producer pause and freeze stay in force).
  update privacy_internal.privacy_cases set state = v.resume_state, blocker_code = null, next_action = null,
      attempt_count = 0, quiescence_attempts = 0, next_attempt_at = pg_catalog.clock_timestamp(), lease_expires_at = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

create or replace function public.privacy_op_close_refused(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if not privacy_internal.case_reversible(v) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_REFUSABLE');
  end if;
  update privacy_internal.privacy_cases set state = 'closed', outcome = 'refused', closed_at = pg_catalog.clock_timestamp(),
      blocker_code = null, next_action = null, challenge_digest = null, challenge_expires_at = null,
      armed_plan = null, armed_plan_hash = null, armed_project_ref = null, armed_environment = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

-- F19: expired challenges are cleared by the sweep, not left to a later confirmation attempt.
create or replace function public.privacy_op_purge_expired() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_purged integer := 0; r record;
begin
  update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null,
      challenge_address_digest = null
    where challenge_expires_at is not null and challenge_expires_at <= pg_catalog.clock_timestamp()
      and state not in ('closed', 'withdrawn');
  for r in select c.id, c.outcome, pg_catalog.date_trunc('month', c.closed_at)::date as month
      from privacy_internal.privacy_cases c
     where c.state in ('closed', 'withdrawn') and c.purge_after is not null and c.purge_after <= pg_catalog.clock_timestamp()
     order by c.id for update loop
    insert into privacy_internal.privacy_case_outcomes (month, outcome, cases)
      values (r.month, coalesce(r.outcome, 'refused'), 1)
      on conflict (month, outcome) do update set cases = privacy_internal.privacy_case_outcomes.cases + 1;
    delete from privacy_internal.privacy_cases where id = r.id;
    v_purged := v_purged + 1;
  end loop;
  return pg_catalog.jsonb_build_object('status', 'ok', 'purged', v_purged);
end $$;

-- Processor RPCs ----------------------------------------------------------------------------------------------------
create or replace function public.privacy_proc_claim(p_lease_seconds integer, p_project_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text; v_code text; v_action text; v_changed boolean := false;
begin
  if privacy_internal.privacy_setting('executor_enabled') <> 'true' then return null; end if;
  if p_lease_seconds not between 30 and 600 or p_project_ref is null then
    raise exception 'Invalid claim' using errcode = '22023';
  end if;
  select * into v from privacy_internal.privacy_cases c
   where c.state in ('ready', 'executing', 'app_data_erased', 'supabase_erased')
     and (c.lease_expires_at is null or c.lease_expires_at <= pg_catalog.clock_timestamp())
     and coalesce(c.next_attempt_at, pg_catalog.clock_timestamp()) <= pg_catalog.clock_timestamp()
   order by c.received_at limit 1 for update skip locked;
  if not found then return null; end if;
  if v.state = 'ready' then
    v_code := null;
    select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
    v_changed := v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8'));
    if v.armed_project_ref is distinct from p_project_ref or v.armed_plan is null then
      v_code := 'ENVIRONMENT_MISMATCH'; v_action := 'operator_rearm';
    elsif v.arm_expires_at is null or v.arm_expires_at <= pg_catalog.clock_timestamp() then
      -- An expired approval is never consumed: it must be re-armed.
      v_code := 'ARM_EXPIRED'; v_action := 'operator_rearm';
    elsif not exists (select 1 from public.participant_identities i where i.id = v.subject_id and i.state = 'live')
        or v_email is null then
      v_code := 'SUBJECT_NOT_LIVE'; v_action := 'operator_review';
    elsif v_changed and v.destructive_started_at is null then
      v_code := 'VERIFICATION_STALE'; v_action := 'operator_review';
    end if;
    if v_code is not null then
      update privacy_internal.privacy_cases set state = 'blocked', blocker_code = v_code, next_action = v_action where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', v_code);
    end if;
    -- The one-use arm is consumed by the atomic claim; after the destructive start an address change is only recorded.
    update privacy_internal.privacy_cases set state = 'executing', armed_consumed_at = pg_catalog.clock_timestamp(),
        attempt_count = 0, quiescence_attempts = 0,
        phase_manifest = phase_manifest || case when v_changed and v.destructive_started_at is not null
          then pg_catalog.jsonb_build_object('response_address_changed', true) else '{}'::jsonb end
      where id = v.id;
  end if;
  update privacy_internal.privacy_cases set fence = fence + 1, lease_token = gen_random_uuid(),
      lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'claimed', 'case_id', v.id, 'fence', v.fence,
    'lease_token', v.lease_token, 'state', v.state, 'last_phase', v.last_phase, 'subject_id', v.subject_id);
end $$;

-- F15 + F16: the first freeze starts the irreversible window and pauses the subject's producers atomically.
create or replace function public.privacy_proc_freeze(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  insert into privacy_internal.frozen_subjects (subject_id, case_id) values (v.subject_id, v.id) on conflict do nothing;
  insert into privacy_internal.case_producer_pause (case_id, subject_id) values (v.id, v.subject_id) on conflict do nothing;
  update privacy_internal.privacy_cases set last_phase = 'freeze', attempt_count = 0, quiescence_attempts = 0,
      destructive_started_at = coalesce(destructive_started_at, pg_catalog.clock_timestamp()),
      phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('freeze',
        pg_catalog.jsonb_build_object('others_photos_for_review', privacy_internal.erasure_others_photo_count(v.subject_id)))
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', 'freeze');
end $$;

-- F16 + F18: bounded producer-pause window. Database-provable work (older open transactions) is waited for a
-- bounded number of cycles, then the case blocks for the operator (freeze preserved, never proceed-to-delete).
-- External outbound work (leased push, in-flight dispatch) cannot be proven finished from here: it is observed,
-- never awaited, and recorded as external_followup so the final response mentions it.
create or replace function public.privacy_proc_erase_relational(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v privacy_internal.privacy_cases; v_result jsonb; v_msg text; v_detail text; v_state text; v_map text[];
  v_frozen timestamptz; v_wait timestamptz; v_cap integer; v_ext boolean; v_flags jsonb := '{}'::jsonb;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase in ('relational', 'storage', 'auth') then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'relational');
  end if;
  if v.last_phase is distinct from 'freeze' or v.armed_plan is null then
    raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001';
  end if;
  select f.frozen_at into v_frozen from privacy_internal.frozen_subjects f where f.subject_id = v.subject_id;
  if v_frozen is null then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  insert into privacy_internal.case_producer_pause (case_id, subject_id, since) values (v.id, v.subject_id, v_frozen)
    on conflict (case_id) do nothing;
  if privacy_internal.subject_external_activity(v.subject_id) then
    update privacy_internal.case_producer_pause set activity_observed = true where case_id = v.id;
  end if;

  v_cap := coalesce(privacy_internal.privacy_setting('privacy_quiescence_max_attempts')::integer, 12);
  v_wait := v_frozen + pg_catalog.make_interval(secs => privacy_internal.privacy_setting('freeze_quiescence_seconds')::integer);
  if v_wait <= pg_catalog.clock_timestamp() then
    v_wait := null;
    -- One bounded observation: a transaction older than the freeze may still hold a write that passed its live check.
    if exists (select 1 from pg_catalog.pg_stat_activity a
        where a.datname = pg_catalog.current_database() and a.pid <> pg_catalog.pg_backend_pid()
          and a.backend_type = 'client backend' and a.xact_start is not null and a.xact_start < v_frozen
          and a.state <> 'idle') then
      v_wait := pg_catalog.clock_timestamp() + interval '5 seconds';
    end if;
  end if;
  if v_wait is not null then
    if v.quiescence_attempts >= v_cap then
      update privacy_internal.privacy_cases set state = 'blocked', resume_state = 'executing',
          blocker_code = 'QUIESCENCE_TIMEOUT', next_action = 'operator_retry', lease_expires_at = null where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'QUIESCENCE_TIMEOUT');
    end if;
    update privacy_internal.privacy_cases set quiescence_attempts = quiescence_attempts + 1,
        next_attempt_at = least(v_wait, pg_catalog.clock_timestamp() + interval '5 seconds'), lease_expires_at = null
      where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'wait', 'phase', 'relational');
  end if;

  select p.activity_observed into v_ext from privacy_internal.case_producer_pause p where p.case_id = v.id;
  if coalesce(v_ext, false) then v_flags := v_flags || pg_catalog.jsonb_build_object('external_followup', true); end if;
  if privacy_internal.case_address_changed(v) then
    v_flags := v_flags || pg_catalog.jsonb_build_object('response_address_changed', true);
  end if;
  begin
    v_result := privacy_internal.account_erasure_execute(v.subject_id, v.armed_plan);
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail, v_state = returned_sqlstate;
    if v_state in ('40001', '40P01', '55P03', '57014') then
      return pg_catalog.jsonb_build_object('status', 'retry', 'phase', 'relational');
    end if;
    v_map := privacy_internal.map_seam_error(v_msg, v_detail);
    update privacy_internal.privacy_cases set state = 'blocked', resume_state = 'executing',
        blocker_code = v_map[1], next_action = v_map[2], lease_expires_at = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'blocked', 'code', v_map[1]);
  end;
  update privacy_internal.privacy_cases set last_phase = 'relational', state = 'app_data_erased', attempt_count = 0,
      phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('relational',
        pg_catalog.jsonb_build_object('tombstone_created', v_result -> 'tombstone_created', 'impact', v_result -> 'impact'))
        || v_flags
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', 'relational');
end $$;

create or replace function public.privacy_proc_finish(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.state = 'closed' then return pg_catalog.jsonb_build_object('status', 'skipped'); end if;
  if v.state <> 'supabase_erased' then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  delete from privacy_internal.frozen_subjects where subject_id = v.subject_id;
  delete from privacy_internal.case_producer_pause where case_id = v.id;
  delete from privacy_internal.privacy_case_commands where case_id = v.id;
  -- Unlink the subject and destroy every retry/verification pointer as soon as it is not needed.
  update privacy_internal.privacy_cases set state = 'closed', outcome = 'erased', closed_at = pg_catalog.clock_timestamp(),
      subject_id = null, armed_plan = null, armed_plan_hash = null, challenge_digest = null,
      challenge_address_digest = null, verified_address_digest = null, lease_token = null, lease_expires_at = null
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

-- F17: restore gate with real reconciliation ----------------------------------------------------------------------
create or replace function public.privacy_op_set_switch(p_key text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_key in ('intake_enabled', 'executor_enabled') and p_value
      and coalesce((select g.status from privacy_internal.restore_gate g), 'closed') <> 'closed' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PENDING');
  end if;
  update privacy_internal.privacy_settings set value = case when p_value then 'true' else 'false' end
    where key = p_key and key in ('intake_enabled', 'executor_enabled');
  if not found then raise exception 'Invalid switch' using errcode = '22023'; end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'key', p_key, 'enabled', p_value);
end $$;

create or replace function public.privacy_op_restore_gate(p_action text, p_evidence text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
begin
  if p_action = 'begin' then
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    update privacy_internal.restore_gate set status = 'pending', evidence_ref = null, reconciled_at = null,
        reconciled_subject = null, updated_at = pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'pending');
  elsif p_action = 'clear' then
    select * into g from privacy_internal.restore_gate for update;
    -- Reconciliation must have been performed in THIS database (privacy_op_restore_reconcile), not just asserted.
    if g.status <> 'reconciled' then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_REQUIRED');
    end if;
    if pg_catalog.length(v_evidence) not between 1 and 200 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_EVIDENCE_REQUIRED');
    end if;
    -- The evidence reference stays for audit; the restored subject id does not (no standing identity ledger).
    update privacy_internal.restore_gate set status = 'closed', evidence_ref = v_evidence, reconciled_subject = null,
        updated_at = pg_catalog.clock_timestamp();
    -- Intake and executor stay off: the operator turns them on explicitly afterwards.
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'closed');
  end if;
  raise exception 'Invalid gate action' using errcode = '22023';
end $$;

-- Replays the REAL erasure on one subject of the restored copy (relational seam + Auth record), then proves zero
-- residue. Any failure or residue rolls the whole subject back and refuses (fail closed).
create function public.privacy_op_restore_reconcile(p_subject uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_plan jsonb; v_residue text[]; v_msg text; v_detail text;
begin
  if p_subject is null then raise exception 'Invalid subject' using errcode = '22023'; end if;
  select * into g from privacy_internal.restore_gate for update;
  if g.status = 'closed' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_NOT_OPEN');
  end if;
  begin
    if exists (select 1 from public.participant_identities i where i.id = p_subject and i.state = 'live') then
      v_plan := privacy_internal.account_erasure_plan(p_subject, '{}'::jsonb);
      if pg_catalog.jsonb_array_length(v_plan -> 'blockers') > 0 then
        raise exception 'RESTORE_RECONCILE_BLOCKED' using detail = (v_plan -> 'blockers')::text;
      end if;
      perform privacy_internal.account_erasure_execute(p_subject, v_plan - 'blockers');
    end if;
    -- The restored Auth record (no Auth service runs against a scratch copy).
    delete from auth.users where id = p_subject;
    v_residue := privacy_internal.subject_residue(p_subject);
    if pg_catalog.cardinality(v_residue) > 0 then
      raise exception 'RESTORE_RECONCILE_RESIDUE' using detail = pg_catalog.array_to_string(v_residue, ',');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    if v_msg in ('RESTORE_RECONCILE_BLOCKED', 'RESTORE_RECONCILE_RESIDUE') then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_msg, 'detail', v_detail);
    end if;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_RECONCILE_FAILED');
  end;
  update privacy_internal.restore_gate set status = 'reconciled', reconciled_at = pg_catalog.clock_timestamp(),
      reconciled_subject = p_subject, updated_at = pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'reconciled');
end $$;

revoke all on function public.privacy_op_restore_gate(text, text), public.privacy_op_restore_reconcile(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_restore_gate(text, text), public.privacy_op_restore_reconcile(uuid) to service_role;

-- Patches of earlier functions (producer pause + exact FK mapping probe) -------------------------------------------
do $patch$
declare
  r record; v_oid oid; v_def text; v_count integer; v_ns regnamespace;
begin
  for r in select * from (values
    ('privacy_internal', 'account_erasure_plan', $q$  if exists (
    select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
       -- Every column of the FK (composite included) must be classified in the registry.
       and exists (select 1 from pg_catalog.unnest(c.conkey) as k(attnum)
         join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where not exists (select 1 from privacy_internal.erasure_dispositions d
          where d.schema_name = 'public' and d.table_name = t.relname and d.column_name = a.attname))) then$q$,
      $q$  if privacy_internal.identity_edge_unregistered() then$q$, 1),
    ('public', 'claim_match_player_add_redrives', $q$and not privacy_internal.subject_frozen(o.actor_id)$q$,
      $q$and not privacy_internal.player_add_paused(o.actor_id, o.target_user_id, o.email)$q$, 2),
    ('public', 'dispatch_match_player_add', $q$privacy_internal.subject_frozen(p_actor_id)$q$,
      $q$privacy_internal.player_add_paused(p_actor_id, v_op.target_user_id, v_op.email)$q$, 1),
    ('public', 'claim_notification_push_jobs', $q$privacy_internal.subject_frozen(n.recipient_user_id)$q$,
      $q$privacy_internal.producer_paused(n.recipient_user_id)$q$, 1),
    ('public', 'persist_notification', $q$privacy_internal.subject_frozen(p_recipient_user_id)$q$,
      $q$privacy_internal.producer_paused(p_recipient_user_id)$q$, 1)
  ) as t(ns, fn, old_text, new_text, expected) loop
    v_ns := r.ns::regnamespace;
    select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = v_ns and p.proname = r.fn;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, r.old_text, ''))) / pg_catalog.length(r.old_text);
    if v_count <> r.expected then
      raise exception 'Cannot patch %: expected % occurrence(s), found % of [%]', r.fn, r.expected, v_count, pg_catalog.left(r.old_text, 60);
    end if;
    execute pg_catalog.replace(v_def, r.old_text, r.new_text);
  end loop;
end $patch$;

commit;
