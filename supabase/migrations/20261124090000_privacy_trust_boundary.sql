begin;

-- PAF-199 review round 6 (F28-F33 completion): the trust boundary is codified, every enforceable increment added.
--   F28  the isolation authority is a marker row only the provisioning path (supabase_admin) can write; the session
--        setting is a secondary check; clear checks it too
--   F29  explicit coverage_complete gate field (reconciled == expected, every member traced) required at clear
--   F31  remnants_swept_at: a flagged case cannot be acknowledged or answered before the remnant sweep ran
--   F33  PENDING_UNBAN: a stale freeze with a ban applied is not restartable until the unban outcome is recorded

-- F28 -----------------------------------------------------------------------------------------------------------
create table privacy_internal.restore_isolation_marker (
  id boolean primary key default true check (id),
  database_name text not null,
  marked_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table privacy_internal.restore_isolation_marker enable row level security;
-- No client role (service_role included) can create, change or remove the marker: only the provisioning path runs as
-- a role that is not subject to these revokes. The RPCs only read it.
revoke all on privacy_internal.restore_isolation_marker from public, anon, authenticated, service_role;

-- The marker names its database: a dump of a restore target restored under another name carries a foreign marker.
create or replace function privacy_internal.restore_isolated() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from privacy_internal.restore_isolation_marker m where m.database_name = pg_catalog.current_database())
    and coalesce(pg_catalog.current_setting('app.restore_target', true) = 'on', false);
$$;

-- Table shape ---------------------------------------------------------------------------------------------------
alter table privacy_internal.restore_gate add column coverage_complete boolean not null default false;
alter table privacy_internal.privacy_cases add column remnants_swept_at timestamptz;

alter table privacy_internal.privacy_cases drop constraint privacy_cases_blocker_code_check;
alter table privacy_internal.privacy_cases add constraint privacy_cases_blocker_code_check check (blocker_code in (
  'PLAN_MISMATCH', 'BLOCKED_PRECONDITION', 'PLATFORM_ADMIN_GRANT', 'SUCCESSOR_INVALID', 'UNCLASSIFIED_DEPENDENCY',
  'REGISTRY_DRIFT', 'SUBJECT_NOT_LIVE', 'RESIDUAL_REFERENCE', 'ENVIRONMENT_MISMATCH', 'STORAGE_FAILED', 'STORAGE_RESIDUE',
  'AUTH_DELETE_FAILED', 'AUTH_UNVERIFIED', 'RETRIES_EXHAUSTED', 'SEAM_FAILED', 'FREEZE_FAILED', 'ARM_EXPIRED',
  'VERIFICATION_STALE', 'QUIESCENCE_TIMEOUT', 'BAN_LIFT_FAILED', 'EXTERNAL_FOLLOWUP_ACK_REQUIRED', 'PENDING_UNBAN'));

