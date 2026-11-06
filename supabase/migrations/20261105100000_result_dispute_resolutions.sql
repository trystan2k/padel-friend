begin;

-- T15.2: audited dispute resolution (uphold / replace / void) and the repair-job
-- contract. A resolution never switches an official fact: replacing or voiding a
-- prior OFFICIAL confirmation only queues exactly one correction job; the projector
-- that performs the switch (and reports publication) arrives with the replay units.
-- Overriding a never-confirmed result stays the ordinary first-confirmation branch,
-- audited with the ADMIN_OVERRIDE source.
--
-- Lock order (same as the amendment commands): community/event chain
-- (lock_match_event_registration) -> proposal row -> amendment row -> official state.

-- 1. Enumerations that gain the resolution / repair vocabulary.
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
      'result_repair_queued')),
  drop constraint match_event_audit_log_actor_result_check,
  add constraint match_event_audit_log_actor_result_check check (
    (action = 'result_confirmed' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action = 'result_amendment_accepted' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action = 'result_repair_queued')
    or (action = 'reconfirmation_excluded' and actor_id is null)
    or (actor_id is not null and (action <> 'result_confirmed'
      or after_data ->> 'source' in ('MANUAL', 'ADMIN_OVERRIDE')))
  );

alter table public.result_amendment_events
  drop constraint result_amendment_events_event_type_check,
  add constraint result_amendment_events_event_type_check
    check (event_type in ('requested', 'candidate_submitted', 'candidate_superseded', 'approved',
      'disputed', 'accepted', 'canceled', 'upheld', 'replaced', 'voided', 'repair_queued'));

alter table public.match_event_management_commands
  drop constraint match_event_management_commands_action_check,
  add constraint match_event_management_commands_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'edit', 'reconfirm',
      'submit_result', 'review_result', 'correct_result',
      'submit_amendment_candidate', 'review_amendment', 'cancel_amendment', 'resolve_dispute'));

-- An admin-overridden first confirmation flows through the statistics fact like any other.
alter table public.statistics_group_facts
  drop constraint statistics_group_facts_confirmation_source_check,
  add constraint statistics_group_facts_confirmation_source_check
    check (confirmation_source in ('MANUAL', 'AUTO_48H', 'ADMIN_OVERRIDE'));

comment on constraint match_result_confirmation_actor_shape on public.match_event_result_confirmations is
  'ADMIN_OVERRIDE is the audited-override shape; the insert guard admits it only for a current community admin with a matching insert-only dispute resolution.';

