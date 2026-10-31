begin;

-- PAF-125 review round 2. Forward-only, on top of 20261031130000.

-- 1. Durable invite redrive (F9, F10, F12). Invite delivery is an HTTP call that runs
-- after the command answered, so the ledger is the only durable memory of it: a
-- failed send, a crashed holder, a waiter that never got the creation capability or a
-- dispatch that never ran must all be picked up by later activity without any
-- scheduler. `retry_after` is the earliest time an operation may be (re)driven; it
-- starts a short grace after the add (so an in-flight delivery is never raced) and is
-- pushed out exponentially every time the sweep hands the operation out.
alter table public.match_player_add_operations
  add column dispatch_attempts smallint not null default 0,
  add column retry_after timestamptz not null default pg_catalog.clock_timestamp() + interval '30 seconds';
create index match_player_add_operations_redrive on public.match_player_add_operations (retry_after)
  where dispatch_state in ('none', 'failed', 'pending') and (state = 'awaiting_identity' or email_eligible);

create function public.match_player_add_redrive_limits(out max_attempts smallint, out base_backoff interval)
language sql immutable set search_path = '' as $$
  select 6::smallint, interval '1 minute';
$$;

-- A failed send waits before the sweep retries it (the settling caller already tried).
create or replace function public.settle_match_player_add(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid,
  p_delivered boolean) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_op public.match_player_add_operations%rowtype; v_user uuid;
begin
  perform public.assert_actor_not_provisional();
  if p_delivered is null then raise exception 'Invalid player add settlement' using errcode = '22023'; end if;
  select * into v_op from public.match_player_add_operations o
    where o.actor_id = p_actor_id and o.match_event_id = p_match_event_id and o.request_id = p_request_id;
  if v_op.id is null then raise exception 'Invalid player add operation' using errcode = '22023'; end if;
  perform public.lock_match_player_add_email(v_op.email);
  select * into v_op from public.match_player_add_operations o where o.id = v_op.id for update;
  if v_op.dispatch_state = 'pending' then
    update public.match_player_add_operations set
      dispatch_state = case when p_delivered then 'sent' else 'failed' end,
      dispatched_at = case when p_delivered then pg_catalog.clock_timestamp() end,
      retry_after = case when p_delivered then retry_after
        else greatest(retry_after, pg_catalog.clock_timestamp() + (select l.base_backoff from public.match_player_add_redrive_limits() l)) end,
      capability_hash = null, capability_expires_at = null
      where id = v_op.id;
    if not p_delivered then
      delete from public.match_player_add_recipient_sends s
        where s.email_digest = public.match_player_add_digest(v_op.email) and s.operation_id = v_op.id;
    end if;
  end if;
  if v_op.state = 'awaiting_identity' then
    select u.id into v_user from auth.users u where pg_catalog.lower(u.email) = v_op.email order by u.created_at limit 1;
    if v_user is not null then perform public.complete_match_player_add_locked(v_op.id, v_user, false); end if;
  end if;
  return pg_catalog.jsonb_build_object(
    'completed', exists (select 1 from public.match_player_add_operations o where o.id = v_op.id and o.state = 'completed'),
    'waiting', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('actor_id', w.actor_id,
        'match_event_id', w.match_event_id, 'request_id', w.request_id) order by w.created_at, w.id)
      from public.match_player_add_operations w
      where w.email = v_op.email and w.state = 'awaiting_identity' and w.dispatch_state = 'none'
        and w.id <> v_op.id), '[]'::jsonb));