-- F29: gate with explicit coverage ---------------------------------------------------------------------------------
create or replace function public.privacy_op_restore_gate(p_action text, p_evidence text default null, p_snapshot_at timestamptz default null,
  p_expected_subjects uuid[] default null, p_restore_project_ref text default null, p_tombstone_count integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
  v_ref text := pg_catalog.btrim(coalesce(p_restore_project_ref, '')); v_new uuid[]; v_expected uuid[]; v_rec uuid[];
  v_extend boolean; v_status text;
begin
  if p_action in ('begin', 'clear') and not privacy_internal.restore_isolated() then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_NOT_ISOLATED');
  end if;
  if p_action = 'begin' then
    if p_snapshot_at is null or pg_catalog.length(v_ref) not between 1 and 64 or p_tombstone_count is null or p_tombstone_count < 0 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PARAMETERS_REQUIRED');
    end if;
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    select * into g from privacy_internal.restore_gate for update;
    v_new := coalesce(array(select distinct x from pg_catalog.unnest(coalesce(p_expected_subjects, '{}'::uuid[])) x order by x), '{}'::uuid[]);
    v_extend := coalesce(g.status in ('pending', 'reconciled') and g.snapshot_at = p_snapshot_at
      and g.restore_project_ref = v_ref and g.restore_database = pg_catalog.current_database(), false);
    v_expected := case when v_extend
      then array(select distinct x from pg_catalog.unnest(g.expected_subjects || v_new) x order by x) else v_new end;
    v_rec := case when v_extend then g.reconciled_subjects else '{}'::uuid[] end;
    if pg_catalog.cardinality(v_expected) <> p_tombstone_count then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COUNT_MISMATCH',
        'expected', pg_catalog.cardinality(v_expected), 'tombstones', p_tombstone_count);
    end if;
    v_status := case when not exists (select 1 from pg_catalog.unnest(v_expected) e where e <> all (v_rec)) then 'reconciled' else 'pending' end;
    update privacy_internal.restore_gate set status = v_status, evidence_ref = null, snapshot_at = p_snapshot_at,
        expected_subjects = v_expected, reconciled_subjects = v_rec, restore_project_ref = v_ref,
        restore_database = pg_catalog.current_database(), tombstone_count = p_tombstone_count,
        expected_count = pg_catalog.cardinality(v_expected), coverage_complete = (v_status = 'reconciled'),
        storage_plans = case when v_extend then storage_plans else '{}'::jsonb end,
        storage_verified_subjects = case when v_extend then storage_verified_subjects else '{}'::uuid[] end,
        reconciled_at = case when v_status = 'reconciled' then pg_catalog.clock_timestamp() end,
        updated_at = pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', v_status, 'expected', pg_catalog.cardinality(v_expected));
  elsif p_action = 'clear' then
    select * into g from privacy_internal.restore_gate for update;
    if g.status <> 'reconciled' then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_REQUIRED');
    end if;
    -- Coverage is re-derived, not trusted from the flag alone: every expected member was reconciled (each only after
    -- its existence trace was found in this database).
    if not g.coverage_complete or exists (select 1 from pg_catalog.unnest(g.expected_subjects) e where e <> all (g.reconciled_subjects)) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COVERAGE_INCOMPLETE');
    end if;
    if pg_catalog.length(v_evidence) not between 1 and 200 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_EVIDENCE_REQUIRED');
    end if;
    if p_tombstone_count is distinct from pg_catalog.cardinality(g.reconciled_subjects) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COUNT_MISMATCH',
        'reconciled', pg_catalog.cardinality(g.reconciled_subjects), 'tombstones', p_tombstone_count);
    end if;
    update privacy_internal.restore_gate set status = 'closed', evidence_ref = v_evidence, expected_subjects = '{}',
        reconciled_subjects = '{}', storage_plans = '{}'::jsonb, storage_verified_subjects = '{}', coverage_complete = false,
        updated_at = pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'closed');
  end if;
  raise exception 'Invalid gate action' using errcode = '22023';
end $$;

create or replace function public.privacy_op_restore_reconcile(p_subject uuid, p_project_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_code text; v_plan jsonb; v_residue text[]; v_msg text; v_detail text; v_rec uuid[]; v_done boolean;
begin
  select * into g from privacy_internal.restore_gate for update;
  v_code := privacy_internal.restore_gate_check(p_subject, p_project_ref);
  if v_code is not null then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_code); end if;
  if p_subject <> all (g.storage_verified_subjects) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_STORAGE_PHASE_REQUIRED');
  end if;
  begin
    if exists (select 1 from public.participant_identities i where i.id = p_subject and i.state = 'live') then
      v_plan := privacy_internal.account_erasure_plan(p_subject, '{}'::jsonb);
      if pg_catalog.jsonb_array_length(v_plan -> 'blockers') > 0 then
        raise exception 'RESTORE_RECONCILE_BLOCKED' using detail = (v_plan -> 'blockers')::text;
      end if;
      perform privacy_internal.account_erasure_execute(p_subject, v_plan - 'blockers');
    end if;
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
  v_rec := array(select distinct x from pg_catalog.unnest(g.reconciled_subjects || p_subject) x order by x);
  v_done := not exists (select 1 from pg_catalog.unnest(g.expected_subjects) e where e <> all (v_rec));
  update privacy_internal.restore_gate set reconciled_subjects = v_rec, status = case when v_done then 'reconciled' else 'pending' end,
      coverage_complete = v_done, storage_plans = storage_plans - p_subject::text,
      reconciled_at = case when v_done then pg_catalog.clock_timestamp() end, updated_at = pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', case when v_done then 'reconciled' else 'pending' end,
    'reconciled', pg_catalog.cardinality(v_rec), 'expected', pg_catalog.cardinality(g.expected_subjects));
