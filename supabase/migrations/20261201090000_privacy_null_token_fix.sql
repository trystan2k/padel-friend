begin;

-- PAF-199 review round 13 (F49): NULL tokens. In SQL "a.token <> NULL" is NULL, so the stale-token branch of
-- privacy_op_cleanup_confirm never ran for a NULL token, and "unban_dispatch_token IS NOT DISTINCT FROM NULL" accepted
-- an undispatched row: a caller could resolve a cleanup without dispatching. Every token-bearing privacy RPC now
-- rejects NULL up front and compares with IS [NOT] DISTINCT FROM.

-- Lease fence: a NULL fence or token is a lost lease (not a comparison that happens to evaluate to NULL).
create or replace function privacy_internal.case_lease(p_case uuid, p_fence bigint, p_token uuid)
returns privacy_internal.privacy_cases language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  if p_case is null or p_fence is null or p_token is null then
    raise exception 'PRIVACY_LEASE_LOST' using errcode = 'P0001';
  end if;
  select * into v from privacy_internal.privacy_cases c where c.id = p_case for update;
  if not found or v.fence is distinct from p_fence or v.lease_token is distinct from p_token
      or v.lease_expires_at is null or v.lease_expires_at <= pg_catalog.clock_timestamp()
      or v.state not in ('executing', 'app_data_erased', 'supabase_erased') then
    raise exception 'PRIVACY_LEASE_LOST' using errcode = 'P0001';
  end if;
  update privacy_internal.privacy_cases set lease_expires_at = pg_catalog.clock_timestamp() + interval '120 seconds'
    where id = p_case returning * into v;
  return v;
end $$;

create or replace function public.privacy_op_cleanup_target(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid; v_token uuid := gen_random_uuid();
begin
  if p_reference is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_OPEN_OBLIGATION');
  end if;
  delete from privacy_internal.cleanup_admissions a where a.state = 'confirmed'
    and a.confirmed_at + pg_catalog.make_interval(secs => coalesce(privacy_internal.privacy_setting('privacy_cleanup_settle_seconds')::integer, 300))
      <= pg_catalog.clock_timestamp();
  if not exists (select 1 from privacy_internal.ban_cleanup_obligations o where o.case_ref = p_reference and o.resolved_at is null) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_OPEN_OBLIGATION');
  end if;
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_reference;
  if v_subject is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'OBLIGATION_SUBJECT_UNAVAILABLE');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
  if exists (select 1 from privacy_internal.privacy_cases n
      where n.subject_id = v_subject and n.reference <> p_reference and n.state not in ('closed', 'withdrawn')) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_SUPERSEDED');
  end if;
  insert into privacy_internal.cleanup_admissions (subject, token, case_ref) values (v_subject, v_token, p_reference)
    on conflict (subject) do update set token = excluded.token, case_ref = excluded.case_ref, state = 'active',
      admitted_at = pg_catalog.clock_timestamp(), unban_dispatched_at = null, unban_dispatch_token = null, confirmed_at = null;
  return pg_catalog.jsonb_build_object('status', 'ok', 'subject_id', v_subject, 'token', v_token);
end $$;

