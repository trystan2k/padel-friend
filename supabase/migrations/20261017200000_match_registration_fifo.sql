begin;

-- PAF-5.3: FIFO quartet engine, single-source participation semantics and
-- atomic promotion effects (HIGH RISK).
--
-- One internal reconcile helper is the ONLY place that assigns
-- participation_status, and every read projection derives its counts, caller
-- badge and quartet grouping from the same ordered accepted roster. Promotion
-- notification effects are written inside the same transaction as the
-- acceptance that causes them, so a failed effect rolls the whole acceptance
-- back. Canonical lock order is unchanged and assumed already held by callers:
-- community -> match event -> registration state -> affected registration rows.

-- 1. Ordered accepted roster with derived participation. This is the single
-- semantic source of truth for "who is playing": active rows only
-- (lifecycle = 'accepted'), ordered by the immutable accepted_order with a
-- deterministic id tiebreak, first floor(N/4)*4 playing and the remainder
-- Reserve. reserve_not_playing belongs to the cutoff unit and is never produced
-- here. The reconcile helper and the read projections all consume this shape.
create or replace function public.match_registration_roster(p_match_event_id uuid)
returns table(
  registration_id uuid, user_id uuid, accepted_order bigint, roster_position integer,
  accepted_total integer, playing_total integer, reserve_total integer,
  participation_status public.match_registration_participation)
