begin;

-- PAF-199 review round 2 (F5-F11).
--   F5  challenge bound to the address it was issued to          F6  arm expiry + fresh proof at claim
--   F7  finish failures can quarantine (supabase_erased <-> blocked)
--   F8  restore gate (intake/executor off until post-snapshot reconciliation is recorded)
--   F9  freeze fences live producers and waits for in-flight work  F10 composite identity FKs fail closed
--   F11 retirement loops only touch communities archived by this erasure

-- Table shape --------------------------------------------------------------------------------------
alter table privacy_internal.privacy_cases
  add column challenge_address_digest bytea,
  add column arm_expires_at timestamptz;

do $$
declare v_name text;
begin
  for v_name in select c.conname from pg_catalog.pg_constraint c
      where c.conrelid = 'privacy_internal.privacy_cases'::regclass and c.contype = 'c'
        and (pg_catalog.pg_get_constraintdef(c.oid) like '%PLAN_MISMATCH%'
          or pg_catalog.pg_get_constraintdef(c.oid) like '%app_data_erased%' and pg_catalog.pg_get_constraintdef(c.oid) like '%resume_state%') loop
    execute pg_catalog.format('alter table privacy_internal.privacy_cases drop constraint %I', v_name);
  end loop;
  for v_name in select c.conname from pg_catalog.pg_constraint c
      where c.conrelid = 'privacy_internal.privacy_settings'::regclass and c.contype = 'c' loop
    execute pg_catalog.format('alter table privacy_internal.privacy_settings drop constraint %I', v_name);
  end loop;
end $$;
alter table privacy_internal.privacy_cases
  add constraint privacy_cases_blocker_code_check check (blocker_code in ('PLAN_MISMATCH', 'BLOCKED_PRECONDITION',
    'PLATFORM_ADMIN_GRANT', 'SUCCESSOR_INVALID', 'UNCLASSIFIED_DEPENDENCY', 'REGISTRY_DRIFT', 'SUBJECT_NOT_LIVE',
    'RESIDUAL_REFERENCE', 'ENVIRONMENT_MISMATCH', 'STORAGE_FAILED', 'STORAGE_RESIDUE', 'AUTH_DELETE_FAILED',
    'AUTH_UNVERIFIED', 'RETRIES_EXHAUSTED', 'SEAM_FAILED', 'FREEZE_FAILED', 'ARM_EXPIRED', 'VERIFICATION_STALE')),
  add constraint privacy_cases_resume_state_check check (resume_state in ('executing', 'app_data_erased', 'supabase_erased'));
alter table privacy_internal.privacy_settings
  add constraint privacy_settings_key_check check (key in ('intake_enabled', 'executor_enabled', 'restore_gate', 'freeze_quiescence_seconds')),
  add constraint privacy_settings_value_check check (value ~ '^(true|false|pending|clear|[0-9]{1,4})$');
insert into privacy_internal.privacy_settings values ('restore_gate', 'clear'), ('freeze_quiescence_seconds', '15');

-- F7 + F5/F6: transition graph ---------------------------------------------------------------------
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
  if old.state in ('closed', 'withdrawn') and new.state is distinct from old.state then
    raise exception 'PRIVACY_CASE_TERMINAL' using errcode = '23514';
  end if;
  if new.state is distinct from old.state then
    v_ok := case old.state
      when 'received' then new.state in ('verified', 'withdrawn', 'closed')
      when 'verified' then new.state in ('ready', 'received', 'withdrawn', 'closed')
      when 'ready' then new.state in ('executing', 'verified', 'withdrawn', 'blocked', 'closed')
      when 'executing' then (new.state = 'app_data_erased' and new.last_phase = 'relational') or new.state = 'blocked'
      when 'app_data_erased' then (new.state = 'supabase_erased' and new.last_phase = 'auth') or new.state = 'blocked'
      -- A failing finish quarantines the case with its last committed phase (auth) intact.
      when 'supabase_erased' then new.state in ('closed', 'blocked')
      when 'blocked' then new.state in ('executing', 'app_data_erased', 'supabase_erased', 'ready')
        or (new.state in ('withdrawn', 'closed', 'received') and old.armed_consumed_at is null)
      else false end;
    if not coalesce(v_ok, false) then
      raise exception 'PRIVACY_CASE_TRANSITION_INVALID' using errcode = '23514';
    end if;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;

