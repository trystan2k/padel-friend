begin;

-- T15.3 (2/2): fenced repair processor, correction-aware guards and the publication seam.
--
-- Claim (fresh UUID fence token + attempt increment) is committed on its own BEFORE any
-- sporting work. Execution locks the job row for its whole transaction; a reclaim uses
-- FOR UPDATE SKIP LOCKED, so it can never take a job from a transaction that is actively
-- running it, even after the lease's wall clock has passed. A stale worker presenting an old
-- fence token publishes nothing.
--
-- Lock graph: job row -> community/event chain -> proposal -> amendment -> official state ->
-- profile/version FK coverage -> global rating projection. Enqueue never waits for a job row
-- while it holds sporting locks (it only inserts a brand-new row), so no reverse edge exists.
-- Publication is atomic: every sporting change runs inside one exception subtransaction; a
-- failure rolls back the pointer, sources, calculations, ratings and control, and the outer
-- transaction records the failed attempt.

-- 1. Vocabulary.
alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'reconfirmation_carried', 'result_approved',
      'result_disputed', 'result_corrected', 'result_confirmed', 'player_added', 'player_claimed',
      'result_amendment_requested', 'result_amendment_candidate_submitted',
      'result_amendment_candidate_superseded', 'result_amendment_approved',
      'result_amendment_disputed', 'result_amendment_accepted', 'result_amendment_canceled',
      'result_dispute_upheld', 'result_dispute_replaced', 'result_dispute_voided',
      'result_repair_queued', 'result_repair_claimed', 'result_repair_retried',
      'result_repair_failed', 'result_repair_applied')),
  drop constraint match_event_audit_log_actor_result_check,
  add constraint match_event_audit_log_actor_result_check check (
    (action = 'result_confirmed' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action = 'result_amendment_accepted' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action in ('result_repair_queued', 'result_repair_claimed', 'result_repair_failed', 'result_repair_applied'))
    or (action = 'reconfirmation_excluded' and actor_id is null)
    or (actor_id is not null and (action <> 'result_confirmed'
      or after_data ->> 'source' in ('MANUAL', 'ADMIN_OVERRIDE')))
  );

alter table public.result_amendment_events
  drop constraint result_amendment_events_event_type_check,
  add constraint result_amendment_events_event_type_check
    check (event_type in ('requested', 'candidate_submitted', 'candidate_superseded', 'approved',
      'disputed', 'accepted', 'canceled', 'upheld', 'replaced', 'voided', 'repair_queued', 'applied'));

-- 2. Job / attempt evidence additions. The calibration stamp a newly-ratable group takes is
-- frozen on the job when the correction is accepted (column defaults at enqueue), never
-- read from a default at execution time.
alter table public.result_repair_jobs
  add column frozen_rating_engine text not null default 'app-wide-level'
    check (char_length(frozen_rating_engine) between 1 and 64),
  add column frozen_rating_engine_version text not null default '1.0.0'
    check (char_length(frozen_rating_engine_version) between 1 and 32),
  add column frozen_rating_config_version integer not null default 1
    check (frozen_rating_config_version >= 1),
  add column failure_stage text check (failure_stage is null or failure_stage in (
    'base', 'lock', 'fact', 'replay', 'publish', 'complete'));
alter table public.result_repair_attempts
  add column stage text check (stage is null or stage in ('base', 'lock', 'fact', 'replay', 'publish', 'complete')),
  add column groups_replayed integer check (groups_replayed is null or groups_replayed >= 0),
  add column events_total integer check (events_total is null or events_total >= 0),
  add column sources_total integer check (sources_total is null or sources_total >= 0),
  add column duration_ms integer check (duration_ms is null or duration_ms >= 0);

do $patch$
declare
  v_patch record; v_original text;
