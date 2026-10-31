begin;

-- PAF-127: the current event owner or a community admin adds a person to a
-- match by name, email and estimated level. Three branches, one uniform
-- response:
--   registered email  -> standard pending event invitation only (idempotent);
--   provisional email -> reuse the identity (never overwrite name/level);
--   unknown email     -> Auth creates the auth.users row through Admin Invite and
--                        the AFTER INSERT bridge below provisions profile, rating,
--                        membership and registration inside Auth's own
--                        transaction, so a failure leaves no user, no rows and no
--                        email.
-- Lock order: normalized-email advisory lock -> actor rate window -> canonical
-- community -> event registration chain. No path takes the email lock after an
-- event lock, and no SQL transaction is held open across the Auth HTTP call.

-- 1. Private operation ledger: idempotency, Auth bridge capability, delivery
-- state and the full per-add audit (actor, event, target email, branch,
-- outcome). No client grants; manager-visible audit stays branch-free.
create table public.match_player_add_operations (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  request_id uuid not null,
  fingerprint text not null,
  email text not null check (email = pg_catalog.lower(pg_catalog.btrim(email)) and char_length(email) between 3 and 254),
  display_name text not null check (char_length(display_name) between 1 and 80),
  estimated_level numeric(3,1) not null check (estimated_level between 0.0 and 7.0),
  locale text not null check (locale in ('en', 'pt-BR', 'es')),
  state text not null default 'awaiting_identity' check (state in ('awaiting_identity', 'completed')),
  branch text check (branch in ('registered', 'provisional', 'new')),
  outcome text check (outcome in ('invited', 'already_invited', 'self', 'registered', 'already_registered',
    'membership_conflict', 'invitation_closed')),
  target_user_id uuid references auth.users(id) on delete restrict,
  email_eligible boolean not null default false,
  capability_hash bytea unique,
  capability_expires_at timestamptz,
  dispatch_state text not null default 'none' check (dispatch_state in ('none', 'pending', 'sent', 'failed', 'suppressed')),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  completed_at timestamptz,
  dispatched_at timestamptz,
  unique (actor_id, match_event_id, request_id),
  check ((state = 'completed') = (branch is not null and outcome is not null
    and target_user_id is not null and completed_at is not null)),
  check ((capability_hash is null) = (capability_expires_at is null))
);
create index match_player_add_operations_awaiting on public.match_player_add_operations (email)
  where state = 'awaiting_identity';

-- 2. Rate-limit state. Actor windows count successful logical adds; recipient
-- sends key the normalized email digest so one address gets at most one invite
-- email per interval across every event and community.
create table public.match_player_add_actor_windows (
  actor_id uuid not null references auth.users(id) on delete restrict,
  window_start timestamptz not null,
  add_count integer not null check (add_count > 0),
  primary key (actor_id, window_start)
);
create table public.match_player_add_recipient_sends (
  email_digest bytea primary key,
  operation_id uuid not null references public.match_player_add_operations(id) on delete restrict,
  sent_at timestamptz not null
);
create table public.match_player_add_throttle_hits (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('actor', 'recipient')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  request_id uuid not null,
  email_digest bytea,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  check ((scope = 'recipient') = (email_digest is not null))
);
alter table public.match_player_add_operations enable row level security;
alter table public.match_player_add_actor_windows enable row level security;
alter table public.match_player_add_recipient_sends enable row level security;
alter table public.match_player_add_throttle_hits enable row level security;
revoke all on public.match_player_add_operations, public.match_player_add_actor_windows,
  public.match_player_add_recipient_sends, public.match_player_add_throttle_hits
  from public, anon, authenticated, service_role;

-- Operational defaults (not product decisions); one place to tune them.
create function public.match_player_add_limits(out actor_window interval, out actor_max_adds integer,
  out recipient_interval interval, out capability_ttl interval)
language sql immutable set search_path = '' as $$
  select interval '1 hour', 20, interval '15 minutes', interval '10 minutes';
$$;

-- Digest for normalized emails (throttle keys) and bridge capabilities; the raw
-- capability is never stored.
create function public.match_player_add_digest(p_value text) returns bytea
language sql immutable set search_path = '' as $$
  select pg_catalog.sha256(pg_catalog.convert_to(p_value, 'UTF8'));
$$;

create function public.lock_match_player_add_email(p_email text) returns void
language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_email, 127127));
$$;

