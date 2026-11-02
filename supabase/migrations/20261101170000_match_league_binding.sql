begin;

-- PAF-11 / U2: durable League binding for Ranked match events.
--
-- Contract (docs/plan/Plan PAF-11 T11, "Shared implementation contracts" and U2):
--   * match_events.league_id is the single source of truth: NULL = Unranked, non-null = Ranked in
--     that League. There is deliberately no independently mutable is_ranked flag.
--   * Only Competitive events can carry a League; the League must belong to the event's community
--     (composite FK) and must already exist when the event is first published. The column is not
--     in guard_match_event_mutation()'s editable list, so no later League (or edit/tampering) can
--     claim an earlier event. Every pre-existing event stays NULL (Unranked): nothing is backfilled.
--   * publish_match_event validates the binding under the community lock plus a League row lock,
--     and replay equality includes it, so a retry with a conflicting intent fails with MATCH_CONFLICT.
--   * Members-only admission: every writer of an accepted/pending registration or invitation on a
--     Ranked event requires current active community membership of the TARGET (provisional members
--     included). Actor restrictions (assert_actor_not_provisional) are unchanged. No new error
--     reveals whether an email belongs to an account.

alter table public.match_events add column league_id uuid;
alter table public.match_events
  add constraint match_events_league_fk foreign key (league_id, community_id)
    references public.leagues (id, community_id) on delete restrict,
  add constraint match_events_league_competitive_only check (league_id is null or event_type = 'competitive');
create index match_events_league_id on public.match_events (league_id, starts_at) where league_id is not null;

-- 1. Shared binding rule. Caller holds the community lock; the League row is share-locked so a
-- concurrent League command (which also holds the community lock first) cannot interleave.
create function public.assert_match_league_binding(
  p_community_id uuid, p_league_id uuid, p_starts_at timestamptz, p_event_type public.match_event_type,
  p_published_at timestamptz default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_league public.leagues%rowtype;
begin
  if p_league_id is null then return; end if;
  if p_event_type <> 'competitive' then
    raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED';
  end if;
  select * into v_league from public.leagues l where l.id = p_league_id and l.community_id = p_community_id for share;
  -- Unknown and cross-community Leagues are indistinguishable.
  if not found or (p_published_at is not null and v_league.created_at > p_published_at) then
    raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_NOT_FOUND';
  end if;
  if v_league.status = 'closed' then
    raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_CLOSED';
  end if;
  if p_starts_at < v_league.start_at or (v_league.end_at is not null and p_starts_at > v_league.end_at) then
    raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_OUT_OF_PERIOD';
  end if;
end $$;

-- Defense in depth for direct writers: insert re-validates the whole binding with the database
-- publication time as existence anchor; an update may not move a bound event outside its League
-- window or turn it Friendly (U3 adds the explicit repair/consent flow on top of this floor).
create function public.guard_match_event_league_binding() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    perform public.assert_match_league_binding(new.community_id, new.league_id, new.starts_at,
      new.event_type, new.published_at);
  elsif new.league_id is not null then
    if new.event_type <> 'competitive' then
      raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED';
    end if;
    if new.starts_at is distinct from old.starts_at then
      perform public.assert_match_league_window(new.league_id, new.community_id, new.starts_at);
    end if;
  end if;
  return new;
end $$;

create function public.assert_match_league_window(p_league_id uuid, p_community_id uuid, p_starts_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare v_league public.leagues%rowtype;
begin
  select * into v_league from public.leagues l where l.id = p_league_id and l.community_id = p_community_id for share;
  if not found or p_starts_at < v_league.start_at or (v_league.end_at is not null and p_starts_at > v_league.end_at) then
    raise exception using errcode = 'P0001', message = 'MATCH_LEAGUE_OUT_OF_PERIOD';
  end if;
end $$;

create trigger match_event_league_binding before insert or update on public.match_events
  for each row execute function public.guard_match_event_league_binding();

-- 2. Derived competition projection merged into the event readers. League identity is shown only
-- to active members of the event's community; everyone else only learns the event is Ranked.
create function public.match_event_competition(p_event_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'competition_status', case when e.event_type = 'competitive'
      then case when e.league_id is null then 'unranked' else 'ranked' end end,
    'league_id', case when public.is_community_member(e.community_id) then e.league_id end,
    'league_name', case when public.is_community_member(e.community_id)
      then (select l.name from public.leagues l where l.id = e.league_id) end)
  from public.match_events e where e.id = p_event_id;
$$;

-- 3. Eligible League options for the intended schedule (browser reader).
create function public.list_match_league_options(p_community_id uuid, p_date text, p_start_time text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_timezone text; v_start timestamptz;
begin
  perform public.assert_actor_not_provisional();
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_community_id is null or not public.is_community_member(p_community_id) then
    raise exception using errcode = '42501';
  end if;
  select public.get_effective_community_admin_defaults(c.settings)->>'timezone' into v_timezone
    from public.communities c where c.id = p_community_id;
  begin
    v_start := public.match_event_local_start(p_date, p_start_time, v_timezone);
  exception when others then
    -- Every malformed schedule (impossible day, DST gap, bad time) is the same input error.
    raise exception using errcode = '22023';
  end;
  return pg_catalog.jsonb_build_object(
    'starts_at', public.league_utc_text(v_start),
    'leagues', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'id', l.id, 'name', l.name, 'status', l.status, 'end_mode', l.end_mode, 'timezone', l.timezone,
        'start_at', public.league_utc_text(l.start_at), 'end_at', public.league_utc_text(l.end_at),
        'start_date', ((l.start_at at time zone l.timezone)::date)::text,
        'end_date', ((l.end_at at time zone l.timezone)::date)::text) order by l.start_at, l.id)
      from public.leagues l
      where l.community_id = p_community_id and l.status in ('upcoming', 'active')
        and l.start_at <= v_start and (l.end_at is null or v_start <= l.end_at)), '[]'::jsonb));
