begin;

-- PAF-232 (PAF-199 unit C): verified privacy-request case lifecycle and the resumable deletion engine.
--
-- Everything stateful lives in privacy_internal (no client privilege). Three families of definer
-- wrappers expose it:
--   * self-service  (authenticated): request_account_deletion, get_my_deletion_request,
--     withdraw_my_deletion_request. The subject is always auth.uid(); never a submitted id or email.
--   * operator      (service_role only): privacy_op_*. The challenge CODE is generated and shown by the
--     operator script; only its digest and expiry are stored.
--   * processor     (service_role only): privacy_proc_*. Lease + fence per call, one committed phase at a
--     time, relational erasure delegated to the unit B seam inside the same transaction as its phase mark.
--
-- State graph (guard trigger enforces it for every writer):
--   received -> verified | withdrawn | closed(refused)
--   verified -> ready | received(restart verification) | withdrawn | closed
--   ready    -> executing(claim, consumes the one-use arm) | verified | withdrawn | blocked | closed
--   executing -> app_data_erased(after relational) | blocked
--   app_data_erased -> supabase_erased(after storage+auth) | blocked
--   supabase_erased -> closed
--   blocked -> executing | app_data_erased (resume) | ready (re-arm; nothing irreversible yet) | withdrawn | closed
--   withdrawn, closed: terminal.

create table privacy_internal.privacy_settings (
  key text primary key check (key in ('intake_enabled', 'executor_enabled')),
  value text not null check (value in ('true', 'false'))
);
insert into privacy_internal.privacy_settings values ('intake_enabled', 'true'), ('executor_enabled', 'true');

create table privacy_internal.privacy_cases (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default ('PR-' || upper(pg_catalog.substr(pg_catalog.replace(gen_random_uuid()::text, '-', ''), 1, 12))),
  subject_id uuid,
  scope text not null default 'erasure' check (scope = 'erasure'),
  state text not null default 'received' check (state in
    ('received', 'verified', 'ready', 'executing', 'app_data_erased', 'supabase_erased', 'closed', 'withdrawn', 'blocked')),
  resume_state text check (resume_state in ('executing', 'app_data_erased')),
  last_phase text check (last_phase in ('freeze', 'relational', 'storage', 'auth')),
  received_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  challenge_digest bytea,
  challenge_expires_at timestamptz,
  challenge_attempts smallint not null default 0,
  challenge_consumed_at timestamptz,
  verified_at timestamptz,
  verified_address_digest bytea,
  armed_plan jsonb,
  armed_plan_hash text,
  armed_project_ref text,
  armed_environment text,
  armed_at timestamptz,
  armed_consumed_at timestamptz,
  phase_manifest jsonb not null default '{}'::jsonb,
  blocker_code text check (blocker_code in ('PLAN_MISMATCH', 'BLOCKED_PRECONDITION', 'PLATFORM_ADMIN_GRANT',
    'SUCCESSOR_INVALID', 'UNCLASSIFIED_DEPENDENCY', 'REGISTRY_DRIFT', 'SUBJECT_NOT_LIVE', 'RESIDUAL_REFERENCE',
    'ENVIRONMENT_MISMATCH', 'STORAGE_FAILED', 'STORAGE_RESIDUE', 'AUTH_DELETE_FAILED', 'AUTH_UNVERIFIED',
    'RETRIES_EXHAUSTED', 'SEAM_FAILED', 'FREEZE_FAILED')),
  next_action text check (next_action in ('operator_rearm', 'operator_retry', 'operator_remove_platform_grant', 'operator_review')),
  lease_token uuid,
  lease_expires_at timestamptz,
  fence bigint not null default 0,
  attempt_count smallint not null default 0,
  next_attempt_at timestamptz,
  outcome text check (outcome in ('erased', 'withdrawn', 'refused')),
  final_response_at timestamptz,
  purge_after timestamptz,
  closed_at timestamptz,
  check (subject_id is not null or state in ('closed', 'withdrawn')),
  check ((state = 'blocked') = (blocker_code is not null)),
  check ((state = 'blocked') = (next_action is not null))
);
create unique index privacy_cases_one_open on privacy_internal.privacy_cases (subject_id)
  where state not in ('closed', 'withdrawn');