-- 2. Insert-only dispute resolution evidence. The rejecting review rows stay the
-- dispute evidence (referenced, never copied or erased); one resolution per candidate
-- version makes contradictory decisions structurally impossible.
create table public.result_dispute_resolutions (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null,
  proposal_id uuid not null,
  group_number bigint not null,
  resolution_kind text not null check (resolution_kind in ('amendment', 'first_confirmation')),
  amendment_id uuid,
  base_confirmation_id uuid references public.match_event_result_confirmations(id) on delete restrict,
  candidate_version bigint not null,
  decision text not null check (decision in ('uphold', 'replace', 'void')),
  confirmation_id uuid references public.match_event_result_confirmations(id)
    on delete restrict deferrable initially deferred,
  actor_id uuid not null references auth.users(id) on delete restrict,
  justification text not null,
  evidence_review_id uuid references public.match_event_result_reviews(id) on delete restrict,
  command_id uuid not null,
  fingerprint text not null,
  decided_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint result_dispute_resolution_command_unique unique (actor_id, command_id),
  constraint result_dispute_resolution_one_per_candidate unique (proposal_id, candidate_version),
  constraint result_dispute_resolution_group_fk
    foreign key (proposal_id, match_event_id, group_number)
    references public.match_event_result_proposals(id, match_event_id, group_number)
    on delete restrict,
  constraint result_dispute_resolution_version_fk
    foreign key (proposal_id, candidate_version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete restrict,
  constraint result_dispute_resolution_amendment_fk
    foreign key (amendment_id, proposal_id)
    references public.result_amendment_requests(id, proposal_id)
    on delete restrict,
  constraint result_dispute_resolution_justification_check check (
    justification = btrim(justification) and char_length(justification) between 1 and 500
    and justification !~ '[[:cntrl:]]'),
  constraint result_dispute_resolution_shape_check check (
    (resolution_kind = 'amendment' and amendment_id is not null
      and base_confirmation_id is not null and confirmation_id is null)
    or (resolution_kind = 'first_confirmation' and amendment_id is null
      and base_confirmation_id is null and decision in ('uphold', 'void')
      and (confirmation_id is not null) = (decision = 'uphold'))
  )
);
create index result_dispute_resolutions_event on public.result_dispute_resolutions (match_event_id);
create unique index result_dispute_resolution_one_per_amendment
  on public.result_dispute_resolutions (amendment_id) where amendment_id is not null;
comment on table public.result_dispute_resolutions is
  'Insert-only Community Admin decision on a disputed result (uphold / replace / void). Reuses the rejecting reviews as dispute evidence; never erases them and is never a player approval.';

alter table public.match_event_result_official_state
  add constraint official_state_void_decision_fk
    foreign key (void_decision_id) references public.result_dispute_resolutions(id) on delete restrict;

create trigger result_dispute_resolutions_immutable
  before update or delete on public.result_dispute_resolutions
  for each row execute function public.guard_result_amendment_insert_only();

-- 3. Repair jobs and attempts. Sanitized failure codes only: no SQL text, stack traces or
-- cross-community payloads are ever stored.
create table public.result_repair_jobs (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  match_event_id uuid not null,
  proposal_id uuid not null,
  group_number bigint not null,
  kind text not null check (kind in ('replace', 'void')),
  amendment_id uuid not null,
  resolution_id uuid references public.result_dispute_resolutions(id) on delete restrict,
  expected_base_confirmation_id uuid not null
    references public.match_event_result_confirmations(id) on delete restrict,
  candidate_version bigint not null,
  command_fingerprint text not null,
  reason text not null check (reason in (
    'amendment_accepted', 'admin_override_replace', 'admin_override_void')),
  requested_by uuid references auth.users(id) on delete restrict,
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  status text not null default 'queued' check (status in ('queued', 'running', 'failed', 'succeeded')),
  lease_token uuid,
  lease_expires_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_code text check (failure_code is null or failure_code in (
    'BASE_STALE', 'CANDIDATE_INVALID', 'PERMISSION_REVOKED', 'CONFIG_UNSUPPORTED',
    'REPLAY_FAILED', 'PUBLICATION_FAILED', 'LEASE_EXPIRED', 'INTERNAL')),
  next_attempt_at timestamptz,
  started_at timestamptz,
  finished_at timestamptz,
  committed_revision bigint check (committed_revision is null or committed_revision >= 1),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint result_repair_job_amendment_unique unique (amendment_id),
  constraint result_repair_job_logical_correction unique (proposal_id, expected_base_confirmation_id),
  constraint result_repair_job_amendment_identity unique (id, amendment_id),
  constraint result_repair_job_amendment_fk
    foreign key (amendment_id, proposal_id)
    references public.result_amendment_requests(id, proposal_id) on delete restrict,
  constraint result_repair_job_group_fk
    foreign key (proposal_id, match_event_id, group_number)
    references public.match_event_result_proposals(id, match_event_id, group_number)
    on delete restrict,
  constraint result_repair_job_candidate_fk
    foreign key (proposal_id, candidate_version)
    references public.result_amendment_candidates(proposal_id, version) on delete restrict,
  constraint result_repair_job_status_shape check (
    (status = 'queued' and lease_token is null and lease_expires_at is null
      and finished_at is null and committed_revision is null)
    or (status = 'running' and lease_token is not null and lease_expires_at is not null
      and started_at is not null and finished_at is null and committed_revision is null)
    or (status = 'failed' and lease_token is null and lease_expires_at is null
      and failure_code is not null and finished_at is not null and committed_revision is null)
    or (status = 'succeeded' and lease_token is null and lease_expires_at is null
      and failure_code is null and finished_at is not null and committed_revision is not null)
  )
);
-- One running global repair claim at a time.
create unique index result_repair_one_running on public.result_repair_jobs ((true))
  where status = 'running';
create index result_repair_jobs_due on public.result_repair_jobs (next_attempt_at, id)
  where status in ('queued', 'failed');
create index result_repair_jobs_community on public.result_repair_jobs (community_id, requested_at);
comment on table public.result_repair_jobs is
  'Durable correction command for one replaced or voided official fact. Queued by acceptance or an audited override; the official-fact switch and publication belong to the projector. Exactly one job per amendment and per logical correction.';

alter table public.result_amendment_requests
  add constraint result_amendment_repair_job_fk
    foreign key (repair_job_id, id) references public.result_repair_jobs(id, amendment_id)
    on delete restrict;

create table public.result_repair_attempts (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.result_repair_jobs(id) on delete restrict,
  attempt_number integer not null check (attempt_number >= 1),
  fence_token uuid not null,
  status text not null default 'running' check (status in ('running', 'failed', 'succeeded', 'expired')),
  base_revision bigint,
  result_revision bigint,
  failure_code text check (failure_code is null or failure_code in (
    'BASE_STALE', 'CANDIDATE_INVALID', 'PERMISSION_REVOKED', 'CONFIG_UNSUPPORTED',
    'REPLAY_FAILED', 'PUBLICATION_FAILED', 'LEASE_EXPIRED', 'INTERNAL')),
  started_at timestamptz not null default pg_catalog.clock_timestamp(),
  finished_at timestamptz,
  constraint result_repair_attempt_number_unique unique (job_id, attempt_number),
  constraint result_repair_attempt_shape check (
    (status = 'running' and finished_at is null and result_revision is null and failure_code is null)
    or (status in ('failed', 'expired') and finished_at is not null
      and failure_code is not null and result_revision is null)
    or (status = 'succeeded' and finished_at is not null and failure_code is null
      and base_revision is not null and result_revision is not null
      and result_revision > base_revision)
  )
);
create unique index result_repair_one_running_attempt on public.result_repair_attempts (job_id)
  where status = 'running';
comment on table public.result_repair_attempts is
  'Per-claim repair outcome with base/result revisions. Terminal rows are immutable evidence; detailed rows are Platform Admin only.';

create function public.guard_result_repair_job()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Result repair jobs are never deleted' using errcode = '23514';
  end if;
  if (new.id, new.community_id, new.match_event_id, new.proposal_id, new.group_number, new.kind,
      new.amendment_id, new.resolution_id, new.expected_base_confirmation_id, new.candidate_version,
      new.command_fingerprint, new.reason, new.requested_by, new.requested_at)
    is distinct from (old.id, old.community_id, old.match_event_id, old.proposal_id, old.group_number,
      old.kind, old.amendment_id, old.resolution_id, old.expected_base_confirmation_id,
      old.candidate_version, old.command_fingerprint, old.reason, old.requested_by, old.requested_at) then
    raise exception 'Result repair job identity is immutable' using errcode = '23514';
  end if;
  if old.status = 'succeeded' then
    raise exception 'Succeeded result repair jobs are immutable' using errcode = '23514';
  end if;
  if new.status <> old.status and not (
    (old.status = 'queued' and new.status = 'running')
    or (old.status = 'running' and new.status in ('failed', 'succeeded'))
    or (old.status = 'failed' and new.status in ('queued', 'running'))
  ) then
    raise exception 'Invalid result repair job transition' using errcode = '23514';
  end if;
  if new.attempt_count < old.attempt_count then
    raise exception 'Result repair attempt counts only grow' using errcode = '23514';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger result_repair_job_guard
  before update or delete on public.result_repair_jobs
  for each row execute function public.guard_result_repair_job();

create function public.guard_result_repair_attempt()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Result repair attempts are never deleted' using errcode = '23514';
  end if;
  if old.status <> 'running' then
    raise exception 'Terminal result repair attempts are immutable' using errcode = '23514';
  end if;
  if (new.id, new.job_id, new.attempt_number, new.fence_token, new.started_at)
    is distinct from (old.id, old.job_id, old.attempt_number, old.fence_token, old.started_at) then
    raise exception 'Result repair attempt identity is immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger result_repair_attempt_guard
  before update or delete on public.result_repair_attempts
  for each row execute function public.guard_result_repair_attempt();

-- 4. RLS: new tables are reachable only through guarded RPCs, plus narrow reads.
create function public.result_dispute_event_reader(p_match_event_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true'
    and exists (
      select 1 from public.match_events e
       where e.id = p_match_event_id
         and (
           e.created_by = (select auth.uid())
           or public.is_community_admin(e.community_id)
           or exists (
             select 1 from public.match_event_registrations r
              where r.match_event_id = e.id and r.user_id = (select auth.uid())
                and r.lifecycle = 'accepted' and r.cancelled_at is null)
           or exists (
             select 1 from public.result_amendment_requests q
               join public.match_event_result_proposal_versions v
                 on v.proposal_id = q.proposal_id and v.version = q.base_version
              where q.match_event_id = e.id
                and (v.teams -> 'team_a' ? (select auth.uid())::text
                  or v.teams -> 'team_b' ? (select auth.uid())::text))
         ));
$$;

-- Own-community diagnostics need a current Community Admin; Platform Admins read any.
-- Passing a null community means Platform Admin only.
create function public.result_repair_diagnostics_reader(p_community_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.is_platform_admin()
    or (p_community_id is not null and public.is_community_admin(p_community_id));
$$;

alter table public.result_dispute_resolutions enable row level security;
alter table public.result_repair_jobs enable row level security;
alter table public.result_repair_attempts enable row level security;

create policy result_dispute_resolution_reader_read on public.result_dispute_resolutions
  for select to authenticated using (public.result_dispute_event_reader(match_event_id));
create policy result_repair_job_admin_read on public.result_repair_jobs
  for select to authenticated using (public.result_repair_diagnostics_reader(community_id));
create policy result_repair_attempt_platform_read on public.result_repair_attempts
  for select to authenticated using (public.result_repair_diagnostics_reader(null));
create policy "provisional actor restricted" on public.result_dispute_resolutions
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));
create policy "provisional actor restricted" on public.result_repair_jobs
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));
create policy "provisional actor restricted" on public.result_repair_attempts
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

