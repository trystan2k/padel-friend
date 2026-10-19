begin;

-- PAF-5.4: cutoff lifecycle and exactly-once alerts.
--
-- One internal per-event processor expires every still-pending request and
-- reconciles the accepted roster so only the residual Reserve becomes
-- Reserve Not Playing; complete quartets stay playable, accepted order is never
-- renumbered and the event is never cancelled, deleted or auto-closed. The
-- transition, its notification effects and the cutoff_processed_at marker are
-- written in the same transaction under the canonical lock order
-- (community -> match event -> registration state -> affected registration
-- rows). A restricted bounded batch processor runs one small batch, isolating
-- each event in its own exception subtransaction and skipping events it cannot
-- lock immediately. The unattended schedule (pg_cron, 1-minute cadence) lives in
-- the separate scheduler migration.

-- 1. Cheap due-event selection. The unprocessed partial index narrows the batch
-- to events whose cutoff marker is still unset; the cutoff index serves the
-- "became due" range scan and its ordering.
create index match_events_registration_cutoff_due
  on public.match_events (registration_cutoff_at, id);
create index match_event_registration_state_unprocessed
  on public.match_event_registration_state (match_event_id) where cutoff_processed_at is null;

-- Durable processor bookkeeping on the per-event state row.
--   * cutoff_attempt_count / cutoff_last_attempt_at are the fairness cursor:
--     every selected event is stamped, so an event that keeps failing or
--     staying lock-skipped rotates behind the never-attempted ones instead of
--     pinning the oldest-first prefix and starving the rest.
--   * the cutoff_failure_* columns retain the last per-event failure so an
--     operator can see WHICH event failed and why long after the cron run:
--     pg_cron only records "1 row" for a successful command, so the batch's
--     returned errors JSON never survives in cron.job_run_details.
alter table public.match_event_registration_state
  add column cutoff_attempt_count bigint not null default 0 check (cutoff_attempt_count >= 0),
  add column cutoff_last_attempt_at timestamptz,
  add column cutoff_failure_count bigint not null default 0 check (cutoff_failure_count >= 0),
  add column cutoff_last_failure_at timestamptz,
  add column cutoff_last_failure_sqlstate text,
  add column cutoff_last_failure_message text;

-- 2. Effective status on read. The roster now derives Reserve Not Playing from
-- the DB clock (or an already-persisted cutoff marker) instead of only from the
-- stored column, so a client never sees remaining Reserve as playable after the
-- cutoff even before the scheduler has persisted the transition. GET reads stay
-- write-free; the processor is the only path that persists the derived state.
create or replace function public.match_registration_roster(p_match_event_id uuid)
returns table(
  registration_id uuid, user_id uuid, accepted_order bigint, roster_position integer,
  accepted_total integer, playing_total integer, reserve_total integer,
  participation_status public.match_registration_participation)
language sql stable security definer set search_path = '' as $$
  with cutoff as (
    select (e.registration_cutoff_at <= pg_catalog.clock_timestamp()
      or s.cutoff_processed_at is not null) as is_closed
    from public.match_events e
    left join public.match_event_registration_state s on s.match_event_id = e.id
    where e.id = p_match_event_id
  ), ranked as (
    select r.id, r.user_id, r.accepted_order,
      row_number() over (order by r.accepted_order, r.id)::integer as roster_position,
      count(*) over ()::integer as accepted_total
    from public.match_event_registrations r
    where r.match_event_id = p_match_event_id and r.lifecycle = 'accepted'
  )
  select r.id, r.user_id, r.accepted_order, r.roster_position, r.accepted_total,
    (r.accepted_total / 4) * 4, r.accepted_total % 4,
    case when r.roster_position <= (r.accepted_total / 4) * 4
      then 'playing'::public.match_registration_participation
      when (select c.is_closed from cutoff c)
        then 'reserve_not_playing'::public.match_registration_participation
      else 'reserve'::public.match_registration_participation end
  from ranked r;