create index privacy_cases_work on privacy_internal.privacy_cases (state, next_attempt_at)
  where state in ('ready', 'executing', 'app_data_erased', 'supabase_erased');
create index privacy_cases_purge on privacy_internal.privacy_cases (purge_after) where purge_after is not null;

create table privacy_internal.privacy_case_commands (
  subject_id uuid not null,
  command_id uuid not null,
  action text not null check (action in ('request', 'withdraw')),
  case_id uuid not null references privacy_internal.privacy_cases (id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (subject_id, command_id)
);
create index privacy_case_commands_window on privacy_internal.privacy_case_commands (subject_id, created_at)
  where action = 'request';

-- Non-identifying outcome counts kept after the purge (owner decision d).
create table privacy_internal.privacy_case_outcomes (
  month date not null,
  outcome text not null,
  cases integer not null check (cases > 0),
  primary key (month, outcome)
);

create table privacy_internal.frozen_subjects (
  subject_id uuid primary key,
  case_id uuid not null,
  frozen_at timestamptz not null default pg_catalog.clock_timestamp()
);

alter table privacy_internal.privacy_settings enable row level security;
alter table privacy_internal.privacy_cases enable row level security;
alter table privacy_internal.privacy_case_commands enable row level security;
alter table privacy_internal.privacy_case_outcomes enable row level security;
alter table privacy_internal.frozen_subjects enable row level security;
revoke all on privacy_internal.privacy_settings, privacy_internal.privacy_cases, privacy_internal.privacy_case_commands,
  privacy_internal.privacy_case_outcomes, privacy_internal.frozen_subjects from public, anon, authenticated, service_role;

create function privacy_internal.privacy_setting(p_key text) returns text
language sql stable security definer set search_path = '' as $$
  select s.value from privacy_internal.privacy_settings s where s.key = p_key;
$$;

-- Transition graph guard.
create function privacy_internal.guard_privacy_case() returns trigger
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
      when 'supabase_erased' then new.state = 'closed'
      when 'blocked' then new.state in ('executing', 'app_data_erased', 'ready')
        or (new.state in ('withdrawn', 'closed') and old.armed_consumed_at is null)
      else false end;
    if not coalesce(v_ok, false) then
      raise exception 'PRIVACY_CASE_TRANSITION_INVALID' using errcode = '23514';
    end if;
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger privacy_case_guard before update or delete on privacy_internal.privacy_cases
  for each row execute function privacy_internal.guard_privacy_case();

-- Live-existence and freeze gate: every authenticated boundary already routes through
-- is_provisional_actor() (restrictive RLS policies on every table and on storage.objects, and
-- assert_actor_not_provisional() in the definer RPCs). A frozen subject, or one whose live anchor is gone
-- (erased), is restricted there: a stale JWT is rejected by the live-existence check, not by a marker.
create function privacy_internal.account_actor_blocked() returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and (
    exists (select 1 from privacy_internal.frozen_subjects f where f.subject_id = (select auth.uid()))
    or not exists (select 1 from public.participant_identities i
      where i.id = (select auth.uid()) and i.state = 'live'));
$$;
create or replace function public.is_provisional_actor() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_provisional_player((select auth.uid())) or public.actor_session_revoked()
    or privacy_internal.account_actor_blocked();
$$;

-- Self-service RPCs ------------------------------------------------------------------------------
create function privacy_internal.case_receipt(p_case privacy_internal.privacy_cases, p_command uuid, p_replayed boolean)
returns jsonb language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'command_id', p_command, 'reference', p_case.reference, 'state', p_case.state,
    'received_at', p_case.received_at, 'replayed', p_replayed,
    'can_withdraw', p_case.state in ('received', 'verified', 'ready')
      or (p_case.state = 'blocked' and p_case.armed_consumed_at is null));
