begin;

-- PAF-5.4 follow-up: expose Reserve Not Playing on the flat event DTO.
--
-- The cutoff migration deliberately left the new count out of get_match_event /
-- list_match_events because adding a flat key breaks the exact-key contract test;
-- this additive migration closes that gap now that the contract update is in
-- scope. Both read projections keep every existing key and the flat primitive
-- DTO shape, and derive the count from match_registration_counts so there is
-- still exactly one source of truth (reserve_count excludes not-playing).
-- Return types are unchanged (jsonb / setof jsonb), so create or replace keeps
-- the existing signatures, security definer + empty search_path discipline and
-- the browser-executable grant model (re-asserted below).

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
    'playing_count',n.playing_count,'reserve_count',n.reserve_count,
    'reserve_not_playing_count',n.reserve_not_playing_count,'group_count',n.accepted_count/4,
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
    when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='reserve_not_playing') then 'reserve_not_playing'
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
       n.accepted_count, n.playing_count, n.reserve_count, n.reserve_not_playing_count,
       case when e.created_by=auth.uid() then 'creator'
       when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='playing') then 'playing'
       when exists(select 1 from public.match_registration_roster(e.id) q where q.user_id=auth.uid() and q.participation_status='reserve_not_playing') then 'reserve_not_playing'
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
    'playing_count',e.playing_count,'reserve_count',e.reserve_count,
    'reserve_not_playing_count',e.reserve_not_playing_count,'group_count',e.accepted_count/4,
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

-- ACL: both read RPCs stay browser-executable for authenticated callers only;
-- internal helpers are untouched. Re-asserted so the replacement cannot drift
-- from the existing grant model.
revoke all on function public.get_match_event(uuid),
  public.list_match_events(text, uuid, text, integer, timestamptz) from public, anon, authenticated;
grant execute on function public.get_match_event(uuid),
  public.list_match_events(text, uuid, text, integer, timestamptz) to authenticated;

commit;