revoke all on public.result_dispute_resolutions, public.result_repair_jobs,
  public.result_repair_attempts from public, anon, authenticated, service_role;
-- command_id / fingerprint / lease and fence tokens stay internal.
grant select (id, match_event_id, proposal_id, group_number, resolution_kind, amendment_id,
  base_confirmation_id, candidate_version, decision, confirmation_id, actor_id, justification,
  evidence_review_id, decided_at)
  on public.result_dispute_resolutions to authenticated;
grant select (id, community_id, match_event_id, proposal_id, group_number, kind, amendment_id,
  resolution_id, expected_base_confirmation_id, candidate_version, reason, requested_by,
  requested_at, status, attempt_count, failure_code, next_attempt_at, started_at, finished_at,
  committed_revision, updated_at)
  on public.result_repair_jobs to authenticated;
grant select (id, job_id, attempt_number, status, base_revision, result_revision, failure_code,
  started_at, finished_at)
  on public.result_repair_attempts to authenticated;

-- 5. DTO helpers (sanitized: codes only).
create function public.result_repair_job_dto(j public.result_repair_jobs)
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
    'next_attempt_at', j.next_attempt_at,
    'requested_at', j.requested_at,
    'started_at', j.started_at,
    'finished_at', j.finished_at,
    'committed_revision', j.committed_revision);
$$;

create function public.result_dispute_resolution_dto(x public.result_dispute_resolutions)
returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'resolution_id', x.id,
    'event_id', x.match_event_id,
    'proposal_id', x.proposal_id,
    'group_number', x.group_number,
    'resolution_kind', x.resolution_kind,
    'amendment_id', x.amendment_id,
    'base_confirmation_id', x.base_confirmation_id,
    'candidate_version', x.candidate_version,
    'decision', x.decision,
    'confirmation_id', x.confirmation_id,
    'actor_id', x.actor_id,
    'justification', x.justification,
    'evidence_review_id', x.evidence_review_id,
    'decided_at', x.decided_at);
$$;

create function public.result_dispute_receipt(
  x public.result_dispute_resolutions, p_command_id uuid, p_replayed boolean
) returns jsonb language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'resolution', public.result_dispute_resolution_dto(x),
    'amendment_lifecycle', (select r.lifecycle from public.result_amendment_requests r
      where r.id = x.amendment_id),
    'official_confirmation_id', (select s.current_confirmation_id
      from public.match_event_result_official_state s where s.proposal_id = x.proposal_id),
    'repair', (select public.result_repair_job_dto(j) from public.result_repair_jobs j
      where j.resolution_id = x.id),
    -- The prior official fact stays active until a committed repair; never "applied" here.
    'pending_application', exists (
      select 1 from public.result_repair_jobs j
       where j.resolution_id = x.id and j.status <> 'succeeded'),
    'command_id', p_command_id,
    'replayed', p_replayed);
$$;