$$;

create function public.request_account_deletion(p_command_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := (select auth.uid()); v_case privacy_internal.privacy_cases; v_cmd privacy_internal.privacy_case_commands;
begin
  if v_uid is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform public.assert_actor_not_provisional();
  if p_command_id is null then raise exception 'Invalid command' using errcode = '22023'; end if;
  if not exists (select 1 from public.player_profiles p where p.user_id = v_uid and not p.is_provisional) then
    raise exception 'PRIVACY_REQUEST_ACCOUNT_REQUIRED' using errcode = '42501';
  end if;
  perform public.lock_actor_rate_scope('privacy_request', v_uid);
  select * into v_cmd from privacy_internal.privacy_case_commands c where c.subject_id = v_uid and c.command_id = p_command_id;
  if found then
    select * into v_case from privacy_internal.privacy_cases c where c.id = v_cmd.case_id;
    return privacy_internal.case_receipt(v_case, p_command_id, true);
  end if;
  if privacy_internal.privacy_setting('intake_enabled') <> 'true' then
    raise exception 'PRIVACY_REQUESTS_DISABLED' using errcode = 'P0001';
  end if;
  select * into v_case from privacy_internal.privacy_cases c
   where c.subject_id = v_uid and c.state not in ('closed', 'withdrawn') for update;
  if found then
    insert into privacy_internal.privacy_case_commands (subject_id, command_id, action, case_id)
      values (v_uid, p_command_id, 'request', v_case.id);
    return privacy_internal.case_receipt(v_case, p_command_id, true);
  end if;
  -- Fresh reopen cap: a short rolling window per subject (same advisory-lock pattern as security_rate_limits).
  if (select pg_catalog.count(distinct c.case_id) from privacy_internal.privacy_case_commands c
       where c.subject_id = v_uid and c.action = 'request'
         and c.created_at > pg_catalog.clock_timestamp() - interval '24 hours') >= 3 then
    raise exception 'PRIVACY_REQUEST_RATE_LIMITED' using errcode = 'P0001';
  end if;
  insert into privacy_internal.privacy_cases (subject_id) values (v_uid) returning * into v_case;
  insert into privacy_internal.privacy_case_commands (subject_id, command_id, action, case_id)
    values (v_uid, p_command_id, 'request', v_case.id);
  return privacy_internal.case_receipt(v_case, p_command_id, false);
end $$;

create function public.get_my_deletion_request() returns jsonb
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
    'can_withdraw', v_case.state in ('received', 'verified', 'ready')
      or (v_case.state = 'blocked' and v_case.armed_consumed_at is null));
end $$;

create function public.withdraw_my_deletion_request(p_command_id uuid) returns jsonb
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
  if not (v_case.state in ('received', 'verified', 'ready') or (v_case.state = 'blocked' and v_case.armed_consumed_at is null)) then
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

-- Operator RPCs (service_role) --------------------------------------------------------------------
create function privacy_internal.case_by_reference(p_reference text, p_lock boolean default true)
returns privacy_internal.privacy_cases language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  if p_lock then
    select * into v from privacy_internal.privacy_cases c where c.reference = p_reference for update;
  else
    select * into v from privacy_internal.privacy_cases c where c.reference = p_reference;
  end if;
  if not found then raise exception 'PRIVACY_CASE_NOT_FOUND' using errcode = 'P0002'; end if;
  return v;
end $$;

create function public.privacy_op_list_cases() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'reference', c.reference, 'state', c.state, 'received_at', c.received_at, 'last_phase', c.last_phase,
    'blocker_code', c.blocker_code, 'next_action', c.next_action, 'verified', c.verified_at is not null,
    'armed', c.armed_at is not null and c.armed_consumed_at is null, 'attempts', c.attempt_count,
    'purge_after', c.purge_after) order by c.received_at), '[]'::jsonb)
  from privacy_internal.privacy_cases c where c.state not in ('closed', 'withdrawn') or c.final_response_at is null;
