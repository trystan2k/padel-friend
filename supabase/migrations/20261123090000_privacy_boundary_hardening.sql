begin;

-- PAF-199 review round 5 (F28-F33).
--   F28  restore RPCs require a DATABASE-level isolation flag (app.restore_target = 'on'); a live database never has it
--   F29  count parity: expected subjects == withdrawn tombstones created after the snapshot (begin and clear)
--   F30  two-phase storage proof (plan from pointers + prefix listing, then deleted/re-listed confirmation); no caller boolean
--   F31  producers re-check the pause right before the external call; supabase_erased needs the follow-up ack;
--        remnant sweep support
--   F32  the freeze verifies the Auth address under a row lock as its last check
--   F33  a failed ban lift is a blocker (BAN_LIFT_FAILED), not silence

-- Tombstone creation time (tombstones carry no personal data); older rows stay NULL and never count.
alter table public.participant_identities add column created_at timestamptz;
alter table public.participant_identities alter column created_at set default pg_catalog.clock_timestamp();

alter table privacy_internal.privacy_cases drop constraint privacy_cases_blocker_code_check;
alter table privacy_internal.privacy_cases add constraint privacy_cases_blocker_code_check check (blocker_code in (
  'PLAN_MISMATCH', 'BLOCKED_PRECONDITION', 'PLATFORM_ADMIN_GRANT', 'SUCCESSOR_INVALID', 'UNCLASSIFIED_DEPENDENCY',
  'REGISTRY_DRIFT', 'SUBJECT_NOT_LIVE', 'RESIDUAL_REFERENCE', 'ENVIRONMENT_MISMATCH', 'STORAGE_FAILED', 'STORAGE_RESIDUE',
  'AUTH_DELETE_FAILED', 'AUTH_UNVERIFIED', 'RETRIES_EXHAUSTED', 'SEAM_FAILED', 'FREEZE_FAILED', 'ARM_EXPIRED',
  'VERIFICATION_STALE', 'QUIESCENCE_TIMEOUT', 'BAN_LIFT_FAILED', 'EXTERNAL_FOLLOWUP_ACK_REQUIRED'));

alter table privacy_internal.restore_gate
  add column tombstone_count integer,
  add column expected_count integer,
  add column storage_plans jsonb not null default '{}'::jsonb,
  add column storage_verified_subjects uuid[] not null default '{}';

-- F28 ------------------------------------------------------------------------------------------------------------
create function privacy_internal.restore_isolated() returns boolean
language sql stable set search_path = '' as $$
  select coalesce(pg_catalog.current_setting('app.restore_target', true) = 'on', false);
$$;