end $$;

-- F33: the case a stale freeze leaves behind is not restartable while the temporary ban may still be on --------------
create or replace function privacy_internal.case_reversible(p_case privacy_internal.privacy_cases) returns boolean
language sql immutable set search_path = '' as $$
  select p_case.destructive_started_at is null and p_case.armed_consumed_at is null
    and p_case.state in ('received', 'verified', 'ready', 'blocked')
    and coalesce(p_case.blocker_code, '') not in ('PENDING_UNBAN', 'BAN_LIFT_FAILED');
$$;

create or replace function public.privacy_proc_freeze(p_case uuid, p_fence bigint, p_token uuid, p_check_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  if p_check_only then
    -- Early exit before the ban (no lock, no ban yet).
    if v.destructive_started_at is null then
      select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
      if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
        update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'VERIFICATION_STALE',
            next_action = 'operator_review', armed_consumed_at = null, lease_expires_at = null where id = v.id;
        return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE');
      end if;
    end if;
    return pg_catalog.jsonb_build_object('status', 'ok', 'phase', 'freeze');
  end if;
  if v.destructive_started_at is null then
    -- This freeze IS the destructive start; the Auth row lock holds a concurrent email change off until commit.
    select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id for share;
    if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
      -- The temporary ban is on: the case waits in PENDING_UNBAN (never restartable) until the unban is recorded.
      update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'PENDING_UNBAN',
          next_action = 'operator_retry', armed_consumed_at = null, lease_expires_at = null where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE');
    end if;
  end if;
  update privacy_internal.case_producer_pause set active = true, since = pg_catalog.clock_timestamp(), subject_id = v.subject_id
    where case_id = v.id;
  if not found then
    insert into privacy_internal.case_producer_pause (case_id, subject_id, active) values (v.id, v.subject_id, true);
  end if;
  insert into privacy_internal.frozen_subjects (subject_id, case_id) values (v.subject_id, v.id) on conflict do nothing;
  update privacy_internal.privacy_cases set last_phase = 'freeze', attempt_count = 0, quiescence_attempts = 0,
      destructive_started_at = coalesce(destructive_started_at, pg_catalog.clock_timestamp()),
      phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('freeze',
        pg_catalog.jsonb_build_object('others_photos_for_review', privacy_internal.erasure_others_photo_count(v.subject_id)))
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', 'freeze');
end $$;

-- The processor recorded the unban outcome (no lease: the stale freeze released it).
create function public.privacy_proc_unban_done(p_case uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update privacy_internal.privacy_cases set blocker_code = 'VERIFICATION_STALE', next_action = 'operator_review'
    where id = p_case and state = 'blocked' and blocker_code = 'PENDING_UNBAN';
  if not found then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE');
end $$;

create or replace function public.privacy_proc_ban_lift_failed(p_case uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update privacy_internal.privacy_cases set blocker_code = 'BAN_LIFT_FAILED', next_action = 'operator_retry'
    where id = p_case and state = 'blocked' and blocker_code in ('PENDING_UNBAN', 'VERIFICATION_STALE')
      and destructive_started_at is null and last_phase is null;
  if not found then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'BAN_LIFT_FAILED');
end $$;

create or replace function public.privacy_op_retry(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state = 'blocked' and v.blocker_code in ('BAN_LIFT_FAILED', 'PENDING_UNBAN') then
    return pg_catalog.jsonb_build_object('status', 'ban_lift_required', 'subject_id', v.subject_id);
  end if;
  if v.state <> 'blocked' or v.resume_state is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_RETRYABLE');
  end if;
  update privacy_internal.privacy_cases set state = v.resume_state, blocker_code = null, next_action = null,
      attempt_count = 0, quiescence_attempts = 0, next_attempt_at = pg_catalog.clock_timestamp(), lease_expires_at = null
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

create or replace function public.privacy_op_ban_lift_done(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state <> 'blocked' or v.blocker_code not in ('BAN_LIFT_FAILED', 'PENDING_UNBAN') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_RETRYABLE');
  end if;
  update privacy_internal.privacy_cases set blocker_code = 'VERIFICATION_STALE', next_action = 'operator_review' where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', 'blocked');
end $$;

-- F31: the sweep precedes the acknowledgment and the response of a flagged case ----------------------------------------
create function public.privacy_op_remnants_swept(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state in ('closed', 'withdrawn') or v.destructive_started_at is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CASE_NOT_SWEEPABLE');
  end if;
  update privacy_internal.privacy_cases set remnants_swept_at = pg_catalog.clock_timestamp() where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference);
end $$;

create or replace function public.privacy_op_ack_external_followup(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if not coalesce((v.phase_manifest ->> 'external_followup')::boolean, false) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_EXTERNAL_FOLLOWUP');
  end if;
  -- The digests that identify an in-flight invitation's shell are destroyed at close: the sweep must come first.
  if v.remnants_swept_at is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'REMNANTS_SWEEP_REQUIRED');
  end if;
  update privacy_internal.privacy_cases set phase_manifest = phase_manifest || pg_catalog.jsonb_build_object('external_followup_ack', true)
    where id = v.id returning * into v;
  if v.state = 'blocked' and v.blocker_code = 'EXTERNAL_FOLLOWUP_ACK_REQUIRED' and v.resume_state is not null then
    update privacy_internal.privacy_cases set state = v.resume_state, blocker_code = null, next_action = null,
        attempt_count = 0, next_attempt_at = pg_catalog.clock_timestamp(), lease_expires_at = null
      where id = v.id returning * into v;
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', v.state);
end $$;

create or replace function public.privacy_op_record_response(p_reference text, p_external_followup_ack boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_followup boolean;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state not in ('closed', 'withdrawn') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CASE_NOT_FINAL');
  end if;
  v_followup := coalesce((v.phase_manifest ->> 'external_followup')::boolean, false);
  if v_followup and p_external_followup_ack is distinct from true
      and not coalesce((v.phase_manifest ->> 'external_followup_ack')::boolean, false) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EXTERNAL_FOLLOWUP_ACK_REQUIRED');
  end if;
  if v_followup and v.remnants_swept_at is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'REMNANTS_SWEEP_REQUIRED');
  end if;
  update privacy_internal.privacy_cases set final_response_at = pg_catalog.clock_timestamp(),
      purge_after = pg_catalog.clock_timestamp() + interval '90 days',
      phase_manifest = phase_manifest || case when v_followup then pg_catalog.jsonb_build_object('external_followup_ack', true) else '{}'::jsonb end
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'purge_after', v.purge_after);
end $$;

revoke all on function privacy_internal.restore_isolated(), privacy_internal.case_reversible(privacy_internal.privacy_cases)
  from public, anon, authenticated, service_role;
revoke all on function public.privacy_proc_unban_done(uuid), public.privacy_op_remnants_swept(text)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_proc_unban_done(uuid), public.privacy_op_remnants_swept(text) to service_role;

-- Arm cannot convert an unlifted ban into an ordinary stale blocker (patch asserts one occurrence) -----------------
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$  if not ((v.state in ('verified', 'ready') and v.armed_consumed_at is null)$q$;
  v_new text := $q$  if v.state = 'blocked' and v.blocker_code in ('PENDING_UNBAN', 'BAN_LIFT_FAILED') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_ARMABLE');
  end if;
  if not ((v.state in ('verified', 'ready') and v.armed_consumed_at is null)$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'privacy_op_arm';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch privacy_op_arm: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

commit;
