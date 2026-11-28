begin;

-- PAF-199 review round 7 (F34, F37).
--   F34  identity-free erasure events: every completed erasure (history or not) leaves ONE bare event row, so restore
--        count parity covers erasures that created no tombstone
--   F37  the case remembers that the temporary ban was applied (and when it was lifted): a reclaimed stale pre-check
--        cannot strand a banned person, and withdraw/refuse wait for the confirmed unban

-- F34 ------------------------------------------------------------------------------------------------------------
-- NOT an identity ledger: a timestamp and a flag. No subject id, digest or mapping of any kind.
create table privacy_internal.erasure_events (
  id bigint generated always as identity primary key,
  erased_at timestamptz not null default pg_catalog.clock_timestamp(),
  tombstone_created boolean not null
);
alter table privacy_internal.erasure_events enable row level security;
revoke all on privacy_internal.erasure_events from public, anon, authenticated, service_role;
create index erasure_events_erased_at on privacy_internal.erasure_events (erased_at);

-- Best-effort history: one event per existing tombstone. Earlier erasures without history are unreconstructable.
insert into privacy_internal.erasure_events (erased_at, tombstone_created)
  select i.created_at, true from public.participant_identities i where i.state = 'withdrawn' and i.created_at is not null;

create function public.privacy_op_erasure_count_since(p_since timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('count', pg_catalog.count(*)) from privacy_internal.erasure_events e where e.erased_at > p_since;
$$;
revoke all on function public.privacy_op_erasure_count_since(timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_erasure_count_since(timestamptz) to service_role;

-- The old, tombstone-based counters are retired (the unused informational counter too).
drop function public.privacy_op_tombstone_count_since(timestamptz);
drop function public.privacy_op_erasures_since(timestamptz);

-- F37 -------------------------------------------------------------------------------------------------------------
alter table privacy_internal.privacy_cases add column ban_applied_at timestamptz, add column ban_lifted_at timestamptz;

-- Recorded by the processor (lease-fenced) IMMEDIATELY BEFORE the external ban call.
create function public.privacy_proc_ban_mark(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  update privacy_internal.privacy_cases set ban_applied_at = pg_catalog.clock_timestamp(), ban_lifted_at = null where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;
revoke all on function public.privacy_proc_ban_mark(uuid, bigint, uuid) from public, anon, authenticated, service_role;
grant execute on function public.privacy_proc_ban_mark(uuid, bigint, uuid) to service_role;

-- A banned person whose unban is not confirmed is never withdrawable, refusable or restartable.
create or replace function privacy_internal.case_reversible(p_case privacy_internal.privacy_cases) returns boolean
language sql immutable set search_path = '' as $$
  select p_case.destructive_started_at is null and p_case.armed_consumed_at is null
    and p_case.state in ('received', 'verified', 'ready', 'blocked')
    and coalesce(p_case.blocker_code, '') not in ('PENDING_UNBAN', 'BAN_LIFT_FAILED')
    and not (p_case.ban_applied_at is not null and p_case.ban_lifted_at is null);
$$;

create or replace function public.privacy_proc_freeze(p_case uuid, p_fence bigint, p_token uuid, p_check_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  if p_check_only then
    if v.destructive_started_at is null then
      select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
      if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
        -- A reclaimed case may already carry the ban of an earlier, interrupted attempt: then it waits for the unban.
        if v.ban_applied_at is not null and v.ban_lifted_at is null then
          update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'PENDING_UNBAN',
              next_action = 'operator_retry', armed_consumed_at = null, lease_expires_at = null where id = v.id;
          return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE', 'unban_required', true);
        end if;
        update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'VERIFICATION_STALE',
            next_action = 'operator_review', armed_consumed_at = null, lease_expires_at = null where id = v.id;
        return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE');
      end if;
    end if;
    return pg_catalog.jsonb_build_object('status', 'ok', 'phase', 'freeze');
  end if;
  if v.destructive_started_at is null then
    select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id for share;
    if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
      update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'PENDING_UNBAN',
          next_action = 'operator_retry', armed_consumed_at = null, lease_expires_at = null where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE', 'unban_required', true);
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

-- The unban outcome is durably recorded: the ban no longer blocks withdrawal or restart.
create or replace function public.privacy_proc_unban_done(p_case uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update privacy_internal.privacy_cases set blocker_code = 'VERIFICATION_STALE', next_action = 'operator_review',
      ban_lifted_at = pg_catalog.clock_timestamp()
    where id = p_case and state = 'blocked' and blocker_code = 'PENDING_UNBAN';
  if not found then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE');
end $$;

create or replace function public.privacy_op_ban_lift_done(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state <> 'blocked' or v.blocker_code not in ('BAN_LIFT_FAILED', 'PENDING_UNBAN') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'STATE_NOT_RETRYABLE');
  end if;
  update privacy_internal.privacy_cases set blocker_code = 'VERIFICATION_STALE', next_action = 'operator_review',
      ban_lifted_at = pg_catalog.clock_timestamp() where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'state', 'blocked');
end $$;

-- F34: the seam leaves one bare event when it completes (patch asserts exactly one occurrence) ---------------------
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$  delete from public.participant_identities where id = p_subject;$q$;
  v_new text := $q$  -- One identity-free event per completed erasure (history or not): the restore coverage proof counts these.
  insert into privacy_internal.erasure_events (tombstone_created) values (v_has_history);
  delete from public.participant_identities where id = p_subject;$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'privacy_internal'::regnamespace and p.proname = 'account_erasure_execute';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch account_erasure_execute: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

commit;