$$;

-- Counts now separate ordinary Reserve from Reserve Not Playing. The return row
-- gains a column, so the SQL-language dependants are dropped first and the
-- generated read functions are recreated below.
drop function public.get_match_event(uuid);
drop function public.list_match_events(text, uuid, text, integer, timestamptz);
drop function public.match_registration_counts(uuid);
create function public.match_registration_counts(p_match_event_id uuid)
returns table(
  accepted_count integer, playing_count integer, reserve_count integer,
  reserve_not_playing_count integer)
language sql stable security definer set search_path = '' as $$
  select coalesce(max(r.accepted_total), 0),
    count(*) filter (where r.participation_status = 'playing')::integer,
    count(*) filter (where r.participation_status = 'reserve')::integer,
    count(*) filter (where r.participation_status = 'reserve_not_playing')::integer
  from public.match_registration_roster(p_match_event_id) r;
$$;

-- 3. Single reconcile helper: cutoff-aware roster means the residual Reserve is
-- persisted as Reserve Not Playing and its exactly-once alert is written here,
-- in the same transaction and revision bump as the cutoff transition.
create or replace function public.reconcile_match_registration_participation(
  p_match_event_id uuid, p_accepted_registration_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_community uuid;
  v_before jsonb;
  v_revision bigint;
  v_accepted integer;
  v_playing integer;
  v_reserve integer;
  v_reserve_not_playing integer;
  v_before_playing integer;
  v_group integer;
  v_changed integer := 0;
  v_row record;
  v_member record;
  v_accepted_user uuid;
  v_accepted_order bigint;
  v_accepted_participation public.match_registration_participation;
begin
  select e.community_id into v_community
  from public.match_events e where e.id = p_match_event_id;
  if v_community is null then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_EVENT_NOT_FOUND';
  end if;

  -- Snapshot the stored participation of the active roster once, before the
  -- reconcile write, so only genuinely changed rows produce effects.
  select coalesce(jsonb_object_agg(r.id::text, to_jsonb(r.participation_status)), '{}'::jsonb)
    into v_before
  from public.match_event_registrations r
  where r.match_event_id = p_match_event_id and r.lifecycle = 'accepted';

  -- Previously reconciled playing headcount. The just-accepted row is excluded
  -- because its stored value is only the caller's provisional 'reserve' anchor.
  select count(*) into v_before_playing
  from public.match_event_registrations r
  where r.match_event_id = p_match_event_id and r.lifecycle = 'accepted'
    and r.participation_status = 'playing'
    and (p_accepted_registration_id is null or r.id <> p_accepted_registration_id);

  select c.accepted_count, c.playing_count, c.reserve_count, c.reserve_not_playing_count
    into v_accepted, v_playing, v_reserve, v_reserve_not_playing
  from public.match_registration_counts(p_match_event_id) c;

  -- One reconcile write; rows already in the derived state are untouched.
  update public.match_event_registrations r
  set participation_status = roster.participation_status
  from public.match_registration_roster(p_match_event_id) roster
  where r.id = roster.registration_id
    and r.participation_status is distinct from roster.participation_status;

  -- The revision advances exactly once per successful reconcile. Event keys
  -- below are revision-scoped, so a genuine new transition yields a new alert
  -- while any no-op re-invocation cannot.
  update public.match_event_registration_state s
  set transition_revision = s.transition_revision + 1
  where s.match_event_id = p_match_event_id
  returning s.transition_revision into v_revision;
  if v_revision is null then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_STATE_NOT_FOUND';
  end if;

  -- Immediate acceptance/status effects, promotion effects and the cutoff
  -- Reserve-Not-Playing effect for changed players only. A newly accepted
  -- player is identified explicitly (its stored provisional anchor is not a
  -- prior participation state).
  for v_row in
    select q.registration_id, q.user_id, q.accepted_order, q.roster_position,
      q.new_status, q.old_status
    from (
      select c.registration_id, c.user_id, c.accepted_order, c.roster_position,
        c.participation_status as new_status,
        case when c.registration_id = p_accepted_registration_id then null
          else (v_before ->> c.registration_id::text)::public.match_registration_participation
          end as old_status
      from public.match_registration_roster(p_match_event_id) c
    ) q
    where q.old_status is distinct from q.new_status
    order by q.roster_position
  loop
    v_changed := v_changed + 1;
    if v_row.old_status is null and v_row.new_status = 'playing' then
      perform public.persist_notification(v_row.user_id,
        'match.fifo_playing:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_row.user_id::text,
        'match_registration_playing', 'matches', 'match_event', p_match_event_id, v_community);
    elsif v_row.old_status = 'reserve' and v_row.new_status = 'playing' then
      perform public.persist_notification(v_row.user_id,
        'match.fifo_promoted:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_row.user_id::text,
        'match_registration_promoted', 'matches', 'match_event', p_match_event_id, v_community);
    elsif v_row.new_status = 'reserve_not_playing' then
      perform public.persist_notification(v_row.user_id,
        'match.cutoff_not_playing:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_row.user_id::text,
        'match_registration_not_playing', 'matches', 'match_event', p_match_event_id, v_community);
    elsif v_row.new_status = 'reserve' then
      perform public.persist_notification(v_row.user_id,
        'match.fifo_reserve:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_row.user_id::text,
        'match_registration_reserve', 'matches', 'match_event', p_match_event_id, v_community);
    end if;
  end loop;

  -- Quartets that only now became complete: their four members all changed
  -- state in this reconcile. Unrelated, already-complete quartets are never
  -- notified because the loop starts above the previous playing headcount.
  for v_group in (v_before_playing / 4 + 1) .. (v_playing / 4) loop
    for v_member in
      select c.user_id
      from public.match_registration_roster(p_match_event_id) c
      where c.roster_position > (v_group - 1) * 4 and c.roster_position <= v_group * 4
      order by c.roster_position
    loop
      perform public.persist_notification(v_member.user_id,
        'match.fifo_quartet_complete:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_member.user_id::text,
        'match_registration_quartet_complete', 'matches', 'match_event', p_match_event_id, v_community);
    end loop;
  end loop;

  if p_accepted_registration_id is not null then
    select c.user_id, c.accepted_order, c.participation_status
      into v_accepted_user, v_accepted_order, v_accepted_participation
    from public.match_registration_roster(p_match_event_id) c
    where c.registration_id = p_accepted_registration_id;
  end if;

  return jsonb_build_object(
    'event_id', p_match_event_id,
    'accepted_count', v_accepted,
    'playing_count', v_playing,
    'reserve_count', v_reserve,
    'reserve_not_playing_count', v_reserve_not_playing,
    'transition_revision', v_revision,
    'changed_count', v_changed,
    'accepted_registration_id', p_accepted_registration_id,
    'accepted_user_id', v_accepted_user,
    'accepted_order', v_accepted_order,
    'accepted_participation', v_accepted_participation);
end $$;

-- 4. Canonical-order lock acquisition that never blocks the batch: the
-- community, event and registration-state rows are taken with SKIP LOCKED and a
-- contended event returns NULL so the next tick retries it.
create function public.lock_match_event_registration_skip_locked(p_event_id uuid)
returns public.match_events language plpgsql security definer set search_path = '' as $$
declare
  v_community_id uuid;
  v_event public.match_events%rowtype;
begin
  select e.community_id into v_community_id from public.match_events e where e.id = p_event_id;
  if v_community_id is null then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_EVENT_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_community_id for update skip locked;
  if not found then return null; end if;
  select * into v_event from public.match_events e where e.id = p_event_id for update skip locked;
  if not found then return null; end if;
  insert into public.match_event_registration_state(match_event_id, next_accepted_ordinal)
  select p_event_id, coalesce(max(r.accepted_order), 0) + 1
  from public.match_event_registrations r where r.match_event_id = p_event_id
  on conflict (match_event_id) do nothing;
  perform 1 from public.match_event_registration_state s
    where s.match_event_id = p_event_id for update skip locked;
  if not found then return null; end if;
  return v_event;
end $$;

-- 5. Per-event cutoff processor. No-op before due and no-op (writing nothing)
-- when cutoff_processed_at is already set, so a second execution cannot emit a
-- second alert. Expiring pending requests gains them no anchors, ordinal or
-- membership side effect; the reconcile persists the Reserve Not Playing state
-- and its effect; the marker and revision bump share the same transaction.
create function public.process_match_event_registration_cutoff(
  p_match_event_id uuid, p_skip_locked boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_now timestamptz;
  v_processed_at timestamptz;
  v_reconcile jsonb;
  v_revision bigint;
  v_expired_users uuid[];
  v_expired integer;
  v_uid uuid;
begin
  if p_skip_locked then
    v_event := public.lock_match_event_registration_skip_locked(p_match_event_id);
    if v_event.id is null then
      return jsonb_build_object(
        'event_id', p_match_event_id, 'processed', false, 'reason', 'locked');
    end if;
  else
    v_event := public.lock_match_event_registration(p_match_event_id);
  end if;

  -- Fresh DB clock reading after the locks are held; equality is closed.
  v_now := pg_catalog.clock_timestamp();
  if v_now < v_event.registration_cutoff_at then
    return jsonb_build_object(
      'event_id', p_match_event_id, 'processed', false, 'reason', 'not_due');
  end if;

  select s.cutoff_processed_at into v_processed_at
  from public.match_event_registration_state s
  where s.match_event_id = p_match_event_id for update;
  if v_processed_at is not null then
    return jsonb_build_object(
      'event_id', p_match_event_id, 'processed', false, 'reason', 'already_processed');
  end if;

  -- Expire every still-pending request: no anchors, no ordinal, no membership.
  select coalesce(array_agg(r.user_id), '{}'::uuid[]) into v_expired_users
  from public.match_event_registrations r
  where r.match_event_id = p_match_event_id and r.lifecycle = 'pending';
  v_expired := coalesce(array_length(v_expired_users, 1), 0);

  update public.match_event_registrations r
  set lifecycle = 'expired', resolved_at = v_now, resolved_by = null
  where r.match_event_id = p_match_event_id and r.lifecycle = 'pending';

  update public.match_event_registration_attempts a
  set outcome = 'expired', decided_at = v_now, actor_id = null
  where a.match_event_id = p_match_event_id and a.outcome = 'pending';

  -- Reconcile flips only the residual Reserve to Reserve Not Playing, keeps
  -- complete quartets playable, preserves accepted order and writes the
  -- not-playing effects in this same transaction.
  v_reconcile := public.reconcile_match_registration_participation(p_match_event_id);
  v_revision := (v_reconcile ->> 'transition_revision')::bigint;

  -- Expired-request alerts, revision-scoped so they are exactly-once.
  foreach v_uid in array v_expired_users loop
    perform public.persist_notification(v_uid,
      'match.cutoff_expired:' || p_match_event_id::text || ':' || v_revision::text || ':' || v_uid::text,
      'match_registration_expired', 'matches', 'match_event', p_match_event_id, v_event.community_id);
  end loop;

  update public.match_event_registration_state s
  set cutoff_processed_at = v_now
  where s.match_event_id = p_match_event_id;

  return jsonb_build_object(
    'event_id', p_match_event_id, 'processed', true, 'reason', 'processed',
    'expired_count', v_expired,
    'accepted_count', (v_reconcile ->> 'accepted_count')::integer,
    'playing_count', (v_reconcile ->> 'playing_count')::integer,
    'reserve_count', (v_reconcile ->> 'reserve_count')::integer,
    'reserve_not_playing_count', (v_reconcile ->> 'reserve_not_playing_count')::integer,
    'transition_revision', v_revision);
end $$;

-- 6. Restricted bounded batch. One small transaction, each event isolated in
-- its own exception subtransaction (a failing event's effects and marker roll
-- back while the rest complete), and events it cannot lock immediately are
-- skipped for the next tick. Overdue events are picked up by the same
-- unprocessed-marker predicate, so downtime is caught up automatically.
--
-- F25 fairness: the selection is ordered by the per-event attempt cursor
-- (cutoff_attempt_count) first, then the cutoff instant. Every selected event is
-- stamped, so a poisoned prefix of repeatedly-failing or lock-skipped events
-- rotates behind the never-attempted ones and can no longer starve later due
-- events, while the batch stays bounded and catch-up is unchanged.
--
-- F24 durability: per-event failures are retained on the state row
-- (cutoff_failure_count / cutoff_last_failure_*), which survives the cron run.
-- pg_cron only stores "1 row" for a successful command, so the returned errors
-- JSON never reaches cron.job_run_details.
create function public.process_due_match_event_registration_cutoffs(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_event_id uuid;
  v_result jsonb;
  v_reason text;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_event_id in
    select e.id
    from public.match_event_registration_state s
    join public.match_events e on e.id = s.match_event_id
    where s.cutoff_processed_at is null
      and e.registration_cutoff_at <= pg_catalog.clock_timestamp()
    order by s.cutoff_attempt_count, e.registration_cutoff_at, e.id
    limit v_limit
  loop
    begin
      v_result := public.process_match_event_registration_cutoff(v_event_id, true);
      v_reason := coalesce(v_result ->> 'reason', '');
      if coalesce((v_result ->> 'processed')::boolean, false) then
        v_processed := v_processed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;
      if v_reason in ('processed', 'already_processed') then
        -- The event reached a terminal processor state: stamp the fairness
        -- cursor and clear any stale failure record.
        update public.match_event_registration_state s
        set cutoff_attempt_count = s.cutoff_attempt_count + 1,
            cutoff_last_attempt_at = pg_catalog.clock_timestamp(),
            cutoff_failure_count = 0,
            cutoff_last_failure_at = null,
            cutoff_last_failure_sqlstate = null,
            cutoff_last_failure_message = null
        where s.match_event_id = v_event_id;
      else
        -- Lock-skipped or not due: stamp the cursor so the event rotates to the
        -- back, but keep any outstanding failure record (nothing was resolved).
        update public.match_event_registration_state s
        set cutoff_attempt_count = s.cutoff_attempt_count + 1,
            cutoff_last_attempt_at = pg_catalog.clock_timestamp()
        where s.match_event_id = v_event_id;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'event_id', v_event_id, 'sqlstate', SQLSTATE, 'message', SQLERRM);
      -- Durable, operator-visible failure record; cleared only when the event
      -- later reaches a terminal processor state.
      update public.match_event_registration_state s
      set cutoff_attempt_count = s.cutoff_attempt_count + 1,
          cutoff_last_attempt_at = pg_catalog.clock_timestamp(),
          cutoff_failure_count = s.cutoff_failure_count + 1,
          cutoff_last_failure_at = pg_catalog.clock_timestamp(),
          cutoff_last_failure_sqlstate = SQLSTATE,
          cutoff_last_failure_message = SQLERRM
      where s.match_event_id = v_event_id;
    end;
  end loop;
  return pg_catalog.jsonb_build_object(
    'processed', v_processed, 'skipped', v_skipped, 'failed', v_failed,
    'selected', v_processed + v_skipped + v_failed, 'errors', v_errors);
end $$;

-- 7. Read projections. Counts keep their exact key set; the caller badge gains
-- a Reserve Not Playing value so a match read never labels it ordinary Reserve.
create function public.get_match_event(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'event_id',e.id,'community_id',e.community_id,'community_name',c.name,
    'creator_id',e.created_by,'creator_name',p.display_name,'creator_level',g.display_level,
    'starts_at',e.starts_at,'timezone',e.timezone,'event_type',e.event_type,'visibility',e.visibility,
    'team_assignment_mode',e.team_assignment_mode,'venue_name',e.venue_name,'maps_url',e.maps_url,
    'photo_path',e.photo_path,'court_notes',e.court_notes,'duration_minutes',e.duration_minutes,
    'notes',e.notes,'court_booked',e.court_booked,'restriction_enabled',e.restriction_enabled,
    'min_level',e.min_level,'max_level',e.max_level,'price_minor',e.price_minor,'currency',e.currency,
    'payment_note',e.payment_note,'maximum_registrations',e.maximum_registrations,
    'registration_cutoff_at',e.registration_cutoff_at,'accepted_count',n.accepted_count,
    'playing_count',n.playing_count,'reserve_count',n.reserve_count,'group_count',n.accepted_count/4,
     'more_needed',4-(n.accepted_count%4),'caller_badge',b.badge,
     'is_past',e.starts_at<=now(),
     'registration_open',e.starts_at>now() and e.registration_cutoff_at>now() and (e.maximum_registrations is null or n.accepted_count<e.maximum_registrations),
     'caller_is_invited',caller.caller_is_invited,
     'caller_eligibility',caller.caller_eligibility,
     'caller_requires_approval',caller.caller_requires_approval)
  from public.match_events e join public.communities c on c.id=e.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  left join public.global_player_ratings g on g.user_id=e.created_by
  cross join lateral public.match_registration_counts(e.id) n
   cross join lateral (select case when e.created_by=auth.uid() then 'creator'
    when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
    when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='reserve_not_playing') then 'reserve_not_playing'
    when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') then 'reserve'
     when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end badge) b
   cross join lateral public.match_event_caller_context(e.id) caller
  where e.id=p_event_id and public.can_read_match_event(e.id)
$$;

create function public.list_match_events(p_entry text,p_community_id uuid default null,p_cursor text default '',p_limit integer default 20,p_as_of timestamptz default now())
returns setof jsonb language sql stable security definer set search_path = '' as $$
  with parsed as (select split_part(p_cursor,'|',1) instant,split_part(p_cursor,'|',2) id), cursor_values as (
    select case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then instant::timestamptz end starts_at,
      case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then id::uuid end event_id from parsed
  ), eligible as (
    select e.*,c.name community_name,p.display_name creator_name,g.display_level creator_level,
       n.accepted_count, n.playing_count, n.reserve_count,
       caller.caller_is_invited, caller.caller_eligibility, caller.caller_requires_approval,
       case when e.created_by=auth.uid() then 'creator'
       when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
       when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='reserve_not_playing') then 'reserve_not_playing'
       when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') then 'reserve'
       when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end caller_badge

     from public.match_events e join public.communities c on c.id=e.community_id
    left join public.player_profiles p on p.user_id=e.created_by left join public.global_player_ratings g on g.user_id=e.created_by
    cross join lateral public.match_registration_counts(e.id) n
    cross join lateral public.match_event_caller_context(e.id) caller
    where public.can_read_match_event(e.id) and (p_community_id is null or e.community_id=p_community_id)
      and case p_entry when 'available' then e.visibility='community_open' and e.starts_at>coalesce(p_as_of,now()) and e.registration_cutoff_at>coalesce(p_as_of,now()) and (e.maximum_registrations is null or n.accepted_count<e.maximum_registrations)
      when 'my' then e.starts_at>coalesce(p_as_of,now()) and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()))
      when 'past' then e.starts_at<=coalesce(p_as_of,now()) and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid())) else false end
  )
  select jsonb_build_object('event_id',e.id,'community_id',e.community_id,'community_name',e.community_name,
    'creator_id',e.created_by,'creator_name',e.creator_name,'creator_level',e.creator_level,'starts_at',e.starts_at,
    'timezone',e.timezone,'event_type',e.event_type,'visibility',e.visibility,'team_assignment_mode',e.team_assignment_mode,
    'venue_name',e.venue_name,'maps_url',e.maps_url,'photo_path',e.photo_path,'court_notes',e.court_notes,
    'duration_minutes',e.duration_minutes,'notes',e.notes,'court_booked',e.court_booked,'restriction_enabled',e.restriction_enabled,
    'min_level',e.min_level,'max_level',e.max_level,'price_minor',e.price_minor,'currency',e.currency,'payment_note',e.payment_note,
    'maximum_registrations',e.maximum_registrations,'registration_cutoff_at',e.registration_cutoff_at,'accepted_count',e.accepted_count,
    'playing_count',e.playing_count,'reserve_count',e.reserve_count,'group_count',e.accepted_count/4,
     'more_needed',4-(e.accepted_count%4),'caller_badge',e.caller_badge,
     'is_past',e.starts_at<=coalesce(p_as_of,now()),
     'registration_open',e.starts_at>coalesce(p_as_of,now()) and e.registration_cutoff_at>coalesce(p_as_of,now()) and (e.maximum_registrations is null or e.accepted_count<e.maximum_registrations),
     'caller_is_invited',e.caller_is_invited,
     'caller_eligibility',e.caller_eligibility,
     'caller_requires_approval',e.caller_requires_approval,
    'as_of',coalesce(p_as_of,now()),
     'cursor',to_char(e.starts_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF')||'|'||e.id::text)
  from eligible e cross join cursor_values v
  where (v.starts_at is null or (p_entry='past' and (e.starts_at,e.id)<(v.starts_at,v.event_id)) or (p_entry<>'past' and (e.starts_at,e.id)>(v.starts_at,v.event_id)))
  order by case when p_entry='past' then null else e.starts_at end asc,case when p_entry='past' then null else e.id end asc,
    case when p_entry='past' then e.starts_at end desc,case when p_entry='past' then e.id end desc
  limit least(greatest(coalesce(p_limit,20),1),50)
$$;

-- 8. Creator request queue carries the Reserve Not Playing count so it is never
-- merged into ordinary Reserve.
create or replace function public.list_match_event_registration_requests(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_event public.match_events%rowtype;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  select * into v_event from public.match_events e where e.id = p_match_event_id;
  if not found or v_event.created_by <> v_actor then
    return;
  end if;
  return query
  select jsonb_build_object(
    'event_id', v_event.id,
    'accepted_count', n.accepted_count,
    'playing_count', n.playing_count,
    'reserve_count', n.reserve_count,
    'reserve_not_playing_count', n.reserve_not_playing_count,
    'maximum_registrations', v_event.maximum_registrations,
    'registration_cutoff_at', v_event.registration_cutoff_at,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.user_id,
        'attempt_id', pa.id,
        'display_name', p.display_name,
        'display_level', g.display_level,
        'registration_source', r.registration_source,
        'requested_at', r.requested_at)
        order by r.requested_at, r.id)
      from public.match_event_registrations r
      left join public.player_profiles p on p.user_id = r.user_id
      left join public.global_player_ratings g on g.user_id = r.user_id
      left join lateral (
        select a.id from public.match_event_registration_attempts a
        where a.match_event_id = r.match_event_id and a.user_id = r.user_id and a.outcome = 'pending'
        order by a.requested_at desc, a.id desc limit 1) pa on true
      where r.match_event_id = v_event.id and r.lifecycle = 'pending'), '[]'::jsonb))
  from public.match_registration_counts(v_event.id) n;
