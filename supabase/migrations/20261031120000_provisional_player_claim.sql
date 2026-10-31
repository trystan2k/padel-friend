begin;

-- PAF-129: verified claim of a provisional identity. The permanent Auth UUID,
-- profile, rating, memberships and registrations never move; the claim only
-- clears is_provisional (flag-only transition the provenance guard allows) after
-- the database itself has verified mailbox ownership. Nothing here trusts a
-- client-supplied target, email or "verified" flag.
--
-- Local Auth runs with email confirmations disabled, where a plain signup against
-- an invited address returns a session for that same identity and stamps
-- email_confirmed_at without any mailbox proof. email_confirmed_at alone is
-- therefore NOT proof of ownership. The proof is the session's own authentication
-- method (JWT amr, signed by Auth): the invite, recovery, magic-link/OTP,
-- signup-confirmation or OAuth flow must have established it. A password session
-- (including that unverified signup) never qualifies.

-- 1. Claim audit vocabulary: one anchor row on the originating event per claim.
alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'result_approved', 'result_disputed',
      'result_corrected', 'result_confirmed', 'player_added', 'player_claimed'));
create unique index match_audit_player_claimed_once on public.match_event_audit_log (target_user_id)
  where action = 'player_claimed';

-- 2. Internal predicates (no client grants).
-- 'none'       caller is not a signed-in provisional player;
-- 'unverified' provisional, but mailbox ownership is not established by this session;
-- 'ready'      mailbox ownership proven for the address the player was invited at.
create function public.provisional_claim_state() returns text
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
  -- The address must still be the one the player was invited at (an email change
  -- never transfers a claim to a different mailbox).
  if not exists (select 1 from public.match_player_add_operations o
    where o.target_user_id = v_uid and o.email = pg_catalog.lower(v_user.email)) then
    return 'unverified';
  end if;
  if pg_catalog.jsonb_typeof(v_amr) is distinct from 'array' then return 'unverified'; end if;
  -- Mailbox proof: Auth reports invite, recovery and magic-link verification as 'otp'.
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_amr) a
    where a ->> 'method' in ('otp', 'recovery', 'magiclink', 'email/signup')) then
    return 'ready';
  end if;
  -- Provider proof: the provider itself must vouch for this very address. Auth links a
  -- provider sign-in to the invited identity even when the provider says the email is
  -- unverified, so the identity's own email_verified flag is checked here.
  if exists (select 1 from pg_catalog.jsonb_array_elements(v_amr) a where a ->> 'method' = 'oauth')
    and exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email'
      and pg_catalog.lower(i.identity_data ->> 'email') = pg_catalog.lower(v_user.email)
      and i.identity_data ->> 'email_verified' = 'true') then
    return 'ready';
  end if;
  return 'unverified';
end $$;

-- Real rating evidence, not profile age: any counted group or recorded rating
-- movement locks the initial level.
create function public.player_has_rated_history(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.global_player_ratings r where r.user_id = p_user_id
    and (r.confirmed_competitive_game_groups > 0 or r.last_rating_at is not null
      or r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level));
$$;

-- 3. Restricted claim surface. These two RPCs are the only authenticated entry
-- points a provisional session may call; every other one stays guarded by
-- assert_actor_not_provisional (the inventory test allowlists exactly these).
-- Both are self-scoped: no target UUID or email parameter exists.
create function public.get_provisional_claim_context() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_state text := public.provisional_claim_state(); v_uid uuid := auth.uid();
begin
  if v_state <> 'ready' then return pg_catalog.jsonb_build_object('state', v_state); end if;
  return (select pg_catalog.jsonb_build_object('state', 'ready', 'display_name', p.display_name,
      'initial_level', r.initial_display_level, 'can_edit_level', not public.player_has_rated_history(v_uid))
    from public.player_profiles p join public.global_player_ratings r on r.user_id = p.user_id
    where p.user_id = v_uid);
end $$;

create function public.claim_provisional_player(p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_profile public.player_profiles%rowtype; v_rating public.global_player_ratings%rowtype;
  v_event public.match_events%rowtype; v_revision bigint; v_locked boolean;
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
  -- identity before the proof (a provider identity whose email the provider did not
  -- verify, sessions opened by an unverified signup or provider sign-in) is dropped; only
  -- the proving session survives.
  delete from auth.identities i where i.user_id = v_uid and i.provider <> 'email'
    and not (pg_catalog.lower(i.identity_data ->> 'email') = (select pg_catalog.lower(u.email) from auth.users u where u.id = v_uid)
      and i.identity_data ->> 'email_verified' = 'true');
  delete from auth.sessions s where s.user_id = v_uid
    and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;

  select * into v_event from public.match_events e where e.id = v_profile.source_match_event_id;
  select s.transition_revision into v_revision from public.match_event_registration_state s
    where s.match_event_id = v_event.id;
  insert into public.match_event_audit_log(match_event_id, community_id, actor_id, target_user_id, action, request_id,
    occurred_at, event_version, transition_revision, after_data)
    values (v_event.id, v_event.community_id, v_uid, v_uid, 'player_claimed', pg_catalog.gen_random_uuid(),
      pg_catalog.clock_timestamp(), v_event.version, coalesce(v_revision, 0),
      pg_catalog.jsonb_build_object('level_locked', v_locked));
end $$;

revoke all on function public.provisional_claim_state(), public.player_has_rated_history(uuid),
  public.get_provisional_claim_context(),
  public.claim_provisional_player(text, text, numeric, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.get_provisional_claim_context(),
  public.claim_provisional_player(text, text, numeric, text, text) to authenticated;

commit;