-- F5: the challenge remembers the address it was issued for ---------------------------------------------
create or replace function public.privacy_op_start_verification(p_reference text, p_digest bytea, p_ttl_seconds integer default 1800)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if not (v.state in ('received', 'verified')
      or (v.state = 'blocked' and v.armed_consumed_at is null and v.blocker_code = 'VERIFICATION_STALE')) then
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
  -- The code was mailed to the address on file when it was issued: if that address changed, the proof
  -- belongs to another mailbox. Cancel it; verification must restart.
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
      challenge_consumed_at = pg_catalog.clock_timestamp(), challenge_digest = null,
      verified_address_digest = v.challenge_address_digest
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

-- F6: arm expiry (15 minutes), re-arm, and fresh proof at the claim --------------------------------------
create or replace function public.privacy_op_arm(p_reference text, p_expected jsonb, p_project_ref text, p_environment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_plan jsonb; v_email text;
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
  if not (v.state in ('verified', 'ready') and v.armed_consumed_at is null
      or (v.state = 'blocked' and v.armed_consumed_at is null)
      or (v.state = 'blocked' and v.last_phase in ('freeze') and v.blocker_code in ('PLAN_MISMATCH', 'SUCCESSOR_INVALID', 'ENVIRONMENT_MISMATCH', 'PLATFORM_ADMIN_GRANT'))) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_ARMABLE');
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
  if v.verified_address_digest is null
      or v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
    update privacy_internal.privacy_cases set state = case when state = 'verified' then 'received' else state end,
        verified_at = null, verified_address_digest = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'VERIFICATION_STALE');
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
      armed_consumed_at = null, attempt_count = 0, next_attempt_at = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state,
    'plan_hash', v.armed_plan_hash, 'arm_expires_at', v.arm_expires_at);
end $$;

create or replace function public.privacy_proc_claim(p_lease_seconds integer, p_project_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text; v_code text; v_action text;
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
    if v.armed_project_ref is distinct from p_project_ref or v.armed_plan is null then
      v_code := 'ENVIRONMENT_MISMATCH'; v_action := 'operator_rearm';
    elsif v.arm_expires_at is null or v.arm_expires_at <= pg_catalog.clock_timestamp() then
      -- An expired approval is never consumed: it must be re-armed.
      v_code := 'ARM_EXPIRED'; v_action := 'operator_rearm';
    elsif not exists (select 1 from public.participant_identities i where i.id = v.subject_id and i.state = 'live')
        or v_email is null then
      v_code := 'SUBJECT_NOT_LIVE'; v_action := 'operator_review';
    elsif v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8')) then
      v_code := 'VERIFICATION_STALE'; v_action := 'operator_review';
    end if;
    if v_code is not null then
      update privacy_internal.privacy_cases set state = 'blocked', blocker_code = v_code, next_action = v_action where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', v_code);
    end if;
    -- The one-use arm is consumed by the atomic claim: from here the case is irreversible.
    update privacy_internal.privacy_cases set state = 'executing', armed_consumed_at = pg_catalog.clock_timestamp(),
        attempt_count = 0 where id = v.id;
  end if;
  update privacy_internal.privacy_cases set fence = fence + 1, lease_token = gen_random_uuid(),
      lease_expires_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => p_lease_seconds)
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'claimed', 'case_id', v.id, 'fence', v.fence,
    'lease_token', v.lease_token, 'state', v.state, 'last_phase', v.last_phase, 'subject_id', v.subject_id);
end $$;

-- F7: a failing finish quarantines the case at its real state -----------------------------------------------
create or replace function public.privacy_proc_fail(p_case uuid, p_fence bigint, p_token uuid, p_code text, p_retryable boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_attempts integer;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if p_code not in ('STORAGE_FAILED', 'AUTH_DELETE_FAILED', 'AUTH_UNVERIFIED', 'FREEZE_FAILED', 'SEAM_FAILED', 'STORAGE_RESIDUE') then
    raise exception 'Invalid code' using errcode = '22023';
  end if;
  v_attempts := v.attempt_count + 1;
  if p_retryable and v_attempts < 6 then
    update privacy_internal.privacy_cases set attempt_count = v_attempts, lease_expires_at = null,
        next_attempt_at = pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => least(300, 10 * (2 ^ v_attempts)::integer))
      where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'retry', 'attempts', v_attempts);
  end if;
  update privacy_internal.privacy_cases set state = 'blocked', resume_state = v.state,
      attempt_count = v_attempts, lease_expires_at = null,
      blocker_code = case when p_retryable then 'RETRIES_EXHAUSTED' else p_code end, next_action = 'operator_retry'
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'blocked', 'attempts', v_attempts);
end $$;

