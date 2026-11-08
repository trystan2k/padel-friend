-- Web Push device registry (PAF-15 U2). One row per browser push endpoint; owners reach it only through
-- the restricted RPCs below. The service role (later delivery unit) bypasses RLS; browsers never write directly.
create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint text not null,
  p256dh text not null,
  auth text not null,
  vapid_key_id text not null,
  locale text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_seen_at timestamptz not null default now(),
  expires_at timestamptz,
  retired_at timestamptz,
  retired_reason text,
  constraint push_subscriptions_endpoint_key unique (endpoint),
  constraint push_subscriptions_endpoint_check
    check (octet_length(endpoint) between 20 and 2048 and endpoint ~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'),
  constraint push_subscriptions_p256dh_check check (p256dh ~ '^[A-Za-z0-9_-]{87}$'),
  constraint push_subscriptions_auth_check check (auth ~ '^[A-Za-z0-9_-]{22}$'),
  constraint push_subscriptions_vapid_key_id_check check (char_length(vapid_key_id) between 1 and 64),
  constraint push_subscriptions_locale_check check (locale in ('en', 'pt-BR', 'es')),
  constraint push_subscriptions_retired_check check (
    (retired_at is null) = (retired_reason is null)
    and (retired_reason is null or retired_reason in
      ('user_disabled', 'logout', 'key_changed', 'permission_revoked', 'expired', 'endpoint_gone'))
  )
);
create index push_subscriptions_user_active_idx on public.push_subscriptions (user_id) where retired_at is null;

alter table public.push_subscriptions enable row level security;
revoke all on public.push_subscriptions from public, anon, authenticated;

create or replace function public.register_my_push_subscription(
  p_endpoint text,
  p_p256dh text,
  p_auth text,
  p_vapid_key_id text,
  p_locale text,
  p_expires_at timestamptz default null
) returns uuid
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_existing public.push_subscriptions;
  v_id uuid;
  v_decoded bytea;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  perform public.assert_actor_not_provisional();
  if p_endpoint is null or p_p256dh is null or p_auth is null or p_vapid_key_id is null or p_locale is null
    or octet_length(p_endpoint) not between 20 and 2048
    or p_endpoint !~ '^https://[^/@[:space:]]+(/[^[:space:]]*)?$'
    or p_p256dh !~ '^[A-Za-z0-9_-]{87}$'
    or p_auth !~ '^[A-Za-z0-9_-]{22}$'
    or char_length(p_vapid_key_id) not between 1 and 64
    or p_locale not in ('en', 'pt-BR', 'es') then
    raise exception using errcode = '22023', message = 'PUSH_INVALID_SUBSCRIPTION';
  end if;
  -- Decoded key material: an uncompressed P-256 point (65 bytes, 0x04 prefix) and a 16-byte auth secret.
  v_decoded := decode(translate(p_p256dh, '-_', '+/') || '=', 'base64');
  if octet_length(v_decoded) <> 65 or get_byte(v_decoded, 0) <> 4
    or octet_length(decode(translate(p_auth, '-_', '+/') || '==', 'base64')) <> 16 then
    raise exception using errcode = '22023', message = 'PUSH_INVALID_SUBSCRIPTION';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(p_endpoint, 0));
  select * into v_existing from public.push_subscriptions where endpoint = p_endpoint for update;

  if found and v_existing.user_id <> v_uid and v_existing.retired_at is null then
    -- Another account still owns this endpoint; it must retire its association first (logout/cleanup).
    raise exception using errcode = '23505', message = 'PUSH_ENDPOINT_CONFLICT';
  end if;
  if (found is false or v_existing.user_id <> v_uid or v_existing.retired_at is not null)
    and (select count(*) from public.push_subscriptions where user_id = v_uid and retired_at is null) >= 25 then
    raise exception using errcode = '54000', message = 'PUSH_DEVICE_LIMIT';
  end if;

  if not found then
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, vapid_key_id, locale, expires_at)
    values (v_uid, p_endpoint, p_p256dh, p_auth, p_vapid_key_id, p_locale, p_expires_at)
    returning id into v_id;
  elsif v_existing.user_id = v_uid and v_existing.retired_at is null then
    update public.push_subscriptions
      set p256dh = p_p256dh, auth = p_auth, vapid_key_id = p_vapid_key_id, locale = p_locale,
          expires_at = p_expires_at, last_seen_at = now(), updated_at = now()
      where id = v_existing.id
      returning id into v_id;
  else
    -- Re-enrolment (retired row or released endpoint): a new enrolment, so created_at restarts and
    -- the device never receives events from before it was enabled.
    update public.push_subscriptions
      set user_id = v_uid, p256dh = p_p256dh, auth = p_auth, vapid_key_id = p_vapid_key_id,
          locale = p_locale, expires_at = p_expires_at, created_at = now(), last_seen_at = now(),
          updated_at = now(), retired_at = null, retired_reason = null
      where id = v_existing.id
      returning id into v_id;
  end if;
  return v_id;