end $$;

-- 9. Notification allowlists. Both cutoff kinds resolve their context (venue,
-- timezone, caller participation and counts) without weakening existing kinds.
create or replace function public.get_my_notification_target_v2(p_notification_id uuid)
returns table(target_status text, community_id uuid, community_name text,
  invitation_id uuid, membership_status text, match_event_id uuid, match_available boolean)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid(); v_n public.notifications%rowtype; v_old record;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then
    raise exception 'Authentication required' using errcode='28000';
  end if;
  select n.* into v_n from public.notifications n where n.id=p_notification_id and n.recipient_user_id=v_actor;
  if not found then raise exception 'Notification unavailable' using errcode='42501'; end if;
  if v_n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete','match_registration_expired','match_registration_not_playing')
    and v_n.category='matches' and v_n.target_type='match_event' then
    if exists(select 1 from public.match_events e where e.id=v_n.target_id
      and e.community_id is not distinct from v_n.community_id and public.can_read_match_event(e.id)) then
      return query select 'match_available', null::uuid, null::text, null::uuid, null::text, v_n.target_id, true;
    else
      return query select 'unavailable', null::uuid, null::text, null::uuid, null::text, null::uuid, false;
    end if;
    return;
  end if;
  select * into v_old from public.get_my_notification_target(p_notification_id);
  return query select v_old.target_status, v_old.community_id, v_old.community_name,
    v_old.invitation_id, v_old.membership_status, null::uuid, false;