-- F9: relational phase waits for in-flight work ------------------------------------------------------------
create or replace function public.privacy_proc_erase_relational(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v privacy_internal.privacy_cases; v_result jsonb; v_msg text; v_detail text; v_state text; v_map text[];
  v_frozen timestamptz; v_wait timestamptz;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase in ('relational', 'storage', 'auth') then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'relational');
  end if;
  if v.last_phase is distinct from 'freeze' or v.armed_plan is null then
    raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001';
  end if;
  -- Quiescence: the freeze marker fences every NEW write of the subject (restrictive RLS, producer filters).
  -- Work that passed its live check before the marker became visible must finish before the destructive
  -- phase: wait for the configured settle time, for older open transactions, and for leased push jobs.
  select f.frozen_at into v_frozen from privacy_internal.frozen_subjects f where f.subject_id = v.subject_id;
  if v_frozen is null then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  v_wait := v_frozen + pg_catalog.make_interval(secs => privacy_internal.privacy_setting('freeze_quiescence_seconds')::integer);
  if v_wait <= pg_catalog.clock_timestamp() then v_wait := null; end if;
  if v_wait is null and exists (select 1 from pg_catalog.pg_stat_activity a
      where a.datname = pg_catalog.current_database() and a.pid <> pg_catalog.pg_backend_pid()
        and a.backend_type = 'client backend' and a.xact_start is not null and a.xact_start < v_frozen
        and a.state <> 'idle') then
    v_wait := pg_catalog.clock_timestamp() + interval '5 seconds';
  end if;
  if v_wait is null then
    select pg_catalog.max(j.lease_expires_at) into v_wait from public.notification_push_jobs j
      join public.notifications n on n.id = j.notification_id
     where n.recipient_user_id = v.subject_id and j.status = 'leased' and j.lease_expires_at > pg_catalog.clock_timestamp();
  end if;
  if v_wait is not null then
    update privacy_internal.privacy_cases set next_attempt_at = least(v_wait, pg_catalog.clock_timestamp() + interval '10 minutes'),
        lease_expires_at = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'wait', 'phase', 'relational');
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
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', 'relational');
end $$;

-- F8: restore gate -------------------------------------------------------------------------------------------
-- A restored environment starts with intake and executor OFF and the gate pending: switches cannot be turned
-- on until the operator records that the erasures made after the snapshot were reconciled. No identity
-- ledger: the gate is a fail-closed flag plus an evidence reference, nothing else.
create or replace function public.privacy_op_set_switch(p_key text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_key in ('intake_enabled', 'executor_enabled') and p_value
      and privacy_internal.privacy_setting('restore_gate') = 'pending' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PENDING');
  end if;
  update privacy_internal.privacy_settings set value = case when p_value then 'true' else 'false' end
    where key = p_key and key in ('intake_enabled', 'executor_enabled');
  if not found then raise exception 'Invalid switch' using errcode = '22023'; end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'key', p_key, 'enabled', p_value);
end $$;

create function public.privacy_op_restore_gate(p_action text, p_evidence text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  if p_action = 'begin' then
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    update privacy_internal.privacy_settings set value = 'pending' where key = 'restore_gate';
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'pending');
  elsif p_action = 'clear' then
    if p_evidence is null or pg_catalog.length(pg_catalog.btrim(p_evidence)) < 8 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_EVIDENCE_REQUIRED');
    end if;
    update privacy_internal.privacy_settings set value = 'clear' where key = 'restore_gate';
    -- Intake and executor stay off: the operator turns them on explicitly afterwards.
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'clear');
  end if;
  raise exception 'Invalid gate action' using errcode = '22023';
end $$;

-- F10 / F11 / F9 producers: patches of earlier functions ---------------------------------------------------------
create function privacy_internal.erasure_archive_scope(p_subject uuid, p_succ jsonb) returns uuid[]
language sql stable security definer set search_path = '' as $$
  select coalesce(array(select c.id from public.communities c where c.archived_at is null and (
      (c.created_by = p_subject and not (coalesce(p_succ -> 'communities', '{}'::jsonb) ? c.id::text))
      or (exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = p_subject
            and m.role = 'admin' and m.status = 'active' and m.valid_until is null)
          and not exists (select 1 from public.community_members a where a.community_id = c.id and a.user_id <> p_subject
            and a.role = 'admin' and a.status = 'active'
            and (a.valid_until is null or a.valid_until > pg_catalog.clock_timestamp()))))
    order by c.id), '{}'::uuid[]);
