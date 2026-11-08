-- Ownership first; notification identity never grants access to its target. No read timestamp writes.
create function public.get_my_notification_target_v4(p_notification_id uuid)
returns table (
  target_status text, community_id uuid, community_name text, invitation_id uuid,
  membership_status text, match_event_id uuid, match_available boolean, kind text,
  created_at timestamptz, result_context jsonb, level_review_context jsonb, destination_href text
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_n public.notifications%rowtype;
  v_href text;
  v_legacy record;
  v_league public.leagues%rowtype;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  perform public.assert_actor_not_provisional();
  select n.* into v_n from public.notifications n
    where n.id = p_notification_id and n.recipient_user_id = v_actor;
  if not found then raise exception 'Notification unavailable' using errcode = '42501'; end if;

  if v_n.target_type = 'player_rating' then
    if v_n.category = 'rankings' and v_n.kind = 'rating_changed' and v_n.target_id = v_actor
      and exists (select 1 from public.global_player_ratings r where r.user_id = v_actor) then
      v_href := '/players/' || v_actor::text;
    end if;
  elsif v_n.target_type = 'league' then
    select l.* into v_league from public.leagues l
      where l.id = v_n.target_id and l.community_id = v_n.community_id;
    if found and v_n.category = 'leagues'
      and v_n.kind in ('league_started', 'league_closed', 'league_standings_published', 'league_standings_amended')
      and public.is_community_member(v_league.community_id)
      and (v_league.status <> 'closed' or exists (
        select 1 from public.league_standings_snapshots s where s.league_id = v_league.id
      )) then
      v_href := '/community/' || v_league.community_id::text || '/leagues/' || v_league.id::text;
    end if;
  elsif v_n.target_type = 'level_review_request'
    and v_n.kind in ('level_review_submitted', 'level_review_requested') then
    if v_n.category = 'rankings' and v_n.community_id is null and exists (
      select 1 from public.player_level_review_requests r where r.id = v_n.target_id
        and ((v_n.kind = 'level_review_submitted' and r.owner_id = v_actor)
          or (v_n.kind = 'level_review_requested' and public.is_platform_admin()))
    ) then
      v_href := case when v_n.kind = 'level_review_requested' then '/platform-admin' else '' end
        || '/level-reviews/' || v_n.target_id::text;
    end if;
  else
    select t.* into v_legacy from public.get_my_notification_target_v3(p_notification_id) t;
    return query select v_legacy.target_status, v_legacy.community_id, v_legacy.community_name,
      v_legacy.invitation_id, v_legacy.membership_status, v_legacy.match_event_id,
      v_legacy.match_available, v_legacy.kind, v_legacy.created_at,
      v_legacy.result_context, v_legacy.level_review_context, null::text;
    return;
  end if;
  -- Even an unavailable target carries no name, target ID or stale context.
  return query select case when v_href is null then 'unavailable' else 'destination_available' end,
    null::uuid, null::text, null::uuid, null::text, null::uuid, false,
    v_n.kind, v_n.created_at, null::jsonb, null::jsonb, v_href;
end $$;
revoke all on function public.get_my_notification_target_v4(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_my_notification_target_v4(uuid) to authenticated;