end;
$function$;

create or replace function public.reconcile_my_push_devices(
  p_current_endpoint text default null,
  p_locale text default null
) returns table (
  device_id uuid,
  is_current boolean,
  device_retired_at timestamptz,
  device_retired_reason text,
  device_vapid_key_id text,
  device_locale text,
  device_created_at timestamptz,
  device_last_seen_at timestamptz,
  device_expires_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  perform public.assert_actor_not_provisional();
  if (p_current_endpoint is not null and octet_length(p_current_endpoint) > 2048)
    or (p_locale is not null and p_locale not in ('en', 'pt-BR', 'es')) then
    raise exception using errcode = '22023', message = 'PUSH_INVALID_SUBSCRIPTION';
  end if;
  if p_current_endpoint is not null then
    update public.push_subscriptions s
      set last_seen_at = now(),
          locale = coalesce(p_locale, s.locale),
          updated_at = case when p_locale is not null and p_locale <> s.locale then now() else s.updated_at end
      where s.user_id = v_uid and s.endpoint = p_current_endpoint and s.retired_at is null;
  end if;
  return query
    select s.id, (s.endpoint = p_current_endpoint), s.retired_at, s.retired_reason, s.vapid_key_id,
           s.locale, s.created_at, s.last_seen_at, s.expires_at
    from public.push_subscriptions s
    where s.user_id = v_uid
      and (s.retired_at is null or s.endpoint = p_current_endpoint)
    order by s.created_at, s.id;
end;
$function$;

create or replace function public.retire_my_push_subscription(
  p_endpoint text,
  p_reason text
) returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_uid uuid := (select auth.uid());
  v_count integer;
begin
  if v_uid is null or coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) then
    raise exception using errcode = '28000', message = 'Authentication required';
  end if;
  perform public.assert_actor_not_provisional();
  if p_endpoint is null or octet_length(p_endpoint) > 2048
    or p_reason is null
    or p_reason not in ('user_disabled', 'logout', 'key_changed', 'permission_revoked', 'expired') then
    raise exception using errcode = '22023', message = 'PUSH_INVALID_SUBSCRIPTION';
  end if;
  update public.push_subscriptions
    set retired_at = now(), retired_reason = p_reason, updated_at = now()
    where user_id = v_uid and endpoint = p_endpoint and retired_at is null;
  get diagnostics v_count = row_count;
  return v_count > 0;
end;
$function$;

revoke execute on function public.register_my_push_subscription(text, text, text, text, text, timestamptz) from public, anon, authenticated;
revoke execute on function public.reconcile_my_push_devices(text, text) from public, anon, authenticated;
revoke execute on function public.retire_my_push_subscription(text, text) from public, anon, authenticated;
grant execute on function public.register_my_push_subscription(text, text, text, text, text, timestamptz) to authenticated;
grant execute on function public.reconcile_my_push_devices(text, text) to authenticated;
grant execute on function public.retire_my_push_subscription(text, text) to authenticated;