create or replace function public.privacy_op_cleanup_dispatch(p_token uuid, p_case_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid;
begin
  if p_token is null or p_case_ref is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_TOKEN_STALE');
  end if;
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_case_ref;
  if v_subject is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
  update privacy_internal.cleanup_admissions set unban_dispatched_at = pg_catalog.clock_timestamp(), unban_dispatch_token = p_token
    where subject = v_subject and token is not distinct from p_token and case_ref = p_case_ref and state = 'active';
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_TOKEN_STALE');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end $$;

create or replace function public.privacy_op_cleanup_confirm(p_token uuid, p_case_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid; a privacy_internal.cleanup_admissions; v_newer boolean;
begin
  if p_token is null or p_case_ref is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_TOKEN_STALE');
  end if;
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_case_ref;
  if v_subject is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
  select * into a from privacy_internal.cleanup_admissions x where x.subject = v_subject and x.case_ref = p_case_ref;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  if a.token is distinct from p_token or a.state is distinct from 'active' then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_TOKEN_STALE');
  end if;
  if a.unban_dispatch_token is distinct from p_token then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_DISPATCHED');
  end if;
  v_newer := exists (select 1 from privacy_internal.privacy_cases n
    where n.subject_id = v_subject and n.reference <> p_case_ref and n.state not in ('closed', 'withdrawn'));
  update privacy_internal.ban_cleanup_obligations set resolved_at = pg_catalog.clock_timestamp(), resolution = 'unbanned'
    where case_ref = p_case_ref and resolved_at is null;
  update privacy_internal.cleanup_admissions set state = 'confirmed', confirmed_at = pg_catalog.clock_timestamp() where subject = v_subject;
  return pg_catalog.jsonb_build_object('status', 'ok', 'newer_case_open', v_newer);
end $$;

create or replace function public.privacy_op_cleanup_release(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid;
begin
  if p_reference is null or not exists (select 1 from privacy_internal.ban_cleanup_obligations o where o.case_ref = p_reference and o.resolved_at is null) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_OPEN_OBLIGATION');
  end if;
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_reference;
  if v_subject is not null then
    perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
    delete from privacy_internal.cleanup_admissions where subject = v_subject;
  end if;
  update privacy_internal.ban_cleanup_obligations set resolved_at = pg_catalog.clock_timestamp(), resolution = 'superseded'
    where case_ref = p_reference and resolved_at is null;
  return pg_catalog.jsonb_build_object('status', 'ok', 'resolution', 'superseded');
end $$;

create or replace function public.privacy_proc_ban_mark(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  if p_case is null or p_fence is null or p_token is null then
    raise exception 'PRIVACY_LEASE_LOST' using errcode = 'P0001';
  end if;
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v.subject_id::text, 0));
  if privacy_internal.cleanup_gate_active(v.subject_id) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'CLEANUP_IN_PROGRESS');
  end if;
  update privacy_internal.privacy_cases set ban_applied_at = pg_catalog.clock_timestamp(), ban_lifted_at = null,
      ban_lease_token = p_token where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

-- NULL never owns a ban: ok requires a non-NULL token that equals the recorded one on an executing case.
create or replace function public.privacy_proc_ban_check(p_case uuid, p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  if p_case is null or p_token is null then
    return pg_catalog.jsonb_build_object('ok', false, 'unban', false, 'recoverable', false, 'code', 'BAN_FENCE_ABORTED');
  end if;
  select * into v from privacy_internal.privacy_cases c where c.id = p_case;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'unban', false, 'recoverable', false, 'code', 'BAN_FENCE_ABORTED');
  end if;
  if v.state = 'executing' and v.ban_lease_token is not distinct from p_token then
    return pg_catalog.jsonb_build_object('ok', true, 'unban', false, 'recoverable', false, 'code', null);
  end if;
  if v.destructive_started_at is not null or v.state in ('executing', 'app_data_erased', 'supabase_erased') then
    return pg_catalog.jsonb_build_object('ok', false, 'unban', false, 'recoverable', false,
      'code', case when v.destructive_started_at is not null then 'BAN_KEPT_FOR_IRREVERSIBLE' else 'BAN_FENCE_ABORTED' end);
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'unban', true,
    'recoverable', v.state = 'blocked' and v.blocker_code in ('VERIFICATION_STALE', 'PENDING_UNBAN'), 'code', 'BAN_FENCE_ABORTED');
end $$;

create or replace function public.privacy_proc_ban_cleanup_pending(p_case uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ref text;
begin
  if p_case is null or p_token is null then
    raise exception 'PRIVACY_LEASE_LOST' using errcode = 'P0001';
  end if;
  select c.reference into v_ref from privacy_internal.privacy_cases c where c.id = p_case;
  if v_ref is null then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  insert into privacy_internal.ban_cleanup_obligations (case_ref, token) values (v_ref, p_token) on conflict do nothing;
  return pg_catalog.jsonb_build_object('status', 'pending', 'code', 'BAN_CLEANUP_PENDING');
end $$;

commit;