-- F29: tombstones are created by the seam and carry no personal data.
create function public.privacy_op_tombstone_count_since(p_since timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('count', pg_catalog.count(*)) from public.participant_identities i
   where i.state = 'withdrawn' and i.created_at > p_since;
$$;

create function public.privacy_op_restore_gate_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('status', g.status, 'snapshot_at', g.snapshot_at,
    'expected', pg_catalog.cardinality(g.expected_subjects), 'reconciled', pg_catalog.cardinality(g.reconciled_subjects),
    'tombstone_count', g.tombstone_count) from privacy_internal.restore_gate g;
$$;

drop function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], boolean, text);
create function public.privacy_op_restore_gate(p_action text, p_evidence text default null, p_snapshot_at timestamptz default null,
  p_expected_subjects uuid[] default null, p_restore_project_ref text default null, p_tombstone_count integer default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
  v_ref text := pg_catalog.btrim(coalesce(p_restore_project_ref, '')); v_new uuid[]; v_expected uuid[]; v_rec uuid[];
  v_extend boolean; v_status text;
begin
  if p_action = 'begin' then
    if not privacy_internal.restore_isolated() then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_NOT_ISOLATED');
    end if;
    if p_snapshot_at is null or pg_catalog.length(v_ref) not between 1 and 64 or p_tombstone_count is null or p_tombstone_count < 0 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PARAMETERS_REQUIRED');
    end if;
    -- Fail closed from the first begin attempt on: a restored environment never serves while the gate is unresolved.
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    select * into g from privacy_internal.restore_gate for update;
    v_new := coalesce(array(select distinct x from pg_catalog.unnest(coalesce(p_expected_subjects, '{}'::uuid[])) x order by x), '{}'::uuid[]);
    -- Same snapshot, project and database: the begin EXTENDS the open gate (late erasures), keeping what was reconciled.
    v_extend := coalesce(g.status in ('pending', 'reconciled') and g.snapshot_at = p_snapshot_at
      and g.restore_project_ref = v_ref and g.restore_database = pg_catalog.current_database(), false);
    v_expected := case when v_extend
      then array(select distinct x from pg_catalog.unnest(g.expected_subjects || v_new) x order by x) else v_new end;
    v_rec := case when v_extend then g.reconciled_subjects else '{}'::uuid[] end;
    -- Count parity: every expected subject is one erasure after the snapshot, i.e. one tombstone. Anything else is
    -- an unknown condition: fail closed, the operator escalates.
    if pg_catalog.cardinality(v_expected) <> p_tombstone_count then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COUNT_MISMATCH',
        'expected', pg_catalog.cardinality(v_expected), 'tombstones', p_tombstone_count);
    end if;
    v_status := case when not exists (select 1 from pg_catalog.unnest(v_expected) e where e <> all (v_rec)) then 'reconciled' else 'pending' end;
    update privacy_internal.restore_gate set status = v_status, evidence_ref = null, snapshot_at = p_snapshot_at,
        expected_subjects = v_expected, reconciled_subjects = v_rec, restore_project_ref = v_ref,
        restore_database = pg_catalog.current_database(), tombstone_count = p_tombstone_count,
        expected_count = pg_catalog.cardinality(v_expected),
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
    if pg_catalog.length(v_evidence) not between 1 and 200 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_EVIDENCE_REQUIRED');
    end if;
    -- Parity again at the end: an erasure made while reconciling shows up as an extra tombstone.
    if p_tombstone_count is distinct from pg_catalog.cardinality(g.reconciled_subjects) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COUNT_MISMATCH',
        'reconciled', pg_catalog.cardinality(g.reconciled_subjects), 'tombstones', p_tombstone_count);
    end if;
    update privacy_internal.restore_gate set status = 'closed', evidence_ref = v_evidence, expected_subjects = '{}',
        reconciled_subjects = '{}', storage_plans = '{}'::jsonb, storage_verified_subjects = '{}',
        updated_at = pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'closed');
  end if;
  raise exception 'Invalid gate action' using errcode = '22023';
end $$;

