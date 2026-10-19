begin;
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
    'registration_cutoff_at',e.registration_cutoff_at,'accepted_count',n.n,
    'playing_count',(n.n/4)*4,'reserve_count',n.n%4,'group_count',n.n/4,
     'more_needed',4-(n.n%4),'caller_badge',b.badge,
     'is_past',e.starts_at<=now(),
     'registration_open',e.starts_at>now() and e.registration_cutoff_at>now() and (e.maximum_registrations is null or n.n<e.maximum_registrations),
     'caller_is_invited',caller.caller_is_invited,
     'caller_eligibility',caller.caller_eligibility,
     'caller_requires_approval',caller.caller_requires_approval)
  from public.match_events e join public.communities c on c.id=e.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  left join public.global_player_ratings g on g.user_id=e.created_by
  cross join lateral (select count(*)::integer n from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle='accepted') n
   cross join lateral (select case when e.created_by=auth.uid() then 'creator'
    when exists(select 1 from (select r.user_id,row_number() over(order by r.accepted_order,r.id) pos from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle='accepted') q where q.user_id=auth.uid() and q.pos<=((n.n/4)*4)) then 'playing'
    when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') then 'reserve'
     when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end badge) b
   cross join lateral public.match_event_caller_context(e.id) caller
  where e.id=p_event_id and public.can_read_match_event(e.id)
$$;
create or replace function public.list_match_events(p_entry text,p_community_id uuid default null,p_cursor text default '',p_limit integer default 20,p_as_of timestamptz default now())
returns setof jsonb language sql stable security definer set search_path = '' as $$
  with parsed as (select split_part(p_cursor,'|',1) instant,split_part(p_cursor,'|',2) id), cursor_values as (
    select case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then instant::timestamptz end starts_at,
      case when p_cursor like '%|%' and id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' and pg_catalog.pg_input_is_valid(instant,'timestamptz') then id::uuid end event_id from parsed
  ), eligible as (
    select e.*,c.name community_name,p.display_name creator_name,g.display_level creator_level,n.n accepted_count,
       case when e.created_by=auth.uid() then 'creator'
       when exists(select 1 from (select r.user_id,row_number() over(order by r.accepted_order,r.id) pos from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle='accepted') q where q.user_id=auth.uid() and q.pos<=((n.n/4)*4)) then 'playing'
       when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted') then 'reserve'
       when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end caller_badge
       ,caller.caller_eligibility,caller.caller_is_invited,caller.caller_requires_approval
     from public.match_events e join public.communities c on c.id=e.community_id
    left join public.player_profiles p on p.user_id=e.created_by left join public.global_player_ratings g on g.user_id=e.created_by
    cross join lateral (select count(*)::integer n from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle='accepted') n
    cross join lateral public.match_event_caller_context(e.id) caller
    where public.can_read_match_event(e.id) and (p_community_id is null or e.community_id=p_community_id)
      and case p_entry when 'available' then e.visibility='community_open' and e.starts_at>coalesce(p_as_of,now()) and e.registration_cutoff_at>coalesce(p_as_of,now()) and (e.maximum_registrations is null or n.n<e.maximum_registrations)
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
    'playing_count',(e.accepted_count/4)*4,'reserve_count',e.accepted_count%4,'group_count',e.accepted_count/4,
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
create or replace function public.get_my_match_notification_contexts(p_notification_ids uuid[])
returns table(notification_id uuid, match_event_id uuid, creator_display_name text,
  scheduled_at timestamptz, timezone text, venue text, event_type public.match_event_type,
  playing_count integer, reserve_count integer, price_minor bigint, currency text)
language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if coalesce(cardinality(p_notification_ids),0)>50 then raise exception 'Page too large' using errcode='22023'; end if;
  return query
  select n.id,e.id,p.display_name,e.starts_at,e.timezone,e.venue_name,e.event_type,
    (r.n/4)*4,r.n%4,e.price_minor,e.currency
  from public.notifications n
  join public.match_events e on e.id=n.target_id and e.community_id is not distinct from n.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  cross join lateral(select count(*)::integer n from public.match_event_registrations x where x.match_event_id=e.id and x.lifecycle='accepted') r
  where n.id=any(coalesce(p_notification_ids,'{}'::uuid[])) and n.recipient_user_id=auth.uid()
    and n.category='matches' and n.target_type='match_event'
    and n.kind in ('match_event_published','match_event_invitation') and public.can_read_match_event(e.id);
end $$;
revoke all on function public.get_match_event(uuid), public.list_match_events(text,uuid,text,integer,timestamptz), public.get_my_match_notification_contexts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_match_event(uuid), public.list_match_events(text,uuid,text,integer,timestamptz), public.get_my_match_notification_contexts(uuid[]) to authenticated;
commit;
