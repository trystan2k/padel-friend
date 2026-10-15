create function public.get_my_community_notification_timezones(p_notification_ids uuid[])
returns table (notification_id uuid, time_zone text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000';
  end if;

  return query
    select
      n.id,
      coalesce(c.settings->'admin_defaults'->>'timezone', 'Europe/Madrid')
    from public.community_notifications as n
    join public.community_request_messages as m on m.id = n.request_message_id
    join public.communities as c on c.id = m.community_id
    where n.id = any(coalesce(p_notification_ids, array[]::uuid[]))
      and n.recipient_user_id = auth.uid();
end
$$;

revoke all on function public.get_my_community_notification_timezones(uuid[]) from public, anon, authenticated;
grant execute on function public.get_my_community_notification_timezones(uuid[]) to authenticated;