$$;

create function public.privacy_op_start_verification(p_reference text, p_digest bytea, p_ttl_seconds integer default 1800)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state not in ('received', 'verified') then
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
      state = case when state = 'verified' then 'received' else state end,
      verified_at = null, verified_address_digest = null
    where id = v.id returning * into v;
  -- The address on file in Auth is returned to the operator console only (never stored here).
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference,
    'expires_at', v.challenge_expires_at, 'address', v_email);
end $$;

create function public.privacy_op_confirm_proof(p_reference text, p_digest bytea, p_operator_confirmed boolean)
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
    update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_EXPIRED');
  end if;
  if v.challenge_attempts >= 5 then
    update privacy_internal.privacy_cases set challenge_digest = null, challenge_expires_at = null where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_ATTEMPTS_EXCEEDED');
  end if;
  if p_digest is distinct from v.challenge_digest then
    update privacy_internal.privacy_cases set challenge_attempts = challenge_attempts + 1 where id = v.id;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CHALLENGE_INVALID');
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
  if v_email is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_VERIFIED_ADDRESS');
  end if;
  update privacy_internal.privacy_cases set state = 'verified', verified_at = pg_catalog.clock_timestamp(),
      challenge_consumed_at = pg_catalog.clock_timestamp(), challenge_digest = null,
      verified_address_digest = pg_catalog.sha256(pg_catalog.convert_to(v_email, 'UTF8'))
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

create function public.privacy_op_dry_run(p_reference text, p_successors jsonb default '{}'::jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference, false);
  if v.state not in ('verified', 'ready', 'blocked') or v.subject_id is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_PLANNABLE');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference,
    'plan', privacy_internal.account_erasure_plan(v.subject_id, coalesce(p_successors, '{}'::jsonb)));
end $$;

create function public.privacy_op_arm(p_reference text, p_expected jsonb, p_project_ref text, p_environment text)
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
  if not (v.state = 'verified' or (v.state = 'blocked' and v.armed_consumed_at is null)
      or (v.state = 'blocked' and v.last_phase in ('freeze') and v.blocker_code in ('PLAN_MISMATCH', 'SUCCESSOR_INVALID', 'ENVIRONMENT_MISMATCH', 'PLATFORM_ADMIN_GRANT'))) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_ARMABLE');
  end if;
  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
  if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
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
      armed_at = pg_catalog.clock_timestamp(), armed_consumed_at = null, attempt_count = 0, next_attempt_at = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state,
    'plan_hash', v.armed_plan_hash);
end $$;