begin
  for v_patch in select * from (values
    ('public.guard_result_repair_job()'::regprocedure,
      E'new.command_fingerprint, new.reason, new.requested_by, new.requested_at)\n    is distinct from',
      E'new.command_fingerprint, new.reason, new.requested_by, new.requested_at,\n'
      || E'      new.frozen_rating_engine, new.frozen_rating_engine_version, new.frozen_rating_config_version)\n    is distinct from'),
    ('public.guard_result_repair_job()'::regprocedure,
      E'old.candidate_version, old.command_fingerprint, old.reason, old.requested_by, old.requested_at) then',
      E'old.candidate_version, old.command_fingerprint, old.reason, old.requested_by, old.requested_at,\n'
      || E'      old.frozen_rating_engine, old.frozen_rating_engine_version, old.frozen_rating_config_version) then'),
    -- Completed repairs and failures are audited under their own actions.
    ('public.record_result_amendment_event(public.result_amendment_requests,text,text,text,uuid,bigint,text,jsonb,uuid,timestamp with time zone)'::regprocedure,
      E'    when ''repair_queued'' then ''result_repair_queued''\n',
      E'    when ''repair_queued'' then ''result_repair_queued''\n    when ''applied'' then ''result_repair_applied''\n'),
    -- A correction supersedes a confirmed pointer only through the running repair of its candidate.
    ('public.guard_match_result_proposal_transition()'::regprocedure,
      E'  if old.status = ''confirmed'' then\n    raise exception ''Confirmed result proposals are terminal'' using errcode = ''23514'';\n  end if;\n',
      E'  if old.status = ''confirmed'' then\n'
      || E'    if new.status = ''confirmed'' and new.active_version > old.active_version\n'
      || E'      and exists (select 1 from public.result_repair_jobs j\n'
      || E'        where j.proposal_id = new.id and j.candidate_version = new.active_version\n'
      || E'          and j.kind = ''replace'' and j.status = ''running'')\n'
      || E'      and exists (select 1 from public.match_event_result_official_state s\n'
      || E'        where s.proposal_id = new.id and s.current_version = new.active_version)\n'
      || E'      and exists (select 1 from public.match_event_result_proposal_versions v\n'
      || E'        where v.proposal_id = new.id and v.version = new.active_version\n'
      || E'          and (v.submitted_by, v.submitted_at, v.review_deadline_at)\n'
      || E'            = (new.submitted_by, new.submitted_at, new.review_deadline_at)) then\n'
      || E'      return new;\n'
      || E'    end if;\n'
      || E'    raise exception ''Confirmed result proposals are terminal'' using errcode = ''23514'';\n'
      || E'  end if;\n')
  ) as t(signature, needle, replacement) loop
    v_original := pg_get_functiondef(v_patch.signature);
    if (length(v_original) - length(replace(v_original, v_patch.needle, '')))
      <> length(v_patch.needle) then
      raise exception 'Unexpected % definition; refusing to patch (%)', v_patch.signature,
        left(v_patch.needle, 60);
    end if;
    execute replace(v_original, v_patch.needle, v_patch.replacement);
  end loop;
end $patch$;

-- Validation of a corrected confirmation written by the running repair (see the insert guard).
create function public.result_repair_guard_confirmation(p_new public.match_event_result_confirmations)
returns public.match_event_result_confirmations language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.match_event_result_proposals%rowtype;
  v_job public.result_repair_jobs%rowtype;
  v_amendment public.result_amendment_requests%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_event public.match_events%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
begin
  select * into v_job from public.result_repair_jobs j
   where j.proposal_id = p_new.proposal_id and j.candidate_version = p_new.proposal_version
     and j.kind = 'replace' and j.status = 'running';
  select * into v_proposal from public.match_event_result_proposals p where p.id = p_new.proposal_id;
  select * into v_amendment from public.result_amendment_requests a where a.id = v_job.amendment_id;
  select * into v_state from public.match_event_result_official_state s where s.proposal_id = p_new.proposal_id;
  select * into v_event from public.match_events e where e.id = p_new.match_event_id;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = p_new.proposal_id and v.version = p_new.proposal_version;
  if v_proposal.status <> 'confirmed' or v_proposal.match_event_id <> p_new.match_event_id
    or v_proposal.group_number <> p_new.group_number
    or v_amendment.lifecycle is distinct from 'approved_pending_repair'
    or v_amendment.repair_job_id is distinct from v_job.id
    or v_amendment.candidate_version is distinct from p_new.proposal_version
    or v_state.current_confirmation_id is distinct from v_job.expected_base_confirmation_id
    or p_new.source is distinct from v_amendment.decision_source
    or p_new.actor_id is distinct from v_amendment.decision_actor_id
    or p_new.confirmed_at is distinct from v_amendment.decided_at
    or p_new.effective_at is distinct from (case when p_new.source = 'AUTO_48H' then v_fact.review_deadline_at
      else v_amendment.decided_at end)
    or p_new.event_type is distinct from v_event.event_type
    or p_new.ratable_eligible is distinct from (v_event.event_type = 'competitive' and v_fact.classification <> 'incomplete')
    or (p_new.source <> 'ADMIN_OVERRIDE' and exists (
      select 1 from public.match_event_result_reviews r
       where r.proposal_id = p_new.proposal_id and r.proposal_version = p_new.proposal_version
         and r.decision = 'reject'))
    or (p_new.source = 'ADMIN_OVERRIDE' and not exists (
      select 1 from public.result_dispute_resolutions x
       where x.amendment_id = v_amendment.id and x.decision = 'replace'
         and x.candidate_version = p_new.proposal_version)) then
    raise exception 'Correction confirmation does not match its accepted amendment' using errcode = '23514';
  end if;
  return p_new;
end $$;

do $patch$
declare
  v_original text;
  v_needle constant text := E'  select * into v_proposal from public.match_event_result_proposals p\n   where p.id = new.proposal_id;\n  if not found or v_proposal.status not in';
