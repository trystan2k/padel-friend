create table public.community_request_messages (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  membership_id uuid not null references public.community_members(id) on delete restrict,
  sender_user_id uuid not null references auth.users(id) on delete restrict,
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  body text not null check (
    char_length(body) between 1 and 1000 and body = btrim(body)
  ),
  client_request_id uuid not null,
  created_at timestamptz not null default now(),
  unique (sender_user_id, client_request_id)
);
create index community_request_messages_recipient_created on public.community_request_messages (recipient_user_id, created_at desc, id desc);
create index community_request_messages_community_membership_created on public.community_request_messages (community_id, membership_id, created_at desc);

create table public.community_notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete restrict,
  request_message_id uuid not null unique references public.community_request_messages(id) on delete restrict,
  kind text not null check (kind = 'request_message'),
  created_at timestamptz not null default now(),
  read_at timestamptz
);
create index community_notifications_recipient_created on public.community_notifications (recipient_user_id, created_at desc, id desc);

alter table public.community_request_messages enable row level security;
alter table public.community_notifications enable row level security;
revoke all on public.community_request_messages from public, anon, authenticated;
revoke all on public.community_notifications from public, anon, authenticated;
grant select (id, community_id, membership_id, sender_user_id, recipient_user_id, body, created_at) on public.community_request_messages to authenticated;
grant select (id, recipient_user_id, request_message_id, kind, created_at, read_at) on public.community_notifications to authenticated;

create policy community_request_messages_read on public.community_request_messages for select to authenticated using (
  auth.uid() is not null and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false and (
    recipient_user_id = auth.uid() or exists (
      select 1 from public.community_members cm
      where cm.community_id = community_request_messages.community_id
        and cm.user_id = auth.uid() and cm.role = 'admin' and cm.status = 'active'
        and cm.valid_until is null and cm.valid_from <= now()
    )
  )
);
create policy community_notifications_read on public.community_notifications for select to authenticated using (
  recipient_user_id = auth.uid() and auth.uid() is not null
  and coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false
);

create function public.send_community_request_message(
  p_community_id uuid, p_membership_id uuid, p_body text, p_client_request_id uuid
) returns table(message_id uuid, created_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_sender uuid := auth.uid();
  v_member public.community_members%rowtype;
  v_existing public.community_request_messages%rowtype;
  v_body text := btrim(p_body);
begin
  if v_sender is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception using errcode = '28000'; end if;
  if v_body is null or char_length(v_body) not between 1 and 1000 then raise exception using errcode = '22023'; end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found then raise exception using errcode = 'P0002'; end if;
  if not exists (select 1 from public.community_members a where a.community_id = p_community_id and a.user_id = v_sender and a.role = 'admin' and a.status = 'active' and a.valid_until is null and a.valid_from <= now()) then
    raise exception using errcode = '42501';
  end if;
  select * into v_member from public.community_members m where m.id = p_membership_id and m.community_id = p_community_id for update;
  if not found then raise exception using errcode = '22023'; end if;
  select * into v_existing from public.community_request_messages m where m.sender_user_id = v_sender and m.client_request_id = p_client_request_id;
  if found then
    if v_existing.community_id <> p_community_id or v_existing.membership_id <> p_membership_id or v_existing.body <> v_body or v_existing.recipient_user_id <> v_member.user_id then raise exception using errcode = '23505'; end if;
    return query select v_existing.id, v_existing.created_at; return;
  end if;
  if v_member.status <> 'pending' or v_member.valid_until is not null or v_member.valid_from > now() or v_member.user_id = v_sender then raise exception using errcode = '22023'; end if;
  insert into public.community_request_messages(community_id,membership_id,sender_user_id,recipient_user_id,body,client_request_id)
    values (p_community_id,p_membership_id,v_sender,v_member.user_id,v_body,p_client_request_id)
    returning id, community_request_messages.created_at into message_id, created_at;
  insert into public.community_notifications(recipient_user_id,request_message_id,kind) values(v_member.user_id,message_id,'request_message');
  return next;
end $$;
revoke all on function public.send_community_request_message(uuid,uuid,text,uuid) from public, anon, authenticated;
grant execute on function public.send_community_request_message(uuid,uuid,text,uuid) to authenticated;

create function public.mark_community_notification_read(p_notification_id uuid)
returns table(notification_id uuid, read_at timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then raise exception using errcode = '28000'; end if;
  update public.community_notifications n set read_at = coalesce(n.read_at, now())
    where n.id = p_notification_id and n.recipient_user_id = auth.uid()
    returning n.id,n.read_at into notification_id,read_at;
  if not found then raise exception using errcode = '42501'; end if;
  return next;
end $$;
revoke all on function public.mark_community_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_community_notification_read(uuid) to authenticated;
