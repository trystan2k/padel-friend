-- Serialize enrolment per user so concurrent registrations of different endpoints cannot both pass the
-- 25-active-device count. The user lock is always taken before the endpoint lock (stable lock order).
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

  perform pg_advisory_xact_lock(hashtextextended('push-enrolment:' || v_uid::text, 0));
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