create or replace function privacy_internal.restore_gate_check(p_subject uuid, p_project_ref text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare g privacy_internal.restore_gate;
begin
  -- The authoritative boundary: only a database flagged as a restore target at creation may be reconciled.
  if not privacy_internal.restore_isolated() then return 'RESTORE_NOT_ISOLATED'; end if;
  select * into g from privacy_internal.restore_gate;
  if g.status is distinct from 'pending' then return 'RESTORE_GATE_NOT_PENDING'; end if;
  if p_project_ref is null or p_project_ref is distinct from g.restore_project_ref
      or g.restore_database is distinct from pg_catalog.current_database() then
    return 'RESTORE_PROJECT_MISMATCH';
  end if;
  if p_subject is null or p_subject <> all (g.expected_subjects) then return 'RESTORE_SUBJECT_NOT_EXPECTED'; end if;
  if not (exists (select 1 from public.participant_identities i where i.id = p_subject)
      or exists (select 1 from auth.users u where u.id = p_subject)
      or exists (select 1 from public.player_profiles pp where pp.user_id = p_subject)
      or pg_catalog.cardinality(privacy_internal.subject_residue(p_subject)) > 0) then
    return 'RESTORE_SUBJECT_NOT_FOUND';
  end if;
  return null;
end $$;

-- F30: phase 1 - the deletion plan (restored pointers + the objects the caller listed under the avatar prefix).
drop function public.privacy_op_restore_storage_set(uuid, text);
create function public.privacy_op_restore_storage_set(p_subject uuid, p_project_ref text, p_prefix_paths text[] default '{}')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; v_plan text[]; v_db text[] := '{}'; v_prefix text := 'player-avatars/' || p_subject::text || '/';
begin
  v_code := privacy_internal.restore_gate_check(p_subject, p_project_ref);
  if v_code is not null then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_code); end if;
  if exists (select 1 from pg_catalog.unnest(coalesce(p_prefix_paths, '{}'::text[])) p where pg_catalog.left(p, pg_catalog.length(v_prefix)) <> v_prefix) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STORAGE_PATH_REJECTED');
  end if;
  if pg_catalog.to_regclass('storage.objects') is not null then
    v_db := array(select s.bucket_id || '/' || s.name from privacy_internal.erasure_storage_objects(p_subject) s);
  end if;
  v_plan := array(select distinct x from (
      select 'player-avatars/' || p.avatar_url as x from public.player_profiles p where p.user_id = p_subject and p.avatar_url is not null
      union select 'match-event-photos/' || e.photo_path from public.match_events e where pg_catalog.split_part(e.photo_path, '/', 3) = p_subject::text
      union select 'community-venue-photos/' || v.photo_path from public.community_venues v where pg_catalog.split_part(v.photo_path, '/', 3) = p_subject::text
      union select unnest(v_db)
      union select unnest(coalesce(p_prefix_paths, '{}'::text[]))) q order by x);
  update privacy_internal.restore_gate set
      storage_plans = storage_plans || pg_catalog.jsonb_build_object(p_subject::text, pg_catalog.to_jsonb(v_plan)),
      storage_verified_subjects = pg_catalog.array_remove(storage_verified_subjects, p_subject);
  return pg_catalog.jsonb_build_object('status', 'ok', 'plan', pg_catalog.to_jsonb(v_plan));
end $$;

-- Phase 2 - the proof: exactly the plan was deleted and a fresh listing finds nothing.
create function public.privacy_op_restore_storage_confirm(p_subject uuid, p_project_ref text, p_deleted_paths text[], p_relisted_paths text[])
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_code text; g privacy_internal.restore_gate; v_plan text[]; v_deleted text[];
begin
  v_code := privacy_internal.restore_gate_check(p_subject, p_project_ref);
  if v_code is not null then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_code); end if;
  select * into g from privacy_internal.restore_gate for update;
  if not (g.storage_plans ? p_subject::text) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STORAGE_PLAN_MISSING');
  end if;
  v_plan := array(select pg_catalog.jsonb_array_elements_text(g.storage_plans -> p_subject::text) x order by x);
  v_deleted := array(select distinct x from pg_catalog.unnest(coalesce(p_deleted_paths, '{}'::text[])) x order by x);
  if v_plan is distinct from v_deleted then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STORAGE_INCOMPLETE');
  end if;
  if pg_catalog.cardinality(coalesce(p_relisted_paths, '{}'::text[])) > 0 then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STORAGE_LIE');
  end if;
  update privacy_internal.restore_gate set
      storage_verified_subjects = array(select distinct x from pg_catalog.unnest(storage_verified_subjects || p_subject) x order by x);
  return pg_catalog.jsonb_build_object('status', 'ok', 'storage_verified', true, 'objects', pg_catalog.cardinality(v_plan));
end $$;

drop function public.privacy_op_restore_reconcile(uuid, text, boolean);
create function public.privacy_op_restore_reconcile(p_subject uuid, p_project_ref text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_code text; v_plan jsonb; v_residue text[]; v_msg text; v_detail text; v_rec uuid[]; v_done boolean;
begin
  select * into g from privacy_internal.restore_gate for update;
  v_code := privacy_internal.restore_gate_check(p_subject, p_project_ref);
  if v_code is not null then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_code); end if;
  -- The Storage proof was recorded by the two-phase RPCs; no caller assertion is accepted.
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
      storage_plans = storage_plans - p_subject::text,
      reconciled_at = case when v_done then pg_catalog.clock_timestamp() end, updated_at = pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', case when v_done then 'reconciled' else 'pending' end,
    'reconciled', pg_catalog.cardinality(v_rec), 'expected', pg_catalog.cardinality(g.expected_subjects));
