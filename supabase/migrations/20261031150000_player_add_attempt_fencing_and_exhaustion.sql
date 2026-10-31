begin;

-- PAF-125 review round 3. Forward-only, on top of 20261031140000.

-- 1. Attempt fencing (F13). Every dispatch that hands out a delivery gets a fresh
-- attempt token, kept on the operation while that attempt is in flight. The sweep
-- abandons an attempt (pending -> failed) once its capability lapsed, and a newer
-- attempt may start while the original HTTP call is still running; settle only accepts
-- the token of the attempt that is still in flight, so a late original can never mark,
-- unlock or release anything of its successor.
alter table public.match_player_add_operations add column dispatch_attempt uuid;

-- 2. Exhaustion (F14). An operation whose attempt budget is spent leaves the retry
-- set as 'exhausted' (terminal for delivery) instead of staying 'failed' forever; its
-- recipient slot is released and an audit row says so. Nothing about the ledger state
-- is visible to the add caller, whose answer stays uniform.
alter table public.match_player_add_operations
  drop constraint match_player_add_operations_dispatch_state_check,
  add constraint match_player_add_operations_dispatch_state_check
    check (dispatch_state in ('none', 'pending', 'sent', 'failed', 'suppressed', 'exhausted'));
alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'result_approved', 'result_disputed',
      'result_corrected', 'result_confirmed', 'player_added', 'player_claimed',
      'player_add_delivery_exhausted'));

