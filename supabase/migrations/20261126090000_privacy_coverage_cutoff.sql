begin;

-- PAF-199 review round 8 (F38-F40).
--   F38  the restore cutoff is (xid, time) captured at dump start; the source count is a union filter, so an erasure
--        that began before the dump and commits after it is still counted
--   F39  event coverage starts at a recorded moment; a snapshot older than it is refused (PRE_LEDGER_SNAPSHOT)
--   F40  the ban is bound to the lease token of the worker that recorded it; an expired worker that applies it late is
--        detected after the call and undoes it

-- F38 ------------------------------------------------------------------------------------------------------------
alter table privacy_internal.erasure_events add column xid bigint;

-- patch asserts exactly one occurrence: the event also records the transaction id of the erasure
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$  insert into privacy_internal.erasure_events (tombstone_created) values (v_has_history);$q$;
  v_new text := $q$  insert into privacy_internal.erasure_events (tombstone_created, xid) values (v_has_history, pg_catalog.txid_current());$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'privacy_internal'::regnamespace and p.proname = 'account_erasure_execute';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch account_erasure_execute: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

drop function public.privacy_op_erasure_count_since(timestamptz);
-- Union filter: an erasure that STARTED before the cutoff but committed after it carries a pre-cutoff xid and a
-- post-cutoff time (counted by time); one inserted after the cutoff is counted by either; NULL-xid (historic) rows
-- only by time. Over-inclusion is safe in a disposable scratch copy (it can only make parity refuse).
create function public.privacy_op_erasure_count_since(p_cutoff_xid bigint, p_cutoff_time timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('count', pg_catalog.count(*)) from privacy_internal.erasure_events e
   where e.xid > p_cutoff_xid or e.erased_at >= p_cutoff_time;
$$;
revoke all on function public.privacy_op_erasure_count_since(bigint, timestamptz) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_erasure_count_since(bigint, timestamptz) to service_role;

-- F39 -------------------------------------------------------------------------------------------------------------
create table privacy_internal.coverage_meta (
  id boolean primary key default true check (id),
  coverage_start_at timestamptz not null
);
alter table privacy_internal.coverage_meta enable row level security;
revoke all on privacy_internal.coverage_meta from public, anon, authenticated, service_role;
insert into privacy_internal.coverage_meta (coverage_start_at) values (pg_catalog.clock_timestamp());

alter table privacy_internal.restore_gate add column cutoff_xid bigint;

drop function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer);
create function public.privacy_op_restore_gate(p_action text, p_evidence text default null, p_snapshot_at timestamptz default null,
  p_expected_subjects uuid[] default null, p_restore_project_ref text default null, p_tombstone_count integer default null,
  p_cutoff_xid bigint default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
  v_ref text := pg_catalog.btrim(coalesce(p_restore_project_ref, '')); v_new uuid[]; v_expected uuid[]; v_rec uuid[];
  v_extend boolean; v_status text;
begin
  if p_action in ('begin', 'clear') and not privacy_internal.restore_isolated() then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_NOT_ISOLATED');
  end if;
  if p_action = 'begin' then
    if p_snapshot_at is null or pg_catalog.length(v_ref) not between 1 and 64 or p_tombstone_count is null or p_tombstone_count < 0
        or p_cutoff_xid is null or p_cutoff_xid < 0 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PARAMETERS_REQUIRED');
    end if;
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    -- Erasure events only exist from the coverage start: an older snapshot cannot be proven complete (manual path).
    if p_snapshot_at < (select m.coverage_start_at from privacy_internal.coverage_meta m) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'PRE_LEDGER_SNAPSHOT');
    end if;
    select * into g from privacy_internal.restore_gate for update;
    v_new := coalesce(array(select distinct x from pg_catalog.unnest(coalesce(p_expected_subjects, '{}'::uuid[])) x order by x), '{}'::uuid[]);
    v_extend := coalesce(g.status in ('pending', 'reconciled') and g.snapshot_at = p_snapshot_at and g.cutoff_xid = p_cutoff_xid
      and g.restore_project_ref = v_ref and g.restore_database = pg_catalog.current_database(), false);
    v_expected := case when v_extend
      then array(select distinct x from pg_catalog.unnest(g.expected_subjects || v_new) x order by x) else v_new end;
    v_rec := case when v_extend then g.reconciled_subjects else '{}'::uuid[] end;
    if pg_catalog.cardinality(v_expected) <> p_tombstone_count then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COUNT_MISMATCH',
        'expected', pg_catalog.cardinality(v_expected), 'tombstones', p_tombstone_count);
    end if;
    v_status := case when not exists (select 1 from pg_catalog.unnest(v_expected) e where e <> all (v_rec)) then 'reconciled' else 'pending' end;
    update privacy_internal.restore_gate set status = v_status, evidence_ref = null, snapshot_at = p_snapshot_at, cutoff_xid = p_cutoff_xid,
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
    if not g.coverage_complete or exists (select 1 from pg_catalog.unnest(g.expected_subjects) e where e <> all (g.reconciled_subjects)) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'COVERAGE_INCOMPLETE');
    end if;
    if pg_catalog.length(v_evidence) not between 1 and 200 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_EVIDENCE_REQUIRED');
    end if;
    -- Re-parity with the SAME cutoff: erasures committed after the derivation grow the event count.
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

create or replace function public.privacy_op_restore_gate_status() returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('status', g.status, 'snapshot_at', g.snapshot_at, 'cutoff_xid', g.cutoff_xid,
    'expected', pg_catalog.cardinality(g.expected_subjects), 'reconciled', pg_catalog.cardinality(g.reconciled_subjects),
    'tombstone_count', g.tombstone_count) from privacy_internal.restore_gate g;
$$;

revoke all on function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer, bigint) to service_role;

-- F40 -------------------------------------------------------------------------------------------------------------
alter table privacy_internal.privacy_cases add column ban_lease_token uuid;

-- Recorded together with ban_applied_at, bound to the lease of the worker that is about to ban (case_lease verifies it).
create or replace function public.privacy_proc_ban_mark(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  update privacy_internal.privacy_cases set ban_applied_at = pg_catalog.clock_timestamp(), ban_lifted_at = null,
      ban_lease_token = p_token where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

-- After the external ban call returned: does this worker still own the case? A stale worker (lease expired, case
-- recovered) must undo its late ban. ok = this token holds the ban on an executing case. When it does not, 'unban'
-- says whether nobody wants the ban any more (a newer worker that owns the ban on an executing case keeps it).
create function public.privacy_proc_ban_check(p_case uuid, p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  select * into v from privacy_internal.privacy_cases c where c.id = p_case;
  if not found then return pg_catalog.jsonb_build_object('ok', false, 'unban', true); end if;
  if v.state = 'executing' and v.ban_lease_token = p_token then
    return pg_catalog.jsonb_build_object('ok', true, 'unban', false);
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'unban', not (v.state = 'executing'));
end $$;
revoke all on function public.privacy_proc_ban_check(uuid, uuid) from public, anon, authenticated, service_role;
grant execute on function public.privacy_proc_ban_check(uuid, uuid) to service_role;

commit;
