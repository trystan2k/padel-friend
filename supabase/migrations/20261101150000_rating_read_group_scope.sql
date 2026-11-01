begin;

-- PAF-10 review F1: a player of ONE rated group must not read the other groups of the same
-- event. The event-level reader right is now only the existing result-reader rights (event
-- creator, community admin, accepted registrant). Participation grants access to the
-- requested group alone, checked where a single group is requested.

create or replace function public.rating_can_view_match_event(p_match_event_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.match_events e
     where e.id = p_match_event_id
       and (e.created_by = p_viewer
         or public.is_community_admin(e.community_id)
         or exists (select 1 from public.match_event_registrations r
              where r.match_event_id = e.id and r.user_id = p_viewer
                and r.lifecycle = 'accepted' and r.cancelled_at is null)));
$$;

do $explanation$
declare v_definition text; v_updated text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.get_rating_group_explanation(uuid, bigint)'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    'not public.rating_can_view_match_event(v_event_id, v_uid) then',
    E'not (public.rating_can_view_match_event(v_event_id, v_uid)\n'
    || E'      or exists (select 1 from public.player_rating_events pe\n'
    || E'        where pe.game_group_id = p_game_group_id and pe.user_id = v_uid)) then');
  if v_updated = v_definition then
    raise exception 'Unexpected get_rating_group_explanation definition; refusing to change its access check';
  end if;
  execute v_updated;
end $explanation$;

commit;