end $$;

-- 4. publish_match_event: strict allowlist gains `competition` and `league_id`.
create or replace function public.publish_match_event(p_event_id uuid, p_input jsonb, p_invitee_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $function$
declare
  v_uid uuid := auth.uid();
  v_community uuid;
  v_row public.match_events%rowtype;
  v_existing boolean;
  v_start timestamptz;
  v_cutoff timestamptz;
  v_timezone text;
  v_price numeric;
  v_minor bigint;
  v_currency text;
  v_duration integer;
  v_maximum integer;
  v_creator_level numeric;
  v_restriction_enabled boolean;
  v_min_level numeric;
  v_max_level numeric;
  v_league uuid;
  v_competition text;
begin perform public.assert_actor_not_provisional();
  if v_uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception using errcode='28000'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or p_input - array['community_id','date','start_time','event_type','visibility','team_assignment_mode','venue_name','maps_url','photo_path','saved_venue_id','court_notes','duration_minutes','notes','court_booked','restriction_enabled','min_level','max_level','price','currency','payment_note','maximum_registrations','cutoff_at','competition','league_id'] <> '{}'::jsonb then raise exception using errcode='22023'; end if;
  v_community := (p_input->>'community_id')::uuid;
  perform 1 from public.communities c where c.id=v_community for update;
  if not found or not public.is_community_member(v_community) then raise exception using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text, 73073));
  select * into v_row from public.match_events where id=p_event_id;
  v_existing := found;
  if v_existing and v_row.published_by<>v_uid then raise exception using errcode='42501'; end if;

  -- Competition intent: Ranked needs an explicit League, Unranked must not carry one, Friendly
  -- carries neither. Absent `competition` is derived from league_id (so legacy payloads stay Unranked).
  if nullif(p_input->>'league_id','') is not null and not pg_catalog.pg_input_is_valid(p_input->>'league_id','uuid') then
    raise exception using errcode='22023';
  end if;
  v_league := nullif(p_input->>'league_id','')::uuid;
  v_competition := coalesce(p_input->>'competition', case when v_league is null then 'unranked' else 'ranked' end);
  if v_competition not in ('ranked','unranked') then raise exception using errcode='22023'; end if;
  if (p_input->>'event_type') = 'friendly' and (v_competition = 'ranked' or v_league is not null) then
    raise exception using errcode='P0001', message='MATCH_LEAGUE_FRIENDLY_NOT_ALLOWED';
  end if;
  if v_competition = 'ranked' and v_league is null then
    raise exception using errcode='P0001', message='MATCH_LEAGUE_SELECTION_REQUIRED';
  end if;
  if v_competition = 'unranked' and v_league is not null then
    raise exception using errcode='P0001', message='MATCH_LEAGUE_INTENT_CONFLICT';
  end if;

  if v_existing then
    v_timezone := v_row.timezone;
  else
    select public.get_effective_community_admin_defaults(c.settings)->>'timezone'
      into v_timezone from public.communities c where c.id=v_community;
  end if;

  select r.display_level into v_creator_level from public.global_player_ratings r where r.user_id=v_uid;
  if not v_existing and (p_input->>'event_type')='competitive' and v_creator_level is null then raise exception using errcode='23514'; end if;
  v_restriction_enabled := coalesce((p_input->>'restriction_enabled')::boolean,false);
  v_min_level := nullif(p_input->>'min_level','')::numeric;
  v_max_level := nullif(p_input->>'max_level','')::numeric;
  if v_restriction_enabled then
    if v_min_level is null and v_max_level is null then
      if v_existing then
        v_min_level := v_row.min_level;
        v_max_level := v_row.max_level;
      else
        if v_creator_level is null then raise exception using errcode='23514'; end if;
        v_min_level := greatest(0,v_creator_level-0.5);
        v_max_level := least(7,v_creator_level+1.5);
      end if;
    elsif v_min_level is null or v_max_level is null then
      raise exception using errcode='23514';
    end if;
    if v_min_level in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or v_max_level in ('NaN'::numeric,'Infinity'::numeric,'-Infinity'::numeric)
      or v_min_level < 0 or v_min_level > v_max_level or v_max_level > 7 then
      raise exception using errcode='23514';
    end if;
  else
    if v_min_level is not null or v_max_level is not null then raise exception using errcode='23514'; end if;
    v_min_level := null;
    v_max_level := null;
  end if;

  v_start := public.match_event_local_start(p_input->>'date',p_input->>'start_time',v_timezone);
  v_cutoff := coalesce(nullif(p_input->>'cutoff_at','')::timestamptz,v_start-interval '1 hour');
  if v_cutoff >= v_start then raise exception using errcode='22023'; end if;
  if p_input ? 'duration_minutes' and nullif(p_input->>'duration_minutes','') is not null then
    if p_input->>'duration_minutes' !~ '^[0-9]+$' then raise exception using errcode='22023'; end if;
    v_duration := (p_input->>'duration_minutes')::integer;
    if v_duration <= 0 then raise exception using errcode='22023'; end if;
  end if;
  if p_input ? 'currency' and p_input->>'currency' not in ('BRL','USD','EUR') then raise exception using errcode='22023'; end if;
  v_currency := nullif(p_input->>'currency','');
  if p_input ? 'price' and nullif(p_input->>'price','') is not null then
    if p_input->>'price' !~ '^[0-9]+(\.[0-9]{1,2})?$' then raise exception using errcode='22023'; end if;
    v_price := (p_input->>'price')::numeric;
    v_minor := (round(v_price*100))::bigint;
    if v_minor > 9007199254740991 then raise exception using errcode='22023'; end if;
    v_currency := coalesce(v_currency,'BRL');
  end if;
  v_maximum := nullif(p_input->>'maximum_registrations','')::integer;

  if v_existing then
    if v_row.community_id is not distinct from v_community
      and v_row.starts_at is not distinct from v_start
      and v_row.timezone is not distinct from v_timezone
      and v_row.event_type is not distinct from (p_input->>'event_type')::public.match_event_type
      and v_row.league_id is not distinct from v_league
      and v_row.visibility is not distinct from (p_input->>'visibility')::public.match_event_visibility
      and v_row.team_assignment_mode is not distinct from (p_input->>'team_assignment_mode')::public.match_team_assignment_mode
      and v_row.venue_name is not distinct from (p_input->>'venue_name')
      and v_row.maps_url is not distinct from (p_input->>'maps_url')
      and v_row.photo_path is not distinct from (p_input->>'photo_path')
      and v_row.saved_venue_id is not distinct from nullif(p_input->>'saved_venue_id','')::uuid
      and v_row.court_notes is not distinct from nullif(p_input->>'court_notes','')
      and v_row.duration_minutes is not distinct from v_duration
      and v_row.notes is not distinct from nullif(p_input->>'notes','')
      and v_row.court_booked is not distinct from coalesce((p_input->>'court_booked')::boolean,false)
      and v_row.restriction_enabled is not distinct from v_restriction_enabled
      and v_row.min_level is not distinct from v_min_level
      and v_row.max_level is not distinct from v_max_level
      and v_row.price_minor is not distinct from v_minor
      and v_row.currency is not distinct from v_currency
      and v_row.payment_note is not distinct from nullif(p_input->>'payment_note','')
      and v_row.maximum_registrations is not distinct from v_maximum
      and v_row.registration_cutoff_at is not distinct from v_cutoff
      and not exists(select 1 from unnest(coalesce(p_invitee_ids,'{}'::uuid[])) x where not exists(select 1 from public.match_event_invites i where i.match_event_id=p_event_id and i.invitee_user_id=x))
      and not exists(select 1 from public.match_event_invites i where i.match_event_id=p_event_id and not (i.invitee_user_id=any(coalesce(p_invitee_ids,'{}'::uuid[])))) then
      return p_event_id;
    end if;
    raise exception using errcode='P0001', message='MATCH_CONFLICT';
  end if;

  -- Fresh publication only: the League must exist now, belong to this community, be Active/Upcoming
  -- and cover the intended start. An already published event is never re-validated on replay.
  perform public.assert_match_league_binding(v_community, v_league, v_start,
    (p_input->>'event_type')::public.match_event_type);
  -- Ranked invitees must be current active members (this also covers provisional members).
  if exists(select 1 from unnest(coalesce(p_invitee_ids,'{}'::uuid[])) x where x=v_uid or not exists(select 1 from public.community_members m where m.community_id=v_community and m.user_id=x and m.status='active')) then raise exception using errcode='23514'; end if;
  if p_input ? 'saved_venue_id' and p_input->>'saved_venue_id' is not null and not exists(select 1 from public.community_venues v where v.id=(p_input->>'saved_venue_id')::uuid and v.community_id=v_community and v.archived_at is null) then raise exception using errcode='23514'; end if;
  if not public.valid_match_maps_url(p_input->>'maps_url') then raise exception using errcode='22023'; end if;
  insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,league_id,visibility,team_assignment_mode,venue_name,maps_url,photo_path,saved_venue_id,court_notes,duration_minutes,notes,court_booked,restriction_enabled,min_level,max_level,price_minor,currency,payment_note,maximum_registrations,registration_cutoff_at)
    values(p_event_id,v_community,v_uid,v_start,v_timezone,(p_input->>'event_type')::public.match_event_type,v_league,(p_input->>'visibility')::public.match_event_visibility,(p_input->>'team_assignment_mode')::public.match_team_assignment_mode,p_input->>'venue_name',p_input->>'maps_url',p_input->>'photo_path',nullif(p_input->>'saved_venue_id','')::uuid,nullif(p_input->>'court_notes',''),v_duration,nullif(p_input->>'notes',''),coalesce((p_input->>'court_booked')::boolean,false),v_restriction_enabled,v_min_level,v_max_level,v_minor,v_currency,nullif(p_input->>'payment_note',''),v_maximum,v_cutoff);
  insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) select p_event_id,x,v_uid from (select distinct unnest(coalesce(p_invitee_ids,'{}'::uuid[])) x) q where x<>v_uid;
  return p_event_id;
