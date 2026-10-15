create function public.get_my_community_notification_timezone(p_notification_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_timezone text;
begin
  if auth.uid() is null or coalesce((auth.jwt()->>'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000';
  end if;
  select coalesce(c.settings->'admin_defaults'->>'timezone', 'Europe/Madrid')
    into v_timezone
    from public.community_notifications n
    join public.community_request_messages m on m.id = n.request_message_id
    join public.communities c on c.id = m.community_id
    where n.id = p_notification_id and n.recipient_user_id = auth.uid();
  if not found then return null; end if;
  return v_timezone;
end
$$;

revoke all on function public.get_my_community_notification_timezone(uuid) from public, anon, authenticated;
grant execute on function public.get_my_community_notification_timezone(uuid) to authenticated;
