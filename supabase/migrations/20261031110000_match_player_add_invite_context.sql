begin;

-- Per-send context for the localized invitation email. GoTrue renders a resent
-- invite from the stored user metadata, so the server refreshes that metadata
-- from this trusted read right before each send. Read-only, service role only,
-- bound to the (actor, event, request) key the dispatch already authorized.
create function public.get_match_player_add_invite_context(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_op public.match_player_add_operations%rowtype;
begin
  select * into v_op from public.match_player_add_operations o
    where o.actor_id = p_actor_id and o.match_event_id = p_match_event_id and o.request_id = p_request_id;
  if v_op.id is null then return null; end if;
  return (
    select pg_catalog.jsonb_build_object(
      'target_user_id', v_op.target_user_id,
      'inviter_name', (select p.display_name from public.player_profiles p where p.user_id = v_op.actor_id),
      'venue_name', e.venue_name,
      'starts_at', e.starts_at,
      'timezone', e.timezone)
    from public.match_events e where e.id = v_op.match_event_id);
end $$;

revoke all on function public.get_match_player_add_invite_context(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_match_player_add_invite_context(uuid, uuid, uuid) to service_role;

commit;