-- Amendment audit recorder: now maps the resolution and repair-queued event types.
create or replace function public.record_result_amendment_event(
  p_amendment public.result_amendment_requests, p_event_type text, p_from text, p_to text,
  p_actor uuid, p_candidate_version bigint, p_source text, p_data jsonb, p_command_id uuid,
  p_now timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_revision bigint;
  v_action text;
begin
  insert into public.result_amendment_events(
    amendment_id, event_type, from_lifecycle, to_lifecycle, actor_id, candidate_version,
    decision_source, data, command_id, occurred_at
  ) values (
    p_amendment.id, p_event_type, p_from, p_to, p_actor, p_candidate_version,
    p_source, coalesce(p_data, '{}'::jsonb), p_command_id, p_now);

  select * into v_event from public.match_events e where e.id = p_amendment.match_event_id;
  select s.transition_revision into v_revision
    from public.match_event_registration_state s where s.match_event_id = p_amendment.match_event_id;
  if v_revision is null then
    raise exception 'RESULT_AMENDMENT_REGISTRATION_STATE_MISSING' using errcode = '23514';
  end if;
  v_action := case p_event_type
    when 'upheld' then 'result_dispute_upheld'
    when 'replaced' then 'result_dispute_replaced'
    when 'voided' then 'result_dispute_voided'
    when 'repair_queued' then 'result_repair_queued'
    else 'result_amendment_' || case p_event_type
      when 'requested' then 'requested'
      when 'candidate_submitted' then 'candidate_submitted'
      when 'candidate_superseded' then 'candidate_superseded'
      when 'approved' then 'approved'
      when 'disputed' then 'disputed'
      when 'accepted' then 'accepted'
      else 'canceled' end
    end;
  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, reason, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields
  ) values (
    v_event.id, v_event.community_id, p_actor, v_action,
    case when p_event_type = 'requested' then p_amendment.reason
      when p_event_type = 'disputed' then p_data ->> 'reason_code'
      when p_event_type in ('upheld', 'replaced', 'voided') then p_data ->> 'justification' end,
    p_command_id, p_now, coalesce(p_candidate_version, p_amendment.base_version), v_revision,
    jsonb_build_object('amendment_id', p_amendment.id, 'proposal_id', p_amendment.proposal_id,
      'group_number', p_amendment.group_number, 'lifecycle', p_from,
      'base_confirmation_id', p_amendment.base_confirmation_id),
    jsonb_strip_nulls(jsonb_build_object('amendment_id', p_amendment.id,
      'proposal_id', p_amendment.proposal_id, 'group_number', p_amendment.group_number,
      'lifecycle', p_to, 'base_confirmation_id', p_amendment.base_confirmation_id,
      'candidate_version', p_candidate_version, 'source', p_source,
      'resolution_id', p_data ->> 'resolution_id', 'repair_job_id', p_data ->> 'repair_job_id',
      'repair_kind', p_data ->> 'kind')),
    array['amendment', 'lifecycle']);
end $$;

-- Audit for a resolution that has no amendment (first-confirmation branch).
create function public.record_result_dispute_audit(
  x public.result_dispute_resolutions, p_now timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_revision bigint;
begin
  select * into v_event from public.match_events e where e.id = x.match_event_id;
  select s.transition_revision into v_revision
    from public.match_event_registration_state s where s.match_event_id = x.match_event_id;
  if v_revision is null then
    raise exception 'RESULT_AMENDMENT_REGISTRATION_STATE_MISSING' using errcode = '23514';
  end if;
  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, reason, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields
  ) values (
    v_event.id, v_event.community_id, x.actor_id,
    case x.decision when 'uphold' then 'result_dispute_upheld' when 'replace' then 'result_dispute_replaced'
      else 'result_dispute_voided' end,
    x.justification, x.command_id, p_now, x.candidate_version, v_revision,
    jsonb_build_object('proposal_id', x.proposal_id, 'group_number', x.group_number,
      'version', x.candidate_version),
    jsonb_strip_nulls(jsonb_build_object('proposal_id', x.proposal_id,
      'group_number', x.group_number, 'version', x.candidate_version,
      'resolution_id', x.id, 'source', 'ADMIN_OVERRIDE', 'decision', x.decision,
      'confirmation_id', x.confirmation_id)),
    array['resolution']);
end $$;

