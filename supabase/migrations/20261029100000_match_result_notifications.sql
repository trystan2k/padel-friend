begin;

-- T08.6: keep result alerts in the lifecycle transaction and preserve their
-- exact immutable version outside the generic notification payload.
alter table public.match_event_result_confirmations
  add constraint match_result_confirmation_notification_identity
    unique (id, proposal_id, proposal_version);

create table public.notification_result_links (
  notification_id uuid primary key
    references public.notifications(id) on delete cascade,
  match_event_id uuid not null
    references public.match_events(id) on delete cascade,
  proposal_id uuid not null,
  proposal_version bigint not null,
  confirmation_id uuid,
  constraint notification_result_link_version_fk
    foreign key (proposal_id, proposal_version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete restrict,
  constraint notification_result_link_confirmation_fk
    foreign key (confirmation_id, proposal_id, proposal_version)
    references public.match_event_result_confirmations(id, proposal_id, proposal_version)
    on delete restrict
);
comment on table public.notification_result_links is
  'Internal immutable association from recipient-scoped result notification to its exact proposal version and optional confirmation identity.';

create table public.match_event_result_entry_ready_dispatch (
  match_event_id uuid primary key
    references public.match_events(id) on delete cascade,
  creator_user_id uuid not null references auth.users(id) on delete cascade,
  notification_id uuid not null unique
    references public.notifications(id) on delete cascade,
  dispatched_at timestamptz not null default pg_catalog.clock_timestamp()
);
comment on table public.match_event_result_entry_ready_dispatch is
  'Internal once-per-event claim for the result-entry-ready alert to the event creator current at dispatch.';

alter table public.notification_result_links enable row level security;
alter table public.match_event_result_entry_ready_dispatch enable row level security;
revoke all on public.notification_result_links,
  public.match_event_result_entry_ready_dispatch from public, anon, authenticated;

create function public.persist_match_result_notification(
  p_recipient_user_id uuid,
  p_event_key text,
  p_kind text,
  p_match_event_id uuid,
  p_community_id uuid,
  p_proposal_id uuid,
  p_proposal_version bigint,
  p_confirmation_id uuid default null
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_notification_id uuid;
  v_link public.notification_result_links%rowtype;
begin
  v_notification_id := public.persist_notification(
    p_recipient_user_id,
    p_event_key,
    p_kind,
    'results',
    'result_available',
    p_match_event_id,
    p_community_id
  );

  insert into public.notification_result_links(
    notification_id, match_event_id, proposal_id, proposal_version, confirmation_id
  ) values (
    v_notification_id, p_match_event_id, p_proposal_id, p_proposal_version, p_confirmation_id
  ) on conflict (notification_id) do nothing;

  select link.* into v_link
    from public.notification_result_links link
   where link.notification_id = v_notification_id;
  if (v_link.match_event_id, v_link.proposal_id, v_link.proposal_version, v_link.confirmation_id)
    is distinct from (p_match_event_id, p_proposal_id, p_proposal_version, p_confirmation_id) then
    raise exception 'RESULT_NOTIFICATION_LINK_CONFLICT' using errcode = '23505';
  end if;
  return v_notification_id;
end $$;

create function public.notify_match_result_version(
  p_proposal_id uuid,
  p_proposal_version bigint
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_community_id uuid;
  v_creator_id uuid;
  v_version public.match_event_result_proposal_versions%rowtype;
  v_recipient record;
  v_kind text;
  v_count integer := 0;
begin
  select p.match_event_id, e.community_id, e.created_by
    into v_event_id, v_community_id, v_creator_id
    from public.match_event_result_proposals p
    join public.match_events e on e.id = p.match_event_id
   where p.id = p_proposal_id;
  if not found then
    raise exception 'RESULT_NOTIFICATION_PROPOSAL_UNAVAILABLE' using errcode = '23503';
  end if;
  select version.* into v_version
    from public.match_event_result_proposal_versions version
   where version.proposal_id = p_proposal_id and version.version = p_proposal_version;
  if not found then
    raise exception 'RESULT_NOTIFICATION_VERSION_UNAVAILABLE' using errcode = '23503';
  end if;

  for v_recipient in
    select recipients.user_id, pg_catalog.bool_or(recipients.is_player) as is_player
      from (
        select pg_catalog.jsonb_array_elements_text(v_version.teams -> 'team_a')::uuid as user_id,
               true as is_player
        union all
        select pg_catalog.jsonb_array_elements_text(v_version.teams -> 'team_b')::uuid,
               true
        union all
        select v_creator_id, false
      ) recipients
     group by recipients.user_id
  loop
    v_kind := case
      when v_recipient.is_player
        and v_recipient.user_id <> v_version.submitted_by
        and v_version.review_deadline_at > pg_catalog.clock_timestamp()
        then 'result_review_needed'
      when v_version.version = 1 then 'result_added'
      else 'result_corrected'
    end;
    perform public.persist_match_result_notification(
      v_recipient.user_id,
      'result.submitted:' || p_proposal_id::text || ':v' || p_proposal_version::text,
      v_kind,
      v_event_id,
      v_community_id,
      p_proposal_id,
      p_proposal_version
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.notify_match_result_lifecycle(
  p_proposal_id uuid,
  p_proposal_version bigint,
  p_event_key text,
  p_kind text,
  p_confirmation_id uuid default null
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_community_id uuid;
  v_creator_id uuid;
  v_teams jsonb;
  v_recipient uuid;
  v_count integer := 0;
begin
  select p.match_event_id, e.community_id, e.created_by, version.teams
    into v_event_id, v_community_id, v_creator_id, v_teams
    from public.match_event_result_proposals p
    join public.match_events e on e.id = p.match_event_id
    join public.match_event_result_proposal_versions version
      on version.proposal_id = p.id and version.version = p_proposal_version
   where p.id = p_proposal_id;
  if not found then
    raise exception 'RESULT_NOTIFICATION_VERSION_UNAVAILABLE' using errcode = '23503';
  end if;

  for v_recipient in
    select recipients.user_id from (
      select pg_catalog.jsonb_array_elements_text(v_teams -> 'team_a')::uuid as user_id
      union
      select pg_catalog.jsonb_array_elements_text(v_teams -> 'team_b')::uuid
      union
      select v_creator_id
    ) recipients
  loop
    perform public.persist_match_result_notification(
      v_recipient, p_event_key, p_kind, v_event_id, v_community_id,
      p_proposal_id, p_proposal_version, p_confirmation_id
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.notify_match_result_version_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_match_result_version(new.proposal_id, new.version);
  return new;
end $$;
create trigger match_result_version_notification
  after insert on public.match_event_result_proposal_versions
  for each row execute function public.notify_match_result_version_insert();

create function public.notify_match_result_rejection()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.decision <> 'reject' then return new; end if;
  perform public.notify_match_result_lifecycle(
    new.proposal_id,
    new.proposal_version,
    'result.disputed:' || new.proposal_id::text || ':v' || new.proposal_version::text,
    'result_disputed'
  );
  return new;
end $$;
create trigger match_result_rejection_notification
  after insert on public.match_event_result_reviews
  for each row execute function public.notify_match_result_rejection();

create function public.notify_match_result_confirmation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  perform public.notify_match_result_lifecycle(
    new.proposal_id,
    new.proposal_version,
    'result.confirmed:' || new.id::text,
    'result_confirmed',
    new.id
  );
  return new;
end $$;
create trigger match_result_confirmation_notification
  after insert on public.match_event_result_confirmations
  for each row execute function public.notify_match_result_confirmation();

create function public.notify_match_result_deadline(
  p_proposal_id uuid,
  p_proposal_version bigint
) returns integer language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_community_id uuid;
  v_version public.match_event_result_proposal_versions%rowtype;
  v_recipient uuid;
  v_key text := 'result.deadline:' || p_proposal_id::text || ':v' || p_proposal_version::text;
  v_count integer := 0;
begin
  select p.match_event_id, e.community_id
    into v_event_id, v_community_id
    from public.match_event_result_proposals p
    join public.match_events e on e.id = p.match_event_id
    join public.match_event_result_proposal_versions version
      on version.proposal_id = p.id and version.version = p_proposal_version
   where p.id = p_proposal_id and p.active_version = p_proposal_version
     and p.status = 'pending'
     and p.review_deadline_at = version.review_deadline_at
     and p.review_deadline_at > pg_catalog.clock_timestamp();
  if not found then return 0; end if;
  select version.* into v_version
    from public.match_event_result_proposal_versions version
   where version.proposal_id = p_proposal_id and version.version = p_proposal_version;
  if not found then return 0; end if;

  for v_recipient in
    select pg_catalog.jsonb_array_elements_text(v_version.teams -> 'team_a')::uuid
    union
    select pg_catalog.jsonb_array_elements_text(v_version.teams -> 'team_b')::uuid
  loop
    if v_recipient = v_version.submitted_by then continue; end if;
    if exists (
      select 1 from public.match_event_result_reviews review
       where review.proposal_id = p_proposal_id
         and review.proposal_version = p_proposal_version
         and review.reviewer_user_id = v_recipient
         and review.decision = 'approve'
    ) then
      continue;
    end if;
    perform public.persist_match_result_notification(
      v_recipient, v_key, 'result_deadline_reminder',
      v_event_id, v_community_id, p_proposal_id, p_proposal_version, null
    );
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create function public.notify_match_result_entry_ready(p_match_event_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_notification_id uuid;
begin
  select e.* into v_event from public.match_events e where e.id = p_match_event_id;
  if not found then return false; end if;
  if not exists (
    select 1
      from public.match_event_registration_state state
      join public.match_event_registrations registration
        on registration.match_event_id = state.match_event_id
     where state.match_event_id = v_event.id
       and state.results_protected_at is not null
       and registration.lifecycle = 'accepted'
       and registration.cancelled_at is null
       and registration.participation_status = 'playing'
     group by state.match_event_id
    having count(*) >= 4
  ) or v_event.starts_at + pg_catalog.make_interval(
    mins => coalesce(v_event.duration_minutes, 0)
  ) > pg_catalog.clock_timestamp() then
    return false;
  end if;

  v_notification_id := public.persist_notification(
    v_event.created_by,
    'result.entry_ready:' || v_event.id::text,
    'result_entry_ready',
    'results',
    'match_event',
    v_event.id,
    v_event.community_id
  );
  insert into public.match_event_result_entry_ready_dispatch(
    match_event_id, creator_user_id, notification_id
  ) values (v_event.id, v_event.created_by, v_notification_id)
  on conflict (match_event_id) do nothing;
  return found;
end $$;

create function public.process_match_result_lifecycle_alerts(
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
begin
  for v_candidate in
    select p.id as proposal_id, p.active_version
      from public.match_event_result_proposals p
      join public.match_event_result_proposal_versions version
        on version.proposal_id = p.id and version.version = p.active_version
     where p.status = 'pending'
       and p.review_deadline_at > pg_catalog.clock_timestamp()
       and p.review_deadline_at <= pg_catalog.clock_timestamp() + interval '6 hours'
       and exists (
         select 1
           from (
             select pg_catalog.jsonb_array_elements_text(version.teams -> 'team_a')::uuid as user_id
             union
             select pg_catalog.jsonb_array_elements_text(version.teams -> 'team_b')::uuid
           ) reviewers
          where reviewers.user_id <> version.submitted_by
            and not exists (
              select 1 from public.match_event_result_reviews review
               where review.proposal_id = p.id
                 and review.proposal_version = p.active_version
                 and review.reviewer_user_id = reviewers.user_id
                 and review.decision = 'approve'
            )
            and not exists (
              select 1 from public.notifications notification
               where notification.recipient_user_id = reviewers.user_id
                 and notification.event_key = 'result.deadline:' || p.id::text
                   || ':v' || p.active_version::text
            )
       )
     order by p.review_deadline_at, p.id
     limit v_reminder_limit
  loop
    begin
      v_reminders := v_reminders + public.notify_match_result_deadline(
        v_candidate.proposal_id, v_candidate.active_version
      );
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'proposal_id', v_candidate.proposal_id,
        'version', v_candidate.active_version,
        'kind', 'deadline',
        'message', 'Result reminder failed; retry is scheduled.'
      );
    end;
  end loop;

  for v_candidate in
    select e.id as match_event_id
      from public.match_events e
      join public.match_event_registration_state state on state.match_event_id = e.id
      join public.match_event_registrations registration
        on registration.match_event_id = e.id
     where state.results_protected_at is not null
       and registration.lifecycle = 'accepted'
       and registration.cancelled_at is null
       and registration.participation_status = 'playing'
       and e.starts_at + pg_catalog.make_interval(mins => coalesce(e.duration_minutes, 0))
         <= pg_catalog.clock_timestamp()
       and not exists (
         select 1 from public.match_event_result_entry_ready_dispatch dispatched
          where dispatched.match_event_id = e.id
       )
     group by e.id
    having count(*) >= 4
     order by e.starts_at, e.id
     limit v_entry_ready_limit
  loop
    begin
      if public.notify_match_result_entry_ready(v_candidate.match_event_id) then
        v_ready := v_ready + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'match_event_id', v_candidate.match_event_id,
        'kind', 'entry_ready',
        'message', 'Result-entry alert failed; retry is scheduled.'
      );
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'reminders', v_reminders,
    'entry_ready', v_ready,
    'failed', v_failed,
    'errors', v_errors
  );
end $$;

create function public.get_my_result_notification_contexts(p_notification_ids uuid[])
returns table(
  notification_id uuid,
  notification_kind text,
  match_event_id uuid,
  community_id uuid,
  proposal_id uuid,
  proposal_version bigint,
  group_number bigint,
  proposal_status text,
  current_version bigint,
  current_status text,
  is_current boolean,
  classification text,
  winner_sets integer,
  loser_sets integer,
  score text,
  submitted_by_name text,
  review_deadline_at timestamptz,
  venue text,
  starts_at timestamptz,
  timezone text,
  entry_ready boolean
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
begin
  if v_actor_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if coalesce(cardinality(p_notification_ids), 0) > 50 then
    raise exception 'Page too large' using errcode = '22023';
  end if;

  return query
  select n.id, n.kind, e.id, e.community_id, p.id, link.proposal_version,
         p.group_number,
         case when p.active_version = link.proposal_version then p.status else 'superseded' end,
         p.active_version, p.status, p.active_version = link.proposal_version,
         version.classification,
         case
           when version.classification = 'team_a' then set_totals.team_a_sets
           when version.classification = 'team_b' then set_totals.team_b_sets
           else null::integer
         end,
         case
           when version.classification = 'team_a' then set_totals.team_b_sets
           when version.classification = 'team_b' then set_totals.team_a_sets
           else null::integer
         end,
         (select pg_catalog.string_agg(
            (set_row.value ->> 'team_a_games') || '–' || (set_row.value ->> 'team_b_games'),
            ', ' order by set_row.ordinality
          ) from pg_catalog.jsonb_array_elements(version.sets)
              with ordinality as set_row(value, ordinality)),
         submitter.display_name, version.review_deadline_at,
         e.venue_name, e.starts_at, e.timezone, false
    from public.notifications n
    join public.notification_result_links link on link.notification_id = n.id
    join public.match_event_result_proposals p on p.id = link.proposal_id
    join public.match_events e on e.id = p.match_event_id
      and e.id = link.match_event_id
      and e.id = n.target_id
      and e.community_id is not distinct from n.community_id
    join public.match_event_result_proposal_versions version
      on version.proposal_id = link.proposal_id
     and version.version = link.proposal_version
    left join public.player_profiles submitter on submitter.user_id = version.submitted_by
    -- Stored classification and these counts share the immutable sets facts;
    -- count completed set wins using classify_match_result_sets' predicate.
    left join lateral (
      select
        (count(*) filter (where (set_row.value ->> 'completed')::boolean
          and (set_row.value ->> 'team_a_games')::integer
            > (set_row.value ->> 'team_b_games')::integer))::integer as team_a_sets,
        (count(*) filter (where (set_row.value ->> 'completed')::boolean
          and (set_row.value ->> 'team_b_games')::integer
            > (set_row.value ->> 'team_a_games')::integer))::integer as team_b_sets
      from pg_catalog.jsonb_array_elements(
        case when pg_catalog.jsonb_typeof(version.sets) = 'array'
          then version.sets else '[]'::jsonb end
      ) as set_row(value)
    ) set_totals on true
   where n.id = any(coalesce(p_notification_ids, '{}'::uuid[]))
     and n.recipient_user_id = v_actor_id
     and n.category = 'results'
     and n.target_type = 'result_available'
     and n.kind in ('result_review_needed', 'result_added', 'result_corrected',
       'result_disputed', 'result_confirmed', 'result_deadline_reminder')
     and (
       e.created_by = v_actor_id
       or public.is_community_admin(e.community_id)
       or exists (
         select 1 from public.match_event_registrations r
          where r.match_event_id = e.id
            and r.user_id = v_actor_id
            and r.lifecycle = 'accepted'
            and r.cancelled_at is null
       )
     )
  union all
  select n.id, n.kind, e.id, e.community_id, null::uuid, null::bigint,
         null::bigint, null::text, null::bigint, null::text, true,
         null::text, null::integer, null::integer, null::text, null::text,
         null::timestamptz, e.venue_name, e.starts_at, e.timezone, true
    from public.notifications n
    join public.match_event_result_entry_ready_dispatch dispatch
      on dispatch.notification_id = n.id
     and dispatch.creator_user_id = n.recipient_user_id
    join public.match_events e on e.id = dispatch.match_event_id
      and e.id = n.target_id
      and e.community_id is not distinct from n.community_id
   where n.id = any(coalesce(p_notification_ids, '{}'::uuid[]))
     and n.recipient_user_id = v_actor_id
     and n.category = 'results'
     and n.target_type = 'match_event'
     and n.kind = 'result_entry_ready'
     and (
       e.created_by = v_actor_id
       or public.is_community_admin(e.community_id)
       or exists (
         select 1 from public.match_event_registrations r
          where r.match_event_id = e.id
            and r.user_id = v_actor_id
            and r.lifecycle = 'accepted'
            and r.cancelled_at is null
       )
     );
end $$;

create function public.get_my_notification_target_v3(p_notification_id uuid)
returns table(
  target_status text,
  community_id uuid,
  community_name text,
  invitation_id uuid,
  membership_status text,
  match_event_id uuid,
  match_available boolean,
  kind text,
  created_at timestamptz,
  result_context jsonb
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_notification public.notifications%rowtype;
  v_legacy record;
  v_result record;
begin
  if v_actor_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select n.* into v_notification from public.notifications n
   where n.id = p_notification_id and n.recipient_user_id = v_actor_id;
  if not found then raise exception 'Notification unavailable' using errcode = '42501'; end if;

  select result_context.* into v_result
    from public.get_my_result_notification_contexts(array[p_notification_id]) result_context
   limit 1;
  if found then
    return query select 'result_available', null::uuid, null::text, null::uuid, null::text,
      v_result.match_event_id, true, v_notification.kind, v_notification.created_at,
      pg_catalog.to_jsonb(v_result);
    return;
  end if;

  select target.* into v_legacy
    from public.get_my_notification_target_v2(p_notification_id) target;
  return query select v_legacy.target_status, v_legacy.community_id, v_legacy.community_name,
    v_legacy.invitation_id, v_legacy.membership_status, v_legacy.match_event_id,
    v_legacy.match_available, v_notification.kind, v_notification.created_at, null::jsonb;
end $$;

create function public.validate_result_notification_link()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_notification public.notifications%rowtype;
begin
  select n.* into v_notification from public.notifications n
   where n.id = new.notification_id;
  if not found or v_notification.category <> 'results'
    or v_notification.target_type <> 'result_available'
    or v_notification.target_id <> new.match_event_id then
    raise exception 'Result notification link does not match its event target'
      using errcode = '23514';
  end if;
  return new;
end $$;
create trigger notification_result_link_identity
  before insert or update on public.notification_result_links
  for each row execute function public.validate_result_notification_link();

-- The reminder/readiness work runs after due confirmation candidates and has
-- independent caps. Per-item exceptions are isolated inside the producer.
do $integrate$
declare
  v_original text;
  v_definition text;
begin
  v_original := pg_catalog.pg_get_functiondef(
    'public.process_due_match_event_results(integer)'::regprocedure
  );
  v_definition := replace(
    v_original,
    $old$  v_errors jsonb := '[]'::jsonb;$old$,
    $new$  v_errors jsonb := '[]'::jsonb;
  v_alerts jsonb;$new$
  );
  if v_definition = v_original then
    raise exception 'Unexpected due processor declaration; refusing to omit lifecycle alerts';
  end if;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    $old$  return pg_catalog.jsonb_build_object($old$,
    $new$  begin
    v_alerts := public.process_match_result_lifecycle_alerts(25, 25);
  exception when others then
    v_alerts := pg_catalog.jsonb_build_object(
      'failed', 1,
      'message', 'Lifecycle alerts failed; retry is scheduled.'
    );
  end;
  return pg_catalog.jsonb_build_object($new$
  );
  if v_definition = v_original then
    raise exception 'Unexpected due processor return; refusing to omit lifecycle alerts';
  end if;
  v_original := v_definition;
  v_definition := replace(
    v_definition,
    $old$    'errors', v_errors
  );$old$,
    $new$    'errors', v_errors,
    'alerts', v_alerts
  );$new$
  );
  if v_definition = v_original then
    raise exception 'Unexpected due processor result; refusing to omit lifecycle alert status';
  end if;
  execute v_definition;
end
$integrate$;

revoke all on function public.persist_match_result_notification(uuid, text, text, uuid, uuid, uuid, bigint, uuid),
  public.notify_match_result_version(uuid, bigint),
  public.notify_match_result_lifecycle(uuid, bigint, text, text, uuid),
  public.notify_match_result_version_insert(),
  public.notify_match_result_rejection(),
  public.notify_match_result_confirmation(),
  public.notify_match_result_deadline(uuid, bigint),
  public.notify_match_result_entry_ready(uuid),
  public.process_match_result_lifecycle_alerts(integer, integer),
  public.get_my_result_notification_contexts(uuid[]),
  public.get_my_notification_target_v3(uuid),
  public.validate_result_notification_link()
  from public, anon, authenticated;
grant execute on function public.get_my_result_notification_contexts(uuid[]),
  public.get_my_notification_target_v3(uuid) to authenticated;

-- Seed only each currently Pending active version. Disputed and confirmed
-- history is never replayed, and the deterministic key makes reruns harmless.
do $backfill$
declare
  v_pending record;
begin
  for v_pending in
    select p.id, p.active_version
      from public.match_event_result_proposals p
      join public.match_event_result_proposal_versions version
        on version.proposal_id = p.id and version.version = p.active_version
     where p.status = 'pending'
     order by p.id
  loop
    perform public.notify_match_result_version(v_pending.id, v_pending.active_version);
  end loop;
end
$backfill$;

commit;