begin
  v_original := pg_get_functiondef('public.guard_match_event_result_confirmation_insert()'::regprocedure);
  if (length(v_original) - length(replace(v_original, v_needle, ''))) <> length(v_needle) then
    raise exception 'Unexpected guard_match_event_result_confirmation_insert definition; refusing to patch';
  end if;
  execute replace(v_original, v_needle,
    E'  if exists (select 1 from public.result_repair_jobs j\n'
    || E'      where j.proposal_id = new.proposal_id and j.candidate_version = new.proposal_version\n'
    || E'        and j.kind = ''replace'' and j.status = ''running'') then\n'
    || E'    return public.result_repair_guard_confirmation(new);\n'
    || E'  end if;\n' || v_needle);
end $patch$;

-- 3. Pure helpers.
create function public.result_repair_retryable(p_code text) returns boolean
language sql immutable set search_path = '' as $$
  select p_code in ('REPLAY_FAILED', 'PUBLICATION_FAILED', 'LEASE_EXPIRED', 'INTERNAL');
$$;

create function public.result_repair_failure_code(p_stage text, p_message text) returns text
language sql immutable set search_path = '' as $$
  select case
    when p_message like 'REPAIR_BASE_STALE%' then 'BASE_STALE'
    when p_message like 'REPAIR_CANDIDATE_INVALID%' then 'CANDIDATE_INVALID'
    when p_message like 'REPAIR_PERMISSION_REVOKED%' then 'PERMISSION_REVOKED'
    when p_message like 'RATING_ENGINE_UNSUPPORTED%' or p_message like 'RATING_CONFIG_UNSUPPORTED%' then 'CONFIG_UNSUPPORTED'
    when p_message like 'REPAIR_PUBLICATION_UNAVAILABLE%' or p_stage = 'publish' then 'PUBLICATION_FAILED'
    when p_stage = 'replay' then 'REPLAY_FAILED'
    else 'INTERNAL' end;
$$;

-- Backoff after a failed attempt: 30s, 60s, ... capped at one hour.
create function public.result_repair_backoff(p_attempt_count integer) returns interval
language sql immutable set search_path = '' as $$
  select pg_catalog.make_interval(secs => least(3600, 30 * pg_catalog.power(2, greatest(p_attempt_count, 1) - 1)::integer));
$$;

create or replace function public.result_repair_job_dto(j public.result_repair_jobs)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'job_id', j.id,
    'amendment_id', j.amendment_id,
    'resolution_id', j.resolution_id,
    'proposal_id', j.proposal_id,
    'group_number', j.group_number,
    'kind', j.kind,
    'status', j.status,
    -- Publication is reported only by a committed job: queued and running stay pending.
    'publication', case j.status when 'succeeded' then 'published' when 'failed' then 'failed'
      else 'pending' end,
    'projections_complete', j.status = 'succeeded' and j.committed_revision is not null,
    'attempt_count', j.attempt_count,
    'failure_code', j.failure_code,
    'failure_stage', j.failure_stage,
    'retryable', j.status = 'failed' and public.result_repair_retryable(j.failure_code),
    'stale_lease', j.status = 'running' and j.lease_expires_at < pg_catalog.clock_timestamp(),
    'next_attempt_at', j.next_attempt_at,
    'requested_at', j.requested_at,
    'started_at', j.started_at,
    'finished_at', j.finished_at,
    'committed_revision', j.committed_revision);
$$;

-- 4. Audit of the repair lifecycle (queued is recorded by the enqueue path).
create function public.record_result_repair_audit(
  j public.result_repair_jobs, p_action text, p_actor uuid, p_data jsonb
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_revision bigint;
begin
  select * into v_event from public.match_events e where e.id = j.match_event_id;
  select s.transition_revision into v_revision
    from public.match_event_registration_state s where s.match_event_id = j.match_event_id;
  if v_revision is null then
    raise exception 'RESULT_AMENDMENT_REGISTRATION_STATE_MISSING' using errcode = '23514';
  end if;
  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, reason, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields
  ) values (
    v_event.id, v_event.community_id, p_actor, p_action, null, null, pg_catalog.clock_timestamp(),
    j.candidate_version, v_revision,
    pg_catalog.jsonb_build_object('repair_job_id', j.id, 'amendment_id', j.amendment_id,
      'proposal_id', j.proposal_id, 'group_number', j.group_number),
    pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object('repair_job_id', j.id,
      'amendment_id', j.amendment_id, 'proposal_id', j.proposal_id, 'group_number', j.group_number,
      'repair_kind', j.kind, 'attempt', j.attempt_count) || coalesce(p_data, '{}'::jsonb)),
    array['repair']);
end $$;