end $$;

-- F33 -------------------------------------------------------------------------------------------------------------
create or replace function public.privacy_op_retry(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  -- A failed ban lift is retried by the operator console (Auth admin API) before anything else resumes.
  if v.state = 'blocked' and v.blocker_code = 'BAN_LIFT_FAILED' then
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

create function public.privacy_op_ban_lift_done(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state <> 'blocked' or v.blocker_code <> 'BAN_LIFT_FAILED' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_RETRYABLE');
  end if;
  -- The lock-out is lifted: the case is the ordinary restartable stale-verification blocker again.
  update privacy_internal.privacy_cases set blocker_code = 'VERIFICATION_STALE', next_action = 'operator_review' where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', 'blocked');
end $$;

create function public.privacy_proc_ban_lift_failed(p_case uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update privacy_internal.privacy_cases set blocker_code = 'BAN_LIFT_FAILED', next_action = 'operator_retry'
    where id = p_case and state = 'blocked' and blocker_code = 'VERIFICATION_STALE'
      and destructive_started_at is null and last_phase is null;
  if not found then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'BAN_LIFT_FAILED');
end $$;

-- F32: lock the Auth row and verify as the LAST check before the freeze UPDATE ------------------------------------
create or replace function public.privacy_proc_freeze(p_case uuid, p_fence bigint, p_token uuid, p_check_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  if p_check_only then
    -- Early exit before the ban (no lock).
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
    -- This freeze IS the destructive start. The row lock holds a concurrent email change off until this transaction
    -- commits (after which it is a post-start change, recorded for the response routing).
    select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id for share;
    if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
      update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'VERIFICATION_STALE',
          next_action = 'operator_review', armed_consumed_at = null, lease_expires_at = null where id = v.id;
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

-- F31 -------------------------------------------------------------------------------------------------------------
-- Called by the dispatch worker immediately before the external send (the admission was earlier, the send is not atomic).
create function public.match_player_add_send_allowed(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare v_op public.match_player_add_operations%rowtype;
begin
  select * into v_op from public.match_player_add_operations o
    where o.actor_id = p_actor_id and o.match_event_id = p_match_event_id and o.request_id = p_request_id;
  if v_op.id is null then return false; end if;
  return not privacy_internal.player_add_paused(v_op.actor_id, v_op.target_user_id, v_op.email);
end $$;

create function public.privacy_op_ack_external_followup(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if not coalesce((v.phase_manifest ->> 'external_followup')::boolean, false) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_EXTERNAL_FOLLOWUP');
  end if;
  update privacy_internal.privacy_cases set phase_manifest = phase_manifest || pg_catalog.jsonb_build_object('external_followup_ack', true)
    where id = v.id returning * into v;
  -- The acknowledgment unblocks the supabase_erased boundary: the case resumes by itself.
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
  -- The acknowledgment normally happened at the supabase_erased boundary; either point satisfies it.
  if v_followup and p_external_followup_ack is distinct from true
      and not coalesce((v.phase_manifest ->> 'external_followup_ack')::boolean, false) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EXTERNAL_FOLLOWUP_ACK_REQUIRED');
  end if;
  update privacy_internal.privacy_cases set final_response_at = pg_catalog.clock_timestamp(),
      purge_after = pg_catalog.clock_timestamp() + interval '90 days',
      phase_manifest = phase_manifest || case when v_followup then pg_catalog.jsonb_build_object('external_followup_ack', true) else '{}'::jsonb end
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'purge_after', v.purge_after);
end $$;

-- Remnant sweep support: the retained address digest and the freeze time of a case that is still open.
create function public.privacy_op_remnant_context(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_since timestamptz;
begin
  v := privacy_internal.case_by_reference(p_reference, false);
  if v.state in ('closed', 'withdrawn') or v.destructive_started_at is null or v.verified_address_digest is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CASE_NOT_SWEEPABLE');
  end if;
  select p.since into v_since from privacy_internal.case_producer_pause p where p.case_id = v.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'since', coalesce(v_since, v.destructive_started_at),
    'digest', pg_catalog.encode(v.verified_address_digest, 'hex'));
end $$;

-- An invite shell: an invited, never signed-in Auth user without any profile. Anything else is a real person.
create function public.privacy_op_remnant_is_shell(p_user uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_shell boolean;
begin
  select exists (select 1 from auth.users u
    where u.id = p_user and u.invited_at is not null and u.last_sign_in_at is null
      and not exists (select 1 from public.player_profiles pp where pp.user_id = u.id)) into v_shell;
  return pg_catalog.jsonb_build_object('shell', v_shell);
end $$;

revoke all on function privacy_internal.restore_isolated() from public, anon, authenticated, service_role;
revoke all on function public.privacy_op_tombstone_count_since(timestamptz), public.privacy_op_restore_gate_status(),
  public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer),
  public.privacy_op_restore_storage_set(uuid, text, text[]),
  public.privacy_op_restore_storage_confirm(uuid, text, text[], text[]), public.privacy_op_restore_reconcile(uuid, text),
  public.privacy_op_retry(text), public.privacy_op_ban_lift_done(text), public.privacy_proc_ban_lift_failed(uuid),
  public.privacy_proc_freeze(uuid, bigint, uuid, boolean), public.match_player_add_send_allowed(uuid, uuid, uuid),
  public.privacy_op_ack_external_followup(text), public.privacy_op_record_response(text, boolean),
  public.privacy_op_remnant_context(text), public.privacy_op_remnant_is_shell(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_tombstone_count_since(timestamptz), public.privacy_op_restore_gate_status(),
  public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer),
  public.privacy_op_restore_storage_set(uuid, text, text[]),
  public.privacy_op_restore_storage_confirm(uuid, text, text[], text[]), public.privacy_op_restore_reconcile(uuid, text),
  public.privacy_op_retry(text), public.privacy_op_ban_lift_done(text), public.privacy_proc_ban_lift_failed(uuid),
  public.privacy_proc_freeze(uuid, bigint, uuid, boolean), public.match_player_add_send_allowed(uuid, uuid, uuid),
  public.privacy_op_ack_external_followup(text), public.privacy_op_record_response(text, boolean),
  public.privacy_op_remnant_context(text), public.privacy_op_remnant_is_shell(uuid) to service_role;

-- Patches of earlier functions (each asserts exactly one occurrence) -----------------------------------------------
do $patch$
declare
  r record; v_oid oid; v_def text; v_count integer; v_ns regnamespace;
begin
  for r in select * from (values
    ('public', 'privacy_proc_complete_phase',
      $q$    update privacy_internal.privacy_cases set last_phase = 'auth', state = 'supabase_erased', attempt_count = 0,$q$,
      $q$    -- Outstanding external sends are acknowledged by the operator BEFORE the case leaves the destructive boundary.
    if coalesce((v.phase_manifest ->> 'external_followup')::boolean, false)
        and not coalesce((v.phase_manifest ->> 'external_followup_ack')::boolean, false) then
      update privacy_internal.privacy_cases set state = 'blocked', resume_state = 'app_data_erased',
          blocker_code = 'EXTERNAL_FOLLOWUP_ACK_REQUIRED', next_action = 'operator_review', lease_expires_at = null where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'EXTERNAL_FOLLOWUP_ACK_REQUIRED');
    end if;
    update privacy_internal.privacy_cases set last_phase = 'auth', state = 'supabase_erased', attempt_count = 0,$q$, 1),
    ('public', 'prepare_notification_push',
      $q$  select * into v_n from public.notifications where id = p_notification_id;$q$,
      $q$  select * into v_n from public.notifications where id = p_notification_id;
  -- The pause is re-checked right before the vendor call: an admission that predates the freeze must not send.
  if privacy_internal.producer_paused(v_n.recipient_user_id) then
    update public.notification_push_deliveries set status = 'skipped', updated_at = now() where notification_id = p_notification_id and subscription_id = p_subscription_id;
    return null;
  end if;$q$, 1)
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
