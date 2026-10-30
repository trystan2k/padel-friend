begin;

-- Empty in production. Only trusted database fixtures may write this clock;
-- no client role can read, write, or invoke the internal helper.
create table public.match_result_alert_test_clock (
  singleton boolean primary key default true check (singleton),
  frozen_at timestamptz not null
);
alter table public.match_result_alert_test_clock enable row level security;
revoke all on public.match_result_alert_test_clock from public, anon, authenticated, service_role;

create function public.match_result_alert_clock()
returns timestamptz language sql volatile set search_path = '' as $$
  select coalesce((select frozen_at from public.match_result_alert_test_clock),
                  pg_catalog.clock_timestamp())
$$;
revoke all on function public.match_result_alert_clock() from public, anon, authenticated, service_role;

-- Include proposal identity in new command payloads. The receipt identity also
-- distinguishes legacy ledger rows, whose payload predates proposal_id.
do $migration$
declare
  v_function regprocedure;
  v_definition text;
  v_original text;
begin
  foreach v_function in array array[
    'public.review_match_event_result(uuid,bigint,text,text,text,uuid)'::regprocedure,
    'public.correct_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid)'::regprocedure
  ] loop
    v_original := pg_catalog.pg_get_functiondef(v_function);
    v_definition := replace(v_original,
      'v_payload := jsonb_build_object(',
      'v_payload := jsonb_build_object(''proposal_id'', p_proposal_id,');
    v_definition := replace(v_definition,
      'if v_command.action <> ''review_result'' or v_command.payload <> v_payload then',
      'if v_command.action <> ''review_result''
       or v_command.result ->> ''proposal_id'' is distinct from p_proposal_id::text
        or (case when v_command.payload ? ''proposal_id'' then v_command.payload <> v_payload
             else v_command.payload <> (v_payload - ''proposal_id'') end) then');
    v_definition := replace(v_definition,
      'if v_command.action <> ''correct_result'' or v_command.payload <> v_payload then',
      'if v_command.action <> ''correct_result''
       or v_command.result ->> ''proposal_id'' is distinct from p_proposal_id::text
        or (case when v_command.payload ? ''proposal_id'' then v_command.payload <> v_payload
             else v_command.payload <> (v_payload - ''proposal_id'') end) then');
    if v_definition = v_original then
      raise exception 'Unable to install proposal-scoped replay identity for %', v_function;
    end if;
    execute v_definition;
  end loop;
end
$migration$;

-- Reminder dispatch revalidates under the shared event-chain then proposal
-- lock ordering. A transition that commits first makes this producer a no-op.
create or replace function public.notify_match_result_deadline(
  p_proposal_id uuid,
  p_proposal_version bigint
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_version public.match_event_result_proposal_versions%rowtype;
  v_recipient uuid;
  v_key text := 'result.deadline:' || p_proposal_id::text || ':v' || p_proposal_version::text;
  v_count integer := 0;
begin
  select p.match_event_id into v_event_id
    from public.match_event_result_proposals p where p.id = p_proposal_id;
  if not found then return 0; end if;
  v_event := public.lock_match_event_registration_skip_locked(v_event_id);
  if v_event.id is null then return 0; end if;
  begin
    select p.* into v_proposal from public.match_event_result_proposals p
     where p.id = p_proposal_id for update nowait;
  exception when lock_not_available then return 0;
  end;
  if not found or v_proposal.active_version <> p_proposal_version
    or v_proposal.status <> 'pending'
    or v_proposal.review_deadline_at <= public.match_result_alert_clock() then
    return 0;
  end if;
  select version.* into v_version
    from public.match_event_result_proposal_versions version
   where version.proposal_id = p_proposal_id
     and version.version = p_proposal_version
     and version.review_deadline_at = v_proposal.review_deadline_at;
  if not found then return 0; end if;

  for v_recipient in
    select pg_catalog.jsonb_array_elements_text(v_version.teams -> 'team_a')::uuid
    union
    select pg_catalog.jsonb_array_elements_text(v_version.teams -> 'team_b')::uuid
  loop
    if v_recipient = v_version.submitted_by or exists (
      select 1 from public.match_event_result_reviews review
       where review.proposal_id = p_proposal_id
         and review.proposal_version = p_proposal_version
         and review.reviewer_user_id = v_recipient and review.decision = 'approve'
    ) then continue; end if;
    perform public.persist_match_result_notification(
      v_recipient, v_key, 'result_deadline_reminder', v_event.id,
      v_event.community_id, p_proposal_id, p_proposal_version, null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Readiness follows the frozen playable roster, not result submission. The
-- event lock serializes this predicate with roster/cancellation transitions.
create or replace function public.notify_match_result_entry_ready(p_match_event_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_notification_id uuid;
  v_fingerprint text;
begin
  v_event := public.lock_match_event_registration_skip_locked(p_match_event_id);
  if v_event.id is null then return false; end if;
  if v_event.id is null or v_event.status <> 'open' then return false; end if;
  perform public.process_match_event_registration_cutoff(v_event.id, false);
  if not exists (
    select 1 from public.match_event_registrations registration
     where registration.match_event_id = v_event.id
       and registration.lifecycle = 'accepted'
       and registration.cancelled_at is null
       and registration.participation_status = 'playing'
     group by registration.match_event_id having count(*) >= 4
  ) then
    v_fingerprint := public.match_result_entry_roster_fingerprint(v_event.id);
    begin
      perform public.mark_match_result_alert_ineligible(v_event.id, v_fingerprint);
    exception when others then null;
    end;
    return false;
  end if;
  if (v_event.starts_at + case when v_event.duration_minutes is null then interval '0 minutes'
       else pg_catalog.make_interval(mins => v_event.duration_minutes) end)
       > public.match_result_alert_clock() then return false; end if;

  v_notification_id := public.persist_notification(
    v_event.created_by, 'result.entry_ready:' || v_event.id::text,
    'result_entry_ready', 'results', 'match_event', v_event.id, v_event.community_id
  );
  insert into public.match_event_result_entry_ready_dispatch(
    match_event_id, creator_user_id, notification_id
  ) values (v_event.id, v_event.created_by, v_notification_id)
  on conflict (match_event_id) do nothing;
  return found;
end $$;

-- Entry-ready candidate discovery mirrors the authoritative producer predicate.
do $migration$
declare
  v_original text;
  v_definition text;
begin
  v_original := pg_catalog.pg_get_functiondef(
    'public.process_match_result_lifecycle_alerts(integer,integer)'::regprocedure
  );
  v_definition := v_original;
  v_definition := replace(v_definition,
    'join public.match_event_registration_state state on state.match_event_id = e.id',
    '');
  v_definition := replace(v_definition,
    'state.results_protected_at is not null',
    'e.status = ''open''');
  v_definition := replace(v_definition,
    'coalesce(e.duration_minutes, 0)', 'coalesce(e.duration_minutes, 0)');
  if v_definition = v_original then
    raise exception 'Unable to install result readiness candidate predicate';
  end if;
  execute v_definition;
end
$migration$;

revoke all on function public.notify_match_result_deadline(uuid,bigint),
  public.notify_match_result_entry_ready(uuid) from public, anon, authenticated;

-- The 24-hour aging horizon affects effective-key ordering only; it is not a
-- dispatch-delay guarantee. The conditional delay bound is documented beside
-- the processor, relative to due time and bounded predecessor/defer assumptions.
create function public.match_result_alert_aging_horizon()
returns interval language sql immutable parallel safe set search_path = '' as $$
  select interval '24 hours'
$$;
revoke all on function public.match_result_alert_aging_horizon()
  from public, anon, authenticated;

-- Canonical-lock misses defer by 120s plus deterministic candidate-specific
-- jitter [0, 60s]. This exceeds the 60s scheduler cadence, so deferred candidates
-- leave the due set for at least one full scheduler interval.
create function public.match_result_alert_lock_defer_interval(p_candidate_id uuid)
returns interval language sql immutable parallel safe set search_path = '' as $$
  select interval '120 seconds' + pg_catalog.make_interval(secs => pg_catalog.mod(
    pg_catalog.hashtextextended(p_candidate_id::text, 84519) & 2147483647,
    61
  )::integer)
$$;
revoke all on function public.match_result_alert_lock_defer_interval(uuid)
  from public, anon, authenticated;

create function public.match_result_alert_aging_at(p_enqueued_at timestamptz)
returns timestamptz language sql immutable parallel safe set search_path = '' as $$
  select ((p_enqueued_at at time zone 'UTC')
    + public.match_result_alert_aging_horizon()) at time zone 'UTC'
$$;
revoke all on function public.match_result_alert_aging_at(timestamptz)
  from public, anon, authenticated;

create table public.match_result_alert_processing_state (
  alert_kind text not null check (alert_kind in ('deadline', 'entry_ready')),
  candidate_id uuid not null,
  candidate_version bigint not null default 0 check (candidate_version >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  attempted_at timestamptz,
  next_attempt_at timestamptz,
  last_failure_code text,
  last_failure_message text,
  terminal_outcome text check (
    terminal_outcome is null or terminal_outcome in ('ineligible', 'quarantined')
  ),
  roster_fingerprint text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (alert_kind, candidate_id, candidate_version),
  check ((last_failure_code is null) = (last_failure_message is null)),
  check (coalesce(terminal_outcome = 'quarantined', false)
    or (last_failure_code is null) = (next_attempt_at is null)),
  check (
    (coalesce(terminal_outcome = 'ineligible', false)
      or (coalesce(terminal_outcome = 'quarantined', false) and alert_kind = 'entry_ready'))
    = (roster_fingerprint is not null)
  )
);
alter table public.match_result_alert_processing_state enable row level security;
revoke all on public.match_result_alert_processing_state from public, anon, authenticated;

-- One serialized resume position per producer. Candidate processing metadata
-- stays per candidate; this table only advances after a scan exhausts its cap.
create table public.match_result_alert_scan_state (
  alert_kind text primary key check (alert_kind in ('deadline', 'entry_ready')),
  resume_effective_key timestamptz,
  resume_candidate_id uuid,
  resume_candidate_version bigint not null default 0 check (resume_candidate_version >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((resume_effective_key is null) = (resume_candidate_id is null)),
  check (alert_kind = 'deadline' or resume_candidate_version = 0),
  check (resume_effective_key is not null or resume_candidate_version = 0)
);
alter table public.match_result_alert_scan_state enable row level security;
revoke all on public.match_result_alert_scan_state from public, anon, authenticated;
insert into public.match_result_alert_scan_state(alert_kind)
values ('deadline'), ('entry_ready');

create table public.match_result_alert_deadline_queue (
  proposal_id uuid not null references public.match_event_result_proposals(id) on delete cascade,
  proposal_version bigint not null check (proposal_version > 0),
  due_at timestamptz not null,
  enqueued_at timestamptz not null default pg_catalog.clock_timestamp(),
  next_attempt_at timestamptz,
  effective_key timestamptz generated always as (
    least(due_at, public.match_result_alert_aging_at(enqueued_at))
  ) stored,
  active boolean not null default true,
  primary key (proposal_id, proposal_version)
);
alter table public.match_result_alert_deadline_queue enable row level security;
revoke all on public.match_result_alert_deadline_queue from public, anon, authenticated;
create index match_result_alert_deadline_effective_scan_idx
  on public.match_result_alert_deadline_queue (effective_key, proposal_id, proposal_version)
  where active;

insert into public.match_result_alert_deadline_queue(
  proposal_id, proposal_version, due_at, enqueued_at, active
)
select proposal.id, proposal.active_version, proposal.review_deadline_at - interval '6 hours',
       pg_catalog.clock_timestamp(), true
  from public.match_event_result_proposals proposal
 where proposal.status = 'pending' and proposal.review_deadline_at is not null;

create function public.sync_match_result_deadline_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'pending' then
    update public.match_result_alert_deadline_queue
       set active = false
     where proposal_id = new.id and active;
    return new;
  end if;

  update public.match_result_alert_deadline_queue
     set active = false
   where proposal_id = new.id and proposal_version <> new.active_version and active;

  insert into public.match_result_alert_deadline_queue(
    proposal_id, proposal_version, due_at, enqueued_at, active
  ) values (
    new.id, new.active_version, new.review_deadline_at - interval '6 hours',
    public.match_result_alert_clock(), true
  ) on conflict (proposal_id, proposal_version) do update
    set due_at = excluded.due_at, next_attempt_at = null,
        enqueued_at = case when public.match_result_alert_deadline_queue.active
          then public.match_result_alert_deadline_queue.enqueued_at else excluded.enqueued_at end,
        active = true;
  return new;
end $$;
revoke all on function public.sync_match_result_deadline_queue() from public, anon, authenticated;

create trigger match_result_alert_deadline_queue_sync
  after insert or update of active_version, status, review_deadline_at
  on public.match_event_result_proposals
  for each row execute function public.sync_match_result_deadline_queue();

create table public.match_result_alert_entry_ready_queue (
  match_event_id uuid primary key references public.match_events(id) on delete cascade,
  due_at timestamptz not null,
  enqueued_at timestamptz not null default pg_catalog.clock_timestamp(),
  next_attempt_at timestamptz,
  effective_key timestamptz generated always as (
    least(due_at, public.match_result_alert_aging_at(enqueued_at))
  ) stored,
  active boolean not null default true,
  roster_revision bigint not null default 0 check (roster_revision >= 0)
);
alter table public.match_result_alert_entry_ready_queue enable row level security;
revoke all on public.match_result_alert_entry_ready_queue from public, anon, authenticated;

create index match_result_alert_entry_ready_effective_scan_idx
  on public.match_result_alert_entry_ready_queue (effective_key, match_event_id) where active;

insert into public.match_result_alert_entry_ready_queue(match_event_id, due_at, enqueued_at, active)
select event.id,
       event.starts_at + pg_catalog.make_interval(mins => coalesce(event.duration_minutes, 0)),
       pg_catalog.clock_timestamp(),
       not exists (select 1 from public.match_event_result_entry_ready_dispatch dispatched
                    where dispatched.match_event_id = event.id)
  from public.match_events event
 where event.status = 'open';

create function public.sync_match_result_entry_ready_queue()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.status <> 'open' then
    delete from public.match_result_alert_entry_ready_queue
     where match_event_id = new.id;
    return new;
  end if;
  insert into public.match_result_alert_entry_ready_queue(
    match_event_id, due_at, enqueued_at, active
  )
  values (
    new.id,
    new.starts_at + pg_catalog.make_interval(mins => coalesce(new.duration_minutes, 0)),
    public.match_result_alert_clock(),
    not exists (select 1 from public.match_event_result_entry_ready_dispatch dispatched
                 where dispatched.match_event_id = new.id)
  ) on conflict (match_event_id) do update
    set due_at = excluded.due_at,
        next_attempt_at = null,
        enqueued_at = case when public.match_result_alert_entry_ready_queue.active
          then public.match_result_alert_entry_ready_queue.enqueued_at else excluded.enqueued_at end,
        active = case when exists (
          select 1 from public.match_event_result_entry_ready_dispatch dispatched
           where dispatched.match_event_id = new.id
        ) then false else public.match_result_alert_entry_ready_queue.active end;
  return new;
end $$;
revoke all on function public.sync_match_result_entry_ready_queue() from public, anon, authenticated;

create trigger match_result_alert_entry_ready_queue_sync
  after insert or update of status, starts_at, duration_minutes on public.match_events
  for each row execute function public.sync_match_result_entry_ready_queue();

create index match_event_registrations_entry_ready_playing_idx
  on public.match_event_registrations (match_event_id, user_id)
  where lifecycle = 'accepted' and cancelled_at is null
    and participation_status = 'playing' and confirmed_generation = required_generation;

create function public.touch_match_result_entry_ready_roster()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
begin
  if tg_op = 'DELETE' then
    v_event_id := old.match_event_id;
  else
    v_event_id := new.match_event_id;
  end if;

  update public.match_result_alert_entry_ready_queue queue
     set roster_revision = queue.roster_revision + 1,
         next_attempt_at = null,
         active = not exists (
           select 1 from public.match_event_result_entry_ready_dispatch dispatched
             where dispatched.match_event_id = v_event_id
         ),
         enqueued_at = case when not queue.active and not exists (
           select 1 from public.match_event_result_entry_ready_dispatch dispatched
            where dispatched.match_event_id = v_event_id
         ) then public.match_result_alert_clock() else queue.enqueued_at end
   where queue.match_event_id = v_event_id;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;
revoke all on function public.touch_match_result_entry_ready_roster()
  from public, anon, authenticated;

create trigger match_result_entry_ready_roster_revision
  after insert or update of lifecycle, cancelled_at, accepted_order, participation_status,
    required_generation, confirmed_generation or delete on public.match_event_registrations
  for each row execute function public.touch_match_result_entry_ready_roster();

create function public.deactivate_match_result_entry_ready_queue_after_dispatch()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  update public.match_result_alert_entry_ready_queue
     set active = false
   where match_event_id = new.match_event_id;
  return new;
end $$;
revoke all on function public.deactivate_match_result_entry_ready_queue_after_dispatch()
  from public, anon, authenticated;

create trigger match_result_entry_ready_dispatch_deactivate
  after insert on public.match_event_result_entry_ready_dispatch
  for each row execute function public.deactivate_match_result_entry_ready_queue_after_dispatch();

-- Independent fallback bookkeeping records a retry turn when the primary state
-- row is locked or its write fails. Both its advisory and row locks are NOWAIT.
create table public.match_result_alert_retry_fallback (
  alert_kind text not null check (alert_kind in ('deadline', 'entry_ready')),
  candidate_id uuid not null,
  candidate_version bigint not null default 0 check (candidate_version >= 0),
  attempt_count integer not null default 0 check (attempt_count >= 0),
  failure_count integer not null default 0 check (failure_count >= 0),
  last_failure_code text,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (alert_kind, candidate_id, candidate_version)
);
alter table public.match_result_alert_retry_fallback enable row level security;
revoke all on public.match_result_alert_retry_fallback from public, anon, authenticated;

create function public.record_match_result_alert_fallback(
  p_kind text, p_candidate_id uuid, p_version bigint, p_failure_code text
) returns void language plpgsql security definer set search_path = '' as $$
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'fallback:' || p_kind || ':' || p_candidate_id::text || ':' || coalesce(p_version, 0)::text, 84519
  )) then raise lock_not_available; end if;
  begin
    perform 1 from public.match_result_alert_retry_fallback
     where alert_kind = p_kind and candidate_id = p_candidate_id
       and candidate_version = coalesce(p_version, 0) for update nowait;
  exception when lock_not_available then raise;
  end;
  insert into public.match_result_alert_retry_fallback(
    alert_kind, candidate_id, candidate_version, attempt_count, failure_count,
    last_failure_code, updated_at
  ) values (
    p_kind, p_candidate_id, coalesce(p_version, 0), 1, 1,
    case when p_failure_code ~ '^[A-Z0-9_]{1,80}$' then p_failure_code else 'PROCESSING_ERROR' end,
    public.match_result_alert_clock()
  ) on conflict (alert_kind, candidate_id, candidate_version) do update
    set attempt_count = public.match_result_alert_retry_fallback.attempt_count + 1,
        failure_count = public.match_result_alert_retry_fallback.failure_count + 1,
        last_failure_code = excluded.last_failure_code,
        updated_at = public.match_result_alert_clock();
end $$;
revoke all on function public.record_match_result_alert_fallback(text,uuid,bigint,text)
  from public, anon, authenticated;

-- Fingerprinting is bounded: read at most four indexed playable user ids plus the
-- event-local roster revision maintained by the registration trigger. The shared
-- canonical event lock remains O(event ledger) by the existing T08.3 protocol;
-- that lock chain is intentionally unchanged here.
create function public.match_result_entry_roster_fingerprint(p_event_id uuid)
returns text language sql volatile security definer set search_path = '' as $$
  select pg_catalog.md5(
    coalesce((
      select pg_catalog.jsonb_agg(playing.user_id order by playing.user_id)::text
        from (
          select registration.user_id
            from public.match_event_registrations registration
           where registration.match_event_id = p_event_id
             and registration.lifecycle = 'accepted'
             and registration.cancelled_at is null
             and registration.participation_status = 'playing'
             and registration.confirmed_generation = registration.required_generation
           order by registration.user_id
           limit 4
        ) playing
    ), '[]') || ':' || coalesce((
      select queue.roster_revision::text
        from public.match_result_alert_entry_ready_queue queue
       where queue.match_event_id = p_event_id
    ), '0')
  )
$$;
revoke all on function public.match_result_entry_roster_fingerprint(uuid)
  from public, anon, authenticated;

create function public.mark_match_result_alert_ineligible(p_event_id uuid, p_fingerprint text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_id uuid := p_event_id;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    'entry_ready:' || p_event_id::text || ':0', 84519
  )) then return false; end if;
  begin
    perform 1 from public.match_result_alert_processing_state
     where alert_kind = 'entry_ready'
       and candidate_id = p_event_id and candidate_version = 0 for update nowait;
  exception when lock_not_available then return false;
  end;
  insert into public.match_result_alert_processing_state(
    alert_kind, candidate_id, candidate_version,
    terminal_outcome, roster_fingerprint
  ) values ('entry_ready', v_id, 0, 'ineligible', p_fingerprint)
  on conflict (alert_kind, candidate_id, candidate_version) do update
    set terminal_outcome = 'ineligible', roster_fingerprint = excluded.roster_fingerprint,
        failure_count = 0, next_attempt_at = null,
        last_failure_code = null, last_failure_message = null,
        updated_at = pg_catalog.clock_timestamp();
  update public.match_result_alert_entry_ready_queue
     set active = false
   where match_event_id = p_event_id;
  return true;
end $$;
revoke all on function public.mark_match_result_alert_ineligible(uuid,text)
  from public, anon, authenticated;

create function public.record_match_result_alert_attempt(
  p_kind text, p_candidate_id uuid, p_version bigint, p_failed boolean,
  p_failure_code text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_code text;
  v_next_attempt_at timestamptz;
  -- Ten consecutive failures enter quarantine. Quarantined work remains eligible
  -- on exponential 1h, 2h, 4h... retries capped at 24h; success clears the streak.
  v_max_consecutive_failures constant integer := 10;
  v_failure_count integer := 0;
  v_existing_terminal_outcome text;
  v_existing_fingerprint text;
  v_current_fingerprint text;
  v_reset_quarantine boolean := false;
  v_quarantined boolean := false;
begin
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended(
    p_kind || ':' || p_candidate_id::text || ':' || coalesce(p_version, 0)::text, 84519
  )) then raise lock_not_available; end if;
  begin
    select state.failure_count, state.terminal_outcome, state.roster_fingerprint
      into v_failure_count, v_existing_terminal_outcome, v_existing_fingerprint
      from public.match_result_alert_processing_state state
     where state.alert_kind = p_kind
       and state.candidate_id = p_candidate_id
       and state.candidate_version = coalesce(p_version, 0) for update nowait;
  exception when lock_not_available then raise;
  end;
  if not found then
    v_failure_count := 0;
    v_existing_terminal_outcome := null;
    v_existing_fingerprint := null;
  end if;
  if p_kind = 'entry_ready' then
    v_current_fingerprint := public.match_result_entry_roster_fingerprint(p_candidate_id);
    v_reset_quarantine := v_existing_terminal_outcome = 'quarantined'
      and v_existing_fingerprint is distinct from v_current_fingerprint;
  end if;
  v_failure_count := case when p_failed
    then (case when v_reset_quarantine then 0 else v_failure_count end) + 1
    else 0 end;
  v_quarantined := p_failed and v_failure_count >= v_max_consecutive_failures;
  v_code := case when p_failed and p_failure_code ~ '^[A-Z0-9_]{1,80}$'
    then p_failure_code when p_failed then 'PROCESSING_ERROR' else null end;
  v_next_attempt_at := case when not p_failed then null
    when v_quarantined then public.match_result_alert_clock() + pg_catalog.make_interval(
      hours => least(24, pg_catalog.power(
        2, greatest(v_failure_count - v_max_consecutive_failures, 0)
      ))::integer
    )
    else public.match_result_alert_clock() + pg_catalog.make_interval(
      secs => least(300, 30 * pg_catalog.power(
        2, least(greatest(v_failure_count - 1, 0), 4)
      ))::integer
    ) end;
  insert into public.match_result_alert_processing_state(
    alert_kind, candidate_id, candidate_version, attempt_count, failure_count,
    attempted_at, next_attempt_at, last_failure_code, last_failure_message,
    terminal_outcome, roster_fingerprint, updated_at
  ) values (
    p_kind, p_candidate_id, coalesce(p_version, 0), 1,
    v_failure_count,
    public.match_result_alert_clock(),
    v_next_attempt_at,
    v_code,
    case when p_failed then 'Lifecycle alert failed; recovery policy applied.' end,
    case when v_quarantined then 'quarantined' end,
    case when v_quarantined and p_kind = 'entry_ready' then v_current_fingerprint end,
    public.match_result_alert_clock()
  ) on conflict (alert_kind, candidate_id, candidate_version) do update
    set attempt_count = public.match_result_alert_processing_state.attempt_count + 1,
        failure_count = v_failure_count,
        attempted_at = public.match_result_alert_clock(),
        next_attempt_at = v_next_attempt_at,
        last_failure_code = v_code,
        last_failure_message = case when p_failed
          then 'Lifecycle alert failed; recovery policy applied.' end,
        terminal_outcome = case
          when v_quarantined then 'quarantined'
          when v_reset_quarantine
            or (not p_failed and public.match_result_alert_processing_state.terminal_outcome = 'quarantined')
            then null
          else public.match_result_alert_processing_state.terminal_outcome end,
        roster_fingerprint = case
          when v_quarantined and p_kind = 'entry_ready' then v_current_fingerprint
          when v_reset_quarantine
            or (not p_failed and public.match_result_alert_processing_state.terminal_outcome = 'quarantined')
            then null
          else public.match_result_alert_processing_state.roster_fingerprint end,
        updated_at = public.match_result_alert_clock();
end $$;
revoke all on function public.record_match_result_alert_attempt(text,uuid,bigint,boolean,text)
  from public, anon, authenticated;

-- Conditional SLA at one-minute cadence: with producer limit L >= 2, each run
-- reserves resumeBudget=ceil(L/2) claims after its cursor and headBudget=floor(L/2)
-- claims from queue head. A suffix candidate loses at most headBudget claims/run
-- relative to an unsplit scan. A due head candidate is revisited within
-- ceil(dueHeadCount/headBudget)+1 runs. For D due-or-deferred predecessors, use
-- C=headBudget in T + ceil(D/C)*interval + defer_max; interval=60s,
-- defer_max=180s, D_max=3,000 concurrent deferred candidates per producer at
-- default examination cap 1,000. When p_max_examined covers the producer claim
-- limit, examination capacity is hard-reserved per phase: resume examines at most
-- p_max_examined - headBudget rows, and head owns headBudget rows. Total stays
-- within the cap, and head gets all its slots despite suffix locks. Below that
-- threshold, preserve the bounded resume-only scan because the full reservation
-- cannot fit. Assume p_max_examined covers each producer's
-- claim limit, claim capacity >= arrival rate, one-minute cadence, no overlapping
-- runs, canonical event locks acquired promptly, and
-- successful notification processing. Event locks are transaction-scoped and
-- short-lived; sustained simultaneous locks beyond scan capacity indicate a
-- wedged system outside this SLA. Candidates remain due and process as locks clear.
-- Quarantined retries count in D when due; lock and processing failures follow
-- their own defer/quarantine bounds. The resume cursor advances when due suffix
-- candidates remain after its last examined position, including claim-limit stops.
-- With zero suffix candidates examined, preserve the prior cursor when an eligible
-- suffix remains (including rows skipped by FOR UPDATE SKIP LOCKED); reset only
-- when the resume scan observes an exhausted due tail. At or above the claim-limit
-- threshold, cap is partitioned between phases, not shared dynamically; it remains
-- a safety valve, not fairness logic.
drop function if exists public.process_match_result_lifecycle_alerts(integer, integer);
create function public.process_match_result_lifecycle_alerts(
  p_reminder_limit integer default 25,
  p_entry_ready_limit integer default 25,
  p_max_examined integer default 1000
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reminder_limit integer := least(greatest(coalesce(p_reminder_limit, 25), 1), 100);
  v_entry_ready_limit integer := least(greatest(coalesce(p_entry_ready_limit, 25), 1), 100);
  v_max_examined integer := least(greatest(coalesce(p_max_examined, 1000), 1), 10000);
  v_candidate record;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_claimed boolean;
  v_candidate_failed boolean;
  v_sqlstate text;
  v_stored_fingerprint text;
  v_now timestamptz;
  v_reminder_claims integer := 0;
  v_entry_ready_claims integer := 0;
  v_reminders integer := 0;
  v_ready integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_resume_effective_key timestamptz;
  v_resume_candidate_id uuid;
  v_resume_candidate_version bigint;
  v_last_effective_key timestamptz;
  v_last_candidate_id uuid;
  v_last_candidate_version bigint;
  v_resume_budget integer;
  v_head_budget integer;
  v_resume_exam_budget integer;
  v_head_exam_budget integer;
  v_phase_claim_budget integer;
  v_phase_claims integer;
  v_resume_examined integer;
  v_scan_phase integer;
  v_has_more boolean;
begin
  -- Serialize each producer scan with its cursor update. Producer rows are
  -- acquired in fixed order so overlapping calls cannot reverse progress.
  select state.resume_effective_key, state.resume_candidate_id,
         state.resume_candidate_version
    into v_resume_effective_key, v_resume_candidate_id, v_resume_candidate_version
    from public.match_result_alert_scan_state state
   where state.alert_kind = 'deadline'
   for update;
  if not found then raise exception 'Missing deadline alert scan state'; end if;

  v_now := public.match_result_alert_clock();
  v_resume_budget := (v_reminder_limit + 1) / 2;
  v_head_budget := v_reminder_limit - v_resume_budget;
  if v_max_examined >= v_reminder_limit then
    v_resume_exam_budget := v_max_examined - v_head_budget;
    v_head_exam_budget := v_head_budget;
  else
    v_resume_exam_budget := v_max_examined;
    v_head_exam_budget := 0;
  end if;
  v_resume_examined := 0;
  v_last_effective_key := null;
  v_last_candidate_id := null;
  v_last_candidate_version := 0;
  for v_scan_phase in 0..1 loop
    v_phase_claim_budget := case when v_scan_phase = 0
      then v_resume_budget else v_head_budget end;
    if v_phase_claim_budget = 0 then continue; end if;
    v_phase_claims := 0;
    for v_candidate in
    select queue.proposal_id, queue.proposal_version, queue.due_at, queue.effective_key,
           proposal.match_event_id
      from public.match_result_alert_deadline_queue queue
      join public.match_event_result_proposals proposal
        on proposal.id = queue.proposal_id
       and proposal.active_version = queue.proposal_version
      left join public.match_result_alert_processing_state state
        on state.alert_kind = 'deadline'
       and state.candidate_id = queue.proposal_id
       and state.candidate_version = queue.proposal_version
      left join public.match_result_alert_retry_fallback fallback
        on fallback.alert_kind = 'deadline'
       and fallback.candidate_id = queue.proposal_id
       and fallback.candidate_version = queue.proposal_version
      where queue.active
        and queue.due_at <= v_now
        and (queue.next_attempt_at is null or queue.next_attempt_at <= v_now)
        and proposal.status = 'pending'
        and (state.next_attempt_at is null or state.next_attempt_at <= v_now)
        and (fallback.updated_at is null or fallback.updated_at <= v_now - interval '1 second')
         and (v_scan_phase = 1 or v_resume_effective_key is null or
           (queue.effective_key, queue.proposal_id, queue.proposal_version) >
           (v_resume_effective_key, v_resume_candidate_id, v_resume_candidate_version))
       order by queue.effective_key, queue.proposal_id, queue.proposal_version
        limit case when v_scan_phase = 0
          then v_resume_exam_budget else v_head_exam_budget end
        for update of queue skip locked
        loop

       if v_scan_phase = 0 then
        v_resume_examined := v_resume_examined + 1;
        v_last_effective_key := v_candidate.effective_key;
        v_last_candidate_id := v_candidate.proposal_id;
        v_last_candidate_version := v_candidate.proposal_version;
      end if;

    v_claimed := false;
    begin
      v_event := public.lock_match_event_registration_skip_locked(v_candidate.match_event_id);
      if v_event.id is not null then
        select proposal.* into v_proposal
          from public.match_event_result_proposals proposal
         where proposal.id = v_candidate.proposal_id
         for update nowait;
        v_claimed := found;
      end if;
    exception when lock_not_available then
      v_claimed := false;
    end;
    if not v_claimed then
      update public.match_result_alert_deadline_queue
         set next_attempt_at = public.match_result_alert_clock()
           + public.match_result_alert_lock_defer_interval(v_candidate.proposal_id)
       where proposal_id = v_candidate.proposal_id
         and proposal_version = v_candidate.proposal_version;
      continue;
    end if;

    v_reminder_claims := v_reminder_claims + 1;
    v_phase_claims := v_phase_claims + 1;
    v_now := public.match_result_alert_clock();
    if v_proposal.status <> 'pending'
      or v_proposal.active_version <> v_candidate.proposal_version then
      update public.match_result_alert_deadline_queue
         set active = false
       where proposal_id = v_candidate.proposal_id
         and proposal_version = v_candidate.proposal_version;
      exit when v_phase_claims >= v_phase_claim_budget;
      continue;
    end if;
    if v_proposal.review_deadline_at <= v_now then
      update public.match_result_alert_deadline_queue
         set active = false
       where proposal_id = v_candidate.proposal_id
         and proposal_version = v_candidate.proposal_version;
      exit when v_phase_claims >= v_phase_claim_budget;
      continue;
    end if;
    if v_proposal.review_deadline_at > v_now + interval '6 hours' then
      update public.match_result_alert_deadline_queue
         set due_at = v_proposal.review_deadline_at - interval '6 hours'
       where proposal_id = v_candidate.proposal_id
         and proposal_version = v_candidate.proposal_version;
      exit when v_phase_claims >= v_phase_claim_budget;
      continue;
    end if;

    v_candidate_failed := false;
    v_sqlstate := null;
    begin
      v_reminders := v_reminders + public.notify_match_result_deadline(
        v_candidate.proposal_id, v_candidate.proposal_version
      );
      update public.match_result_alert_deadline_queue
         set active = false
       where proposal_id = v_candidate.proposal_id
         and proposal_version = v_candidate.proposal_version;
    exception when others then
      v_candidate_failed := true;
      v_sqlstate := SQLSTATE;
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'proposal_id', v_candidate.proposal_id,
        'version', v_candidate.proposal_version,
        'kind', 'deadline', 'message', 'Result reminder failed; recovery policy applied.'
      );
    end;
    begin
      perform public.record_match_result_alert_attempt(
        'deadline', v_candidate.proposal_id, v_candidate.proposal_version,
        v_candidate_failed, v_sqlstate
      );
    exception when others then
      begin
        perform public.record_match_result_alert_fallback(
          'deadline', v_candidate.proposal_id, v_candidate.proposal_version, SQLSTATE
        );
      exception when others then null;
      end;
      if not v_candidate_failed then
        v_failed := v_failed + 1;
        v_errors := v_errors || pg_catalog.jsonb_build_object(
          'proposal_id', v_candidate.proposal_id,
          'version', v_candidate.proposal_version,
          'kind', 'deadline_bookkeeping',
          'message', 'Result reminder attempt could not be recorded.'
        );
       end if;
     end;
     exit when v_phase_claims >= v_phase_claim_budget;
     end loop;

    if v_scan_phase = 0 then
      select exists (
       select 1
        from public.match_result_alert_deadline_queue queue
        join public.match_event_result_proposals proposal
          on proposal.id = queue.proposal_id
         and proposal.active_version = queue.proposal_version
        left join public.match_result_alert_processing_state state
          on state.alert_kind = 'deadline'
         and state.candidate_id = queue.proposal_id
         and state.candidate_version = queue.proposal_version
        left join public.match_result_alert_retry_fallback fallback
          on fallback.alert_kind = 'deadline'
         and fallback.candidate_id = queue.proposal_id
         and fallback.candidate_version = queue.proposal_version
       where queue.active and queue.due_at <= v_now
         and (queue.next_attempt_at is null or queue.next_attempt_at <= v_now)
         and proposal.status = 'pending'
         and (state.next_attempt_at is null or state.next_attempt_at <= v_now)
         and (fallback.updated_at is null or fallback.updated_at <= v_now - interval '1 second')
          and (
            (v_resume_examined = 0 and (v_resume_effective_key is null or
              (queue.effective_key, queue.proposal_id, queue.proposal_version) >
                (v_resume_effective_key, v_resume_candidate_id, v_resume_candidate_version)))
            or (v_resume_examined > 0 and
              (queue.effective_key, queue.proposal_id, queue.proposal_version) >
                (v_last_effective_key, v_last_candidate_id, v_last_candidate_version))
          )
      ) into v_has_more;
      if not v_has_more then
        update public.match_result_alert_scan_state
           set resume_effective_key = null, resume_candidate_id = null,
               resume_candidate_version = 0, updated_at = public.match_result_alert_clock()
         where alert_kind = 'deadline';
      elsif v_resume_examined > 0 then
        update public.match_result_alert_scan_state
           set resume_effective_key = v_last_effective_key,
               resume_candidate_id = v_last_candidate_id,
               resume_candidate_version = v_last_candidate_version,
               updated_at = public.match_result_alert_clock()
         where alert_kind = 'deadline';
      end if;
    end if;
  end loop;

  select state.resume_effective_key, state.resume_candidate_id,
         state.resume_candidate_version
    into v_resume_effective_key, v_resume_candidate_id, v_resume_candidate_version
    from public.match_result_alert_scan_state state
   where state.alert_kind = 'entry_ready'
   for update;
  if not found then raise exception 'Missing entry-ready alert scan state'; end if;
  v_now := public.match_result_alert_clock();
  v_resume_budget := (v_entry_ready_limit + 1) / 2;
  v_head_budget := v_entry_ready_limit - v_resume_budget;
  if v_max_examined >= v_entry_ready_limit then
    v_resume_exam_budget := v_max_examined - v_head_budget;
    v_head_exam_budget := v_head_budget;
  else
    v_resume_exam_budget := v_max_examined;
    v_head_exam_budget := 0;
  end if;
  v_resume_examined := 0;
  v_last_effective_key := null;
  v_last_candidate_id := null;
  v_last_candidate_version := 0;
  for v_scan_phase in 0..1 loop
    v_phase_claim_budget := case when v_scan_phase = 0
      then v_resume_budget else v_head_budget end;
    if v_phase_claim_budget = 0 then continue; end if;
    v_phase_claims := 0;
    for v_candidate in
    select queue.match_event_id, queue.due_at, queue.effective_key
      from public.match_result_alert_entry_ready_queue queue
      left join public.match_result_alert_processing_state state
        on state.alert_kind = 'entry_ready'
       and state.candidate_id = queue.match_event_id
       and state.candidate_version = 0
      left join public.match_result_alert_retry_fallback fallback
        on fallback.alert_kind = 'entry_ready'
       and fallback.candidate_id = queue.match_event_id
       and fallback.candidate_version = 0
      where queue.active
        and queue.due_at <= v_now
        and (queue.next_attempt_at is null or queue.next_attempt_at <= v_now)
        and (state.next_attempt_at is null or state.next_attempt_at <= v_now)
       and (fallback.updated_at is null or fallback.updated_at <= v_now - interval '1 second')
       and not exists (
         select 1 from public.match_event_result_entry_ready_dispatch dispatched
          where dispatched.match_event_id = queue.match_event_id
       )
       and not exists (
         select 1 from public.match_result_alert_processing_state terminal
          where terminal.alert_kind = 'entry_ready'
            and terminal.candidate_id = queue.match_event_id
            and terminal.candidate_version = 0
             and terminal.terminal_outcome = 'ineligible'
            and terminal.roster_fingerprint = public.match_result_entry_roster_fingerprint(
              queue.match_event_id
            )
        )
         and (v_scan_phase = 1 or v_resume_effective_key is null or
           (queue.effective_key, queue.match_event_id) >
           (v_resume_effective_key, v_resume_candidate_id))
       order by queue.effective_key, queue.match_event_id
        limit case when v_scan_phase = 0
          then v_resume_exam_budget else v_head_exam_budget end
        for update of queue skip locked
        loop

       if v_scan_phase = 0 then
        v_resume_examined := v_resume_examined + 1;
        v_last_effective_key := v_candidate.effective_key;
        v_last_candidate_id := v_candidate.match_event_id;
        v_last_candidate_version := 0;
      end if;

    v_claimed := false;
    begin
      v_event := public.lock_match_event_registration_skip_locked(v_candidate.match_event_id);
      v_claimed := v_event.id is not null;
    exception when lock_not_available then
      v_claimed := false;
    end;
    if not v_claimed then
      update public.match_result_alert_entry_ready_queue
         set next_attempt_at = public.match_result_alert_clock()
           + public.match_result_alert_lock_defer_interval(v_candidate.match_event_id)
       where match_event_id = v_candidate.match_event_id;
      continue;
    end if;

    v_entry_ready_claims := v_entry_ready_claims + 1;
    v_phase_claims := v_phase_claims + 1;
    if exists (
      select 1 from public.match_event_result_entry_ready_dispatch dispatched
       where dispatched.match_event_id = v_candidate.match_event_id
    ) then
      update public.match_result_alert_entry_ready_queue
         set active = false where match_event_id = v_candidate.match_event_id;
      exit when v_phase_claims >= v_phase_claim_budget;
      continue;
    end if;

    v_stored_fingerprint := null;
    select state.roster_fingerprint into v_stored_fingerprint
      from public.match_result_alert_processing_state state
     where state.alert_kind = 'entry_ready'
       and state.candidate_id = v_candidate.match_event_id
       and state.candidate_version = 0
        and state.terminal_outcome = 'ineligible';
    if found and v_stored_fingerprint = public.match_result_entry_roster_fingerprint(
      v_candidate.match_event_id
    ) then
      update public.match_result_alert_entry_ready_queue
         set active = false where match_event_id = v_candidate.match_event_id;
      exit when v_phase_claims >= v_phase_claim_budget;
      continue;
    end if;

    v_candidate_failed := false;
    v_sqlstate := null;
    begin
      if public.notify_match_result_entry_ready(v_candidate.match_event_id) then
        v_ready := v_ready + 1;
      end if;
      if exists (
        select 1 from public.match_event_result_entry_ready_dispatch dispatched
         where dispatched.match_event_id = v_candidate.match_event_id
      ) then
        update public.match_result_alert_entry_ready_queue
           set active = false where match_event_id = v_candidate.match_event_id;
      end if;
    exception when others then
      v_candidate_failed := true;
      v_sqlstate := SQLSTATE;
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'match_event_id', v_candidate.match_event_id,
        'kind', 'entry_ready', 'message', 'Result-entry alert failed; recovery policy applied.'
      );
    end;
    begin
      perform public.record_match_result_alert_attempt(
        'entry_ready', v_candidate.match_event_id, 0, v_candidate_failed, v_sqlstate
      );
    exception when others then
      begin
        perform public.record_match_result_alert_fallback(
          'entry_ready', v_candidate.match_event_id, 0, SQLSTATE
        );
      exception when others then null;
      end;
      if not v_candidate_failed then
        v_failed := v_failed + 1;
        v_errors := v_errors || pg_catalog.jsonb_build_object(
          'match_event_id', v_candidate.match_event_id,
          'kind', 'entry_ready_bookkeeping',
          'message', 'Result-entry alert attempt could not be recorded.'
        );
       end if;
     end;
     exit when v_phase_claims >= v_phase_claim_budget;
     end loop;

    if v_scan_phase = 0 then
      select exists (
       select 1
        from public.match_result_alert_entry_ready_queue queue
        left join public.match_result_alert_processing_state state
          on state.alert_kind = 'entry_ready'
         and state.candidate_id = queue.match_event_id
         and state.candidate_version = 0
        left join public.match_result_alert_retry_fallback fallback
          on fallback.alert_kind = 'entry_ready'
         and fallback.candidate_id = queue.match_event_id
         and fallback.candidate_version = 0
       where queue.active and queue.due_at <= v_now
         and (queue.next_attempt_at is null or queue.next_attempt_at <= v_now)
         and (state.next_attempt_at is null or state.next_attempt_at <= v_now)
         and (fallback.updated_at is null or fallback.updated_at <= v_now - interval '1 second')
         and not exists (
           select 1 from public.match_event_result_entry_ready_dispatch dispatched
            where dispatched.match_event_id = queue.match_event_id
         )
         and not exists (
           select 1 from public.match_result_alert_processing_state terminal
            where terminal.alert_kind = 'entry_ready'
              and terminal.candidate_id = queue.match_event_id
              and terminal.candidate_version = 0
              and terminal.terminal_outcome = 'ineligible'
              and terminal.roster_fingerprint = public.match_result_entry_roster_fingerprint(
                queue.match_event_id
              )
         )
          and (
            (v_resume_examined = 0 and (v_resume_effective_key is null or
              (queue.effective_key, queue.match_event_id) >
                (v_resume_effective_key, v_resume_candidate_id)))
            or (v_resume_examined > 0 and
              (queue.effective_key, queue.match_event_id) >
                (v_last_effective_key, v_last_candidate_id))
          )
      ) into v_has_more;
      if not v_has_more then
        update public.match_result_alert_scan_state
           set resume_effective_key = null, resume_candidate_id = null,
               resume_candidate_version = 0, updated_at = public.match_result_alert_clock()
         where alert_kind = 'entry_ready';
      elsif v_resume_examined > 0 then
        update public.match_result_alert_scan_state
           set resume_effective_key = v_last_effective_key,
               resume_candidate_id = v_last_candidate_id,
               resume_candidate_version = 0,
               updated_at = public.match_result_alert_clock()
         where alert_kind = 'entry_ready';
      end if;
    end if;
  end loop;

  return pg_catalog.jsonb_build_object(
    'reminders', v_reminders,
    'entry_ready', v_ready,
    'reminder_claims', v_reminder_claims,
    'entry_ready_claims', v_entry_ready_claims,
    'failed', v_failed,
    'errors', v_errors
  );
end $$;

revoke all on function public.process_match_result_lifecycle_alerts(integer, integer, integer)
  from public, anon, authenticated;

comment on function public.process_match_result_lifecycle_alerts(integer,integer,integer) is
  $sla$Conditional SLA: with producer limit L >= 2, resumeBudget=ceil(L/2) claims scan from the cursor and headBudget=floor(L/2) claims scan from queue head. Suffix candidates lose at most headBudget claims per run relative to an unsplit scan. A due head candidate is revisited within ceil(dueHeadCount/headBudget)+1 runs. For D due-or-deferred predecessors with smaller effective keys, C=headBudget and a candidate due at T dispatches by T + ceil(D/C)*interval + defer_max; interval=60s; defer_max=180s; D_max=3,000 concurrent deferred candidates per producer at default p_max_examined=1,000. Examination capacity is hard-reserved when p_max_examined >= claim limit: resume examines at most p_max_examined-headBudget rows, while head owns headBudget rows. Total examination remains bounded by p_max_examined; head receives its full reserved slots even when suffix rows are skipped by FOR UPDATE SKIP LOCKED. When p_max_examined < claim limit, insufficient capacity prevents the full reservation, so bounded scan remains resume-only. Assumes p_max_examined covers each producer's claim limit, claim capacity >= arrival rate, one-minute cadence, no overlapping runs, canonical event locks acquired promptly, and notification processing succeeds on claim. Event locks are transaction-scoped and short-lived; sustained simultaneous locks beyond scan capacity indicate a wedged system outside this SLA. Candidates remain due and process as locks clear. Quarantined retries count in D when due; lock and processing failures follow their own defer/quarantine bounds. Resume cursor advances when due suffix candidates remain after its last examined position, including claim-limit stops. With zero suffix candidates examined, preserve the prior cursor when an eligible suffix remains, including rows skipped by FOR UPDATE SKIP LOCKED; reset only when the resume scan observes an exhausted due tail. At or above claim limit, examination cap is partitioned between both phases rather than shared dynamically, and remains a safety valve, not fairness logic.$sla$;

commit;
