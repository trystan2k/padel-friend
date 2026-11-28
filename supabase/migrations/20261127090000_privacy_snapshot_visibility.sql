begin;

-- PAF-199 review round 9 (F42-F44).
--   F42  the restore cutoff includes the dump's snapshot: an erasure event whose transaction was not yet visible to it
--        (in progress, or started later) is counted, however early its xid and timestamp
--   F43  a late ban is undone only in a reversible, pre-destructive case; an irreversible case keeps its protection
--   F44  a failed undo of a late ban on a case that left the state machine (withdrawn, closed) becomes a durable,
--        identity-free cleanup obligation the operator resolves

-- F42 ------------------------------------------------------------------------------------------------------------
drop function public.privacy_op_erasure_count_since(bigint, timestamptz);
-- INCLUDE unless the event's transaction was visible to the dump-start snapshot (committed before it: the subject is
-- already absent from the dump). Not visible = in progress or later = uncertain = counted (over-inclusion only makes
-- parity refuse, safe in a disposable scratch). Without a snapshot (legacy callers) the round-8 union filter applies.
create function public.privacy_op_erasure_count_since(p_cutoff_xid bigint, p_cutoff_time timestamptz, p_cutoff_snapshot text default null)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('count', pg_catalog.count(*)) from privacy_internal.erasure_events e
   where case when p_cutoff_snapshot is null then (e.xid > p_cutoff_xid or e.erased_at >= p_cutoff_time)
     else (e.xid is not null
             and not pg_catalog.pg_visible_in_snapshot(e.xid::text::pg_catalog.xid8, p_cutoff_snapshot::pg_catalog.pg_snapshot))
       or (e.xid is null and e.erased_at >= p_cutoff_time)
       or e.xid > p_cutoff_xid end;
$$;
revoke all on function public.privacy_op_erasure_count_since(bigint, timestamptz, text) from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_erasure_count_since(bigint, timestamptz, text) to service_role;

alter table privacy_internal.restore_gate add column cutoff_snapshot text;

drop function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer, bigint);
create function public.privacy_op_restore_gate(p_action text, p_evidence text default null, p_snapshot_at timestamptz default null,
  p_expected_subjects uuid[] default null, p_restore_project_ref text default null, p_tombstone_count integer default null,
  p_cutoff_xid bigint default null, p_cutoff_snapshot text default null)
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
    -- A malformed snapshot is a refusal, never a silent fallback.
    if p_cutoff_snapshot is not null then
      begin
        perform p_cutoff_snapshot::pg_catalog.pg_snapshot;
      exception when others then
        return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PARAMETERS_REQUIRED');
      end;
    end if;
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    if p_snapshot_at < (select m.coverage_start_at from privacy_internal.coverage_meta m) then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'PRE_LEDGER_SNAPSHOT');
    end if;
    select * into g from privacy_internal.restore_gate for update;
    v_new := coalesce(array(select distinct x from pg_catalog.unnest(coalesce(p_expected_subjects, '{}'::uuid[])) x order by x), '{}'::uuid[]);
    v_extend := coalesce(g.status in ('pending', 'reconciled') and g.snapshot_at = p_snapshot_at and g.cutoff_xid = p_cutoff_xid
      and g.cutoff_snapshot is not distinct from p_cutoff_snapshot
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
        cutoff_snapshot = p_cutoff_snapshot,
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
    'cutoff_snapshot', g.cutoff_snapshot,
    'expected', pg_catalog.cardinality(g.expected_subjects), 'reconciled', pg_catalog.cardinality(g.reconciled_subjects),
    'tombstone_count', g.tombstone_count) from privacy_internal.restore_gate g;
$$;

revoke all on function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer, bigint, text)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_restore_gate(text, text, timestamptz, uuid[], text, integer, bigint, text) to service_role;

-- F43 + F44 ---------------------------------------------------------------------------------------------------------
-- Durable, identity-free: a neutral case reference and a token, no subject identifier. NOT a case-state transition, so
-- it survives withdrawn/closed.
create table privacy_internal.ban_cleanup_obligations (
  id bigint generated always as identity primary key,
  case_ref text not null,
  token uuid,
  obligated_at timestamptz not null default pg_catalog.clock_timestamp(),
  resolved_at timestamptz
);
alter table privacy_internal.ban_cleanup_obligations enable row level security;
revoke all on privacy_internal.ban_cleanup_obligations from public, anon, authenticated, service_role;
create unique index ban_cleanup_obligations_open on privacy_internal.ban_cleanup_obligations (case_ref) where resolved_at is null;