create function public.privacy_op_retry(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state <> 'blocked' or v.resume_state is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_RETRYABLE');
  end if;
  update privacy_internal.privacy_cases set state = v.resume_state, blocker_code = null, next_action = null,
      attempt_count = 0, next_attempt_at = pg_catalog.clock_timestamp(), lease_expires_at = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

create function public.privacy_op_close_refused(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if not (v.state in ('received', 'verified', 'ready') or (v.state = 'blocked' and v.armed_consumed_at is null)) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_REFUSABLE');
  end if;
  update privacy_internal.privacy_cases set state = 'closed', outcome = 'refused', closed_at = pg_catalog.clock_timestamp(),
      blocker_code = null, next_action = null, challenge_digest = null, challenge_expires_at = null,
      armed_plan = null, armed_plan_hash = null, armed_project_ref = null, armed_environment = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

-- The operator sent the final mail from the operator mailbox: the case record purges 90 days later.
create function public.privacy_op_record_response(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state not in ('closed', 'withdrawn') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CASE_NOT_FINAL');
  end if;
  update privacy_internal.privacy_cases set final_response_at = pg_catalog.clock_timestamp(),
      purge_after = pg_catalog.clock_timestamp() + interval '90 days'
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'purge_after', v.purge_after);
end $$;

create function public.privacy_op_purge_expired() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_purged integer := 0; r record;
begin
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

create function public.privacy_op_set_switch(p_key text, p_value boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update privacy_internal.privacy_settings set value = case when p_value then 'true' else 'false' end where key = p_key;
  if not found then raise exception 'Invalid switch' using errcode = '22023'; end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'key', p_key, 'enabled', p_value);
end $$;

-- Processor RPCs (service_role) -------------------------------------------------------------------
create function privacy_internal.map_seam_error(p_message text, p_detail text) returns text[]
language sql immutable set search_path = '' as $$
  select case
    when p_message = 'ACCOUNT_ERASURE_BLOCKED' and p_detail like '%platform_admin_grant%' then array['PLATFORM_ADMIN_GRANT', 'operator_remove_platform_grant']
    when p_message = 'ACCOUNT_ERASURE_BLOCKED' and p_detail like '%successor_invalid%' then array['SUCCESSOR_INVALID', 'operator_rearm']
    when p_message = 'ACCOUNT_ERASURE_BLOCKED' and p_detail like '%unclassified_dependency%' then array['UNCLASSIFIED_DEPENDENCY', 'operator_review']
    when p_message = 'ACCOUNT_ERASURE_BLOCKED' and p_detail like '%registry_drift%' then array['REGISTRY_DRIFT', 'operator_review']
    when p_message = 'ACCOUNT_ERASURE_BLOCKED' and p_detail like '%subject_not_live%' then array['SUBJECT_NOT_LIVE', 'operator_review']
    when p_message = 'ACCOUNT_ERASURE_BLOCKED' then array['BLOCKED_PRECONDITION', 'operator_review']
    when p_message in ('ACCOUNT_ERASURE_PLAN_MISMATCH', 'ACCOUNT_ERASURE_PLAN_INVALID') then array['PLAN_MISMATCH', 'operator_rearm']
    when p_message = 'ACCOUNT_ERASURE_RESIDUAL_REFERENCE' then array['RESIDUAL_REFERENCE', 'operator_review']
    when p_message in ('ACCOUNT_ERASURE_SUBJECT_NOT_FOUND', 'ACCOUNT_ERASURE_SUBJECT_NOT_LIVE') then array['SUBJECT_NOT_LIVE', 'operator_review']
    else array['SEAM_FAILED', 'operator_retry'] end;
$$;

create function privacy_internal.case_lease(p_case uuid, p_fence bigint, p_token uuid)
returns privacy_internal.privacy_cases language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  select * into v from privacy_internal.privacy_cases c where c.id = p_case for update;
  if not found or v.fence <> p_fence or v.lease_token is distinct from p_token
      or v.lease_expires_at is null or v.lease_expires_at <= pg_catalog.clock_timestamp()
      or v.state not in ('executing', 'app_data_erased', 'supabase_erased') then
    raise exception 'PRIVACY_LEASE_LOST' using errcode = 'P0001';
  end if;
  update privacy_internal.privacy_cases set lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds'
    where id = p_case returning * into v;
  return v;
end $$;

create function privacy_internal.erasure_storage_objects(p_subject uuid)
returns table (bucket_id text, name text) language sql stable security definer set search_path = '' as $$
  select o.bucket_id::text, o.name::text from storage.objects o
   where o.bucket_id in ('player-avatars', 'match-event-photos', 'community-venue-photos')
     and (o.owner_id = p_subject::text
       or (o.bucket_id = 'player-avatars' and pg_catalog.split_part(o.name, '/', 1) = p_subject::text)
       or (o.bucket_id in ('match-event-photos', 'community-venue-photos') and pg_catalog.split_part(o.name, '/', 3) = p_subject::text))
   order by o.bucket_id, o.name;
$$;

create function privacy_internal.erasure_others_photo_count(p_subject uuid) returns bigint
language sql stable security definer set search_path = '' as $$
  select (select pg_catalog.count(*) from storage.objects o
      where o.bucket_id = 'match-event-photos' and pg_catalog.split_part(o.name, '/', 3) <> p_subject::text
        and exists (select 1 from public.match_events e where e.id::text = pg_catalog.split_part(o.name, '/', 2) and e.created_by = p_subject))
    + (select pg_catalog.count(*) from storage.objects o
      where o.bucket_id = 'community-venue-photos' and pg_catalog.split_part(o.name, '/', 3) <> p_subject::text
        and exists (select 1 from public.community_venues v where v.id::text = pg_catalog.split_part(o.name, '/', 2) and v.created_by = p_subject));
$$;

create function public.privacy_proc_claim(p_lease_seconds integer, p_project_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
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
    if v.armed_project_ref is distinct from p_project_ref or v.armed_plan is null then
      update privacy_internal.privacy_cases set state = 'blocked', blocker_code = 'ENVIRONMENT_MISMATCH',
          next_action = 'operator_rearm' where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'ENVIRONMENT_MISMATCH');
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

create function public.privacy_proc_freeze(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  insert into privacy_internal.frozen_subjects (subject_id, case_id) values (v.subject_id, v.id) on conflict do nothing;
  update privacy_internal.privacy_cases set last_phase = 'freeze', attempt_count = 0,
      phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('freeze',
        pg_catalog.jsonb_build_object('others_photos_for_review', privacy_internal.erasure_others_photo_count(v.subject_id)))
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', 'freeze');
end $$;

create function public.privacy_proc_erase_relational(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v privacy_internal.privacy_cases; v_result jsonb; v_msg text; v_detail text; v_state text; v_map text[];
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase in ('relational', 'storage', 'auth') then
    return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'relational');
  end if;
  if v.last_phase is distinct from 'freeze' or v.armed_plan is null then
    raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001';
  end if;
  begin
    -- A sub-transaction: a seam abort (blocked, drift, residue) leaves no partial application.
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

create function public.privacy_proc_storage_set(p_case uuid, p_fence bigint, p_token uuid, p_limit integer default 200)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase not in ('relational', 'storage') then
    raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001';
  end if;
  return coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('bucket', s.bucket_id, 'name', s.name))
    from (select * from privacy_internal.erasure_storage_objects(v.subject_id) limit greatest(1, least(p_limit, 500))) s), '[]'::jsonb);