-- 5. Claim. Commits (with its attempt row) before any sporting work. Picks the oldest due
-- queued/failed job or an expired-lease running job; SKIP LOCKED leaves a job another
-- transaction is executing alone no matter what its lease clock says.
create function public.claim_result_repair_job(p_job_id uuid default null, p_lease_seconds integer default 600)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_token uuid := pg_catalog.gen_random_uuid();
  v_base bigint;
begin
  if p_lease_seconds is null or p_lease_seconds < 1 or p_lease_seconds > 3600 then
    raise exception 'Invalid result repair lease' using errcode = '22023';
  end if;
  select * into j from public.result_repair_jobs x
   where (p_job_id is null or x.id = p_job_id)
     and ((x.status = 'queued' and (x.next_attempt_at is null or x.next_attempt_at <= v_now))
       or (x.status = 'failed' and x.next_attempt_at is not null and x.next_attempt_at <= v_now)
       or (x.status = 'running' and x.lease_expires_at <= v_now))
   order by (x.status = 'running') desc, x.next_attempt_at nulls first, x.id
   limit 1 for update skip locked;
  if not found then
    return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'none');
  end if;
  select c.committed_revision into v_base from public.player_rating_projection_control c;
  begin
    if j.status = 'running' then
      update public.result_repair_attempts a set status = 'expired', failure_code = 'LEASE_EXPIRED',
          finished_at = v_now
        where a.job_id = j.id and a.status = 'running';
    end if;
    update public.result_repair_jobs x set status = 'running', lease_token = v_token,
        lease_expires_at = v_now + pg_catalog.make_interval(secs => p_lease_seconds),
        attempt_count = x.attempt_count + 1, started_at = v_now, finished_at = null, next_attempt_at = null
      where x.id = j.id returning * into j;
    insert into public.result_repair_attempts(job_id, attempt_number, fence_token, base_revision, stage)
      values (j.id, j.attempt_count, v_token, v_base, 'base');
    perform public.record_result_repair_audit(j, 'result_repair_claimed', null,
      pg_catalog.jsonb_build_object('lease_expires_at', j.lease_expires_at));
  exception when unique_violation then
    -- Another job holds the single running claim.
    return pg_catalog.jsonb_build_object('claimed', false, 'reason', 'busy');
  end;
  return pg_catalog.jsonb_build_object('claimed', true, 'job_id', j.id, 'fence_token', v_token,
    'attempt_number', j.attempt_count, 'lease_expires_at', j.lease_expires_at);
end $$;