$$;
create function privacy_internal.subject_frozen(p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from privacy_internal.frozen_subjects f where f.subject_id = p_subject);
$$;
revoke all on function privacy_internal.erasure_archive_scope(uuid, jsonb), privacy_internal.subject_frozen(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_op_restore_gate(text, text) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_restore_gate(text, text) to service_role;

do $patch$
declare
  r record; v_oid oid; v_def text; v_new text; v_count integer; v_ns regnamespace;
begin
  for r in select * from (values
    ('privacy_internal', 'account_erasure_plan', $q$  if exists (
    select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and pg_catalog.array_length(c.conkey, 1) = 1
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
       and not exists (select 1 from privacy_internal.erasure_dispositions d
          where d.schema_name = 'public' and d.table_name = t.relname and d.column_name = a.attname)) then$q$,
      $q$  if exists (
    select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
       -- Every column of the FK (composite included) must be classified in the registry.
       and exists (select 1 from pg_catalog.unnest(c.conkey) as k(attnum)
         join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = k.attnum
        where not exists (select 1 from privacy_internal.erasure_dispositions d
          where d.schema_name = 'public' and d.table_name = t.relname and d.column_name = a.attname))) then$q$, 1),
    ('privacy_internal', 'account_erasure_plan', $q$    'rebuild_communities', pg_catalog.cardinality(privacy_internal.erasure_subject_communities(p_subject)),$q$,
      $q$    'rebuild_communities', pg_catalog.cardinality(privacy_internal.erasure_subject_communities(p_subject)),
    'retired_leagues', (select pg_catalog.count(*) from public.leagues l
      where l.community_id = any (privacy_internal.erasure_archive_scope(p_subject, v_succ)) and l.status <> 'closed'),
    'retired_events', (select pg_catalog.count(*) from public.match_events e
      where e.community_id = any (privacy_internal.erasure_archive_scope(p_subject, v_succ))
        and e.status = 'open' and e.starts_at > pg_catalog.clock_timestamp()),$q$, 1),
    ('privacy_internal', 'account_erasure_execute', $q$      where c.archived_at is not null and l.status <> 'closed' order by l.id loop$q$,
      $q$      where c.archived_at = v_now and l.status <> 'closed' order by l.id loop$q$, 1),
    ('privacy_internal', 'account_erasure_execute', $q$      where c.archived_at is not null and e.status = 'open' and e.starts_at > v_now order by e.id loop$q$,
      $q$      where c.archived_at = v_now and e.status = 'open' and e.starts_at > v_now order by e.id loop$q$, 1),
    ('public', 'claim_match_player_add_redrives', $q$      and (o.state = 'awaiting_identity' or o.email_eligible)$q$,
      $q$      and (o.state = 'awaiting_identity' or o.email_eligible)
      and not privacy_internal.subject_frozen(o.actor_id)$q$, 2),
    ('public', 'dispatch_match_player_add', $q$  if v_op.id is null then return pg_catalog.jsonb_build_object('action', 'none'); end if;$q$,
      $q$  if v_op.id is null or privacy_internal.subject_frozen(p_actor_id) then
    return pg_catalog.jsonb_build_object('action', 'none');
  end if;$q$, 1),
    ('public', 'claim_notification_push_jobs', $q$    where (j.status = 'pending' and j.next_attempt_at <= now())
       or (j.status = 'leased' and j.lease_expires_at <= now())$q$,
      $q$    where ((j.status = 'pending' and j.next_attempt_at <= now())
       or (j.status = 'leased' and j.lease_expires_at <= now()))
      and not exists (select 1 from public.notifications n
        where n.id = j.notification_id and privacy_internal.subject_frozen(n.recipient_user_id))$q$, 1),
    ('public', 'persist_notification', $q$  if exists (select 1 from auth.users u where u.id = p_recipient_user_id and u.is_anonymous) then return null; end if;$q$,
      $q$  if exists (select 1 from auth.users u where u.id = p_recipient_user_id and u.is_anonymous)
      or privacy_internal.subject_frozen(p_recipient_user_id) then return null; end if;$q$, 1)
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