end $$;

create function public.privacy_proc_complete_phase(p_case uuid, p_fence bigint, p_token uuid, p_phase text, p_removed integer default 0)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if p_phase = 'storage' then
    if v.last_phase = 'storage' or v.last_phase = 'auth' then
      return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'storage');
    end if;
    if v.last_phase is distinct from 'relational' then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
    if exists (select 1 from privacy_internal.erasure_storage_objects(v.subject_id)) then
      raise exception 'PRIVACY_STORAGE_RESIDUE' using errcode = 'P0001';
    end if;
    update privacy_internal.privacy_cases set last_phase = 'storage', attempt_count = 0,
        phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('storage',
          pg_catalog.jsonb_build_object('objects_removed', p_removed))
      where id = v.id;
  elsif p_phase = 'auth' then
    if v.last_phase = 'auth' then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'auth'); end if;
    if v.last_phase is distinct from 'storage' then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
    -- The database, not the API response, proves the Auth user is gone.
    if exists (select 1 from auth.users u where u.id = v.subject_id) then
      raise exception 'PRIVACY_AUTH_STILL_PRESENT' using errcode = 'P0001';
    end if;
    update privacy_internal.privacy_cases set last_phase = 'auth', state = 'supabase_erased', attempt_count = 0,
        phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('auth', pg_catalog.jsonb_build_object('verified_absent', true))
      where id = v.id;
  else
    raise exception 'Invalid phase' using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', p_phase);
end $$;