-- After the external ban call returned. ok: this token holds the ban on an executing case. unban: nobody wants the ban
-- any more AND the case is genuinely pre-destructive (never started the erasure); an irreversible case or a newer
-- worker's executing case keeps its protection. recoverable: the case is a blocked stale-proof case the state machine
-- can carry a failed unban for; otherwise (withdrawn, closed, ...) a failed unban becomes a cleanup obligation.
create or replace function public.privacy_proc_ban_check(p_case uuid, p_token uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  select * into v from privacy_internal.privacy_cases c where c.id = p_case;
  if not found then
    return pg_catalog.jsonb_build_object('ok', false, 'unban', false, 'recoverable', false, 'code', 'BAN_FENCE_ABORTED');
  end if;
  if v.state = 'executing' and v.ban_lease_token = p_token then
    return pg_catalog.jsonb_build_object('ok', true, 'unban', false, 'recoverable', false, 'code', null);
  end if;
  if v.destructive_started_at is not null or v.state in ('executing', 'app_data_erased', 'supabase_erased') then
    return pg_catalog.jsonb_build_object('ok', false, 'unban', false, 'recoverable', false,
      'code', case when v.destructive_started_at is not null then 'BAN_KEPT_FOR_IRREVERSIBLE' else 'BAN_FENCE_ABORTED' end);
  end if;
  return pg_catalog.jsonb_build_object('ok', false, 'unban', true,
    'recoverable', v.state = 'blocked' and v.blocker_code in ('VERIFICATION_STALE', 'PENDING_UNBAN'), 'code', 'BAN_FENCE_ABORTED');
end $$;

create function public.privacy_proc_ban_cleanup_pending(p_case uuid, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_ref text;
begin
  select c.reference into v_ref from privacy_internal.privacy_cases c where c.id = p_case;
  if v_ref is null then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  insert into privacy_internal.ban_cleanup_obligations (case_ref, token) values (v_ref, p_token) on conflict do nothing;
  return pg_catalog.jsonb_build_object('status', 'pending', 'code', 'BAN_CLEANUP_PENDING');
end $$;

create function public.privacy_op_list_cleanup_obligations() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('case_ref', o.case_ref, 'obligated_at', o.obligated_at,
    'code', 'BAN_CLEANUP_PENDING') order by o.id), '[]'::jsonb)
  from privacy_internal.ban_cleanup_obligations o where o.resolved_at is null;
$$;

-- The subject to unban for an open obligation (console memory only; never printed).
create function public.privacy_op_cleanup_target(p_reference text) returns jsonb
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
  return pg_catalog.jsonb_build_object('status', 'ok', 'subject_id', v_subject);
end $$;

create function public.privacy_op_cleanup_resolved(p_reference text) returns jsonb
language plpgsql security definer set search_path = '' as $$
begin
  update privacy_internal.ban_cleanup_obligations set resolved_at = pg_catalog.clock_timestamp()
    where case_ref = p_reference and resolved_at is null;
  if not found then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'NO_OPEN_OBLIGATION'); end if;
  return pg_catalog.jsonb_build_object('status', 'ok');
end $$;

-- Cases with an open obligation stay visible in the operator list, whatever their state.
create or replace function public.privacy_op_list_cases() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'reference', c.reference, 'state', c.state, 'received_at', c.received_at, 'last_phase', c.last_phase,
    'blocker_code', c.blocker_code, 'next_action', c.next_action, 'verified', c.verified_at is not null,
    'armed', c.state = 'ready', 'attempts', c.attempt_count,
    'irreversible', c.destructive_started_at is not null,
    'external_followup', coalesce((c.phase_manifest ->> 'external_followup')::boolean, false),
    'response_address_changed', coalesce((c.phase_manifest ->> 'response_address_changed')::boolean, false),
    'ban_cleanup_open', exists (select 1 from privacy_internal.ban_cleanup_obligations o where o.case_ref = c.reference and o.resolved_at is null),
    'purge_after', c.purge_after) order by c.received_at), '[]'::jsonb)
  from privacy_internal.privacy_cases c
 where c.state not in ('closed', 'withdrawn') or c.final_response_at is null
    or exists (select 1 from privacy_internal.ban_cleanup_obligations o where o.case_ref = c.reference and o.resolved_at is null);
$$;

revoke all on function public.privacy_proc_ban_check(uuid, uuid), public.privacy_proc_ban_cleanup_pending(uuid, uuid),
  public.privacy_op_list_cleanup_obligations(), public.privacy_op_cleanup_target(text), public.privacy_op_cleanup_resolved(text)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_proc_ban_check(uuid, uuid), public.privacy_proc_ban_cleanup_pending(uuid, uuid),
  public.privacy_op_list_cleanup_obligations(), public.privacy_op_cleanup_target(text), public.privacy_op_cleanup_resolved(text) to service_role;

commit;
