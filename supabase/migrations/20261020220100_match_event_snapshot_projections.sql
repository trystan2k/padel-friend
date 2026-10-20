begin;

-- p_as_of classifies the current accepted roster at that instant; it does not
-- reconstruct historical membership. A cutoff marker written after the
-- requested instant does not close that snapshot.
create function public.match_registration_roster(p_match_event_id uuid, p_as_of timestamptz)
returns table(
  registration_id uuid, user_id uuid, accepted_order bigint, roster_position integer,
  accepted_total integer, playing_total integer, reserve_total integer,
  participation_status public.match_registration_participation)
language sql stable security definer set search_path = '' as $$
  with snapshot as materialized (select coalesce(p_as_of, now()) as as_of),
  cutoff as (
    select e.registration_cutoff_at <= s.as_of
      or state.cutoff_processed_at <= s.as_of as is_closed
    from public.match_events e
    left join public.match_event_registration_state state on state.match_event_id=e.id
    cross join snapshot s where e.id=p_match_event_id
  ), ranked as (
    select r.id, r.user_id, r.accepted_order,
      row_number() over(order by r.accepted_order,r.id)::integer as roster_position,
      count(*) over()::integer as accepted_total
    from public.match_event_registrations r
    where r.match_event_id=p_match_event_id and r.lifecycle='accepted'
  )
  select r.id,r.user_id,r.accepted_order,r.roster_position,r.accepted_total,
    (r.accepted_total/4)*4,r.accepted_total%4,
    case when r.roster_position <= (r.accepted_total/4)*4 then 'playing'::public.match_registration_participation
      when (select c.is_closed from cutoff c) then 'reserve_not_playing'::public.match_registration_participation
      else 'reserve'::public.match_registration_participation end
  from ranked r;
$$;

create function public.match_registration_counts(p_match_event_id uuid, p_as_of timestamptz)
returns table(accepted_count integer, playing_count integer, reserve_count integer, reserve_not_playing_count integer)
language sql stable security definer set search_path = '' as $$
  select coalesce(max(r.accepted_total),0),
    count(*) filter(where r.participation_status='playing')::integer,
    count(*) filter(where r.participation_status='reserve')::integer,
    count(*) filter(where r.participation_status='reserve_not_playing')::integer
  from public.match_registration_roster(p_match_event_id,p_as_of) r;
$$;

-- Preserve revoked access on both snapshot and live helper signatures.
revoke all on function public.match_registration_roster(uuid,timestamptz),
  public.match_registration_counts(uuid,timestamptz) from public,anon,authenticated;
revoke all on function public.match_registration_roster(uuid),
  public.match_registration_counts(uuid) from public,anon,authenticated;