end $$;

drop function public.get_my_match_notification_contexts(uuid[]);
create function public.get_my_match_notification_contexts(p_notification_ids uuid[])
returns table(notification_id uuid, match_event_id uuid, creator_display_name text,
  scheduled_at timestamptz, timezone text, venue text, event_type public.match_event_type,
  playing_count integer, reserve_count integer, reserve_not_playing_count integer,
  price_minor bigint, currency text, requester_display_name text,
  caller_participation public.match_registration_participation, caller_accepted_order bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(cardinality(p_notification_ids),0)>50 then raise exception 'Page too large' using errcode='22023'; end if;
  return query
  select n.id,e.id,p.display_name,e.starts_at,e.timezone,e.venue_name,e.event_type,
    c.playing_count,c.reserve_count,c.reserve_not_playing_count,e.price_minor,e.currency,
    rq.display_name,cr.participation_status,cr.accepted_order
  from public.notifications n
  join public.match_events e on e.id=n.target_id and e.community_id is not distinct from n.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  cross join lateral public.match_registration_counts(e.id) c
  left join public.match_event_registration_attempts ra on ra.id = (
    case when n.kind='match_registration_requested'
      and n.event_key ~ '^match\.registration_requested:[0-9a-fA-F-]{36}:[0-9a-fA-F-]{36}$'
      then pg_catalog.split_part(n.event_key,':',3)::uuid end)
    and ra.match_event_id=e.id
  left join public.player_profiles rq on rq.user_id=ra.user_id
  left join lateral (
    select q.participation_status, q.accepted_order
    from public.match_registration_roster(e.id) q
    where q.user_id=(select auth.uid())) cr on true
  where n.id=any(coalesce(p_notification_ids,'{}'::uuid[])) and n.recipient_user_id=auth.uid()
    and n.category='matches' and n.target_type='match_event'
    and n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete','match_registration_expired','match_registration_not_playing') and public.can_read_match_event(e.id);
end $$;

-- 10. ACL: the processors, the skip-locked lock helper, the counts projection
-- and the roster stay internal; only the read RPCs are browser-executable.
revoke all on function public.match_registration_roster(uuid),
  public.match_registration_counts(uuid),
  public.reconcile_match_registration_participation(uuid, uuid),
  public.lock_match_event_registration_skip_locked(uuid),
  public.process_match_event_registration_cutoff(uuid, boolean),
  public.process_due_match_event_registration_cutoffs(integer),
  public.get_match_event(uuid),
  public.list_match_events(text, uuid, text, integer, timestamptz),
  public.list_match_event_registration_requests(uuid),
  public.get_my_notification_target_v2(uuid),
  public.get_my_match_notification_contexts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_match_event(uuid),
  public.list_match_events(text, uuid, text, integer, timestamptz),
  public.list_match_event_registration_requests(uuid),
  public.get_my_notification_target_v2(uuid),
  public.get_my_match_notification_contexts(uuid[]) to authenticated;

commit;