-- dispatch: unchanged except that each handed-out delivery carries a new attempt token.
create or replace function public.dispatch_match_player_add(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_op public.match_player_add_operations%rowtype; v_limits record; v_user uuid; v_token text; v_digest bytea;
  v_attempt uuid := pg_catalog.gen_random_uuid();
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
      if v_op.dispatch_state = 'exhausted' then return pg_catalog.jsonb_build_object('action', 'none'); end if;
      v_token := pg_catalog.replace(pg_catalog.gen_random_uuid()::text || pg_catalog.gen_random_uuid()::text, '-', '');
      update public.match_player_add_operations set dispatch_state = 'pending', dispatch_attempt = v_attempt,
        capability_hash = public.match_player_add_digest(v_token),
        capability_expires_at = pg_catalog.clock_timestamp() + v_limits.capability_ttl
        where id = v_op.id;
      insert into public.match_player_add_recipient_sends(email_digest, operation_id, sent_at)
        values (v_digest, v_op.id, pg_catalog.clock_timestamp())
        on conflict (email_digest) do update set operation_id = excluded.operation_id, sent_at = excluded.sent_at;
      return pg_catalog.jsonb_build_object('action', 'create', 'email', v_op.email, 'capability', v_token,
        'locale', v_op.locale, 'match_event_id', v_op.match_event_id, 'attempt', v_attempt);
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
  update public.match_player_add_operations set dispatch_state = 'pending', dispatch_attempt = v_attempt
    where id = v_op.id;
  insert into public.match_player_add_recipient_sends(email_digest, operation_id, sent_at)
    values (v_digest, v_op.id, pg_catalog.clock_timestamp())
    on conflict (email_digest) do update set operation_id = excluded.operation_id, sent_at = excluded.sent_at;
  return pg_catalog.jsonb_build_object('action', 'resend', 'email', v_op.email, 'locale', v_op.locale,
    'match_event_id', v_op.match_event_id, 'attempt', v_attempt);
end $$;

-- settle: fenced on the attempt token. A caller whose attempt is no longer the one in
-- flight (abandoned by the sweep, superseded, already settled) gets a clean no-op.
drop function public.settle_match_player_add(uuid, uuid, uuid, boolean);
create function public.settle_match_player_add(p_actor_id uuid, p_match_event_id uuid, p_request_id uuid,
  p_delivered boolean, p_attempt uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_op public.match_player_add_operations%rowtype; v_user uuid;
begin
  perform public.assert_actor_not_provisional();
  if p_delivered is null or p_attempt is null then raise exception 'Invalid player add settlement' using errcode = '22023'; end if;
  select * into v_op from public.match_player_add_operations o
    where o.actor_id = p_actor_id and o.match_event_id = p_match_event_id and o.request_id = p_request_id;
  if v_op.id is null then raise exception 'Invalid player add operation' using errcode = '22023'; end if;
  perform public.lock_match_player_add_email(v_op.email);
  select * into v_op from public.match_player_add_operations o where o.id = v_op.id for update;
  if v_op.dispatch_state is distinct from 'pending' or v_op.dispatch_attempt is distinct from p_attempt then
    return pg_catalog.jsonb_build_object('completed', v_op.state = 'completed', 'waiting', '[]'::jsonb);
  end if;
  update public.match_player_add_operations set
    dispatch_state = case when p_delivered then 'sent' else 'failed' end,
    dispatched_at = case when p_delivered then pg_catalog.clock_timestamp() end,
    retry_after = case when p_delivered then retry_after
      else greatest(retry_after, pg_catalog.clock_timestamp() + (select l.base_backoff from public.match_player_add_redrive_limits() l)) end,
    dispatch_attempt = null, capability_hash = null, capability_expires_at = null
    where id = v_op.id;
  if not p_delivered then
    delete from public.match_player_add_recipient_sends s
      where s.email_digest = public.match_player_add_digest(v_op.email) and s.operation_id = v_op.id;
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
revoke all on function public.settle_match_player_add(uuid, uuid, uuid, boolean, uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.settle_match_player_add(uuid, uuid, uuid, boolean, uuid) to service_role;

-- claim: first retires operations whose attempt budget is spent (exhausted, slot
-- released, audited), then hands out the due ones; abandoning a pending attempt also
-- voids its token.
create or replace function public.claim_match_player_add_redrives(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limits record; v_ttl interval := (select l.capability_ttl from public.match_player_add_limits() l); v_keys jsonb;
  v_spent record; v_event public.match_events%rowtype; v_revision bigint;
begin
  perform public.assert_actor_not_provisional();
  select * into v_limits from public.match_player_add_redrive_limits();

  for v_spent in
    select o.id, o.match_event_id, o.actor_id, o.request_id, o.email from public.match_player_add_operations o
    where o.retry_after <= pg_catalog.clock_timestamp() and o.dispatch_attempts >= v_limits.max_attempts
      and (o.state = 'awaiting_identity' or o.email_eligible)
      and (o.dispatch_state in ('none', 'failed')
        or (o.dispatch_state = 'pending' and coalesce(o.capability_expires_at, '-infinity'::timestamptz) <= pg_catalog.clock_timestamp()
          and not exists (select 1 from public.match_player_add_recipient_sends s
            where s.operation_id = o.id and s.sent_at > pg_catalog.clock_timestamp() - v_ttl)))
    order by o.retry_after, o.id
    limit 20
    for update skip locked
  loop
    update public.match_player_add_operations set dispatch_state = 'exhausted', dispatch_attempt = null,
      capability_hash = null, capability_expires_at = null where id = v_spent.id;
    delete from public.match_player_add_recipient_sends s where s.operation_id = v_spent.id;
    select * into v_event from public.match_events e where e.id = v_spent.match_event_id;
    select s.transition_revision into v_revision from public.match_event_registration_state s
      where s.match_event_id = v_spent.match_event_id;
    insert into public.match_event_audit_log(match_event_id, community_id, actor_id, action, request_id,
      occurred_at, event_version, transition_revision)
      values (v_event.id, v_event.community_id, v_spent.actor_id, 'player_add_delivery_exhausted', v_spent.request_id,
        pg_catalog.clock_timestamp(), v_event.version, coalesce(v_revision, 0));
  end loop;

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
      dispatch_state = case when o.dispatch_state = 'pending' then 'failed' else o.dispatch_state end,
      dispatch_attempt = null
    from due where o.id = due.id
    returning o.actor_id, o.match_event_id, o.request_id, o.created_at, o.id
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('actor_id', c.actor_id,
    'match_event_id', c.match_event_id, 'request_id', c.request_id) order by c.created_at, c.id), '[]'::jsonb)
    into v_keys from claimed c;
  return v_keys;
end $$;
revoke all on function public.claim_match_player_add_redrives(integer) from public, anon, authenticated, service_role;
grant execute on function public.claim_match_player_add_redrives(integer) to service_role;

commit;