create or replace function public.get_match_event(p_event_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  with snapshot as materialized (select now() as as_of)
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
    'playing_count',n.playing_count,'reserve_count',n.reserve_count,
    'reserve_not_playing_count',n.reserve_not_playing_count,'group_count',n.accepted_count/4,
    'more_needed',4-(n.accepted_count%4),'caller_badge',b.badge,
    'is_past',e.starts_at<=s.as_of,
    'registration_open',e.starts_at>s.as_of and e.registration_cutoff_at>s.as_of
      and (e.maximum_registrations is null or n.accepted_count<e.maximum_registrations),
    'caller_is_invited',caller.caller_is_invited,
    'caller_eligibility',caller.caller_eligibility,
    'caller_requires_approval',caller.caller_requires_approval,
    'as_of',s.as_of)
  from public.match_events e join public.communities c on c.id=e.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  left join public.global_player_ratings g on g.user_id=e.created_by
  cross join snapshot s
  cross join lateral public.match_registration_counts(e.id,s.as_of) n
  cross join lateral (select case when e.created_by=auth.uid() then 'creator'
    when exists(select 1 from public.match_registration_roster(e.id,s.as_of) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
    when exists(select 1 from public.match_registration_roster(e.id,s.as_of) q where q.user_id=auth.uid() and q.participation_status='reserve_not_playing') then 'reserve_not_playing'
    when exists(select 1 from public.match_registration_roster(e.id,s.as_of) q where q.user_id=auth.uid() and q.participation_status='reserve') then 'reserve'
    when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end badge) b
  cross join lateral public.match_event_caller_context(e.id) caller
  where e.id=p_event_id and public.can_read_match_event(e.id)
$$;

create or replace function public.list_match_events(p_entry text,p_community_id uuid default null,p_cursor text default '',p_limit integer default 20,p_as_of timestamptz default now())
returns setof jsonb language sql stable security definer set search_path = '' as $$
  with snapshot as materialized (select coalesce(p_as_of,now()) as as_of),
  parsed as (select split_part(p_cursor,'|',1) instant,split_part(p_cursor,'|',2) id),
  cursor_values as (
    select case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then instant::timestamptz end starts_at,
      case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then id::uuid end event_id from parsed
  ), eligible as (
    select e.*,c.name community_name,p.display_name creator_name,g.display_level creator_level,
      n.accepted_count,n.playing_count,n.reserve_count,n.reserve_not_playing_count,s.as_of,
      case when e.created_by=auth.uid() then 'creator'
        when exists(select 1 from public.match_registration_roster(e.id,s.as_of) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
        when exists(select 1 from public.match_registration_roster(e.id,s.as_of) q where q.user_id=auth.uid() and q.participation_status='reserve_not_playing') then 'reserve_not_playing'
        when exists(select 1 from public.match_registration_roster(e.id,s.as_of) q where q.user_id=auth.uid() and q.participation_status='reserve') then 'reserve'
        when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end caller_badge,
      caller.caller_is_invited,caller.caller_eligibility,caller.caller_requires_approval
    from public.match_events e join public.communities c on c.id=e.community_id
    left join public.player_profiles p on p.user_id=e.created_by
    left join public.global_player_ratings g on g.user_id=e.created_by
    cross join snapshot s
    cross join lateral public.match_registration_counts(e.id,s.as_of) n
    cross join lateral public.match_event_caller_context(e.id) caller
    where public.can_read_match_event(e.id) and (p_community_id is null or e.community_id=p_community_id)
      and case p_entry
        when 'available' then e.visibility='community_open' and e.starts_at>s.as_of and e.registration_cutoff_at>s.as_of and (e.maximum_registrations is null or n.accepted_count<e.maximum_registrations)
        when 'my' then e.starts_at>s.as_of and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()))
        when 'past' then e.starts_at<=s.as_of and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()))
        else false end
  )
  select jsonb_build_object('event_id',e.id,'community_id',e.community_id,'community_name',e.community_name,
    'creator_id',e.created_by,'creator_name',e.creator_name,'creator_level',e.creator_level,'starts_at',e.starts_at,
    'timezone',e.timezone,'event_type',e.event_type,'visibility',e.visibility,'team_assignment_mode',e.team_assignment_mode,
    'venue_name',e.venue_name,'maps_url',e.maps_url,'photo_path',e.photo_path,'court_notes',e.court_notes,
    'duration_minutes',e.duration_minutes,'notes',e.notes,'court_booked',e.court_booked,'restriction_enabled',e.restriction_enabled,
    'min_level',e.min_level,'max_level',e.max_level,'price_minor',e.price_minor,'currency',e.currency,'payment_note',e.payment_note,
    'maximum_registrations',e.maximum_registrations,'registration_cutoff_at',e.registration_cutoff_at,'accepted_count',e.accepted_count,
    'playing_count',e.playing_count,'reserve_count',e.reserve_count,'reserve_not_playing_count',e.reserve_not_playing_count,
    'group_count',e.accepted_count/4,'more_needed',4-(e.accepted_count%4),'caller_badge',e.caller_badge,
    'is_past',e.starts_at<=e.as_of,
    'registration_open',e.starts_at>e.as_of and e.registration_cutoff_at>e.as_of and (e.maximum_registrations is null or e.accepted_count<e.maximum_registrations),
    'caller_is_invited',e.caller_is_invited,'caller_eligibility',e.caller_eligibility,
    'caller_requires_approval',e.caller_requires_approval,'as_of',e.as_of,
    'cursor',to_char(e.starts_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF')||'|'||e.id::text)
  from eligible e cross join cursor_values v
  where (v.starts_at is null or (p_entry='past' and (e.starts_at,e.id)<(v.starts_at,v.event_id)) or (p_entry<>'past' and (e.starts_at,e.id)>(v.starts_at,v.event_id)))
  order by case when p_entry='past' then null else e.starts_at end asc,case when p_entry='past' then null else e.id end asc,
    case when p_entry='past' then e.starts_at end desc,case when p_entry='past' then e.id end desc
  limit least(greatest(coalesce(p_limit,20),1),50)
$$;

revoke all on function public.get_match_event(uuid),
  public.list_match_events(text,uuid,text,integer,timestamptz) from public,anon,authenticated;
grant execute on function public.get_match_event(uuid),
  public.list_match_events(text,uuid,text,integer,timestamptz) to authenticated;

commit;
