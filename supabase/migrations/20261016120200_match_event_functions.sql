create or replace function public.match_event_local_start(p_date text, p_time text, p_zone text)
returns timestamptz language plpgsql immutable set search_path = '' as $$
declare v_local timestamp; v_first timestamptz; v_second timestamptz;
begin
  if p_date !~ '^\d{4}-\d{2}-\d{2}$' or p_time !~ '^\d{2}:\d{2}(:\d{2})?$' then raise exception using errcode='22023'; end if;
  v_local := (p_date || ' ' || p_time)::timestamp;
  if to_char(v_local,'YYYY-MM-DD HH24:MI:SS') <> to_char(v_local,'YYYY-MM-DD') || ' ' || (case when length(p_time)=5 then p_time||':00' else p_time end) then raise exception using errcode='22023'; end if;
  v_first := v_local at time zone p_zone;
  if (v_first at time zone p_zone) <> v_local then raise exception using errcode='22023'; end if;
  v_second := v_first - interval '1 hour';
  if (v_second at time zone p_zone) = v_local and v_second < v_first then return v_second; end if;
  return v_first;
exception when invalid_datetime_format or invalid_parameter_value then raise exception using errcode='22023';
end $$;

create or replace function public.publish_match_event(p_event_id uuid, p_input jsonb, p_invitee_ids uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
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
begin
  if v_uid is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception using errcode='28000'; end if;
  if p_input is null or jsonb_typeof(p_input)<>'object' or p_input - array['community_id','date','start_time','event_type','visibility','team_assignment_mode','venue_name','maps_url','photo_path','saved_venue_id','court_notes','duration_minutes','notes','court_booked','restriction_enabled','min_level','max_level','price','currency','payment_note','maximum_registrations','cutoff_at'] <> '{}'::jsonb then raise exception using errcode='22023'; end if;
  v_community := (p_input->>'community_id')::uuid;
  perform 1 from public.communities c where c.id=v_community for update;
  if not found or not public.is_community_member(v_community) then raise exception using errcode='42501'; end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_event_id::text, 73073));
  select * into v_row from public.match_events where id=p_event_id;
  v_existing := found;
  if v_existing and v_row.created_by<>v_uid then raise exception using errcode='42501'; end if;
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

  if exists(select 1 from unnest(coalesce(p_invitee_ids,'{}'::uuid[])) x where x=v_uid or not exists(select 1 from public.community_members m where m.community_id=v_community and m.user_id=x and m.status='active')) then raise exception using errcode='23514'; end if;
  if p_input ? 'saved_venue_id' and p_input->>'saved_venue_id' is not null and not exists(select 1 from public.community_venues v where v.id=(p_input->>'saved_venue_id')::uuid and v.community_id=v_community and v.archived_at is null) then raise exception using errcode='23514'; end if;
  if not public.valid_match_maps_url(p_input->>'maps_url') then raise exception using errcode='22023'; end if;
  insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,saved_venue_id,court_notes,duration_minutes,notes,court_booked,restriction_enabled,min_level,max_level,price_minor,currency,payment_note,maximum_registrations,registration_cutoff_at)
    values(p_event_id,v_community,v_uid,v_start,v_timezone,(p_input->>'event_type')::public.match_event_type,(p_input->>'visibility')::public.match_event_visibility,(p_input->>'team_assignment_mode')::public.match_team_assignment_mode,p_input->>'venue_name',p_input->>'maps_url',p_input->>'photo_path',nullif(p_input->>'saved_venue_id','')::uuid,nullif(p_input->>'court_notes',''),v_duration,nullif(p_input->>'notes',''),coalesce((p_input->>'court_booked')::boolean,false),v_restriction_enabled,v_min_level,v_max_level,v_minor,v_currency,nullif(p_input->>'payment_note',''),v_maximum,v_cutoff);
  insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by) select p_event_id,x,v_uid from (select distinct unnest(coalesce(p_invitee_ids,'{}'::uuid[])) x) q where x<>v_uid;
  return p_event_id;
end $$;

create or replace function public.get_match_creation_options(p_community_id uuid default null)
returns jsonb language sql stable security definer set search_path = '' as $$
 select jsonb_build_object(
 'communities',coalesce((select jsonb_agg(jsonb_build_object('id',c.id,'name',c.name,'timezone',public.get_effective_community_admin_defaults(c.settings)->>'timezone','currency',coalesce(c.settings->>'currency','EUR'))) from public.communities c where public.is_community_member(c.id) and (p_community_id is null or c.id=p_community_id)),'[]'::jsonb),
 'level_defaults',(select case when r.display_level is null then jsonb_build_object('min',null,'max',null,'level',null) else jsonb_build_object('min',greatest(0,r.display_level-0.5),'max',least(7,r.display_level+1.5),'level',r.display_level) end from public.global_player_ratings r where r.user_id=auth.uid()),
 'saved_venues',coalesce((select jsonb_agg(jsonb_build_object('id',v.id,'name',v.name,'photo_path',v.photo_path,'maps_url',v.maps_url) order by v.name,v.id) from public.community_venues v where p_community_id is not null and v.community_id=p_community_id and v.archived_at is null and public.is_community_member(v.community_id)),'[]'::jsonb))