-- 6. Queue exactly one correction job for an accepted amendment. Caller holds the event
-- chain and proposal locks. A repeat returns the existing job (no duplicate, no new event).
create function public.queue_result_repair_job_locked(
  p_amendment_id uuid, p_kind text, p_requested_by uuid, p_resolution_id uuid, p_reason text,
  p_command_id uuid, p_now timestamptz
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_request public.result_amendment_requests%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_event public.match_events%rowtype;
  v_job_id uuid;
begin
  if p_kind not in ('replace', 'void') then
    raise exception 'Invalid result repair kind' using errcode = '22023';
  end if;
  select * into v_request from public.result_amendment_requests r
   where r.id = p_amendment_id for update;
  if not found or v_request.lifecycle <> 'approved_pending_repair'
    or v_request.candidate_version is null then
    raise exception 'RESULT_AMENDMENT_STATE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('lifecycle', v_request.lifecycle)::text;
  end if;
  if v_request.repair_job_id is not null then return v_request.repair_job_id; end if;
  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = v_request.proposal_id for share;
  if not found or v_state.current_confirmation_id is distinct from v_request.base_confirmation_id then
    raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
  end if;
  select * into v_event from public.match_events e where e.id = v_request.match_event_id;

  insert into public.result_repair_jobs(
    community_id, match_event_id, proposal_id, group_number, kind, amendment_id, resolution_id,
    expected_base_confirmation_id, candidate_version, command_fingerprint, reason, requested_by,
    requested_at, next_attempt_at
  ) values (
    v_event.community_id, v_request.match_event_id, v_request.proposal_id, v_request.group_number,
    p_kind, v_request.id, p_resolution_id, v_request.base_confirmation_id,
    v_request.candidate_version,
    pg_catalog.md5(pg_catalog.jsonb_build_array(
      v_request.id, p_kind, v_request.base_confirmation_id, v_request.candidate_version)::text),
    p_reason, p_requested_by, p_now, p_now)
  returning id into v_job_id;

  update public.result_amendment_requests r set repair_job_id = v_job_id
   where r.id = v_request.id returning * into v_request;
  perform public.record_result_amendment_event(
    v_request, 'repair_queued', 'approved_pending_repair', 'approved_pending_repair',
    p_requested_by, v_request.candidate_version, v_request.decision_source,
    pg_catalog.jsonb_build_object('repair_job_id', v_job_id, 'kind', p_kind,
      'resolution_id', p_resolution_id),
    p_command_id, p_now);
  perform public.notify_match_result_lifecycle(
    v_request.proposal_id, v_request.candidate_version,
    'result.repair_queued:' || v_job_id::text, 'result_repair_queued');
  return v_job_id;
end $$;

-- 7. Patches of existing definitions (each needle must occur exactly once).
do $patch$
declare
  v_patch record;
  v_original text;
  v_definition text;
begin
  for v_patch in select * from (values
    -- A plain acceptance (player approvals / auto-confirm) now queues the correction job.
    ('public.accept_result_amendment_locked(uuid,bigint,text,uuid,uuid)'::regprocedure,
      E'    p_expected_version, p_source, ''{}''::jsonb, p_command_id, v_now);\n  return ''accepted'';'::text,
      E'    p_expected_version, p_source, ''{}''::jsonb, p_command_id, v_now);\n'
      || E'  perform public.queue_result_repair_job_locked(\n'
      || E'    v_request.id, ''replace'', p_actor, null, ''amendment_accepted'', p_command_id, v_now);\n'
      || E'  return ''accepted'';'),
    ('public.result_amendment_receipt(public.result_amendment_requests,uuid,boolean)'::regprocedure,
      '''pending_application'', r.lifecycle = ''approved_pending_repair'',',
      '''pending_application'', r.lifecycle = ''approved_pending_repair'','
      || E'\n    ''repair_job_id'', r.repair_job_id,'
      || E'\n    ''repair_status'', (select j.status from public.result_repair_jobs j where j.id = r.repair_job_id),'
      || E'\n    ''publication'', (select case j.status when ''succeeded'' then ''published'''
      || E'\n      when ''failed'' then ''failed'' else ''pending'' end'
      || E'\n      from public.result_repair_jobs j where j.id = r.repair_job_id),'),
    ('public.result_amendment_dto(public.result_amendment_requests,uuid)'::regprocedure,
      '''repair_job_id'', r.repair_job_id,',
      '''repair_job_id'', r.repair_job_id,'
      || E'\n    ''repair'', (select public.result_repair_job_dto(j) from public.result_repair_jobs j'
      || E'\n      where j.id = r.repair_job_id),'
      || E'\n    ''resolution'', (select public.result_dispute_resolution_dto(x)'
      || E'\n      from public.result_dispute_resolutions x where x.amendment_id = r.id),'
      || E'\n    ''can_resolve'', public.is_community_admin(e.community_id)'
      || E'\n      and r.lifecycle in (''proposal_pending'', ''disputed''),'),
    -- Admin override: a disputed (rejected) version may be confirmed only by ADMIN_OVERRIDE.
    ('public.guard_match_event_result_confirmation_insert()'::regprocedure,
      'if not found or v_proposal.status <> ''pending''',
      'if not found or v_proposal.status not in (''pending'', ''disputed'')'),
    ('public.guard_match_event_result_confirmation_insert()'::regprocedure,
      E'  select * into v_event from public.match_events e where e.id = new.match_event_id;\n',
      E'  if v_proposal.status = ''disputed'' and new.source <> ''ADMIN_OVERRIDE'' then\n'
      || E'    raise exception ''Confirmation does not reference the current pending result version''\n'
      || E'      using errcode = ''23514'';\n'
      || E'  end if;\n'
      || E'  if exists (\n'
      || E'    select 1 from public.result_dispute_resolutions x\n'
      || E'     where x.proposal_id = new.proposal_id and x.candidate_version = new.proposal_version\n'
      || E'       and x.decision = ''void''\n'
      || E'  ) then\n'
      || E'    raise exception ''Voided result version cannot be confirmed'' using errcode = ''23514'';\n'
      || E'  end if;\n'
      || E'  select * into v_event from public.match_events e where e.id = new.match_event_id;\n'),
    ('public.guard_match_event_result_confirmation_insert()'::regprocedure,
      E'  if exists (\n    select 1 from public.match_event_result_reviews r\n',
      E'  if new.source <> ''ADMIN_OVERRIDE'' and exists (\n    select 1 from public.match_event_result_reviews r\n'),
    ('public.guard_match_event_result_confirmation_insert()'::regprocedure,
      E'  else\n    raise exception ''Invalid result confirmation source''',
      E'  elsif new.source = ''ADMIN_OVERRIDE'' then\n'
      || E'    if new.actor_id is null\n'
      || E'      or new.actor_id is distinct from auth.uid()\n'
      || E'      or new.effective_at is distinct from new.confirmed_at\n'
      || E'      or not public.is_community_admin(v_event.community_id)\n'
      || E'      or not exists (\n'
      || E'        select 1 from public.result_dispute_resolutions x\n'
      || E'         where x.confirmation_id = new.id and x.decision = ''uphold''\n'
      || E'           and x.resolution_kind = ''first_confirmation''\n'
      || E'           and x.actor_id = new.actor_id and x.proposal_id = new.proposal_id\n'
      || E'           and x.candidate_version = new.proposal_version\n'
      || E'      ) then\n'
      || E'      raise exception ''Admin override confirmation requires an audited resolution by a current community admin''\n'
      || E'        using errcode = ''23514'';\n'
      || E'    end if;\n'
      || E'  else\n    raise exception ''Invalid result confirmation source'''),
    -- A disputed version may become confirmed (same version) only through an override confirmation.
    ('public.guard_match_result_proposal_transition()'::regprocedure,
      E'if old.status <> ''pending''\n      or new.status not in (''disputed'', ''confirmed'')',
      E'if not (old.status = ''pending'' or (old.status = ''disputed'' and new.status = ''confirmed''\n'
      || E'        and exists (select 1 from public.match_event_result_confirmations c\n'
      || E'          where c.proposal_id = new.id and c.proposal_version = new.active_version\n'
      || E'            and c.source = ''ADMIN_OVERRIDE'')))\n'
      || E'      or new.status not in (''disputed'', ''confirmed'')'),
    ('public.check_match_result_proposal_pointer()'::regprocedure,
      'if (v_proposal.status = ''disputed'') is distinct from v_has_rejection',
      'if (v_proposal.status = ''disputed'') is distinct from (v_has_rejection and not v_has_confirmation)'),
    -- New result notification kinds resolve through the existing result context reader.
    ('public.get_my_result_notification_contexts(uuid[])'::regprocedure,
      '''result_disputed'', ''result_confirmed'', ''result_deadline_reminder'')',
      '''result_disputed'', ''result_confirmed'', ''result_deadline_reminder'','
      || E'\n       ''result_amendment_resolved'', ''result_repair_queued'')')
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

-- 8. First-confirmation override finalizer (mirrors the ordinary finalizer's projection
-- order; caller holds the event chain and proposal locks and inserted the resolution).
create function public.finalize_match_event_result_override_locked(
  p_proposal_id uuid, p_expected_version bigint, p_actor_id uuid, p_confirmation_id uuid,
  p_justification text, p_command_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_now timestamptz;
  v_transition_revision bigint;
  v_gate jsonb;
begin
  select * into v_proposal from public.match_event_result_proposals p where p.id = p_proposal_id;
  if not found or v_proposal.active_version <> p_expected_version
    or v_proposal.status not in ('pending', 'disputed') then
    raise exception 'Result proposal changed before the override' using errcode = '23514';
  end if;
  select * into v_event from public.match_events e where e.id = v_proposal.match_event_id;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = p_expected_version;
  select s.transition_revision into v_transition_revision
    from public.match_event_registration_state s where s.match_event_id = v_event.id;
  if v_transition_revision is null then
    raise exception 'Result confirmation requires frozen registration state' using errcode = '23514';
  end if;

  if v_event.league_id is not null and v_event.event_type = 'competitive' then
    v_gate := public.match_result_ranked_ineligibility(
      v_event.id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc);
    if v_gate is not null then
      raise exception using errcode = 'P0001',
        message = 'RESULT_AMENDMENT_RANKED_' || upper(v_gate ->> 'reason');
    end if;
  end if;

  v_now := clock_timestamp();
  insert into public.match_event_result_confirmations(
    id, proposal_id, proposal_version, match_event_id, group_number, source,
    confirmed_at, effective_at, actor_id, event_type, ratable_eligible
  ) values (
    p_confirmation_id, v_proposal.id, v_proposal.active_version, v_proposal.match_event_id,
    v_proposal.group_number, 'ADMIN_OVERRIDE', v_now, v_now, p_actor_id, v_event.event_type,
    v_event.event_type = 'competitive' and v_fact.classification <> 'incomplete');
  insert into public.match_event_result_official_state(
    proposal_id, match_event_id, group_number, current_confirmation_id, current_version
  ) values (
    v_proposal.id, v_proposal.match_event_id, v_proposal.group_number,
    p_confirmation_id, v_proposal.active_version);
  update public.match_event_result_proposals p set status = 'confirmed'
   where p.id = v_proposal.id and p.active_version = p_expected_version
     and p.status in ('pending', 'disputed');
  if not found then
    raise exception 'Result proposal changed during the override' using errcode = '23514';
  end if;

  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, reason, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields, confirmation_id
  ) values (
    v_event.id, v_event.community_id, p_actor_id, 'result_confirmed', p_justification,
    p_command_id, v_now, p_expected_version, v_transition_revision,
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', v_proposal.status),
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'confirmed', 'source', 'ADMIN_OVERRIDE',
      'confirmation_id', p_confirmation_id),
    array['status', 'confirmation_id'], p_confirmation_id);
  -- League counters first; the global rating projector keeps the last lock.
  perform public.project_league_confirmation(p_confirmation_id);
  perform public.statistics_project_source(array[v_proposal.id]);
  perform public.project_confirmed_rating_group(v_proposal.id);
  perform public.statistics_publish();
  perform public.statistics_rank_refresh();
  return p_confirmation_id;
end $$;

-- 9. Commands and readers.
create function public.resolve_result_dispute(
  p_proposal_id uuid, p_expected_candidate_version bigint, p_decision text, p_justification text,
  p_command_id uuid, p_expected_base_confirmation_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_request public.result_amendment_requests%rowtype;
  v_command public.match_event_management_commands%rowtype;
  v_existing public.result_dispute_resolutions%rowtype;
  v_resolution public.result_dispute_resolutions%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_justification text := btrim(p_justification);
  v_payload jsonb;
  v_result jsonb;
  v_now timestamptz;
  v_confirmation_id uuid;
  v_review_id uuid;
  v_gate jsonb;
  v_from text;
  v_amendment_id uuid;
  v_fingerprint text;
begin
  perform public.assert_actor_not_provisional();
  if p_proposal_id is null or p_command_id is null or p_expected_candidate_version is null
    or p_expected_candidate_version < 1
    or p_decision is null or p_decision not in ('uphold', 'replace', 'void') then
    raise exception 'RESULT_AMENDMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if v_justification is null or char_length(v_justification) not between 1 and 500
    or v_justification ~ '[[:cntrl:]]' then
    raise exception 'RESULT_AMENDMENT_INVALID_JUSTIFICATION' using errcode = 'P0001';
  end if;
  -- Unreadable events look like missing ones: no cross-community existence leak.
  select p.match_event_id into v_event_id from public.match_event_result_proposals p
   where p.id = p_proposal_id;
  if not found or not public.result_dispute_event_reader(v_event_id) then
    raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001';
  end if;

  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;

  v_payload := jsonb_build_object('proposal_id', p_proposal_id,
    'base_confirmation_id', p_expected_base_confirmation_id,
    'expected_candidate_version', p_expected_candidate_version,
    'decision', p_decision, 'justification', v_justification);
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_command_id;
  if found then
    if v_command.action <> 'resolve_dispute' or v_command.payload <> v_payload then
      raise exception 'RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  -- Authority is re-read under the locks: a revoked admin is denied here.
  if not public.is_community_admin(v_event.community_id) then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;

  select * into v_existing from public.result_dispute_resolutions x
   where x.proposal_id = p_proposal_id and x.candidate_version = p_expected_candidate_version;
  if found then
    raise exception 'RESULT_AMENDMENT_ALREADY_RESOLVED' using errcode = 'P0001',
      detail = jsonb_build_object('resolution_id', v_existing.id, 'decision', v_existing.decision)::text;
  end if;

  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = p_proposal_id for share;
  v_now := clock_timestamp();

  if p_expected_base_confirmation_id is not null then
    -- Amendment branch: the official fact is confirmed; a replace/void queues its correction.
    if not found or v_state.is_void then
      raise exception 'RESULT_AMENDMENT_NOT_CONFIRMED' using errcode = 'P0001';
    end if;
    if v_state.current_confirmation_id <> p_expected_base_confirmation_id then
      raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
        detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
    end if;
    select r.id into v_amendment_id from public.result_amendment_requests r
     where r.proposal_id = p_proposal_id
       and r.lifecycle in ('requested', 'proposal_pending', 'disputed', 'approved_pending_repair');
    if not found then
      raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001';
    end if;
    select * into v_request from public.result_amendment_requests r
     where r.id = v_amendment_id for update;
    if v_request.base_confirmation_id <> p_expected_base_confirmation_id then
      raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
        detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
    end if;
    if v_request.candidate_version is distinct from p_expected_candidate_version then
      raise exception 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT' using errcode = 'P0001',
        detail = jsonb_build_object('current_version', v_request.candidate_version,
          'lifecycle', v_request.lifecycle)::text;
    end if;
    if v_request.lifecycle not in ('proposal_pending', 'disputed') then
      raise exception 'RESULT_AMENDMENT_STATE_CONFLICT' using errcode = 'P0001',
        detail = jsonb_build_object('lifecycle', v_request.lifecycle)::text;
    end if;

    if p_decision = 'replace' then
      select * into v_fact from public.match_event_result_proposal_versions v
       where v.proposal_id = p_proposal_id and v.version = p_expected_candidate_version;
      if v_event.league_id is not null and v_event.event_type = 'competitive' then
        v_gate := public.match_result_ranked_ineligibility(
          v_event.id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc);
        if v_gate is not null then
          raise exception using errcode = 'P0001',
            message = 'RESULT_AMENDMENT_RANKED_' || upper(v_gate ->> 'reason');
        end if;
      end if;
    end if;

    select r.id into v_review_id from public.match_event_result_reviews r
     where r.proposal_id = p_proposal_id and r.proposal_version = p_expected_candidate_version
       and r.decision = 'reject'
     order by r.decided_at desc, r.id desc limit 1;
    v_fingerprint := pg_catalog.md5(v_payload::text);
    insert into public.result_dispute_resolutions(
      match_event_id, proposal_id, group_number, resolution_kind, amendment_id,
      base_confirmation_id, candidate_version, decision, actor_id, justification,
      evidence_review_id, command_id, fingerprint, decided_at
    ) values (
      v_event.id, p_proposal_id, v_proposal.group_number, 'amendment', v_request.id,
      p_expected_base_confirmation_id, p_expected_candidate_version, p_decision, v_actor,
      v_justification, v_review_id, p_command_id, v_fingerprint, v_now)
    returning * into v_resolution;

    v_from := v_request.lifecycle;
    if p_decision = 'uphold' then
      update public.result_amendment_requests r
         set lifecycle = 'rejected', closed_at = v_now, decision_source = 'ADMIN_OVERRIDE',
             decision_actor_id = v_actor, decided_at = v_now, decision_note = v_justification
       where r.id = v_request.id returning * into v_request;
      perform public.record_result_amendment_event(
        v_request, 'upheld', v_from, 'rejected', v_actor, p_expected_candidate_version,
        'ADMIN_OVERRIDE', jsonb_build_object('resolution_id', v_resolution.id,
          'justification', v_justification), p_command_id, v_now);
    else
      update public.result_amendment_requests r
         set lifecycle = 'approved_pending_repair', decision_source = 'ADMIN_OVERRIDE',
             decision_actor_id = v_actor, decided_at = v_now, decision_note = v_justification
       where r.id = v_request.id returning * into v_request;
      perform public.record_result_amendment_event(
        v_request, case p_decision when 'replace' then 'replaced' else 'voided' end,
        v_from, 'approved_pending_repair', v_actor, p_expected_candidate_version,
        'ADMIN_OVERRIDE', jsonb_build_object('resolution_id', v_resolution.id,
          'justification', v_justification), p_command_id, v_now);
      perform public.queue_result_repair_job_locked(
        v_request.id, p_decision, v_actor, v_resolution.id, 'admin_override_' || p_decision,
        p_command_id, v_now);
    end if;
    perform public.notify_match_result_lifecycle(
      p_proposal_id, p_expected_candidate_version,
      'result.amendment_resolved:' || v_resolution.id::text, 'result_amendment_resolved');
  else
    -- First-confirmation branch: nothing is official yet, so there is no correction job.
    if found then
      raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
        detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
    end if;
    if v_proposal.active_version <> p_expected_candidate_version then
      raise exception 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT' using errcode = 'P0001',
        detail = jsonb_build_object('current_version', v_proposal.active_version,
          'lifecycle', null)::text;
    end if;
    -- Uphold = confirm the submitted result over the dispute; void needs a recorded dispute.
    if p_decision = 'replace'
      or v_proposal.status not in ('pending', 'disputed')
      or (p_decision = 'void' and v_proposal.status <> 'disputed') then
      raise exception 'RESULT_AMENDMENT_INVALID_DECISION' using errcode = 'P0001';
    end if;

    select r.id into v_review_id from public.match_event_result_reviews r
     where r.proposal_id = p_proposal_id and r.proposal_version = p_expected_candidate_version
       and r.decision = 'reject'
     order by r.decided_at desc, r.id desc limit 1;
    v_confirmation_id := case when p_decision = 'uphold' then gen_random_uuid() end;
    v_fingerprint := pg_catalog.md5(v_payload::text);
    insert into public.result_dispute_resolutions(
      match_event_id, proposal_id, group_number, resolution_kind, base_confirmation_id,
      candidate_version, decision, confirmation_id, actor_id, justification,
      evidence_review_id, command_id, fingerprint, decided_at
    ) values (
      v_event.id, p_proposal_id, v_proposal.group_number, 'first_confirmation', null,
      p_expected_candidate_version, p_decision, v_confirmation_id, v_actor, v_justification,
      v_review_id, p_command_id, v_fingerprint, v_now)
    returning * into v_resolution;
    perform public.record_result_dispute_audit(v_resolution, v_now);
    if p_decision = 'uphold' then
      perform public.finalize_match_event_result_override_locked(
        p_proposal_id, p_expected_candidate_version, v_actor, v_confirmation_id,
        v_justification, p_command_id);
    else
      perform public.notify_match_result_lifecycle(
        p_proposal_id, p_expected_candidate_version,
        'result.amendment_resolved:' || v_resolution.id::text, 'result_amendment_resolved');
    end if;
  end if;

  v_result := public.result_dispute_receipt(v_resolution, p_command_id, false);
  insert into public.match_event_management_commands(
    match_event_id, actor_id, request_id, action, payload, result, created_at
  ) values (v_event.id, v_actor, p_command_id, 'resolve_dispute', v_payload, v_result, v_now);
  return v_result;
end $$;

create function public.get_result_dispute_resolutions(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  x public.result_dispute_resolutions%rowtype;
begin
  perform public.assert_actor_not_provisional();
  if not public.result_dispute_event_reader(p_match_event_id) then
    raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  for x in select r.* from public.result_dispute_resolutions r
    where r.match_event_id = p_match_event_id order by r.decided_at, r.id
  loop
    return next public.result_dispute_resolution_dto(x);
  end loop;
end $$;

-- Sanitized repair status for readers of the event; the prior official fact stays the
-- answer until a job reports publication.
create function public.get_result_repair_jobs(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  j public.result_repair_jobs%rowtype;
begin
  perform public.assert_actor_not_provisional();
  if not public.result_dispute_event_reader(p_match_event_id) then
    raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  for j in select x.* from public.result_repair_jobs x
    where x.match_event_id = p_match_event_id order by x.requested_at, x.id
  loop
    return next public.result_repair_job_dto(j);
  end loop;
end $$;

create function public.get_result_repair_attempts(p_job_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  a public.result_repair_attempts%rowtype;
begin
  perform public.assert_actor_not_provisional();
  if not public.is_platform_admin() then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;
  for a in select x.* from public.result_repair_attempts x
    where x.job_id = p_job_id order by x.attempt_number
  loop
    return next pg_catalog.jsonb_build_object(
      'attempt_id', a.id, 'job_id', a.job_id, 'attempt_number', a.attempt_number,
      'status', a.status, 'base_revision', a.base_revision, 'result_revision', a.result_revision,
      'failure_code', a.failure_code, 'started_at', a.started_at, 'finished_at', a.finished_at);
  end loop;
end $$;

-- Jobs created before this migration (accepted amendments awaiting repair) get their job now.
do $backfill$
declare
  v_request record;
begin
  for v_request in
    select r.id, r.decision_actor_id from public.result_amendment_requests r
     where r.lifecycle = 'approved_pending_repair' and r.repair_job_id is null
     order by r.id
  loop
    perform public.queue_result_repair_job_locked(
      v_request.id, 'replace', v_request.decision_actor_id, null, 'amendment_accepted', null,
      pg_catalog.clock_timestamp());
  end loop;
end $backfill$;

-- 10. Grants: users reach only the guarded command and the readers.
revoke all on function
  public.guard_result_repair_job(),
  public.guard_result_repair_attempt(),
  public.result_dispute_event_reader(uuid),
  public.result_repair_diagnostics_reader(uuid),
  public.result_repair_job_dto(public.result_repair_jobs),
  public.result_dispute_resolution_dto(public.result_dispute_resolutions),
  public.result_dispute_receipt(public.result_dispute_resolutions, uuid, boolean),
  public.record_result_dispute_audit(public.result_dispute_resolutions, timestamptz),
  public.queue_result_repair_job_locked(uuid, text, uuid, uuid, text, uuid, timestamptz),
  public.finalize_match_event_result_override_locked(uuid, bigint, uuid, uuid, text, uuid),
  public.resolve_result_dispute(uuid, bigint, text, text, uuid, uuid),
  public.get_result_dispute_resolutions(uuid),
  public.get_result_repair_jobs(uuid),
  public.get_result_repair_attempts(uuid)
  from public, anon, authenticated;
-- RLS policies call the reader as the invoker.
grant execute on function public.result_dispute_event_reader(uuid),
  public.result_repair_diagnostics_reader(uuid) to authenticated;
grant execute on function
  public.resolve_result_dispute(uuid, bigint, text, text, uuid, uuid),
  public.get_result_dispute_resolutions(uuid),
  public.get_result_repair_jobs(uuid),
  public.get_result_repair_attempts(uuid)
  to authenticated;

commit;
