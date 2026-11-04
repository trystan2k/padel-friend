begin;

-- PAF-151 / T14.5: resolution notifications and the owner's safe notification target.
--
-- The approved/rejected in-app notice is produced by a trigger on the SAME row update that
-- resolves the request, so the notification commits or rolls back with the decision (and, for
-- approval, with the immutable rating adjustment). It reuses the existing notification store:
-- stable event key, category rankings, target_type level_review_request, no community. In-app
-- delivery has no preference gate (push preferences only affect external delivery), so a push
-- opt-out cannot suppress it. Owner cancellation and under_review never notify.
--
-- The audit chain needs no extra table: the request row already carries each transition's
-- actor and instant (under_review_at/by, canceled_at, decision_actor_id/decided_at/note), the
-- unique adjustment links back through adjustment_id, and the notification target ID is the
-- request ID. Terminal rows and adjustments are immutable and undeletable.

create function public.notify_level_review_resolution() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status in ('approved', 'rejected') and old.status in ('pending', 'under_review') then
    perform public.persist_notification(new.owner_id, 'level-review:' || new.id::text || ':resolved',
      case new.status when 'approved' then 'level_review_approved' else 'level_review_rejected' end,
      'rankings', 'level_review_request', new.id, null);
  end if;
  return null;
end $$;
revoke all on function public.notify_level_review_resolution() from public, anon, authenticated, service_role;
create trigger level_review_resolution_notification after update on public.player_level_review_requests
  for each row execute function public.notify_level_review_resolution();

-- Safe target: ownership of the request is verified against the notification recipient. No
-- community membership is involved; a missing or foreign request is a safe 'unavailable'.
drop function public.get_my_notification_target_v3(uuid);
create function public.get_my_notification_target_v3(p_notification_id uuid)
returns table(
  target_status text,
  community_id uuid,
  community_name text,
  invitation_id uuid,
  membership_status text,
  match_event_id uuid,
  match_available boolean,
  kind text,
  created_at timestamptz,
  result_context jsonb,
  level_review_context jsonb
) language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor_id uuid := auth.uid();
  v_notification public.notifications%rowtype;
  v_legacy record;
  v_result record;
  v_request public.player_level_review_requests%rowtype;
begin
  if v_actor_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  -- Provisional actors stay locked out of this entry point, as the definition it replaces was.
  perform public.assert_actor_not_provisional();
  select n.* into v_notification from public.notifications n
   where n.id = p_notification_id and n.recipient_user_id = v_actor_id;
  if not found then raise exception 'Notification unavailable' using errcode = '42501'; end if;

  if v_notification.target_type = 'level_review_request' then
    select r.* into v_request from public.player_level_review_requests r
     where r.id = v_notification.target_id and r.owner_id = v_actor_id
       and v_notification.category = 'rankings'
       and v_notification.community_id is null
       and ((v_notification.kind = 'level_review_approved' and r.status = 'approved')
         or (v_notification.kind = 'level_review_rejected' and r.status = 'rejected'));
    if not found then
      return query select 'unavailable', null::uuid, null::text, null::uuid, null::text,
        null::uuid, false, v_notification.kind, v_notification.created_at, null::jsonb, null::jsonb;
      return;
    end if;
    return query select 'level_review_available', null::uuid, null::text, null::uuid, null::text,
      null::uuid, false, v_notification.kind, v_notification.created_at, null::jsonb,
      pg_catalog.jsonb_build_object(
        'request_id', v_request.id, 'outcome', v_request.status,
        'requested_min_level', v_request.requested_min_level,
        'requested_max_level', v_request.requested_max_level,
        'approved_level', v_request.approved_level,
        'decided_at', public.rating_utc_text(v_request.decided_at),
        'decision_note', v_request.decision_note,
        'adjustment_id', v_request.adjustment_id);
    return;
  end if;

  select result_context.* into v_result
    from public.get_my_result_notification_contexts(array[p_notification_id]) result_context
   limit 1;
  if found then
    return query select 'result_available', null::uuid, null::text, null::uuid, null::text,
      v_result.match_event_id, true, v_notification.kind, v_notification.created_at,
      pg_catalog.to_jsonb(v_result), null::jsonb;
    return;
  end if;

  select target.* into v_legacy
    from public.get_my_notification_target_v2(p_notification_id) target;
  return query select v_legacy.target_status, v_legacy.community_id, v_legacy.community_name,
    v_legacy.invitation_id, v_legacy.membership_status, v_legacy.match_event_id,
    v_legacy.match_available, v_notification.kind, v_notification.created_at, null::jsonb,
    null::jsonb;
end $$;
revoke all on function public.get_my_notification_target_v3(uuid) from public, anon, authenticated;
grant execute on function public.get_my_notification_target_v3(uuid) to authenticated;

commit;
