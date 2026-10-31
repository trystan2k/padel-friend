begin;

-- PAF-125 review fixes on top of the claim (20261031120000) and add (20261031100000)
-- migrations. Forward-only: the applied definitions are replaced, never edited.

-- 1. Session liveness for claimed players. Auth access JWTs are stateless until
-- they expire, so deleting auth.sessions at claim does not stop a token captured
-- while the identity was provisional: once is_provisional clears, that token would
-- pass every guard with normal access. For an identity that has been claimed, the
-- token's own session_id must therefore still exist in auth.sessions. The claim
-- audit anchor (partial unique index on target_user_id) scopes the check, so
-- ordinary actors pay one index probe and only claimed players add a primary-key
-- lookup. Folding it into is_provisional_actor() reuses the single chokepoint every
-- restrictive policy, actor predicate and assert_actor_not_provisional() already
-- go through. A claimed player's token without a live session is treated as
-- restricted (fail closed), exactly like a provisional one.
create function public.actor_session_revoked() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_event_audit_log a
      where a.target_user_id = (select auth.uid()) and a.action = 'player_claimed')
    and not exists (select 1 from auth.sessions s
      where s.user_id = (select auth.uid())
        and s.id = nullif((select auth.jwt()) ->> 'session_id', '')::uuid);
$$;
revoke all on function public.actor_session_revoked() from public, anon, authenticated, service_role;

create or replace function public.is_provisional_actor() returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_provisional_player((select auth.uid())) or public.actor_session_revoked();
$$;

-- 2. Claim proof bound to the session's own provider identity (F5). The Auth JWT
-- identifies neither the provider nor the identity id behind an OAuth session
-- (amr carries only the method; user_metadata is client-editable), so the session
-- cannot be tied to one identity row directly. The proof is therefore fail-closed:
-- OAuth qualifies only when every provider identity on the account is verified for
-- the invited address, so no unverified identity can ride on another identity's
-- verification. The otp/recovery/magic-link/signup-link allowlist is unchanged.
create or replace function public.provisional_claim_state() returns text
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := auth.uid(); v_user auth.users%rowtype; v_amr jsonb := auth.jwt() -> 'amr';
begin
  if v_uid is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then return 'none'; end if;
  if not exists (select 1 from public.player_profiles p where p.user_id = v_uid and p.is_provisional) then
    return 'none';
  end if;
  select * into v_user from auth.users u where u.id = v_uid;
  if v_user.id is null or v_user.email is null or v_user.email_confirmed_at is null
    or v_user.banned_until > pg_catalog.now() or v_user.deleted_at is not null then
    return 'unverified';
  end if;
  if not exists (select 1 from public.match_player_add_operations o
    where o.target_user_id = v_uid and o.email = pg_catalog.lower(v_user.email)) then
    return 'unverified';
  end if;
  if pg_catalog.jsonb_typeof(v_amr) is distinct from 'array' then return 'unverified'; end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_amr) a
    where a ->> 'method' in ('otp', 'recovery', 'magiclink', 'email/signup')) then
    return 'ready';
  end if;
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_amr) a where a ->> 'method' = 'oauth')
    and exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email')
    and not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email'
      and not (coalesce(pg_catalog.lower(i.identity_data ->> 'email') = pg_catalog.lower(v_user.email), false)
        and coalesce(i.identity_data ->> 'email_verified', '') = 'true')) then
    return 'ready';
  end if;
  return 'unverified';
end $$;

-- 3. Claim (F1): credentials that were not established through a verified flow are
-- dropped. A signup against an invited address stamps email_confirmed_at without
-- mailbox proof and may set a password on the provisional identity; that password
-- (and any pending email change toward an address the claimant never proved) must
-- not survive. The claimant keeps only the proving session and sets a password
-- afterwards through the recovery flow. Same body as before otherwise.
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

  -- The claimant is the only party proven to own this mailbox. Anything attached to the
  -- identity before the proof is dropped; only the proving session survives: provider
  -- identities whose email the provider did not verify, every other session, the
  -- password (set by an unverified signup, never by a verified flow) and any pending
  -- email change.
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

  select * into v_event from public.match_events e where e.id = v_profile.source_match_event_id;
  select s.transition_revision into v_revision from public.match_event_registration_state s
    where s.match_event_id = v_event.id;
  insert into public.match_event_audit_log(match_event_id, community_id, actor_id, target_user_id, action, request_id,
    occurred_at, event_version, transition_revision, after_data)
    values (v_event.id, v_event.community_id, v_uid, v_uid, 'player_claimed', pg_catalog.gen_random_uuid(),
      pg_catalog.clock_timestamp(), v_event.version, coalesce(v_revision, 0),
      pg_catalog.jsonb_build_object('level_locked', v_locked));
end $$;

-- 4. Settlement hands back the other adds still waiting on this email (F3/F4). A
-- dispatch that finds another add already holding the creation capability returns
-- 'none' and leaves its operation awaiting; the holder's bridge deliberately skips
-- operations whose event is locked and a failed holder releases the capability
-- without completing anyone. The settling caller re-drives these waiters (never
-- dispatched, dispatch_state 'none'), so a waiting add is not stranded by the
-- holder's outcome.
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

-- 5. Claim context carries the number of matches the provisional identity took part
-- in (F6), so the claim screen can show the "invited to N matches" notice. Same
-- participant evidence as read access (is_match_event_participant); only a count is
-- disclosed, and only after verified mailbox ownership ('ready').
create or replace function public.get_provisional_claim_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_state text := public.provisional_claim_state(); v_uid uuid := auth.uid();
begin
  if v_state <> 'ready' then return pg_catalog.jsonb_build_object('state', v_state); end if;
  return (select pg_catalog.jsonb_build_object('state', 'ready', 'display_name', p.display_name,
      'initial_level', r.initial_display_level, 'can_edit_level', not public.player_has_rated_history(v_uid),
      'match_count', (select pg_catalog.count(*) from public.match_events e
        where public.is_match_event_participant(e.id, v_uid)))
    from public.player_profiles p join public.global_player_ratings r on r.user_id = p.user_id
    where p.user_id = v_uid);
end $$;

commit;
