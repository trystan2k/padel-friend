begin;

-- PAF-199 review round 10 (F45-F46).
--   F45  the dump snapshot is REQUIRED: no legacy xid/time fallback in the count, and begin refuses a NULL snapshot
--   F46  the cleanup retry refuses when a newer case of the same subject is open: that case owns the ban state

-- F45 -------------------------------------------------------------------------------------------------------------
drop function public.privacy_op_erasure_count_since(bigint, timestamptz, text);
create function public.privacy_op_erasure_count_since(p_cutoff_xid bigint, p_cutoff_time timestamptz, p_cutoff_snapshot text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  -- Without the snapshot no completeness can be claimed (an uncommitted early event is invisible to xid and time).
  if p_cutoff_snapshot is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'SNAPSHOT_REQUIRED');
  end if;
  return (select pg_catalog.jsonb_build_object('count', pg_catalog.count(*)) from privacy_internal.erasure_events e
    where (e.xid is not null
             and not pg_catalog.pg_visible_in_snapshot(e.xid::text::pg_catalog.xid8, p_cutoff_snapshot::pg_catalog.pg_snapshot))
       or (e.xid is null and e.erased_at >= p_cutoff_time)
       or e.xid > p_cutoff_xid);
end $$;
revoke all on function public.privacy_op_erasure_count_since(bigint, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_erasure_count_since(bigint, timestamptz, text) to service_role;

-- begin: a NULL snapshot is refused (patch asserts exactly one occurrence)
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$    -- A malformed snapshot is a refusal, never a silent fallback.
    if p_cutoff_snapshot is not null then$q$;
  v_new text := $q$    if p_cutoff_snapshot is null then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'SNAPSHOT_REQUIRED');
    end if;
    -- A malformed snapshot is a refusal, never a silent fallback.
    if p_cutoff_snapshot is not null then$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'privacy_op_restore_gate';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch privacy_op_restore_gate: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

-- F46 -------------------------------------------------------------------------------------------------------------
-- Another open case of the SAME subject (any state but closed/withdrawn, an irreversible one included) owns the
-- subject's ban state: an old obligation must not lift a ban that protects it.
create or replace function public.privacy_op_cleanup_target(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_subject uuid;
begin
  if not exists (select 1 from privacy_internal.ban_cleanup_obligations o where o.case_ref = p_reference and o.resolved_at is null) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_OPEN_OBLIGATION');
  end if;
  select c.subject_id into v_subject from privacy_internal.privacy_cases c where c.reference = p_reference;
  if v_subject is null then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'OBLIGATION_SUBJECT_UNAVAILABLE');
  end if;
  if exists (select 1 from privacy_internal.privacy_cases n
      where n.subject_id = v_subject and n.reference <> p_reference and n.state not in ('closed', 'withdrawn')) then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CLEANUP_SUPERSEDED');
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'subject_id', v_subject);
end $$;

commit;
