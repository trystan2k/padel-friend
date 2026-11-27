begin;

-- PAF-199 review round 11 (F47): cleanup admission. The ownership check of a cleanup retry was only a snapshot in
-- time: a new case could freeze and ban before the Auth unban landed, and the old cleanup would then lift ITS ban.
-- An admission row now serializes the two: while it exists, no case of that subject can record or apply a ban.

create table privacy_internal.cleanup_admissions (
  subject uuid primary key,
  token uuid not null,
  case_ref text not null,
  admitted_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table privacy_internal.cleanup_admissions enable row level security;
revoke all on privacy_internal.cleanup_admissions from public, anon, authenticated, service_role;

alter table privacy_internal.ban_cleanup_obligations add column resolution text check (resolution in ('unbanned', 'superseded'));

-- The admission is taken under the same per-subject advisory lock the ban recording and the freeze take, so the
-- ownership check, the admission and any concurrent ban admission are strictly ordered.
create or replace function public.privacy_op_cleanup_target(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid; v_token uuid := gen_random_uuid();
begin
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
  -- A re-run (the console crashed mid-unban) refreshes the token instead of leaving a stale admission.
  insert into privacy_internal.cleanup_admissions (subject, token, case_ref) values (v_subject, v_token, p_reference)
    on conflict (subject) do update set token = excluded.token, case_ref = excluded.case_ref,
      admitted_at = pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('status', 'ok', 'subject_id', v_subject, 'token', v_token);
end $$;

-- After the Auth unban landed: the admission must still be this run's, then the obligation resolves and the
-- admission is released. The old ownership re-check cannot undo the unban (the ban of any newer case was refused
-- while the admission stood); a newer case is only reported.
drop function public.privacy_op_cleanup_resolved(text);
create function public.privacy_op_cleanup_confirm(p_token uuid, p_case_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid; v_newer boolean;
begin
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_case_ref;
  if v_subject is null or not exists (select 1 from privacy_internal.cleanup_admissions a
      where a.subject = v_subject and a.token = p_token and a.case_ref = p_case_ref) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_NOT_ADMITTED');
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v_subject::text, 0));
  v_newer := exists (select 1 from privacy_internal.privacy_cases n
    where n.subject_id = v_subject and n.reference <> p_case_ref and n.state not in ('closed', 'withdrawn'));
  update privacy_internal.ban_cleanup_obligations set resolved_at = pg_catalog.clock_timestamp(), resolution = 'unbanned'
    where case_ref = p_case_ref and resolved_at is null;
  delete from privacy_internal.cleanup_admissions where subject = v_subject;
  return pg_catalog.jsonb_build_object('status', 'ok', 'newer_case_open', v_newer);
end $$;

-- Operator escape hatch: drop the admission WITHOUT unbanning (the new case legitimately owns the ban).
create function public.privacy_op_cleanup_release(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid;
begin
  if not exists (select 1 from privacy_internal.ban_cleanup_obligations o where o.case_ref = p_reference and o.resolved_at is null) then
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

-- A case that applies a ban may not run while a cleanup is admitted for its subject.
create or replace function public.privacy_proc_ban_mark(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v.subject_id::text, 0));
  if exists (select 1 from privacy_internal.cleanup_admissions a where a.subject = v.subject_id) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'CLEANUP_IN_PROGRESS');
  end if;
  update privacy_internal.privacy_cases set ban_applied_at = pg_catalog.clock_timestamp(), ban_lifted_at = null,
      ban_lease_token = p_token where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

-- Abandoned admissions of purged cases are released by the purge sweep.
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
  delete from privacy_internal.cleanup_admissions a
    where not exists (select 1 from privacy_internal.privacy_cases c where c.reference = a.case_ref);
  return pg_catalog.jsonb_build_object('status', 'ok', 'purged', v_purged);
end $$;

revoke all on function public.privacy_op_cleanup_confirm(uuid, text), public.privacy_op_cleanup_release(text)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_cleanup_confirm(uuid, text), public.privacy_op_cleanup_release(text) to service_role;

-- The freeze refuses while a cleanup is admitted for its subject (patch asserts exactly one occurrence).
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;$q$;
  v_new text := $q$  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  -- An admitted cleanup of the subject's old ban is in progress: fail closed (the case keeps its lease and retries).
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('privacy-cleanup:' || v.subject_id::text, 0));
  if exists (select 1 from privacy_internal.cleanup_admissions a where a.subject = v.subject_id) then
    return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'CLEANUP_IN_PROGRESS');
  end if;$q$;
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