end $$;
revoke all on function public.settle_match_player_add(uuid, uuid, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_match_player_add(uuid, uuid, uuid, boolean) to service_role;

-- Hands out up to p_limit operations that need another delivery attempt and
-- reschedules them, so concurrent sweeps never share work and every operation is
-- bounded by max_attempts. Eligible: undelivered ('none'/'failed') or abandoned
-- ('pending' whose capability expired, or whose resend was never settled within the
-- capability TTL), and either still waiting for its identity or owed an email. The
-- caller drives each key through dispatch/settle, which re-check everything.
create function public.claim_match_player_add_redrives(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limits record; v_ttl interval := (select l.capability_ttl from public.match_player_add_limits() l); v_keys jsonb;
begin
  perform public.assert_actor_not_provisional();
  select * into v_limits from public.match_player_add_redrive_limits();
  with due as (
    select o.id from public.match_player_add_operations o
    where o.retry_after <= pg_catalog.clock_timestamp() and o.dispatch_attempts < v_limits.max_attempts
      and (o.state = 'awaiting_identity' or o.email_eligible)
      and (o.dispatch_state in ('none', 'failed')
        or (o.dispatch_state = 'pending' and coalesce(o.capability_expires_at, '-infinity'::timestamptz) <= pg_catalog.clock_timestamp()
          and not exists (select 1 from public.match_player_add_recipient_sends s
            where s.operation_id = o.id and s.sent_at > pg_catalog.clock_timestamp() - v_ttl)))
    order by o.retry_after, o.id
    limit greatest(p_limit, 0)
    for update skip locked
  ), claimed as (
    update public.match_player_add_operations o set
      dispatch_attempts = o.dispatch_attempts + 1,
      retry_after = pg_catalog.clock_timestamp() + v_limits.base_backoff * pg_catalog.power(2, o.dispatch_attempts),
      dispatch_state = case when o.dispatch_state = 'pending' then 'failed' else o.dispatch_state end
    from due where o.id = due.id
    returning o.actor_id, o.match_event_id, o.request_id, o.created_at, o.id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('actor_id', c.actor_id,
    'match_event_id', c.match_event_id, 'request_id', c.request_id) order by c.created_at, c.id), '[]'::jsonb)
    into v_keys from claimed c;
  return v_keys;
end $$;
revoke all on function public.match_player_add_redrive_limits(), public.claim_match_player_add_redrives(integer)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_match_player_add_redrives(integer) to service_role;

-- 2. Password-setup continuity (F11). The claim drops any password the identity
-- carried. When no verified provider identity survives, the claimant has no way back in
-- except the proving session, so "still owes a password" is server state, not React
-- state: a reload or a second device after the claim finds the flag and the onboarding
-- gate keeps asking. Private table, read and cleared only through the RPC below.
create table public.provisional_claim_password_pending (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table public.provisional_claim_password_pending enable row level security;
revoke all on public.provisional_claim_password_pending from public, anon, authenticated, service_role;

create or replace function public.claim_provisional_player(p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_profile public.player_profiles%rowtype; v_rating public.global_player_ratings%rowtype;
  v_event public.match_events%rowtype; v_revision bigint; v_locked boolean; v_email text;
begin
  if v_uid is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')) not between 1 and 80
    or p_display_name <> pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')
    or p_preferred_side is null or p_preferred_side not in ('LEFT', 'RIGHT', 'EITHER')
    or (p_dominant_hand is not null and p_dominant_hand not in ('LEFT', 'RIGHT'))
    or (p_bio is not null and char_length(p_bio) > 280)
    or p_initial_level is null or p_initial_level < 0 or p_initial_level > 7
    or p_initial_level * 10 <> pg_catalog.trunc(p_initial_level * 10) then
    raise exception 'Invalid onboarding input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  select * into v_profile from public.player_profiles p where p.user_id = v_uid for update;
  if v_profile.user_id is null or not v_profile.is_provisional then
    raise exception using errcode = 'P0001', message = 'PROVISIONAL_CLAIM_NOT_PENDING';
  end if;
  if public.provisional_claim_state() <> 'ready' then
    raise exception using errcode = '42501', message = 'PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED';
  end if;
  select * into v_rating from public.global_player_ratings r where r.user_id = v_uid for update;
  if v_rating.user_id is null then raise exception 'Incomplete player state' using errcode = '23514'; end if;

  v_locked := public.player_has_rated_history(v_uid);
  if v_locked then
    if p_initial_level <> v_rating.initial_display_level then
      raise exception using errcode = 'P0001', message = 'PROVISIONAL_CLAIM_LEVEL_LOCKED';
    end if;
  elsif p_initial_level <> v_rating.initial_display_level then
    update public.global_player_ratings set initial_display_level = p_initial_level, mu = p_initial_level,
      display_level = p_initial_level, highest_display_level = p_initial_level where user_id = v_uid;
  end if;

  update public.player_profiles set display_name = p_display_name, preferred_side = p_preferred_side,
    dominant_hand = p_dominant_hand, bio = p_bio, is_provisional = false where user_id = v_uid;

  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v_uid;
  delete from auth.identities i where i.user_id = v_uid and i.provider <> 'email'
    and not (coalesce(pg_catalog.lower(i.identity_data ->> 'email') = v_email, false)
      and coalesce(i.identity_data ->> 'email_verified', '') = 'true');
  delete from auth.sessions s where s.user_id = v_uid
    and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;
  update auth.users set encrypted_password = '', email_change = '', email_change_token_new = '',
    email_change_token_current = '', email_change_sent_at = null, email_change_confirm_status = 0,
    updated_at = pg_catalog.now()
    where id = v_uid;
  delete from auth.one_time_tokens t where t.user_id = v_uid
    and t.token_type in ('email_change_token_new', 'email_change_token_current');
  -- Only verified provider identities are left: without one the claimant owes a password.
  if not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email') then
    insert into public.provisional_claim_password_pending(user_id) values (v_uid) on conflict do nothing;
  end if;

  select * into v_event from public.match_events e where e.id = v_profile.source_match_event_id;
  select s.transition_revision into v_revision from public.match_event_registration_state s
    where s.match_event_id = v_event.id;
  insert into public.match_event_audit_log(match_event_id, community_id, actor_id, target_user_id, action, request_id,
    occurred_at, event_version, transition_revision, after_data)
    values (v_event.id, v_event.community_id, v_uid, v_uid, 'player_claimed', pg_catalog.gen_random_uuid(),
      pg_catalog.clock_timestamp(), v_event.version, coalesce(v_revision, 0),
      pg_catalog.jsonb_build_object('level_locked', v_locked));
end $$;
revoke all on function public.claim_provisional_player(text, text, numeric, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_provisional_player(text, text, numeric, text, text) to authenticated;

-- The caller's own password-setup state. `can_skip` is decided here, from a verified
-- provider identity (provider email verified for the account address), never from what
-- the client sees. The flag clears itself as soon as it is resolved on the server: a
-- password exists again (set through the verified session) or a verified provider
-- identity exists, so it cannot be dismissed from the client.
create function public.get_password_setup_state() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_user auth.users%rowtype; v_can_skip boolean; v_pending boolean;
begin
  perform public.assert_actor_not_provisional();
  if v_uid is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select * into v_user from auth.users u where u.id = v_uid;
  v_can_skip := exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email'
    and coalesce(pg_catalog.lower(i.identity_data ->> 'email') = pg_catalog.lower(v_user.email), false)
    and coalesce(i.identity_data ->> 'email_verified', '') = 'true');
  if v_can_skip or coalesce(v_user.encrypted_password, '') <> '' then
    delete from public.provisional_claim_password_pending p where p.user_id = v_uid;
  end if;
  v_pending := exists (select 1 from public.provisional_claim_password_pending p where p.user_id = v_uid);
  return pg_catalog.jsonb_build_object('pending', v_pending, 'can_skip', v_can_skip);
end $$;
revoke all on function public.get_password_setup_state() from public, anon, authenticated, service_role;
grant execute on function public.get_password_setup_state() to authenticated;

commit;
