begin;

-- PAF-199 review round 12 (F48): the cleanup unban is generation-fenced. Retry A admitted under token T1 and stalls in
-- its Auth call; retry B refreshes to T2, unbans, confirms and used to release the admission, so a new case could ban
-- and A's late unban would lift it. Now: the unban is only DISPATCHED under the current token, a stale generation can
-- neither dispatch nor confirm, and a confirmed admission keeps gating bans for a settle window.

alter table privacy_internal.cleanup_admissions
  add column state text not null default 'active' check (state in ('active', 'confirmed')),
  add column unban_dispatched_at timestamptz,
  add column unban_dispatch_token uuid,
  add column confirmed_at timestamptz;

alter table privacy_internal.privacy_settings drop constraint privacy_settings_key_check;
alter table privacy_internal.privacy_settings add constraint privacy_settings_key_check check (key in ('intake_enabled', 'executor_enabled',
  'freeze_quiescence_seconds', 'privacy_quiescence_max_attempts', 'privacy_cleanup_settle_seconds'));
insert into privacy_internal.privacy_settings values ('privacy_cleanup_settle_seconds', '300');

-- The gate: an active admission, or a confirmed one still inside its settle window.
create function privacy_internal.cleanup_gate_active(p_subject uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from privacy_internal.cleanup_admissions a where a.subject = p_subject
    and (a.state = 'active' or a.confirmed_at + pg_catalog.make_interval(secs =>
      coalesce(privacy_internal.privacy_setting('privacy_cleanup_settle_seconds')::integer, 300)) > pg_catalog.clock_timestamp()));
$$;
revoke all on function privacy_internal.cleanup_gate_active(uuid) from public, anon, authenticated, service_role;

create or replace function public.privacy_op_cleanup_target(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid; v_token uuid := gen_random_uuid();
begin
  -- A retry run also releases confirmed admissions past their settle window.
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
  -- A new generation: the previous token (and any unban it dispatched) is stale from now on.
  insert into privacy_internal.cleanup_admissions (subject, token, case_ref) values (v_subject, v_token, p_reference)
    on conflict (subject) do update set token = excluded.token, case_ref = excluded.case_ref, state = 'active',
      admitted_at = pg_catalog.clock_timestamp(), unban_dispatched_at = null, unban_dispatch_token = null, confirmed_at = null;
  return pg_catalog.jsonb_build_object('status', 'ok', 'subject_id', v_subject, 'token', v_token);
end $$;

-- Called by the console immediately BEFORE the Auth unban: only the current generation may dispatch.
create function public.privacy_op_cleanup_dispatch(p_token uuid, p_case_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid;
begin
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_case_ref;
  if v_subject is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
  update privacy_internal.cleanup_admissions set unban_dispatched_at = pg_catalog.clock_timestamp(), unban_dispatch_token = p_token
    where subject = v_subject and token = p_token and case_ref = p_case_ref and state = 'active';
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_TOKEN_STALE');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end $$;

-- Only the current, dispatched generation confirms. The admission is KEPT (confirmed) for the settle window: an older,
-- still in-flight unban can no longer lift the ban of a case that starts after the gate would have opened.
create or replace function public.privacy_op_cleanup_confirm(p_token uuid, p_case_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid; a privacy_internal.cleanup_admissions; v_newer boolean;
begin
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_case_ref;
  if v_subject is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
  select * into a from privacy_internal.cleanup_admissions x where x.subject = v_subject and x.case_ref = p_case_ref;
  if not found then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  if a.token <> p_token or a.state <> 'active' then
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

create or replace function public.privacy_proc_ban_mark(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v.subject_id::text, 0));
  if privacy_internal.cleanup_gate_active(v.subject_id) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'CLEANUP_IN_PROGRESS');
  end if;
  update privacy_internal.privacy_cases set ban_applied_at = pg_catalog.clock_timestamp(), ban_lifted_at = null,
      ban_lease_token = p_token where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

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
  -- Admissions of purged cases, and confirmed ones past their settle window. ACTIVE admissions persist until the
  -- operator confirms or releases them (fail closed).
  delete from privacy_internal.cleanup_admissions a
    where not exists (select 1 from privacy_internal.privacy_cases c where c.reference = a.case_ref)
       or (a.state = 'confirmed' and a.confirmed_at + pg_catalog.make_interval(secs =>
         coalesce(privacy_internal.privacy_setting('privacy_cleanup_settle_seconds')::integer, 300)) <= pg_catalog.clock_timestamp());
  return pg_catalog.jsonb_build_object('status', 'ok', 'purged', v_purged);
end $$;

revoke all on function public.privacy_op_cleanup_dispatch(uuid, text) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_cleanup_dispatch(uuid, text) to service_role;

-- The freeze consults the same gate (patch asserts exactly one occurrence).
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$  if exists (select 1 from privacy_internal.cleanup_admissions a where a.subject = v.subject_id) then$q$;
  v_new text := $q$  if privacy_internal.cleanup_gate_active(v.subject_id) then$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'privacy_proc_freeze';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch privacy_proc_freeze: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

commit;
