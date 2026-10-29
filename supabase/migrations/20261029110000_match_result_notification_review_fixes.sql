begin;

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
       or (v_command.payload ? ''proposal_id'' and v_command.payload <> v_payload) then');
    v_definition := replace(v_definition,
      'if v_command.action <> ''correct_result'' or v_command.payload <> v_payload then',
      'if v_command.action <> ''correct_result''
       or v_command.result ->> ''proposal_id'' is distinct from p_proposal_id::text
       or (v_command.payload ? ''proposal_id'' and v_command.payload <> v_payload) then');
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
  v_event := public.lock_match_event_registration(v_event_id);
  select p.* into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;
  if not found or v_proposal.active_version <> p_proposal_version
    or v_proposal.status <> 'pending'
    or v_proposal.review_deadline_at <= pg_catalog.clock_timestamp() then
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
begin
  v_event := public.lock_match_event_registration(p_match_event_id);
  if v_event.id is null or v_event.status <> 'open' then return false; end if;
  if not exists (
    select 1 from public.match_event_registrations registration
     where registration.match_event_id = v_event.id
       and registration.lifecycle = 'accepted'
       and registration.cancelled_at is null
       and registration.participation_status = 'playing'
     group by registration.match_event_id having count(*) >= 4
  ) then
    return false;
  end if;
  if (v_event.starts_at + case when v_event.duration_minutes is null then interval '0 minutes'
       else pg_catalog.make_interval(mins => v_event.duration_minutes) end)
       > pg_catalog.clock_timestamp() then return false; end if;

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

-- Per-candidate bounded retry state for reminder and entry-ready producers.
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
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (alert_kind, candidate_id, candidate_version),
  check ((last_failure_code is null) = (last_failure_message is null)),
  check ((last_failure_code is null) = (next_attempt_at is null))
);
alter table public.match_result_alert_processing_state enable row level security;
revoke all on public.match_result_alert_processing_state from public, anon, authenticated;

