begin;

-- PAF-125 final review round. Forward-only, on top of 20261031150000.

-- 1. Exhaustion stays out of the manager-visible audit (F19). Which adds ran out of
-- delivery attempts reveals which addresses were unknown/unreachable (an organizer
-- can correlate the row with the email they entered), so that fact lives only in the
-- service-only ledger (match_player_add_operations.dispatch_state = 'exhausted').
-- The value is retired from the audit CHECK. The audit is insert-only by trigger, so
-- rows a previous revision of this branch may have written are cleared with the guard
-- briefly off (migration owner only); a database that never ran it deletes nothing.
alter table public.match_event_audit_log disable trigger match_audit_immutable;
delete from public.match_event_audit_log where action = 'player_add_delivery_exhausted';
alter table public.match_event_audit_log enable trigger match_audit_immutable;
alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'result_approved', 'result_disputed',
      'result_corrected', 'result_confirmed', 'player_added', 'player_claimed'));

-- 2. dispatch (F18): an operation whose own attempt is still live is not dispatched
-- again. Live = pending with an unexpired capability (create) or a send slot younger
-- than the capability TTL (resend) - the same lease the sweep uses to abandon an
-- attempt, so a replay of the same request can never replace an in-flight Auth call;
-- only an expired lease (or a settled/abandoned attempt) lets a new attempt start.
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

  if v_op.dispatch_state = 'pending' and (
    coalesce(v_op.capability_expires_at, '-infinity'::timestamptz) > pg_catalog.clock_timestamp()
    or exists (select 1 from public.match_player_add_recipient_sends s
      where s.operation_id = v_op.id and s.sent_at > pg_catalog.clock_timestamp() - v_limits.capability_ttl)) then
    return pg_catalog.jsonb_build_object('action', 'none');
  end if;

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

-- 3. claim: exhaustion retires the operation in the ledger only (slot released,
-- capability cleared); nothing is written to the manager-visible audit (F19).
create or replace function public.claim_match_player_add_redrives(p_limit integer default 5) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_limits record; v_ttl interval := (select l.capability_ttl from public.match_player_add_limits() l); v_keys jsonb;
  v_spent record;
begin
  perform public.assert_actor_not_provisional();
  select * into v_limits from public.match_player_add_redrive_limits();

  for v_spent in
    select o.id from public.match_player_add_operations o
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

commit;