language sql stable security definer set search_path = '' as $$
  with ranked as (
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
      else 'reserve'::public.match_registration_participation end
  from ranked r;
$$;

-- Counts derived from the same roster definition (never a second formula).
create or replace function public.match_registration_counts(p_match_event_id uuid)
returns table(accepted_count integer, playing_count integer, reserve_count integer)
language sql stable security definer set search_path = '' as $$
  select coalesce(max(r.accepted_total), 0), coalesce(max(r.playing_total), 0),
    coalesce(max(r.reserve_total), 0)
  from public.match_registration_roster(p_match_event_id) r;
$$;

-- 2. Single reconcile helper. The caller already holds the community, event and
-- registration-state locks. It computes the ordered roster once, updates only
-- rows whose derived state actually differs, advances the transition revision
-- on the successful mutation, writes the immediate/promotion/group-completion
-- notification effects, and returns the authoritative counts plus the
-- caller-relevant accepted state and the new revision. Ordinals are never
-- renumbered and no row-by-row committed promotions exist.
drop function public.reconcile_match_registration_participation(uuid);
create function public.reconcile_match_registration_participation(
  p_match_event_id uuid, p_accepted_registration_id uuid default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_community uuid;
  v_before jsonb;
  v_revision bigint;
  v_accepted integer;
  v_playing integer;
  v_reserve integer;
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

  select c.accepted_count, c.playing_count, c.reserve_count
    into v_accepted, v_playing, v_reserve
  from public.match_registration_counts(p_match_event_id) c;

  -- One reconcile write; rows already in the derived state are untouched.
  update public.match_event_registrations r
  set participation_status = roster.participation_status
  from public.match_registration_roster(p_match_event_id) roster
  where r.id = roster.registration_id
    and r.participation_status is distinct from roster.participation_status;

  -- The revision advances exactly once per successful reconcile of a genuine
  -- acceptance. Event keys below are revision-scoped, so a genuine new
  -- transition yields a new alert while any no-op re-invocation cannot.
  update public.match_event_registration_state s
  set transition_revision = s.transition_revision + 1
  where s.match_event_id = p_match_event_id
  returning s.transition_revision into v_revision;
  if v_revision is null then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_STATE_NOT_FOUND';
  end if;

  -- Immediate acceptance/status effects and promotion effects for changed
  -- players only. A newly accepted player is identified explicitly (its stored
  -- provisional anchor is not a prior participation state).
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
    'transition_revision', v_revision,
    'changed_count', v_changed,
    'accepted_registration_id', p_accepted_registration_id,
    'accepted_user_id', v_accepted_user,
    'accepted_order', v_accepted_order,
    'accepted_participation', v_accepted_participation);
end $$;

-- 3. Action RPCs now route every roster change through the single helper and
-- return its authoritative state instead of a provisional value.
create or replace function public.submit_match_registration(p_match_event_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_event public.match_events%rowtype;
  v_membership boolean;
  v_public boolean;
  v_rating numeric;
  v_now timestamptz;
  v_row public.match_event_registrations%rowtype;
  v_found boolean;
  v_source public.match_registration_source;
  v_accepted boolean;
  v_lifecycle public.match_registration_lifecycle;
  v_participation public.match_registration_participation;
  v_accepted_at timestamptz;
  v_accepted_order bigint;
  v_accepted_count integer;
  v_ordinal bigint;
  v_registration_id uuid;
  v_attempt_id uuid;
  v_reconcile jsonb;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;

  v_event := public.lock_match_event_registration(p_match_event_id);
  v_now := pg_catalog.clock_timestamp();

  -- Strict cutoff on the DB clock after lock acquisition; equality is closed.
  if v_now >= v_event.registration_cutoff_at then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_CLOSED';
  end if;
  -- Invite-only entry stays T06; this entry point is Community Open only.
  if v_event.visibility <> 'community_open' then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_INVITE_ONLY';
  end if;

  v_membership := public.match_registration_is_member(v_event.community_id, v_actor);
  select r.display_level into v_rating from public.global_player_ratings r where r.user_id = v_actor;
  select c.visibility = 'public' into v_public from public.communities c where c.id = v_event.community_id;

  if v_membership then
    -- Authoritative rating, inclusive range; enabled range without a rating
    -- requires approval instead of auto-acceptance.
    v_accepted := not v_event.restriction_enabled
      or (v_rating is not null and v_rating between v_event.min_level and v_event.max_level);
    v_source := 'member';
  elsif v_public then
    v_accepted := false;
    v_source := 'guest';
  else
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_DENIED';
  end if;

  select * into v_row from public.match_event_registrations r
  where r.match_event_id = p_match_event_id and r.user_id = v_actor for update;
  v_found := found;
  if v_found then
    if v_row.lifecycle = 'accepted' then
      raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_DUPLICATE';
    end if;
    if v_row.lifecycle = 'pending' then
      raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_PENDING_DUPLICATE';
    end if;
    -- rejected/expired: reuse the canonical identity row as a fresh attempt.
  end if;

  if v_accepted then
    select count(*) into v_accepted_count from public.match_event_registrations r
    where r.match_event_id = p_match_event_id and r.lifecycle = 'accepted';
    -- A finite capacity binds accepted players only (creator and Reserve included).
    if v_event.maximum_registrations is not null and v_accepted_count >= v_event.maximum_registrations then
      raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_FULL';
    end if;
    select s.next_accepted_ordinal into v_ordinal
    from public.match_event_registration_state s where s.match_event_id = p_match_event_id for update;
    update public.match_event_registration_state s
    set next_accepted_ordinal = s.next_accepted_ordinal + 1
    where s.match_event_id = p_match_event_id;
    v_lifecycle := 'accepted';
    v_participation := 'reserve';
    v_accepted_at := v_now;
    v_accepted_order := v_ordinal;
  else
    v_lifecycle := 'pending';
    v_participation := null;
    v_accepted_at := null;
    v_accepted_order := null;
  end if;

  if v_found then
    update public.match_event_registrations r set
      lifecycle = v_lifecycle,
      accepted_at = v_accepted_at,
      approved_at = null,
      accepted_order = v_accepted_order,
      participation_status = v_participation,
      registration_source = v_source,
      requested_at = v_now,
      resolved_at = null,
      resolved_by = null
    where r.id = v_row.id
    returning r.id into v_registration_id;
  else
    insert into public.match_event_registrations(
      match_event_id, user_id, lifecycle, accepted_at, accepted_order,
      participation_status, registration_source, requested_at)
    values (
      p_match_event_id, v_actor, v_lifecycle, v_accepted_at, v_accepted_order,
      v_participation, v_source, v_now)
    returning id into v_registration_id;
  end if;

  insert into public.match_event_registration_attempts(
    match_event_id, user_id, requested_at, decided_at, outcome, actor_id)
  values (
    p_match_event_id, v_actor, v_now,
    case when v_accepted then v_now else null end,
    v_lifecycle,
    case when v_accepted then v_actor else null end)
  returning id into v_attempt_id;

  if v_accepted then
    v_reconcile := public.reconcile_match_registration_participation(
      p_match_event_id, v_registration_id);
    v_participation := (v_reconcile ->> 'accepted_participation')::public.match_registration_participation;
  else
    -- New request: durable creator alert, once per attempt (attempt id scopes the
    -- stable event key, so a re-application after rejection alerts again while a
    -- replay is a no-op).
    perform public.persist_notification(
      v_event.created_by,
      'match.registration_requested:' || v_registration_id::text || ':' || v_attempt_id::text,
      'match_registration_requested', 'matches', 'match_event',
      p_match_event_id, v_event.community_id);
  end if;

  return jsonb_build_object(
    'event_id', p_match_event_id,
    'user_id', v_actor,
    'lifecycle', v_lifecycle,
    'participation', v_participation,
    'accepted_order', v_accepted_order,
    'registration_source', v_source,
    'requested_at', v_now,
    'approved_at', null,
    'accepted_at', v_accepted_at,
    'already_registered', false);
end $$;

create or replace function public.decide_match_registration(p_match_event_id uuid, p_user_id uuid, p_decision text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_event public.match_events%rowtype;
  v_row public.match_event_registrations%rowtype;
  v_now timestamptz;
  v_ordinal bigint;
  v_count integer;
  v_attempt_id uuid;
  v_member boolean;
  v_public boolean;
  v_lifecycle public.match_registration_lifecycle;
  v_participation public.match_registration_participation;
  v_reconcile jsonb;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_user_id is null then
    raise exception using errcode = '22023', message = 'Match registration target required';
  end if;
  if p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception using errcode = '22023', message = 'Invalid registration decision';
  end if;
  if p_user_id = v_actor then
    raise exception using errcode = '42501', message = 'Creator cannot decide their own registration';
  end if;

  v_event := public.lock_match_event_registration(p_match_event_id);
  if v_event.created_by <> v_actor then
    raise exception using errcode = '42501', message = 'Registration decisions are creator-only';
  end if;

  select * into v_row from public.match_event_registrations r
  where r.match_event_id = p_match_event_id and r.user_id = p_user_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_NOT_FOUND';
  end if;

  -- Approving an already-approved request replays with the ORIGINAL anchors/time/order.
  if v_row.lifecycle = 'accepted' then
    if p_decision = 'approve' then
      return jsonb_build_object(
        'event_id', p_match_event_id,
        'user_id', p_user_id,
        'lifecycle', 'accepted',
        'participation', v_row.participation_status,
        'accepted_order', v_row.accepted_order,
        'registration_source', v_row.registration_source,
        'approved_at', v_row.approved_at,
        'accepted_at', v_row.accepted_at,
        'replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_ALREADY_RESOLVED';
  end if;
  -- A rejected/expired row can never silently become accepted.
  if v_row.lifecycle <> 'pending' then
    raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_ALREADY_RESOLVED';
  end if;

  v_now := pg_catalog.clock_timestamp();
  v_lifecycle := case when p_decision = 'approve' then 'accepted' else 'rejected' end;

  if p_decision = 'approve' then
    if v_now >= v_event.registration_cutoff_at then
      raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_CLOSED';
    end if;
    -- Current visibility/membership eligibility must still hold for the requester.
    -- Rating range is intentionally not re-checked: approving out-of-range requests
    -- is exactly what creator approval is for.
    if v_row.registration_source = 'member' then
      v_member := public.match_registration_is_member(v_event.community_id, p_user_id);
      if not v_member then
        raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_REQUESTER_INELIGIBLE';
      end if;
    else
      select c.visibility = 'public' into v_public from public.communities c where c.id = v_event.community_id;
      if not coalesce(v_public, false) then
        raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_REQUESTER_INELIGIBLE';
      end if;
    end if;
    select count(*) into v_count from public.match_event_registrations r
    where r.match_event_id = p_match_event_id and r.lifecycle = 'accepted';
    if v_event.maximum_registrations is not null and v_count >= v_event.maximum_registrations then
      raise exception using errcode = 'P0001', message = 'MATCH_REGISTRATION_FULL';
    end if;
    select s.next_accepted_ordinal into v_ordinal
    from public.match_event_registration_state s where s.match_event_id = p_match_event_id for update;
    update public.match_event_registration_state s
    set next_accepted_ordinal = s.next_accepted_ordinal + 1
    where s.match_event_id = p_match_event_id;

    update public.match_event_registrations r set
      lifecycle = 'accepted',
      accepted_at = v_now,
      approved_at = v_now,
      accepted_order = v_ordinal,
      participation_status = 'reserve',
      resolved_at = null,
      resolved_by = null
    where r.id = v_row.id;
  else
    update public.match_event_registrations r set
      lifecycle = 'rejected',
      accepted_at = null,
      approved_at = null,
      accepted_order = null,
      participation_status = null,
      resolved_at = v_now,
      resolved_by = v_actor
    where r.id = v_row.id;
  end if;

  select a.id into v_attempt_id from public.match_event_registration_attempts a
  where a.match_event_id = p_match_event_id and a.user_id = p_user_id and a.outcome = 'pending'
  order by a.requested_at desc, a.id desc limit 1 for update;
  if v_attempt_id is not null then
    update public.match_event_registration_attempts a
    set outcome = v_lifecycle, decided_at = v_now, actor_id = v_actor
    where a.id = v_attempt_id;
  else
    insert into public.match_event_registration_attempts(
      match_event_id, user_id, requested_at, decided_at, outcome, actor_id)
    values (p_match_event_id, p_user_id, coalesce(v_row.requested_at, v_now), v_now, v_lifecycle, v_actor)
    returning id into v_attempt_id;
  end if;

  if p_decision = 'approve' then
    v_reconcile := public.reconcile_match_registration_participation(p_match_event_id, v_row.id);
    v_participation := (v_reconcile ->> 'accepted_participation')::public.match_registration_participation;
    -- Approval alert, once per attempt (replay is a no-op).
    perform public.persist_notification(
      v_row.user_id,
      'match.registration_approved:' || v_row.id::text || ':' || v_attempt_id::text,
      'match_registration_approved', 'matches', 'match_event',
      p_match_event_id, v_event.community_id);
    return jsonb_build_object(
      'event_id', p_match_event_id,
      'user_id', p_user_id,
      'lifecycle', 'accepted',
      'participation', v_participation,
      'accepted_order', v_ordinal,
      'registration_source', v_row.registration_source,
      'approved_at', v_now,
      'accepted_at', v_now,
      'replayed', false);
  end if;

  perform public.persist_notification(
    v_row.user_id,
    'match.registration_rejected:' || v_row.id::text || ':' || v_attempt_id::text,
    'match_registration_rejected', 'matches', 'match_event',
    p_match_event_id, v_event.community_id);
  return jsonb_build_object(
    'event_id', p_match_event_id,
    'user_id', p_user_id,
    'lifecycle', 'rejected',
    'registration_source', v_row.registration_source,
    'resolved_at', v_now,
    'resolved_by', v_actor,
    'replayed', false);
end $$;

-- 4. Read projections derive counts, caller badge, caller participation/position
-- and quartet grouping from the same roster/counts semantics (finding F3). DTO
-- and return shapes are preserved exactly.
create or replace function public.get_match_event(p_event_id uuid)
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
     'caller_eligibility',elig.value,
     'caller_requires_approval',coalesce(elig.value in ('out_of_range','nonmember'),false))
  from public.match_events e join public.communities c on c.id=e.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  left join public.global_player_ratings g on g.user_id=e.created_by
  cross join lateral public.match_registration_counts(e.id) n
   cross join lateral (select case when e.created_by=auth.uid() then 'creator'
    when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
    when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') then 'reserve'
     when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end badge) b
   cross join lateral (select case
     when e.created_by=auth.uid() then 'creator'
     when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited'
     when exists(select 1 from public.community_members m where m.community_id=e.community_id and m.user_id=auth.uid() and m.status='active') then
       case when not e.restriction_enabled or exists(select 1 from public.global_player_ratings r where r.user_id=auth.uid() and r.display_level between e.min_level and e.max_level) then 'member' else 'out_of_range' end
     when auth.uid() is not null and e.visibility='community_open' and c.visibility='public' then 'nonmember' else null end value) elig
  where e.id=p_event_id and public.can_read_match_event(e.id)
$$;

create or replace function public.list_match_events(p_entry text,p_community_id uuid default null,p_cursor text default '',p_limit integer default 20,p_as_of timestamptz default now())
returns setof jsonb language sql stable security definer set search_path = '' as $$
  with parsed as (select split_part(p_cursor,'|',1) instant,split_part(p_cursor,'|',2) id), cursor_values as (
    select case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then instant::timestamptz end starts_at,
      case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then id::uuid end event_id from parsed
  ), eligible as (
    select e.*,c.name community_name,p.display_name creator_name,g.display_level creator_level,
       n.accepted_count, n.playing_count, n.reserve_count,
       case when e.created_by=auth.uid() then 'creator'
       when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
       when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') then 'reserve'
       when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end caller_badge
       ,case when e.created_by=auth.uid() then 'creator'
         when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited'
         when exists(select 1 from public.community_members m where m.community_id=e.community_id and m.user_id=auth.uid() and m.status='active') then
           case when not e.restriction_enabled or exists(select 1 from public.global_player_ratings r where r.user_id=auth.uid() and r.display_level between e.min_level and e.max_level) then 'member' else 'out_of_range' end
         when auth.uid() is not null and e.visibility='community_open' and c.visibility='public' then 'nonmember' else null end caller_eligibility
     from public.match_events e join public.communities c on c.id=e.community_id
    left join public.player_profiles p on p.user_id=e.created_by left join public.global_player_ratings g on g.user_id=e.created_by
    cross join lateral public.match_registration_counts(e.id) n
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
     'caller_eligibility',e.caller_eligibility,
     'caller_requires_approval',coalesce(e.caller_eligibility in ('out_of_range','nonmember'),false),
    'cursor',to_char(e.starts_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF')||'|'||e.id::text)
  from eligible e cross join cursor_values v
  where (v.starts_at is null or (p_entry='past' and (e.starts_at,e.id)<(v.starts_at,v.event_id)) or (p_entry<>'past' and (e.starts_at,e.id)>(v.starts_at,v.event_id)))
  order by case when p_entry='past' then null else e.starts_at end asc,case when p_entry='past' then null else e.id end asc,
    case when p_entry='past' then e.starts_at end desc,case when p_entry='past' then e.id end desc
  limit least(greatest(coalesce(p_limit,20),1),50)
$$;

-- Notification allowlists: the four FIFO kinds resolve through the existing
-- target/context projections without weakening existing kinds. Their context is
-- already carried by caller_participation/caller_accepted_order plus the derived
-- counts, venue and timezone; no payload column and no rendered prose.
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
  if v_n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete')
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

-- Context projection keeps its exact OUT row shape; the four FIFO kinds join the
-- allowlist and the caller roster comes from the same derived semantics.
create or replace function public.get_my_match_notification_contexts(p_notification_ids uuid[])
returns table(notification_id uuid, match_event_id uuid, creator_display_name text,
  scheduled_at timestamptz, timezone text, venue text, event_type public.match_event_type,
  playing_count integer, reserve_count integer, price_minor bigint, currency text,
  requester_display_name text, caller_participation public.match_registration_participation,
  caller_accepted_order bigint)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(cardinality(p_notification_ids),0)>50 then raise exception 'Page too large' using errcode='22023'; end if;
  return query
  select n.id,e.id,p.display_name,e.starts_at,e.timezone,e.venue_name,e.event_type,
    c.playing_count,c.reserve_count,e.price_minor,e.currency,
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
    and n.kind in ('match_event_published','match_event_invitation','match_registration_requested','match_registration_approved','match_registration_rejected','match_registration_playing','match_registration_reserve','match_registration_promoted','match_registration_quartet_complete') and public.can_read_match_event(e.id);
end $$;

-- Creator request queue and own-state reads share the same counts/position.
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
    'maximum_registrations', v_event.maximum_registrations,
    'registration_cutoff_at', v_event.registration_cutoff_at,
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
        'user_id', r.user_id,
        'display_name', p.display_name,
        'display_level', g.display_level,
        'registration_source', r.registration_source,
        'requested_at', r.requested_at)
        order by r.requested_at, r.id)
      from public.match_event_registrations r
      left join public.player_profiles p on p.user_id = r.user_id
      left join public.global_player_ratings g on g.user_id = r.user_id
      where r.match_event_id = v_event.id and r.lifecycle = 'pending'), '[]'::jsonb))
  from public.match_registration_counts(v_event.id) n;