create function public.record_match_result_alert_attempt(
  p_kind text, p_candidate_id uuid, p_version bigint, p_failed boolean,
  p_failure_code text default null
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_failure_count integer;
  v_code text;
begin
  v_code := case when p_failed and p_failure_code ~ '^[A-Z0-9_]{1,80}$'
    then p_failure_code when p_failed then 'PROCESSING_ERROR' else null end;
  insert into public.match_result_alert_processing_state(
    alert_kind, candidate_id, candidate_version, attempt_count, failure_count,
    attempted_at, next_attempt_at, last_failure_code, last_failure_message, updated_at
  ) values (
    p_kind, p_candidate_id, coalesce(p_version, 0), 1,
    case when p_failed then 1 else 0 end,
    pg_catalog.clock_timestamp(),
    case when p_failed then pg_catalog.clock_timestamp() + interval '30 seconds' end,
    v_code,
    case when p_failed then 'Lifecycle alert failed; retry is scheduled.' end,
    pg_catalog.clock_timestamp()
  ) on conflict (alert_kind, candidate_id, candidate_version) do update
    set attempt_count = public.match_result_alert_processing_state.attempt_count + 1,
        failure_count = case when p_failed then public.match_result_alert_processing_state.failure_count + 1 else 0 end,
        attempted_at = pg_catalog.clock_timestamp(),
        next_attempt_at = case when p_failed then pg_catalog.clock_timestamp()
          + pg_catalog.make_interval(secs => least(300, 30 * pg_catalog.power(
            2, least(public.match_result_alert_processing_state.failure_count, 4)))::integer) end,
        last_failure_code = v_code,
        last_failure_message = case when p_failed then 'Lifecycle alert failed; retry is scheduled.' end,
        updated_at = pg_catalog.clock_timestamp();
end $$;
revoke all on function public.record_match_result_alert_attempt(text,uuid,bigint,boolean,text)
  from public, anon, authenticated;

-- Add backoff filtering and least-attempted/oldest fairness to both independent
-- bounded scans. Each producer's existing exception block is a per-item savepoint.
do $migration$
declare
  v_original text;
  v_definition text;
begin
  v_original := pg_catalog.pg_get_functiondef(
    'public.process_match_result_lifecycle_alerts(integer,integer)'::regprocedure
  );
  v_definition := replace(v_original,
    'where p.status = ''pending''',
    E'where p.status = ''pending''\n        and not exists (select 1 from public.match_result_alert_processing_state retry\n          where retry.alert_kind = ''deadline'' and retry.candidate_id = p.id\n            and retry.candidate_version = p.active_version\n            and retry.next_attempt_at > pg_catalog.clock_timestamp())');
  v_definition := replace(v_definition,
    'order by p.review_deadline_at, p.id',
    E'order by coalesce((select retry.attempt_count from public.match_result_alert_processing_state retry\n          where retry.alert_kind = ''deadline'' and retry.candidate_id = p.id\n            and retry.candidate_version = p.active_version), 0), p.review_deadline_at, p.id');
  v_definition := replace(v_definition,
    'order by e.starts_at, e.id',
    E'order by coalesce((select retry.attempt_count from public.match_result_alert_processing_state retry\n          where retry.alert_kind = ''entry_ready'' and retry.candidate_id = e.id\n            and retry.candidate_version = 0), 0), e.starts_at, e.id');
  v_definition := replace(v_definition,
    E'v_reminders := v_reminders + public.notify_match_result_deadline(\n         v_candidate.proposal_id, v_candidate.active_version\n       );',
    E'v_reminders := v_reminders + public.notify_match_result_deadline(\n         v_candidate.proposal_id, v_candidate.active_version\n       );\n       perform public.record_match_result_alert_attempt(''deadline'', v_candidate.proposal_id, v_candidate.active_version, false);');
  v_definition := replace(v_definition,
    E'v_ready := v_ready + 1;\n       end if;',
    E'v_ready := v_ready + 1;\n       end if;\n       perform public.record_match_result_alert_attempt(''entry_ready'', v_candidate.match_event_id, 0, false);');
  v_definition := replace(v_definition,
    E'exception when others then\n       v_failed := v_failed + 1;\n       v_errors := v_errors || pg_catalog.jsonb_build_object(\n         ''proposal_id'', v_candidate.proposal_id,',
    E'exception when others then\n       perform public.record_match_result_alert_attempt(''deadline'', v_candidate.proposal_id, v_candidate.active_version, true, SQLSTATE);\n       v_failed := v_failed + 1;\n       v_errors := v_errors || pg_catalog.jsonb_build_object(\n         ''proposal_id'', v_candidate.proposal_id,');
  v_definition := replace(v_definition,
    E'exception when others then\n       v_failed := v_failed + 1;\n       v_errors := v_errors || pg_catalog.jsonb_build_object(\n         ''match_event_id'', v_candidate.match_event_id,',
    E'exception when others then\n       perform public.record_match_result_alert_attempt(''entry_ready'', v_candidate.match_event_id, 0, true, SQLSTATE);\n       v_failed := v_failed + 1;\n       v_errors := v_errors || pg_catalog.jsonb_build_object(\n         ''match_event_id'', v_candidate.match_event_id,');
  v_definition := replace(v_definition,
    'where e.status = ''open''',
    E'where e.status = ''open''\n        and not exists (select 1 from public.match_result_alert_processing_state retry\n          where retry.alert_kind = ''entry_ready'' and retry.candidate_id = e.id\n            and retry.candidate_version = 0\n            and retry.next_attempt_at > pg_catalog.clock_timestamp())');
  if v_definition = v_original then
    raise exception 'Unable to install alert retry fairness';
  end if;
  execute v_definition;
end
$migration$;

-- Install the final producer definition explicitly: the preceding structural
-- substitutions vary with pg_get_functiondef formatting across PostgreSQL builds.
create or replace function public.process_match_result_lifecycle_alerts(
  p_reminder_limit integer default 25,
  p_entry_ready_limit integer default 25
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_reminder_limit integer := least(greatest(coalesce(p_reminder_limit, 25), 1), 100);
  v_entry_ready_limit integer := least(greatest(coalesce(p_entry_ready_limit, 25), 1), 100);
  v_candidate record;
  v_reminders integer := 0;
  v_ready integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
  v_sqlstate text;
begin
  for v_candidate in
    select p.id as proposal_id, p.active_version
      from public.match_event_result_proposals p
      join public.match_event_result_proposal_versions version
        on version.proposal_id = p.id and version.version = p.active_version
     where p.status = 'pending'
       and p.review_deadline_at > pg_catalog.clock_timestamp()
       and p.review_deadline_at <= pg_catalog.clock_timestamp() + interval '6 hours'
       and not exists (
         select 1 from public.match_result_alert_processing_state retry
          where retry.alert_kind = 'deadline' and retry.candidate_id = p.id
            and retry.candidate_version = p.active_version
            and retry.next_attempt_at > pg_catalog.clock_timestamp()
       )
       and exists (
         select 1 from (
           select pg_catalog.jsonb_array_elements_text(version.teams -> 'team_a')::uuid as user_id
           union
           select pg_catalog.jsonb_array_elements_text(version.teams -> 'team_b')::uuid
         ) reviewers
          where reviewers.user_id <> version.submitted_by
            and not exists (
              select 1 from public.match_event_result_reviews review
               where review.proposal_id = p.id and review.proposal_version = p.active_version
                 and review.reviewer_user_id = reviewers.user_id and review.decision = 'approve'
            )
            and not exists (
              select 1 from public.notifications notification
               where notification.recipient_user_id = reviewers.user_id
                 and notification.event_key = 'result.deadline:' || p.id::text
                   || ':v' || p.active_version::text
            )
       )
     order by coalesce((
       select retry.attempt_count from public.match_result_alert_processing_state retry
        where retry.alert_kind = 'deadline' and retry.candidate_id = p.id
          and retry.candidate_version = p.active_version
     ), 0), p.review_deadline_at, p.id
     limit v_reminder_limit
  loop
    begin
      v_reminders := v_reminders + public.notify_match_result_deadline(
        v_candidate.proposal_id, v_candidate.active_version
      );
      perform public.record_match_result_alert_attempt(
        'deadline', v_candidate.proposal_id, v_candidate.active_version, false
      );
    exception when others then
      v_sqlstate := SQLSTATE;
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'proposal_id', v_candidate.proposal_id, 'version', v_candidate.active_version,
        'kind', 'deadline', 'message', 'Result reminder failed; retry is scheduled.'
      );
      perform public.record_match_result_alert_attempt(
        'deadline', v_candidate.proposal_id, v_candidate.active_version, true, v_sqlstate
      );
    end;
  end loop;

  for v_candidate in
    select e.id as match_event_id
      from public.match_events e
      join public.match_event_registrations registration on registration.match_event_id = e.id
     where e.status = 'open'
       and registration.lifecycle = 'accepted' and registration.cancelled_at is null
       and registration.participation_status = 'playing'
       and e.starts_at + pg_catalog.make_interval(mins => coalesce(e.duration_minutes, 0))
         <= pg_catalog.clock_timestamp()
       and not exists (
         select 1 from public.match_result_alert_processing_state retry
          where retry.alert_kind = 'entry_ready' and retry.candidate_id = e.id
            and retry.candidate_version = 0
            and retry.next_attempt_at > pg_catalog.clock_timestamp()
       )
       and not exists (
         select 1 from public.match_event_result_entry_ready_dispatch dispatched
          where dispatched.match_event_id = e.id
       )
     group by e.id
    having count(*) >= 4
     order by coalesce((
       select retry.attempt_count from public.match_result_alert_processing_state retry
        where retry.alert_kind = 'entry_ready' and retry.candidate_id = e.id
          and retry.candidate_version = 0
     ), 0), e.starts_at, e.id
     limit v_entry_ready_limit
  loop
    begin
      if public.notify_match_result_entry_ready(v_candidate.match_event_id) then
        v_ready := v_ready + 1;
      end if;
      perform public.record_match_result_alert_attempt(
        'entry_ready', v_candidate.match_event_id, 0, false
      );
    exception when others then
      v_sqlstate := SQLSTATE;
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'match_event_id', v_candidate.match_event_id,
        'kind', 'entry_ready', 'message', 'Result-entry alert failed; retry is scheduled.'
      );
      perform public.record_match_result_alert_attempt(
        'entry_ready', v_candidate.match_event_id, 0, true, v_sqlstate
      );
    end;
  end loop;
  return pg_catalog.jsonb_build_object(
    'reminders', v_reminders, 'entry_ready', v_ready, 'failed', v_failed, 'errors', v_errors
  );
end $$;

commit;