-- 6. Execution steps (called inside execute_result_repair's subtransaction).

-- Base check under the locks. Order: event chain (community first) -> proposal -> amendment ->
-- official state -> profile/version FK coverage. Nothing here takes the rating lock.
create function public.result_repair_prepare_locked(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  v_event public.match_events%rowtype;
  v_amendment public.result_amendment_requests%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_base public.match_event_result_proposal_versions%rowtype;
  v_cand public.match_event_result_proposal_versions%rowtype;
  v_ids uuid[];
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id;
  v_event := public.lock_match_event_registration(j.match_event_id);
  perform 1 from public.match_event_result_proposals p where p.id = j.proposal_id for update;
  select * into v_amendment from public.result_amendment_requests a where a.id = j.amendment_id for update;
  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = j.proposal_id for update;
  if not found or v_state.is_void
    or v_state.current_confirmation_id is distinct from j.expected_base_confirmation_id then
    raise exception using errcode = 'P0001', message = 'REPAIR_BASE_STALE';
  end if;
  select * into v_cand from public.match_event_result_proposal_versions v
   where v.proposal_id = j.proposal_id and v.version = j.candidate_version;
  select * into v_base from public.match_event_result_proposal_versions v
   where v.proposal_id = j.proposal_id and v.version = v_amendment.base_version;
  if v_cand.proposal_id is null or v_base.proposal_id is null
    or v_amendment.lifecycle <> 'approved_pending_repair'
    or v_amendment.repair_job_id is distinct from j.id
    or v_amendment.candidate_version is distinct from j.candidate_version
    or v_amendment.base_confirmation_id is distinct from j.expected_base_confirmation_id
    or not exists (select 1 from public.result_amendment_candidates c
      where c.proposal_id = j.proposal_id and c.version = j.candidate_version
        and c.amendment_id = j.amendment_id and c.base_confirmation_id = j.expected_base_confirmation_id)
    or (v_amendment.decision_source <> 'ADMIN_OVERRIDE' and exists (
      select 1 from public.match_event_result_reviews r
       where r.proposal_id = j.proposal_id and r.proposal_version = j.candidate_version
         and r.decision = 'reject'))
    or (v_amendment.decision_source = 'ADMIN_OVERRIDE' and not exists (
      select 1 from public.result_dispute_resolutions x
       where x.amendment_id = j.amendment_id and x.candidate_version = j.candidate_version
         and x.decision = j.kind)) then
    raise exception using errcode = 'P0001', message = 'REPAIR_CANDIDATE_INVALID';
  end if;
  -- Old and new quartets: every profile a logical event or source may reference is key-share
  -- locked before the rating lock (claim holds its profile row FOR NO KEY UPDATE; compatible).
  select pg_catalog.array_agg(distinct m.value::uuid) into v_ids
    from (select t.teams from (values (v_base.teams), (v_cand.teams)) t(teams)) q,
      pg_catalog.jsonb_array_elements_text((q.teams -> 'team_a') || (q.teams -> 'team_b')) m(value);
  perform 1 from public.player_profiles pr where pr.user_id = any (v_ids) order by pr.user_id for key share;
  perform 1 from public.match_event_result_proposal_versions v
   where v.proposal_id = j.proposal_id and v.version in (v_amendment.base_version, j.candidate_version)
   order by v.version for key share;
  return pg_catalog.jsonb_build_object('community_id', v_event.community_id, 'event_id', v_event.id);
end $$;

-- Switch the official fact. A replacement writes the immutable corrected confirmation and moves
-- the official pointer and the proposal's active version; a void clears the pointer through
-- the audited decision. Friendly/incomplete/void create no active competitive effects: the
-- replay below deactivates their sources.
create function public.result_repair_apply_fact_locked(p_job_id uuid, p_revision bigint) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  a public.result_amendment_requests%rowtype;
  v_event public.match_events%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_confirmation_id uuid := pg_catalog.gen_random_uuid();
  v_now timestamptz := pg_catalog.clock_timestamp();
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id;
  select * into a from public.result_amendment_requests r where r.id = j.amendment_id;
  select * into v_event from public.match_events e where e.id = j.match_event_id;
  if j.kind = 'void' then
    update public.match_event_result_official_state s
       set current_confirmation_id = null, current_version = null, is_void = true,
           void_decision_id = j.resolution_id, official_revision = s.official_revision + 1, selected_at = v_now
     where s.proposal_id = j.proposal_id and s.current_confirmation_id = j.expected_base_confirmation_id;
    if not found then
      raise exception using errcode = 'P0001', message = 'REPAIR_BASE_STALE';
    end if;
    return pg_catalog.jsonb_build_object('kind', 'void', 'confirmation_id', null);
  end if;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = j.proposal_id and v.version = j.candidate_version;
  insert into public.match_event_result_confirmations(
    id, proposal_id, proposal_version, match_event_id, group_number, source,
    confirmed_at, effective_at, actor_id, event_type, ratable_eligible
  ) values (
    v_confirmation_id, j.proposal_id, j.candidate_version, j.match_event_id, j.group_number,
    a.decision_source, a.decided_at,
    case when a.decision_source = 'AUTO_48H' then v_fact.review_deadline_at else a.decided_at end,
    a.decision_actor_id, v_event.event_type,
    v_event.event_type = 'competitive' and v_fact.classification <> 'incomplete');
  update public.match_event_result_official_state s
     set current_confirmation_id = v_confirmation_id, current_version = j.candidate_version,
         is_void = false, void_decision_id = null, official_revision = s.official_revision + 1,
         selected_at = v_now
   where s.proposal_id = j.proposal_id and s.current_confirmation_id = j.expected_base_confirmation_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'REPAIR_BASE_STALE';
  end if;
  update public.match_event_result_proposals p
     set active_version = j.candidate_version, submitted_by = v_fact.submitted_by,
         submitted_at = v_fact.submitted_at, review_deadline_at = v_fact.review_deadline_at
   where p.id = j.proposal_id and p.active_version = a.base_version and p.status = 'confirmed';
  if not found then
    raise exception using errcode = 'P0001', message = 'REPAIR_BASE_STALE';
  end if;
  return pg_catalog.jsonb_build_object('kind', 'replace', 'confirmation_id', v_confirmation_id);
end $$;

-- The atomic publication seam. League standings and statistics publish here, inside the
-- repair transaction and under the locks already held, before the single committed-revision
-- update. Until every derived publisher exists this refuses, so a repair can never be reported
-- as succeeded after publishing only the ratings.
create function public.result_repair_publish_derived(p_job_id uuid, p_revision bigint) returns void
language plpgsql security definer set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'REPAIR_PUBLICATION_UNAVAILABLE';
end $$;

-- 7. Fenced execution. Everything sporting runs in one exception subtransaction; the outer
-- transaction records a failed attempt (code, stage, retry time) and returns a structured
-- failed receipt instead of raising, so the diagnostics are never rolled back with the work.
create function public.execute_result_repair(p_job_id uuid, p_fence_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  v_attempt public.result_repair_attempts%rowtype;
  v_started timestamptz := pg_catalog.clock_timestamp();
  v_stage text := 'base';
  v_base bigint; v_rev bigint; v_control public.player_rating_projection_control%rowtype;
  v_replay record; v_context jsonb; v_events integer; v_sources integer;
  v_message text; v_code text; v_failed boolean := false;
  c_max_automatic constant integer := 5;
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'not_found');
  end if;
  if j.status <> 'running' or j.lease_token is distinct from p_fence_token then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'job', public.result_repair_job_dto(j));
  end if;
  select * into v_attempt from public.result_repair_attempts a
   where a.job_id = j.id and a.attempt_number = j.attempt_count and a.fence_token = p_fence_token
     and a.status = 'running' for update;
  if not found then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'job', public.result_repair_job_dto(j));
  end if;

  begin
    perform public.result_repair_prepare_locked(j.id);
    v_stage := 'lock';
    perform public.rating_projection_lock_covered();
    select * into v_control from public.player_rating_projection_control c for update;
    v_base := v_control.committed_revision;
    v_rev := v_base + 1;
    v_context := pg_catalog.jsonb_build_object('repair_job_id', j.id, 'amendment_id', j.amendment_id,
      'engine', j.frozen_rating_engine, 'engine_version', j.frozen_rating_engine_version,
      'config_version', j.frozen_rating_config_version);
    v_stage := 'fact';
    perform public.result_repair_apply_fact_locked(j.id, v_rev);
    v_stage := 'replay';
    select * into v_replay from public.rating_projection_replay(v_rev, v_context);
    v_stage := 'publish';
    perform public.result_repair_publish_derived(j.id, v_rev);
    v_stage := 'complete';
    select pg_catalog.count(*) into v_events from public.player_rating_events;
    select pg_catalog.count(*) into v_sources from public.player_rating_event_sources;
    update public.player_rating_projection_control c set committed_revision = v_rev,
        last_processed_played_at = coalesce(v_replay.o_last_played_at, c.last_processed_played_at),
        last_processed_game_group_id = coalesce(v_replay.o_last_group_id, c.last_processed_game_group_id)
      where c.singleton and c.committed_revision = v_base;
    if not found then
      raise exception using errcode = 'P0001', message = 'REPAIR_REVISION_CONFLICT';
    end if;
    update public.result_amendment_requests r set lifecycle = 'applied', closed_at = pg_catalog.clock_timestamp()
      where r.id = j.amendment_id and r.lifecycle = 'approved_pending_repair';
    update public.result_repair_jobs x set status = 'succeeded', lease_token = null, lease_expires_at = null,
        failure_code = null, failure_stage = null, next_attempt_at = null,
        finished_at = pg_catalog.clock_timestamp(), committed_revision = v_rev
      where x.id = j.id returning * into j;
    update public.result_repair_attempts a set status = 'succeeded', base_revision = v_base,
        result_revision = v_rev, stage = 'complete', groups_replayed = v_replay.o_groups,
        events_total = v_events, sources_total = v_sources, finished_at = pg_catalog.clock_timestamp(),
        duration_ms = (extract(epoch from (pg_catalog.clock_timestamp() - v_started)) * 1000)::integer
      where a.id = v_attempt.id;
    perform public.record_result_amendment_event(
      (select r from public.result_amendment_requests r where r.id = j.amendment_id),
      'applied', 'approved_pending_repair', 'applied', null, j.candidate_version, null,
      pg_catalog.jsonb_build_object('repair_job_id', j.id, 'kind', j.kind, 'revision', v_rev),
      null, pg_catalog.clock_timestamp());
  exception when others then
    get stacked diagnostics v_message = message_text;
    v_failed := true;
  end;

  if v_failed then
    v_code := public.result_repair_failure_code(v_stage, v_message);
    update public.result_repair_attempts a set status = 'failed', failure_code = v_code, stage = v_stage,
        finished_at = pg_catalog.clock_timestamp(),
        duration_ms = (extract(epoch from (pg_catalog.clock_timestamp() - v_started)) * 1000)::integer
      where a.id = v_attempt.id;
    update public.result_repair_jobs x set status = 'failed', lease_token = null, lease_expires_at = null,
        failure_code = v_code, failure_stage = v_stage, finished_at = pg_catalog.clock_timestamp(),
        next_attempt_at = case when public.result_repair_retryable(v_code) and x.attempt_count < c_max_automatic
          then pg_catalog.clock_timestamp() + public.result_repair_backoff(x.attempt_count) end
      where x.id = j.id returning * into j;
    perform public.record_result_repair_audit(j, 'result_repair_failed', null,
      pg_catalog.jsonb_build_object('failure_code', v_code, 'failure_stage', v_stage));
    return pg_catalog.jsonb_build_object('outcome', 'failed', 'failure_code', v_code,
      'failure_stage', v_stage, 'job', public.result_repair_job_dto(j));
  end if;
  return pg_catalog.jsonb_build_object('outcome', 'succeeded', 'revision', v_rev,
    'job', public.result_repair_job_dto(j));