end $function$;

-- 5. Members-only admission on every writer of the Ranked path.
alter table public.match_player_add_operations drop constraint match_player_add_operations_outcome_check;
alter table public.match_player_add_operations add constraint match_player_add_operations_outcome_check
  check (outcome = any (array['invited','already_invited','self','registered','already_registered',
    'membership_conflict','invitation_closed','ranked_members_only']));

do $$
declare d text;
begin
  -- Ordinary request / direct join / re-entry / invitation acceptance / provisional add all end in
  -- this single registration primitive: deny a Ranked nonmember before any persistence.
  d := pg_get_functiondef('public.submit_match_registration_locked(uuid,uuid)'::regprocedure);
  d := replace(d, 'v_member:=public.match_registration_is_member(v_event.community_id,p_actor_id);',
    'v_member:=public.match_registration_is_member(v_event.community_id,p_actor_id);
  if v_event.league_id is not null and not v_member then
    raise exception ''MATCH_REGISTRATION_RANKED_MEMBERS_ONLY'' using errcode=''P0001''; end if;');
  if position('MATCH_REGISTRATION_RANKED_MEMBERS_ONLY' in d) = 0 then raise exception 'submit extension failed'; end if;
  execute d;

  -- Organizer approval re-checks CURRENT membership of the requester whatever the stored source.
  d := pg_get_functiondef('public.decide_match_registration(uuid,uuid,text)'::regprocedure);
  d := replace(d, 'if (v_row.registration_source=''member'' and not public.match_registration_is_member(v_event.community_id,v_row.user_id))',
    'if (v_event.league_id is not null and not public.match_registration_is_member(v_event.community_id,v_row.user_id))
      or (v_row.registration_source=''member'' and not public.match_registration_is_member(v_event.community_id,v_row.user_id))');
  if position('v_event.league_id is not null' in d) = 0 then raise exception 'decide extension failed'; end if;
  execute d;

  -- Add by email: a registered nonmember never receives a Ranked invitation. The caller's response
  -- stays blind (status ok), so nothing reveals whether the address belongs to an account.
  d := pg_get_functiondef('public.complete_match_player_add_locked(uuid,uuid,boolean)'::regprocedure);
  d := replace(d, E'v_outcome := ''self'';\n    else',
    E'v_outcome := ''self'';\n    elsif v_event.league_id is not null\n      and not public.match_registration_is_member(v_event.community_id, p_user_id) then\n      v_outcome := ''ranked_members_only'';\n    else');
  if position('ranked_members_only' in d) = 0 then raise exception 'player add extension failed'; end if;
  execute d;

  -- Invitee capability: a pending invite on a Ranked event is not acceptable once membership is gone.
  d := pg_get_functiondef('public.get_my_match_invitation(uuid)'::regprocedure);
  d := replace(d, '''expires_at'', e.registration_cutoff_at, ''responded_at'', i.responded_at)',
    '''expires_at'', e.registration_cutoff_at, ''responded_at'', i.responded_at,
    ''ranked_members_only'', e.league_id is not null and not public.match_registration_is_member(e.community_id, auth.uid()))');
  if position('ranked_members_only' in d) = 0 then raise exception 'invitation extension failed'; end if;
  execute d;

  d := pg_get_functiondef('public.get_match_event(uuid)'::regprocedure);
  d := replace(d, '''as_of'',s.as_of)', '''as_of'',s.as_of) || public.match_event_competition(e.id)');
  if position('match_event_competition' in d) = 0 then raise exception 'detail extension failed'; end if;
  execute d;

  d := pg_get_functiondef('public.list_match_events(text,uuid,text,integer,timestamptz)'::regprocedure);
  d := replace(d, '||''|''||e.id::text)', '||''|''||e.id::text) || public.match_event_competition(e.id)');
  if position('match_event_competition' in d) = 0 then raise exception 'list extension failed'; end if;
  execute d;
end $$;

-- Capability: a nonmember who can read a Ranked event sees a members-only denial, never a guest CTA.
create or replace function public.match_event_caller_context(p_event_id uuid)
returns table(caller_is_invited boolean, caller_eligibility text, caller_requires_approval boolean)
language sql stable security definer set search_path = '' as $$
  select
    exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid())) as caller_is_invited,
    case
      when e.created_by=(select auth.uid()) then 'creator'
      when exists(select 1 from public.community_members m where m.community_id=e.community_id and m.user_id=(select auth.uid()) and m.status='active') then
        case when not e.restriction_enabled or exists(select 1 from public.global_player_ratings r where r.user_id=(select auth.uid()) and r.display_level between e.min_level and e.max_level) then 'member' else 'out_of_range' end
      when e.league_id is not null then 'ranked_members_only'
      when (e.visibility='community_open' and c.visibility='public')
        or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid())) then 'nonmember'
      else null::text
    end as caller_eligibility,
    case
      when e.created_by=(select auth.uid()) then false
      when exists(select 1 from public.community_members m where m.community_id=e.community_id and m.user_id=(select auth.uid()) and m.status='active') then
        e.restriction_enabled and not exists(select 1 from public.global_player_ratings r where r.user_id=(select auth.uid()) and r.display_level between e.min_level and e.max_level)
      when e.league_id is not null then false
      when (e.visibility='community_open' and c.visibility='public')
        or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid())) then true
      else false
    end as caller_requires_approval
  from public.match_events e join public.communities c on c.id=e.community_id
  where e.id=p_event_id and public.can_read_match_event(e.id)
$$;

revoke all on function public.assert_match_league_binding(uuid, uuid, timestamptz, public.match_event_type, timestamptz),
  public.assert_match_league_window(uuid, uuid, timestamptz), public.guard_match_event_league_binding(),
  public.match_event_competition(uuid), public.list_match_league_options(uuid, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.list_match_league_options(uuid, text, text) to authenticated;

commit;