create function public.privacy_proc_finish(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.state = 'closed' then return pg_catalog.jsonb_build_object('status', 'skipped'); end if;
  if v.state <> 'supabase_erased' then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  delete from privacy_internal.frozen_subjects where subject_id = v.subject_id;
  delete from privacy_internal.privacy_case_commands where case_id = v.id;
  -- Unlink the subject and destroy every retry/verification pointer as soon as it is not needed.
  update privacy_internal.privacy_cases set state = 'closed', outcome = 'erased', closed_at = pg_catalog.clock_timestamp(),
      subject_id = null, armed_plan = null, armed_plan_hash = null, challenge_digest = null,
      verified_address_digest = null, lease_token = null, lease_expires_at = null
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

create function public.privacy_proc_fail(p_case uuid, p_fence bigint, p_token uuid, p_code text, p_retryable boolean)
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
  update privacy_internal.privacy_cases set state = 'blocked', resume_state = case when v.state = 'supabase_erased' then 'app_data_erased' else v.state end,
      attempt_count = v_attempts, lease_expires_at = null,
      blocker_code = case when p_retryable then 'RETRIES_EXHAUSTED' else p_code end, next_action = 'operator_retry'
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'blocked', 'attempts', v_attempts);
end $$;

-- Grants -------------------------------------------------------------------------------------------
revoke all on function
  privacy_internal.privacy_setting(text), privacy_internal.guard_privacy_case(), privacy_internal.account_actor_blocked(),
  privacy_internal.case_receipt(privacy_internal.privacy_cases, uuid, boolean),
  privacy_internal.case_by_reference(text, boolean), privacy_internal.map_seam_error(text, text),
  privacy_internal.case_lease(uuid, bigint, uuid), privacy_internal.erasure_storage_objects(uuid),
  privacy_internal.erasure_others_photo_count(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.request_account_deletion(uuid), public.get_my_deletion_request(),
  public.withdraw_my_deletion_request(uuid), public.privacy_op_list_cases(),
  public.privacy_op_start_verification(text, bytea, integer), public.privacy_op_confirm_proof(text, bytea, boolean),
  public.privacy_op_dry_run(text, jsonb), public.privacy_op_arm(text, jsonb, text, text), public.privacy_op_retry(text),
  public.privacy_op_close_refused(text), public.privacy_op_record_response(text), public.privacy_op_purge_expired(),
  public.privacy_op_set_switch(text, boolean), public.privacy_proc_claim(integer, text),
  public.privacy_proc_freeze(uuid, bigint, uuid), public.privacy_proc_erase_relational(uuid, bigint, uuid),
  public.privacy_proc_storage_set(uuid, bigint, uuid, integer), public.privacy_proc_complete_phase(uuid, bigint, uuid, text, integer),
  public.privacy_proc_finish(uuid, bigint, uuid), public.privacy_proc_fail(uuid, bigint, uuid, text, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.request_account_deletion(uuid), public.get_my_deletion_request(),
  public.withdraw_my_deletion_request(uuid) to authenticated;
grant execute on function public.privacy_op_list_cases(), public.privacy_op_start_verification(text, bytea, integer),
  public.privacy_op_confirm_proof(text, bytea, boolean), public.privacy_op_dry_run(text, jsonb),
  public.privacy_op_arm(text, jsonb, text, text), public.privacy_op_retry(text), public.privacy_op_close_refused(text),
  public.privacy_op_record_response(text), public.privacy_op_purge_expired(), public.privacy_op_set_switch(text, boolean),
  public.privacy_proc_claim(integer, text), public.privacy_proc_freeze(uuid, bigint, uuid),
  public.privacy_proc_erase_relational(uuid, bigint, uuid), public.privacy_proc_storage_set(uuid, bigint, uuid, integer),
  public.privacy_proc_complete_phase(uuid, bigint, uuid, text, integer), public.privacy_proc_finish(uuid, bigint, uuid),
  public.privacy_proc_fail(uuid, bigint, uuid, text, boolean) to service_role;

commit;