end $$;

-- 8. Scheduler entry points (trusted). Claim and execution are separate ticks, so a committed
-- claim exists before any sporting work and a dead worker is recovered by lease expiry.
create function public.claim_due_result_repairs(p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_claimed integer := 0; v_result jsonb;
begin
  for i in 1..least(greatest(coalesce(p_limit, 1), 1), 10) loop
    v_result := public.claim_result_repair_job();
    exit when not (v_result ->> 'claimed')::boolean;
    v_claimed := v_claimed + 1;
  end loop;
  return pg_catalog.jsonb_build_object('claimed', v_claimed);
end $$;

create function public.run_claimed_result_repairs(p_limit integer default 1) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_job record; v_done integer := 0; v_failed integer := 0; v_result jsonb;
begin
  for v_job in
    select x.id, x.lease_token from public.result_repair_jobs x
     where x.status = 'running' and x.lease_expires_at > pg_catalog.clock_timestamp()
     order by x.started_at, x.id
     limit least(greatest(coalesce(p_limit, 1), 1), 10)
     for update skip locked
  loop
    v_result := public.execute_result_repair(v_job.id, v_job.lease_token);
    if v_result ->> 'outcome' = 'succeeded' then v_done := v_done + 1;
    elsif v_result ->> 'outcome' = 'failed' then v_failed := v_failed + 1; end if;
  end loop;
  return pg_catalog.jsonb_build_object('succeeded', v_done, 'failed', v_failed);
end $$;

-- Scheduler provisioning and health. A missing pg_cron is a visible state, not a silent one.
do $scheduler$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'T15.3 scheduler: pg_cron is not installed; the result repair jobs were NOT provisioned.';
    return;
  end if;
  begin
    perform cron.schedule('padel-friend-result-repair-claim', '* * * * *',
      'select public.claim_due_result_repairs(1)');
    perform cron.schedule('padel-friend-result-repair-run', '* * * * *',
      'select public.run_claimed_result_repairs(1)');
  exception when others then
    raise notice 'T15.3 scheduler: the result repair jobs could not be scheduled (%).', sqlerrm;
  end;
end
$scheduler$;

create function public.result_repair_scheduler_health() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_installed boolean := exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron');
  v_jobs jsonb := '[]'::jsonb;
  v_overdue integer;
begin
  if v_installed and pg_catalog.to_regclass('cron.job') is not null then
    execute $q$
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
          'name', j.jobname, 'schedule', j.schedule, 'active', j.active,
          'last_run_at', d.start_time, 'last_status', d.status) order by j.jobname), '[]'::jsonb)
        from cron.job j
        left join lateral (select r.start_time, r.status from cron.job_run_details r
            where r.jobid = j.jobid order by r.start_time desc limit 1) d on true
       where j.jobname in ('padel-friend-result-repair-claim', 'padel-friend-result-repair-run')$q$
      into v_jobs;
  end if;
  select pg_catalog.count(*) into v_overdue from public.result_repair_jobs x
   where (x.status = 'queued' and x.requested_at < pg_catalog.clock_timestamp() - interval '5 minutes')
      or (x.status = 'running' and x.lease_expires_at < pg_catalog.clock_timestamp());
  return pg_catalog.jsonb_build_object(
    'pg_cron_installed', v_installed,
    'provisioned', pg_catalog.jsonb_array_length(v_jobs) = 2
      and not exists (select 1 from pg_catalog.jsonb_array_elements(v_jobs) e where not (e ->> 'active')::boolean),
    'jobs', v_jobs,
    'overdue_jobs', v_overdue);