end $$;

create or replace function public.get_my_match_registration(p_match_event_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_result jsonb;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  select jsonb_build_object(
    'event_id', e.id,
    'lifecycle', r.lifecycle,
    'participation', cr.participation_status,
    'accepted_order', r.accepted_order,
    'position', cr.roster_position,
    'registration_source', r.registration_source,
    'requested_at', r.requested_at,
    'approved_at', r.approved_at,
    'accepted_at', r.accepted_at,
    'resolved_at', r.resolved_at)
  into v_result
  from public.match_events e
  left join public.match_event_registrations r
    on r.match_event_id = e.id and r.user_id = v_actor
  left join lateral (
    select q.participation_status, q.roster_position
    from public.match_registration_roster(e.id) q
    where q.user_id = v_actor and r.lifecycle = 'accepted') cr on true
  where e.id = p_match_event_id and (r.id is not null or public.can_read_match_event(e.id));
  return v_result;
end $$;

revoke all on function public.match_registration_roster(uuid),
  public.match_registration_counts(uuid),
  public.reconcile_match_registration_participation(uuid, uuid),
  public.submit_match_registration(uuid),
  public.decide_match_registration(uuid, uuid, text),
  public.get_my_match_registration(uuid),
  public.list_match_event_registration_requests(uuid),
  public.get_match_event(uuid),
  public.list_match_events(text, uuid, text, integer, timestamptz) from public, anon, authenticated;
revoke all on function public.get_my_notification_target_v2(uuid), public.get_my_match_notification_contexts(uuid[]) from public, anon, authenticated;
grant execute on function public.submit_match_registration(uuid),
  public.decide_match_registration(uuid, uuid, text),
  public.get_my_match_registration(uuid),
  public.list_match_event_registration_requests(uuid),
  public.get_match_event(uuid),
  public.list_match_events(text, uuid, text, integer, timestamptz) to authenticated;
grant execute on function public.get_my_notification_target_v2(uuid), public.get_my_match_notification_contexts(uuid[]) to authenticated;

commit;
