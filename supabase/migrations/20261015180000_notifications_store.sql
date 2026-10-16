create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  recipient_user_id uuid not null references auth.users(id) on delete cascade,
  event_key text not null check (char_length(event_key) between 1 and 240),
  kind text not null check (char_length(kind) between 1 and 80),
  category text not null check (category in ('community', 'matches', 'results', 'rankings', 'leagues')),
  target_type text not null check (char_length(target_type) between 1 and 80),
  target_id uuid not null,
  community_id uuid,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  constraint notifications_recipient_event_key unique (recipient_user_id, event_key)
);

create index notifications_recipient_created_idx
  on public.notifications (recipient_user_id, created_at desc, id desc);
create index notifications_recipient_unread_idx
  on public.notifications (recipient_user_id, created_at desc, id desc)
  where read_at is null;

alter table public.notifications enable row level security;
revoke all on public.notifications from anon, authenticated;
grant select (id, recipient_user_id, event_key, kind, category, target_type, target_id, community_id, created_at, read_at)
  on public.notifications to authenticated;
create policy notifications_read on public.notifications
  for select to authenticated
  using (
    recipient_user_id = (select auth.uid())
    and (select auth.uid()) is not null
    and not coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false)
  );

create or replace function public.persist_notification(
  p_recipient_user_id uuid,
  p_event_key text,
  p_kind text,
  p_category text,
  p_target_type text,
  p_target_id uuid,
  p_community_id uuid
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_id uuid;
  v_existing public.notifications%rowtype;
begin
  insert into public.notifications (recipient_user_id, event_key, kind, category, target_type, target_id, community_id)
  values (p_recipient_user_id, p_event_key, p_kind, p_category, p_target_type, p_target_id, p_community_id)
  on conflict on constraint notifications_recipient_event_key do nothing
  returning id into v_id;

  if v_id is not null then
    return v_id;
  end if;

  select n.* into v_existing
  from public.notifications as n
  where n.recipient_user_id = p_recipient_user_id and n.event_key = p_event_key;

  if v_existing.kind is distinct from p_kind
    or v_existing.category is distinct from p_category
    or v_existing.target_type is distinct from p_target_type
    or v_existing.target_id is distinct from p_target_id
    or v_existing.community_id is distinct from p_community_id then
    raise exception using errcode = '23505', message = 'NOTIFICATION_EVENT_CONFLICT';
  end if;
  return v_existing.id;
end;
$function$;
revoke execute on function public.persist_notification(uuid, text, text, text, text, uuid, uuid) from public, anon, authenticated;

create or replace function public.mark_notification_read(p_notification_id uuid)
returns timestamptz language plpgsql security definer set search_path = ''
as $function$
declare v_read_at timestamptz;
begin
  if (select auth.uid()) is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  update public.notifications as n set read_at = coalesce(n.read_at, now())
  where n.id = p_notification_id and n.recipient_user_id = (select auth.uid())
  returning n.read_at into v_read_at;
  if not found then raise exception using errcode = '42501', message = 'Notification unavailable'; end if;
  return v_read_at;
end;
$function$;
revoke execute on function public.mark_notification_read(uuid) from public, anon, authenticated;
grant execute on function public.mark_notification_read(uuid) to authenticated;

create or replace function public.mark_all_notifications_read(p_before timestamptz)
returns bigint language plpgsql security definer set search_path = ''
as $function$
declare v_count bigint;
begin
  if (select auth.uid()) is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  if p_before is null or p_before > transaction_timestamp() then
    raise exception using errcode = '22023', message = 'Invalid notification cutoff';
  end if;
  update public.notifications as n set read_at = coalesce(n.read_at, now())
  where n.recipient_user_id = (select auth.uid()) and n.read_at is null and n.created_at <= p_before;
  get diagnostics v_count = row_count;
  return v_count;
end;
$function$;
revoke execute on function public.mark_all_notifications_read(timestamptz) from public, anon, authenticated;
grant execute on function public.mark_all_notifications_read(timestamptz) to authenticated;

create or replace function public.count_my_unread_notifications()
returns bigint language plpgsql security definer set search_path = ''
as $function$
declare v_count bigint;
begin
  if (select auth.uid()) is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  select count(*) into v_count from public.notifications as n
  where n.recipient_user_id = (select auth.uid()) and n.read_at is null;
  return v_count;
end;
$function$;
revoke execute on function public.count_my_unread_notifications() from public, anon, authenticated;
grant execute on function public.count_my_unread_notifications() to authenticated;