end $$;

-- 9. Authorized endpoints. Own-community Community Admins and Platform Admins retry; the
-- fenced processor entry points above stay revoked from every browser role.
create function public.result_repair_authorized(p_community_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin() or public.is_community_admin(p_community_id);
$$;

create function public.retry_result_repair(p_job_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  j public.result_repair_jobs%rowtype;
  v_claim jsonb;
begin
  perform public.assert_actor_not_provisional();
  select * into j from public.result_repair_jobs x where x.id = p_job_id for update;
  -- Unreadable jobs look like missing ones.
  if not found or not public.result_repair_authorized(j.community_id) then
    raise exception 'RESULT_REPAIR_NOT_FOUND' using errcode = 'P0001';
  end if;
  if j.status = 'succeeded' then
    raise exception 'RESULT_REPAIR_ALREADY_APPLIED' using errcode = 'P0001';
  end if;
  if j.status = 'running' and j.lease_expires_at > pg_catalog.clock_timestamp() then
    raise exception 'RESULT_REPAIR_BUSY' using errcode = 'P0001';
  end if;
  if j.status = 'failed' and not public.result_repair_retryable(j.failure_code) then
    raise exception 'RESULT_REPAIR_NOT_RETRYABLE' using errcode = 'P0001',
      detail = pg_catalog.jsonb_build_object('failure_code', j.failure_code)::text;
  end if;
  if j.status = 'failed' then
    update public.result_repair_jobs x set status = 'queued', next_attempt_at = pg_catalog.clock_timestamp(),
        finished_at = null where x.id = j.id returning * into j;
    perform public.record_result_repair_audit(j, 'result_repair_retried', v_actor, '{}'::jsonb);
  end if;
  v_claim := public.claim_result_repair_job(j.id);
  return pg_catalog.jsonb_build_object('claim', v_claim - 'fence_token',
    'job', (select public.result_repair_job_dto(x) from public.result_repair_jobs x where x.id = j.id));
end $$;

create function public.execute_claimed_result_repair(p_job_id uuid, p_attempt_number integer) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  j public.result_repair_jobs%rowtype;
begin
  perform public.assert_actor_not_provisional();
  select * into j from public.result_repair_jobs x where x.id = p_job_id;
  if not found or not public.result_repair_authorized(j.community_id) then
    raise exception 'RESULT_REPAIR_NOT_FOUND' using errcode = 'P0001';
  end if;
  -- Permission is re-read here (not only at the original request); the claim is the caller's own.
  if j.status <> 'running' or j.attempt_count is distinct from p_attempt_number then
    return pg_catalog.jsonb_build_object('outcome', 'stale', 'job', public.result_repair_job_dto(j));
  end if;
  return public.execute_result_repair(j.id, j.lease_token);
end $$;

create function public.get_result_repair_diagnostics(p_community_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_jobs jsonb;
begin
  perform public.assert_actor_not_provisional();
  if p_community_id is null then
    if not public.is_platform_admin() then
      raise exception 'RESULT_REPAIR_FORBIDDEN' using errcode = '42501';
    end if;
  elsif not public.result_repair_authorized(p_community_id) then
    raise exception 'RESULT_REPAIR_FORBIDDEN' using errcode = '42501';
  end if;
  select coalesce(pg_catalog.jsonb_agg(t.dto order by t.requested_at desc, t.id), '[]'::jsonb)
    into v_jobs
    from (select x.requested_at, x.id,
              public.result_repair_job_dto(x) || pg_catalog.jsonb_build_object('community_id', x.community_id) as dto
            from public.result_repair_jobs x
           where p_community_id is null or x.community_id = p_community_id
           order by x.requested_at desc, x.id limit 50) t;
  return pg_catalog.jsonb_build_object('jobs', v_jobs,
    'scheduler', case when public.is_platform_admin() then public.result_repair_scheduler_health() end);
end $$;

-- Historical audit read: an explicit old revision with its own authorization. The current
-- readers keep rating_read_assert_revision untouched.
create function public.get_rating_history_audit(p_user_id uuid, p_revision bigint, p_limit integer default 50)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_committed bigint := public.rating_committed_revision();
begin
  perform public.assert_actor_not_provisional();
  if not public.is_platform_admin() then
    raise exception 'RATING_AUDIT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_user_id is null or p_revision is null or p_revision < 0 or p_revision > v_committed
    or p_limit is null or p_limit < 1 or p_limit > 200 then
    raise exception 'RATING_AUDIT_INVALID_ARGUMENT' using errcode = '22023';
  end if;
  return pg_catalog.jsonb_build_object(
    'revision', p_revision, 'committed_revision', v_committed,
    'summary', public.rating_summary_at(p_user_id, p_revision),
    'items', coalesce((select pg_catalog.jsonb_agg(t.dto order by t.sort_at desc, t.sort_id desc, t.sort_rank desc)
      from (select * from public.rating_timeline_items(p_user_id, p_revision) x
             order by x.sort_at desc, x.sort_id desc, x.sort_rank desc limit p_limit) t), '[]'::jsonb));
end $$;

-- 10. Grants.
revoke all on function
  public.result_repair_guard_confirmation(public.match_event_result_confirmations),
  public.result_repair_retryable(text),
  public.result_repair_failure_code(text, text),
  public.result_repair_backoff(integer),
  public.record_result_repair_audit(public.result_repair_jobs, text, uuid, jsonb),
  public.claim_result_repair_job(uuid, integer),
  public.result_repair_prepare_locked(uuid),
  public.result_repair_apply_fact_locked(uuid, bigint),
  public.result_repair_publish_derived(uuid, bigint),
  public.execute_result_repair(uuid, uuid),
  public.claim_due_result_repairs(integer),
  public.run_claimed_result_repairs(integer),
  public.result_repair_scheduler_health(),
  public.result_repair_authorized(uuid),
  public.retry_result_repair(uuid),
  public.execute_claimed_result_repair(uuid, integer),
  public.get_result_repair_diagnostics(uuid),
  public.get_rating_history_audit(uuid, bigint, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.retry_result_repair(uuid),
  public.execute_claimed_result_repair(uuid, integer),
  public.get_result_repair_diagnostics(uuid),
  public.get_rating_history_audit(uuid, bigint, integer)
  to authenticated;

commit;