$$;
create or replace function public.search_match_invitees(p_community_id uuid,p_query text,p_limit integer)
returns table(user_id uuid,display_name text) language sql stable security definer set search_path = '' as $$
 select p.user_id,coalesce(p.display_name,'') from public.community_members m join public.player_profiles p on p.user_id=m.user_id
  where m.community_id=p_community_id and m.status='active' and public.is_community_member(p_community_id) and m.user_id <> auth.uid() and length(btrim(p_query))>=3 and p.display_name ilike '%'||replace(replace(replace(btrim(p_query),'\','\\'),'%','\%'),'_','\_')||'%' escape '\'
 order by p.display_name,p.user_id limit least(greatest(p_limit,1),20)
$$;
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
     'caller_eligibility',elig.value,
     'caller_requires_approval',coalesce(elig.value in ('out_of_range','nonmember'),false))
  from public.match_events e join public.communities c on c.id=e.community_id
  left join public.player_profiles p on p.user_id=e.created_by
  left join public.global_player_ratings g on g.user_id=e.created_by
  cross join lateral (select count(*)::integer n from public.match_event_registrations r where r.match_event_id=e.id) n
   cross join lateral (select case when e.created_by=auth.uid() then 'creator'
    when exists(select 1 from (select r.user_id,row_number() over(order by r.accepted_at,r.id) pos from public.match_event_registrations r where r.match_event_id=e.id) q where q.user_id=auth.uid() and q.pos<=((n.n/4)*4)) then 'playing'
    when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid()) then 'reserve'
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
    select e.*,c.name community_name,p.display_name creator_name,g.display_level creator_level,n.n accepted_count,
       case when e.created_by=auth.uid() then 'creator'
       when exists(select 1 from (select r.user_id,row_number() over(order by r.accepted_at,r.id) pos from public.match_event_registrations r where r.match_event_id=e.id) q where q.user_id=auth.uid() and q.pos<=((n.n/4)*4)) then 'playing'
       when exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid()) then 'reserve'
       when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited' else null end caller_badge
       ,case when e.created_by=auth.uid() then 'creator'
         when exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()) then 'invited'
         when exists(select 1 from public.community_members m where m.community_id=e.community_id and m.user_id=auth.uid() and m.status='active') then
           case when not e.restriction_enabled or exists(select 1 from public.global_player_ratings r where r.user_id=auth.uid() and r.display_level between e.min_level and e.max_level) then 'member' else 'out_of_range' end
         when auth.uid() is not null and e.visibility='community_open' and c.visibility='public' then 'nonmember' else null end caller_eligibility
     from public.match_events e join public.communities c on c.id=e.community_id
    left join public.player_profiles p on p.user_id=e.created_by left join public.global_player_ratings g on g.user_id=e.created_by
    cross join lateral (select count(*)::integer n from public.match_event_registrations r where r.match_event_id=e.id) n
    where public.can_read_match_event(e.id) and (p_community_id is null or e.community_id=p_community_id)
      and case p_entry when 'available' then e.visibility='community_open' and e.starts_at>coalesce(p_as_of,now()) and e.registration_cutoff_at>coalesce(p_as_of,now()) and (e.maximum_registrations is null or n.n<e.maximum_registrations)
      when 'my' then e.starts_at>coalesce(p_as_of,now()) and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid()) or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()))
      when 'past' then e.starts_at<=coalesce(p_as_of,now()) and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid()) or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid())) else false end
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
     'caller_eligibility',e.caller_eligibility,
     'caller_requires_approval',coalesce(e.caller_eligibility in ('out_of_range','nonmember'),false),
    'cursor',to_char(e.starts_at,'YYYY-MM-DD"T"HH24:MI:SS.USOF')||'|'||e.id::text)
  from eligible e cross join cursor_values v
  where (v.starts_at is null or (p_entry='past' and (e.starts_at,e.id)<(v.starts_at,v.event_id)) or (p_entry<>'past' and (e.starts_at,e.id)>(v.starts_at,v.event_id)))
  order by case when p_entry='past' then null else e.starts_at end asc,case when p_entry='past' then null else e.id end asc,
    case when p_entry='past' then e.starts_at end desc,case when p_entry='past' then e.id end desc
  limit least(greatest(coalesce(p_limit,20),1),50)
$$;
revoke all on function public.match_event_local_start(text,text,text), public.publish_match_event(uuid,jsonb,uuid[]), public.get_match_creation_options(uuid), public.search_match_invitees(uuid,text,integer), public.get_match_event(uuid), public.list_match_events(text,uuid,text,integer,timestamptz) from public, anon, authenticated;
grant execute on function public.publish_match_event(uuid,jsonb,uuid[]), public.get_match_creation_options(uuid), public.search_match_invitees(uuid,text,integer), public.get_match_event(uuid), public.list_match_events(text,uuid,text,integer,timestamptz) to authenticated;
