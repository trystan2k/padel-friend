-- PAF-189 (L-2): per-user DB-side rate limits. Rolling windows count committed rows of the
-- authoritative tables (communities, request messages, match events and leagues are never deleted
-- or rewritten by users), so deletion cannot reset consumed quota. Every check runs after the
-- actor-scoped advisory lock in the same transaction as the write; a rejected call rolls back.

-- Communities have no archived/deleted/owner-transfer lifecycle. created_by is immutable ownership,
-- so every extant created community counts toward the cap; leaving an Admin membership does not
-- release ownership. Future transfer/archive commands must preserve this cap under the same lock.
-- Named limits (single source for the RPCs below and the integration tests).
create function public.security_rate_limits() returns table(
  community_create_max integer, community_create_window interval,
  community_owned_max integer,
  request_message_max integer, request_message_window interval,
  match_event_max integer, match_event_window interval,
  league_create_max integer, league_create_window interval
) language sql immutable set search_path = '' as $$
  select 3, interval '24 hours',
    10,
    10, interval '1 hour',
    20, interval '24 hours',
    5, interval '24 hours';
$$;

create index if not exists communities_created_by_created_at on public.communities (created_by, created_at);
create index if not exists community_request_messages_sender_membership_created
  on public.community_request_messages (sender_user_id, membership_id, created_at);
create index if not exists match_events_created_by_published_at on public.match_events (created_by, published_at);
create index if not exists leagues_owner_created_at on public.leagues (owner_id, created_at);

-- Serializes an actor's quota check + write per scope (last-slot concurrency accepts exactly one).
create function public.lock_actor_rate_scope(p_scope text, p_actor uuid, p_key uuid default null) returns void
language sql security definer set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_scope || ':' || p_actor::text || ':' || coalesce(p_key::text, ''), 189189));
$$;

create function public.assert_community_create_allowed(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l record; v_now timestamptz;
begin
  select * into v_l from public.security_rate_limits();
  perform public.lock_actor_rate_scope('community_create', p_actor);
  v_now := pg_catalog.clock_timestamp();
  if (select pg_catalog.count(*) from public.communities c where c.created_by = p_actor) >= v_l.community_owned_max then
    raise exception 'COMMUNITY_OWNED_LIMIT_REACHED' using errcode = 'P0001';
  end if;
  if (select pg_catalog.count(*) from public.communities c
      where c.created_by = p_actor and c.created_at > v_now - v_l.community_create_window) >= v_l.community_create_max then
    raise exception 'COMMUNITY_CREATE_RATE_LIMITED' using errcode = 'P0001';
  end if;
end $$;

create function public.assert_request_message_allowed(p_actor uuid, p_membership_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l record; v_now timestamptz;
begin
  select * into v_l from public.security_rate_limits();
  perform public.lock_actor_rate_scope('request_message', p_actor, p_membership_id);
  v_now := pg_catalog.clock_timestamp();
  if (select pg_catalog.count(*) from public.community_request_messages m
      where m.sender_user_id = p_actor and m.membership_id = p_membership_id
        and m.created_at > v_now - v_l.request_message_window) >= v_l.request_message_max then
    raise exception 'COMMUNITY_REQUEST_MESSAGE_RATE_LIMITED' using errcode = 'P0001';
  end if;
end $$;

create function public.assert_match_event_create_allowed(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l record; v_now timestamptz;
begin
  select * into v_l from public.security_rate_limits();
  perform public.lock_actor_rate_scope('match_event_create', p_actor);
  v_now := pg_catalog.clock_timestamp();
  if (select pg_catalog.count(*) from public.match_events e
      where e.created_by = p_actor and e.published_at > v_now - v_l.match_event_window) >= v_l.match_event_max then
    raise exception 'MATCH_EVENT_CREATE_RATE_LIMITED' using errcode = 'P0001';
  end if;
end $$;

create function public.assert_league_create_allowed(p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_l record; v_now timestamptz;
begin
  select * into v_l from public.security_rate_limits();
  perform public.lock_actor_rate_scope('league_create', p_actor);
  v_now := pg_catalog.clock_timestamp();
  if (select pg_catalog.count(*) from public.leagues l
      where l.owner_id = p_actor and l.created_at > v_now - v_l.league_create_window) >= v_l.league_create_max then
    raise exception 'LEAGUE_CREATE_RATE_LIMITED' using errcode = 'P0001';
  end if;
end $$;

revoke all on function public.security_rate_limits(), public.lock_actor_rate_scope(text, uuid, uuid),
  public.assert_community_create_allowed(uuid), public.assert_request_message_allowed(uuid, uuid),
  public.assert_match_event_create_allowed(uuid), public.assert_league_create_allowed(uuid)
  from public, anon, authenticated;

-- Patch the RPCs in place so every earlier hardening stays intact. The check sits after
-- the idempotent replay branch / immediately before the first write, so retries never burn quota.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.create_community(text,public.community_visibility,public.community_join_policy,text,text)'::regprocedure);
  d := replace(d, E'  insert into public.communities (name, visibility',
    E'  perform public.assert_community_create_allowed(v_actor);\n  insert into public.communities (name, visibility');
  if position('assert_community_create_allowed' in d) = 0 then raise exception 'community patch failed'; end if;
  execute d;

  d := pg_get_functiondef('public.send_community_request_message(uuid,uuid,text,uuid)'::regprocedure);
  d := replace(d, E'  insert into public.community_request_messages(community_id,membership_id',
    E'  perform public.assert_request_message_allowed(v_sender, p_membership_id);\n  insert into public.community_request_messages(community_id,membership_id');
  if position('assert_request_message_allowed' in d) = 0 then raise exception 'message patch failed'; end if;
  execute d;

  d := pg_get_functiondef('public.publish_match_event(uuid,jsonb,uuid[])'::regprocedure);
  d := replace(d, E'  insert into public.match_events(id,community_id,created_by',
    E'  perform public.assert_match_event_create_allowed(v_uid);\n  insert into public.match_events(id,community_id,created_by');
  if position('assert_match_event_create_allowed' in d) = 0 then raise exception 'publish patch failed'; end if;
  execute d;

  d := pg_get_functiondef('public.create_league(uuid,uuid,text,text,date,text,date,integer)'::regprocedure);
  d := replace(d, E'  insert into public.leagues (community_id, owner_id, name,',
    E'  perform public.assert_league_create_allowed(v_actor);\n  insert into public.leagues (community_id, owner_id, name,');
  if position('assert_league_create_allowed' in d) = 0 then raise exception 'league patch failed'; end if;
  execute d;
end $$;
