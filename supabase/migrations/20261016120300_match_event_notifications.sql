create or replace function public.notify_match_event_published()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_member record;
begin
  if new.visibility = 'community_open' then
    for v_member in
      select m.user_id from public.community_members m
      where m.community_id = new.community_id and m.status = 'active'
        and m.valid_from <= pg_catalog.now()
        and (m.valid_until is null or m.valid_until > pg_catalog.now())
        and m.user_id <> new.created_by
    loop
      perform public.persist_notification(v_member.user_id,
        'match.event_published:' || new.id::text, 'match_event_published', 'matches',
        'match_event', new.id, new.community_id);
    end loop;
  end if;
  return new;
end $$;
create trigger match_event_published_notification after insert on public.match_events
for each row execute function public.notify_match_event_published();

create or replace function public.notify_match_event_invitation()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_community uuid;
begin
  select e.community_id into v_community from public.match_events e where e.id = new.match_event_id;
  perform public.persist_notification(new.invitee_user_id,
    'match.invitation:' || new.id::text, 'match_event_invitation', 'matches',
    'match_event', new.match_event_id, v_community);
  return new;
end $$;
create trigger match_event_invitation_notification after insert on public.match_event_invites
for each row execute function public.notify_match_event_invitation();

create function public.get_my_notification_target_v2(p_notification_id uuid)
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
  if v_n.kind in ('match_event_published','match_event_invitation') and v_n.category='matches' and v_n.target_type='match_event' then
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

create function public.get_my_match_notification_contexts(p_notification_ids uuid[])
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
  cross join lateral(select count(*)::integer n from public.match_event_registrations x where x.match_event_id=e.id) r
  where n.id=any(coalesce(p_notification_ids,'{}'::uuid[])) and n.recipient_user_id=auth.uid()
    and n.category='matches' and n.target_type='match_event'
    and n.kind in ('match_event_published','match_event_invitation') and public.can_read_match_event(e.id);
end $$;
revoke all on function public.notify_match_event_published(), public.notify_match_event_invitation(), public.get_my_notification_target_v2(uuid), public.get_my_match_notification_contexts(uuid[]) from public, anon, authenticated;
grant execute on function public.get_my_notification_target_v2(uuid), public.get_my_match_notification_contexts(uuid[]) to authenticated;