-- 3. Manager vocabulary: one sanitized audit row per completed add. Target and
-- branch live only in the private ledger so the audit is not an existence oracle.
alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'result_approved', 'result_disputed',
      'result_corrected', 'result_confirmed', 'player_added'));

-- 4. Authorization and roster window. The actor is passed explicitly because the
-- Auth bridge runs without a user JWT; ownership is the current (post-transfer)
-- owner, never the original publisher.
create function public.match_player_add_actor_authorized(p_event_id uuid, p_actor_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select p_actor_id is not null and not public.is_provisional_player(p_actor_id)
    and exists (select 1 from public.match_events e where e.id = p_event_id and (e.created_by = p_actor_id
      or exists (select 1 from public.community_members m where m.community_id = e.community_id
        and m.user_id = p_actor_id and m.status = 'active' and m.role = 'admin'
        and m.valid_from <= pg_catalog.now() and (m.valid_until is null or m.valid_until > pg_catalog.now()))));
$$;

-- Caller holds the event lock. Capacity applies to every branch so a full roster
-- answers identically whether or not the email is known.
create function public.assert_match_player_add_window_locked(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event public.match_events%rowtype; v_now timestamptz := pg_catalog.clock_timestamp(); v_count integer;
begin
  select * into v_event from public.match_events e where e.id = p_event_id;
  if v_event.status = 'cancelled' then raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode = 'P0001'; end if;
  if v_now >= v_event.starts_at then raise exception 'MATCH_MANAGEMENT_STARTED' using errcode = 'P0001'; end if;
  if exists (select 1 from public.match_event_registration_state s
    where s.match_event_id = p_event_id and s.results_protected_at is not null) then
    raise exception 'MATCH_MANAGEMENT_RESULT_PROTECTED' using errcode = 'P0001';
  end if;
  if v_now >= v_event.registration_cutoff_at then raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode = 'P0001'; end if;
  select count(*) into v_count from public.match_event_registrations r
    where r.match_event_id = p_event_id and r.lifecycle = 'accepted';
  if v_event.maximum_registrations is not null and v_count >= v_event.maximum_registrations then
    raise exception 'MATCH_REGISTRATION_FULL' using errcode = 'P0001';
  end if;
end $$;

-- 5. Branch executor. Caller holds the email lock. Re-checks authorization and
-- the window under the canonical event lock, then routes through the standard
-- invitation and registration writers (invite-only, level approval queue, FIFO
-- and capacity rules are never bypassed).
create function public.complete_match_player_add_locked(p_operation_id uuid, p_user_id uuid, p_new_identity boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_op public.match_player_add_operations%rowtype;
  v_event public.match_events%rowtype;
  v_provisional boolean;
  v_lifecycle public.match_registration_lifecycle;
  v_branch text; v_outcome text; v_revision bigint; v_invite uuid;
begin
  select * into v_op from public.match_player_add_operations o where o.id = p_operation_id for update;
  if v_op.id is null or v_op.state <> 'awaiting_identity' or p_user_id is null then
    raise exception 'Invalid player add operation' using errcode = '22023';
  end if;
  v_event := public.lock_match_event_registration(v_op.match_event_id);
  if not public.match_player_add_actor_authorized(v_event.id, v_op.actor_id) then
    raise exception 'Player add forbidden' using errcode = '42501';
  end if;
  perform public.assert_match_player_add_window_locked(v_event.id);
  if p_new_identity then
    perform public.provision_provisional_player_locked(p_user_id, v_op.display_name, v_op.estimated_level,
      v_op.actor_id, v_event.id);
  end if;
  select p.is_provisional into v_provisional from public.player_profiles p where p.user_id = p_user_id;

  if coalesce(v_provisional, false) then
    v_branch := case when p_new_identity then 'new' else 'provisional' end;
    begin
      perform public.ensure_provisional_community_membership_locked(v_event.community_id, p_user_id,
        v_op.actor_id, v_event.id);
    exception when raise_exception then
      if sqlerrm <> 'PROVISIONAL_MEMBERSHIP_CONFLICT' then raise; end if;
      v_outcome := 'membership_conflict';
    end;
    if v_outcome is null then
      if v_event.visibility = 'invite_only' then
        insert into public.match_event_invites(match_event_id, invitee_user_id, invited_by)
          values (v_event.id, p_user_id, v_op.actor_id) on conflict (match_event_id, invitee_user_id) do nothing;
      end if;
      select r.lifecycle into v_lifecycle from public.match_event_registrations r
        where r.match_event_id = v_event.id and r.user_id = p_user_id;
      if v_lifecycle in ('accepted', 'pending') then
        v_outcome := 'already_registered';
      else
        begin
          perform public.submit_match_registration_locked(v_event.id, p_user_id);
          v_outcome := 'registered';
        exception when raise_exception then
          -- A terminal invitation is never resurrected.
          if sqlerrm <> 'MATCH_REGISTRATION_INVITE_ONLY' then raise; end if;
          v_outcome := 'invitation_closed';
        end;
      end if;
    end if;
  else
    -- Registered account (with or without a completed player profile): pending
    -- invitation only, never a profile, membership or registration write.
    v_branch := 'registered';
    if p_user_id in (v_op.actor_id, v_event.created_by) then
      v_outcome := 'self';
    else
      insert into public.match_event_invites(match_event_id, invitee_user_id, invited_by)
        values (v_event.id, p_user_id, v_op.actor_id) on conflict (match_event_id, invitee_user_id) do nothing
        returning id into v_invite;
      v_outcome := case when v_invite is null then 'already_invited' else 'invited' end;
    end if;
  end if;

  select s.transition_revision into v_revision from public.match_event_registration_state s
    where s.match_event_id = v_event.id;
  insert into public.match_event_audit_log(match_event_id, community_id, actor_id, action, request_id,
    occurred_at, event_version, transition_revision)
    values (v_event.id, v_event.community_id, v_op.actor_id, 'player_added', v_op.request_id,
      pg_catalog.clock_timestamp(), v_event.version, v_revision);
  update public.match_player_add_operations set state = 'completed', branch = v_branch, outcome = v_outcome,
    target_user_id = p_user_id, email_eligible = v_branch <> 'registered', completed_at = pg_catalog.clock_timestamp(),
    capability_hash = null, capability_expires_at = null
    where id = p_operation_id;
end $$;

-- 6. Authenticated command. Success is always {status:'ok', request_id} whatever
-- the email resolves to; the actor throttle answers {status:'rate_limited'} and
-- commits its audit evidence instead of raising.
create function public.add_match_player(p_match_event_id uuid, p_display_name text, p_email text,
  p_estimated_level numeric, p_locale text, p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_name text := pg_catalog.btrim(p_display_name, E' \t\n\r\f\v');
  v_email text := pg_catalog.lower(pg_catalog.btrim(p_email, E' \t\n\r\f\v'));
  v_limits record; v_fingerprint text; v_op public.match_player_add_operations%rowtype;
  v_count integer; v_user uuid;
begin
  perform public.assert_actor_not_provisional();
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_match_event_id is null or p_request_id is null
    or v_name is null or char_length(v_name) not between 1 and 80
    or v_email is null or char_length(v_email) not between 3 and 254
    or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or p_estimated_level is null or p_estimated_level < 0 or p_estimated_level > 7
    or p_estimated_level * 10 <> pg_catalog.trunc(p_estimated_level * 10)
    or p_locale is null or p_locale not in ('en', 'pt-BR', 'es') then
    raise exception 'Invalid player add input' using errcode = '22023';
  end if;
  if not exists (select 1 from public.match_events e where e.id = p_match_event_id) then
    raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode = 'P0001';
  end if;
  if not public.match_player_add_actor_authorized(p_match_event_id, v_actor) then
    raise exception 'Player add forbidden' using errcode = '42501';
  end if;

  perform public.lock_match_player_add_email(v_email);
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(v_name, v_email,
    pg_catalog.round(p_estimated_level, 1)::text, p_locale)::text);
  select * into v_op from public.match_player_add_operations o
    where o.actor_id = v_actor and o.match_event_id = p_match_event_id and o.request_id = p_request_id;
  if found then
    if v_op.fingerprint <> v_fingerprint then
      raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return pg_catalog.jsonb_build_object('status', 'ok', 'request_id', p_request_id);
  end if;

  select * into v_limits from public.match_player_add_limits();
  insert into public.match_player_add_actor_windows as w (actor_id, window_start, add_count)
    values (v_actor, pg_catalog.date_bin(v_limits.actor_window, pg_catalog.clock_timestamp(), timestamptz 'epoch'), 1)
    on conflict (actor_id, window_start) do update set add_count = w.add_count + 1
      where w.add_count < v_limits.actor_max_adds
    returning add_count into v_count;
  if v_count is null then
    insert into public.match_player_add_throttle_hits(scope, actor_id, match_event_id, request_id)
      values ('actor', v_actor, p_match_event_id, p_request_id);
    return pg_catalog.jsonb_build_object('status', 'rate_limited', 'request_id', p_request_id);
  end if;

  perform public.lock_match_event_registration(p_match_event_id);
  perform public.assert_match_player_add_window_locked(p_match_event_id);
  insert into public.match_player_add_operations(match_event_id, actor_id, request_id, fingerprint, email,
    display_name, estimated_level, locale)
    values (p_match_event_id, v_actor, p_request_id, v_fingerprint, v_email, v_name, p_estimated_level, p_locale)
    returning * into v_op;
  select u.id into v_user from auth.users u where pg_catalog.lower(u.email) = v_email order by u.created_at limit 1;
  if v_user is not null then
    perform public.complete_match_player_add_locked(v_op.id, v_user, false);
  end if;
  return pg_catalog.jsonb_build_object('status', 'ok', 'request_id', p_request_id);
end $$;

-- 7. Service-only delivery hooks. The server derives p_actor_id from verified
-- claims after add_match_player succeeded for that same actor/event/request.
-- dispatch returns what the Auth mail adapter must do:
--   {action:'create', email, capability, locale, match_event_id} -> Admin Invite
--     with the one-use capability in user metadata (creates the identity);
--   {action:'resend', email, locale, match_event_id} -> re-send the invite to
--     the existing provisional identity;
--   {action:'none'} -> nothing to send (registered, throttled or in flight).
create function public.dispatch_match_player_add(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.match_player_add_operations%rowtype; v_limits record; v_user uuid; v_token text; v_digest bytea;
begin
  perform public.assert_actor_not_provisional();
  select * into v_op from public.match_player_add_operations o
    where o.actor_id = p_actor_id and o.match_event_id = p_match_event_id and o.request_id = p_request_id;
  if v_op.id is null then return pg_catalog.jsonb_build_object('action', 'none'); end if;
  perform public.lock_match_player_add_email(v_op.email);
  select * into v_op from public.match_player_add_operations o where o.id = v_op.id for update;
  select * into v_limits from public.match_player_add_limits();
  v_digest := public.match_player_add_digest(v_op.email);

  if v_op.state = 'awaiting_identity' then
    select u.id into v_user from auth.users u where pg_catalog.lower(u.email) = v_op.email order by u.created_at limit 1;
    if v_user is null then
      -- Another add is already creating this identity; its bridge completes this one too.
      if exists (select 1 from public.match_player_add_operations o where o.email = v_op.email
        and o.state = 'awaiting_identity' and o.id <> v_op.id and o.capability_expires_at > pg_catalog.clock_timestamp()) then
        return pg_catalog.jsonb_build_object('action', 'none');
      end if;
      v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
      update public.match_player_add_operations set dispatch_state = 'pending',
        capability_hash = public.match_player_add_digest(v_token),
        capability_expires_at = pg_catalog.clock_timestamp() + v_limits.capability_ttl
        where id = v_op.id;
      insert into public.match_player_add_recipient_sends(email_digest, operation_id, sent_at)
        values (v_digest, v_op.id, pg_catalog.clock_timestamp())
        on conflict (email_digest) do update set operation_id = excluded.operation_id, sent_at = excluded.sent_at;
      return pg_catalog.jsonb_build_object('action', 'create', 'email', v_op.email, 'capability', v_token,
        'locale', v_op.locale, 'match_event_id', v_op.match_event_id);
    end if;
    perform public.complete_match_player_add_locked(v_op.id, v_user, false);
    select * into v_op from public.match_player_add_operations o where o.id = v_op.id;
  end if;

  if not v_op.email_eligible or v_op.dispatch_state not in ('none', 'failed') then
    return pg_catalog.jsonb_build_object('action', 'none');
  end if;
  if exists (select 1 from public.match_player_add_recipient_sends s where s.email_digest = v_digest
    and s.sent_at > pg_catalog.clock_timestamp() - v_limits.recipient_interval) then
    update public.match_player_add_operations set dispatch_state = 'suppressed' where id = v_op.id;
    insert into public.match_player_add_throttle_hits(scope, actor_id, match_event_id, request_id, email_digest)
      values ('recipient', v_op.actor_id, v_op.match_event_id, v_op.request_id, v_digest);
    return pg_catalog.jsonb_build_object('action', 'none');
  end if;
  update public.match_player_add_operations set dispatch_state = 'pending' where id = v_op.id;
  insert into public.match_player_add_recipient_sends(email_digest, operation_id, sent_at)
    values (v_digest, v_op.id, pg_catalog.clock_timestamp())
    on conflict (email_digest) do update set operation_id = excluded.operation_id, sent_at = excluded.sent_at;
  return pg_catalog.jsonb_build_object('action', 'resend', 'email', v_op.email, 'locale', v_op.locale,
    'match_event_id', v_op.match_event_id);
end $$;

-- Records the Auth call outcome. A failed send releases the recipient slot so a
-- retry with the same request can deliver. If the identity appeared outside the
-- bridge meanwhile (racing signup), the add resolves against it now.
create function public.settle_match_player_add(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid,
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
  return pg_catalog.jsonb_build_object('completed',
    exists (select 1 from public.match_player_add_operations o where o.id = v_op.id and o.state = 'completed'));
end $$;

-- 8. Auth bridge. Strictly a no-op for ordinary signups, OAuth and resets. Only
-- an insert by GoTrue carrying a live, unexpired, single-use capability whose
-- hash and normalized email match an awaiting operation provisions anything; a
-- forged or stale capability aborts the insert. Any failure rolls back the new
-- auth.users row together with every provisioned row and suppresses the email.
create function public.complete_match_player_add_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_token text := new.raw_user_meta_data ->> 'padel_add_capability'; v_email text := pg_catalog.lower(new.email);
  v_op public.match_player_add_operations%rowtype; v_other uuid; v_event public.match_events%rowtype;
begin
  if v_token is null then return null; end if;
  if session_user::text <> 'supabase_auth_admin' then
    raise exception using errcode = '42501', message = 'MATCH_PLAYER_ADD_CAPABILITY_INVALID';
  end if;
  perform public.lock_match_player_add_email(v_email);
  select * into v_op from public.match_player_add_operations o
    where o.capability_hash = public.match_player_add_digest(v_token) and o.email = v_email
      and o.state = 'awaiting_identity' and o.capability_expires_at > pg_catalog.clock_timestamp()
    for update;
  if v_op.id is null then
    raise exception using errcode = '42501', message = 'MATCH_PLAYER_ADD_CAPABILITY_INVALID';
  end if;
  update auth.users set raw_user_meta_data = raw_user_meta_data - 'padel_add_capability' where id = new.id;
  perform public.complete_match_player_add_locked(v_op.id, new.id, true);
  -- Concurrent adds of the same email to other events join the identity just
  -- created. They never block on another event lock (no cross-event deadlock);
  -- a skipped or failing one stays awaiting and resolves on its own retry.
  for v_other in select o.id from public.match_player_add_operations o
    where o.email = v_email and o.state = 'awaiting_identity' order by o.created_at, o.id
  loop
    begin
      select * into v_event from public.lock_match_event_registration_skip_locked(
        (select o.match_event_id from public.match_player_add_operations o where o.id = v_other));
      if v_event.id is not null then
        perform public.complete_match_player_add_locked(v_other, new.id, true);
        update public.match_player_add_operations set dispatch_state = 'suppressed'
          where id = v_other and dispatch_state = 'none';
      end if;
    exception when others then null;
    end;
  end loop;
  return null;
end $$;
create trigger match_player_add_identity after insert on auth.users
  for each row execute function public.complete_match_player_add_identity();

revoke all on function public.match_player_add_limits(), public.match_player_add_digest(text),
  public.lock_match_player_add_email(text), public.match_player_add_actor_authorized(uuid, uuid),
  public.assert_match_player_add_window_locked(uuid),
  public.complete_match_player_add_locked(uuid, uuid, boolean),
  public.add_match_player(uuid, text, text, numeric, text, uuid),
  public.dispatch_match_player_add(uuid, uuid, uuid),
  public.settle_match_player_add(uuid, uuid, uuid, boolean),
  public.complete_match_player_add_identity()
  from public, anon, authenticated, service_role;
grant execute on function public.add_match_player(uuid, text, text, numeric, text, uuid) to authenticated;
grant execute on function public.dispatch_match_player_add(uuid, uuid, uuid),
  public.settle_match_player_add(uuid, uuid, uuid, boolean) to service_role;

commit;
