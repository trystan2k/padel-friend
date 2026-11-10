begin;

-- T17.6: durable, deduplicated operational alert state.
--
-- Failure signals are DERIVED from the existing durable failure records (terminal result repair
-- jobs, exhausted Push jobs, overdue repair scheduler). Nothing here writes into those records,
-- so a monitoring outage can never roll back or block a rating, replay or notification. The
-- Worker reads the signals, reconciles them here (one row per alert key = source/job/attempt),
-- sends best-effort, and then stamps delivery. A failed send leaves the row un-notified and is
-- retried by the next sweep without ever double-paging an already-notified key.
create table public.operational_alerts (
  alert_key text primary key check (char_length(alert_key) between 1 and 200),
  source text not null check (source in ('repair', 'push', 'scheduler', 'processing')),
  severity text not null check (severity in ('critical', 'warning')),
  reference text not null check (char_length(reference) between 1 and 80),
  opened_at timestamptz not null default now(),
  notified_at timestamptz,
  resolved_at timestamptz,
  resolution_notified_at timestamptz,
  delivery_token uuid,
  delivery_lease_until timestamptz
);
alter table public.operational_alerts enable row level security;
revoke all on public.operational_alerts from public, anon, authenticated;
grant all on public.operational_alerts to service_role;

-- One private monitor status, not a second Push queue. Configuration faults have no job to
-- settle; persist this safe enum so an independent alert sweep can observe them.
create table public.operational_push_health (
  singleton boolean primary key default true check(singleton),
  code text check(code in ('PUSH_CONFIG_UNAVAILABLE','PUSH_DISABLED')),
  updated_at timestamptz not null default now()
);
alter table public.operational_push_health enable row level security;
revoke all on public.operational_push_health from public, anon, authenticated;
grant all on public.operational_push_health to service_role;
create function public.record_operational_push_health(p_code text default null) returns void
language sql security definer set search_path = '' as $$
  insert into public.operational_push_health(singleton,code) values(true,p_code)
    on conflict(singleton) do update set code=excluded.code, updated_at=now();
$$;
revoke all on function public.record_operational_push_health(text) from public, anon, authenticated;
grant execute on function public.record_operational_push_health(text) to service_role;

-- Terminal failures only. A retryable failure still inside its retry budget is a transient
-- retry, not a page.
create function public.operational_failure_signals() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(s), '[]'::jsonb) from (
    select pg_catalog.jsonb_build_object(
        'key', 'repair:' || j.id || ':' || j.attempt_count,
        'source', 'repair', 'severity', 'critical',
        'reference', j.id::text,
        'code', coalesce(j.failure_code, 'INTERNAL'),
        'stage', j.failure_stage) as s
      from public.result_repair_jobs j
     where j.status = 'failed'
       and (not public.result_repair_retryable(j.failure_code) or j.attempt_count >= 5)
    union all
    select pg_catalog.jsonb_build_object(
        'key', 'push:' || p.notification_id,
        'source', 'push', 'severity', 'warning',
        'reference', p.notification_id::text,
        'code', case when p.status='exhausted' then 'PUSH_EXHAUSTED' else 'PUSH_FAILED' end, 'stage', null)
      from public.notification_push_jobs p
     where p.status = 'exhausted' or exists(
       select 1 from public.notification_push_deliveries d where d.notification_id=p.notification_id and d.status in ('failed','exhausted'))
    union all
    select pg_catalog.jsonb_build_object(
        'key', 'processing:' || s.proposal_id || ':' || s.proposal_version,
        'source', 'processing', 'severity', 'critical', 'reference', s.proposal_id::text,
        'code', 'AUTO_CONFIRM_FAILED', 'stage', 'confirm')
      from public.match_event_result_processing_state s
      join public.match_event_result_proposals p on p.id = s.proposal_id
     where s.failure_count >= 5 and s.last_failure_code is not null
       and p.status = 'pending' and p.active_version = s.proposal_version
    union all
    select pg_catalog.jsonb_build_object('key','push:configuration','source','push','severity','critical',
      'reference','configuration','code',h.code,'stage','configuration')
      from public.operational_push_health h where h.code = 'PUSH_CONFIG_UNAVAILABLE'
        or (h.code = 'PUSH_DISABLED' and exists(select 1 from public.notification_push_jobs where status in ('pending','leased') and created_at < now()-interval '5 minutes'))
    union all
    select pg_catalog.jsonb_build_object(
        'key', 'scheduler:result-repair', 'source', 'scheduler', 'severity', 'critical',
        'reference', 'result-repair', 'code', 'SCHEDULER_OVERDUE', 'stage', null)
     where (public.result_repair_scheduler_health() ->> 'overdue_jobs')::integer > 0
  ) t;
$$;

-- Applies the current signal set. Returns what still needs a message: keys opened but never
-- notified, and keys resolved after a notified page whose resolution message is still owed.
create function public.reconcile_operational_alerts(p_signals jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_keys text[];
begin
  if p_signals is null or pg_catalog.jsonb_typeof(p_signals) <> 'array' then
    raise exception 'ALERT_SIGNALS_INVALID' using errcode = '22023';
  end if;
  select coalesce(pg_catalog.array_agg(e ->> 'key'), '{}') into v_keys
    from pg_catalog.jsonb_array_elements(p_signals) e;
  insert into public.operational_alerts(alert_key, source, severity, reference)
    select e ->> 'key', e ->> 'source', e ->> 'severity', e ->> 'reference'
      from pg_catalog.jsonb_array_elements(p_signals) e
    on conflict (alert_key) do update
      set resolved_at = null, resolution_notified_at = null, notified_at = null, delivery_token = null, delivery_lease_until = null,
          opened_at = pg_catalog.now()
      where public.operational_alerts.resolved_at is not null;
  update public.operational_alerts set resolved_at = pg_catalog.now()
    where resolved_at is null and not (alert_key = any (v_keys));
  return pg_catalog.jsonb_build_object(
    'open', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'key', alert_key, 'source', source, 'severity', severity, 'reference', reference, 'deliveryId', md5(alert_key || opened_at::text || ':open')) order by opened_at)
      from (select * from public.operational_alerts
             where resolved_at is null and notified_at is null order by opened_at limit 50) a), '[]'::jsonb),
    'resolved', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'key', alert_key, 'source', source, 'severity', severity, 'reference', reference, 'deliveryId', md5(alert_key || opened_at::text || ':resolved')) order by resolved_at)
      from (select * from public.operational_alerts
             where resolved_at is not null and notified_at is not null
               and resolution_notified_at is null order by resolved_at limit 50) r), '[]'::jsonb));
end $$;

create function public.mark_operational_alert_sent(p_key text, p_resolution boolean default false, p_token uuid default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  v_count integer;
begin
  if p_resolution then
    update public.operational_alerts set resolution_notified_at = pg_catalog.now(), delivery_token = null, delivery_lease_until = null
      where alert_key = p_key and delivery_token = p_token and delivery_lease_until > now()
        and resolved_at is not null and resolution_notified_at is null;
  else
    update public.operational_alerts set notified_at = pg_catalog.now(), delivery_token = null, delivery_lease_until = null
      where alert_key = p_key and delivery_token = p_token and delivery_lease_until > now()
        and notified_at is null;
  end if;
  get diagnostics v_count = row_count;
  return v_count > 0;
end $$;

revoke execute on function public.operational_failure_signals(), public.reconcile_operational_alerts(jsonb),
  public.mark_operational_alert_sent(text, boolean, uuid) from public, anon, authenticated;
grant execute on function public.operational_failure_signals(), public.reconcile_operational_alerts(jsonb),
  public.mark_operational_alert_sent(text, boolean, uuid) to service_role;

-- Lease claims fence overlapping Workers; receiver idempotency additionally covers a crash
-- after HTTP receipt but before its committed delivery stamp. Monitoring never holds sporting locks.
create function public.claim_operational_alert(p_key text, p_resolution boolean, p_token uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.operational_alerts set delivery_token = p_token,
      delivery_lease_until = now() + interval '30 seconds'
    where alert_key = p_key and p_token is not null
      and (delivery_lease_until is null or delivery_lease_until <= now())
      and ((not p_resolution and resolved_at is null and notified_at is null)
        or (p_resolution and resolved_at is not null and notified_at is not null and resolution_notified_at is null));
  get diagnostics v_count = row_count;
  return v_count = 1;
end $$;
create function public.release_operational_alert(p_key text, p_token uuid)
returns void language sql security definer set search_path = '' as $$
  update public.operational_alerts set delivery_token = null, delivery_lease_until = null
    where alert_key = p_key and delivery_token = p_token;
$$;
revoke all on function public.claim_operational_alert(text,boolean,uuid), public.release_operational_alert(text,uuid)
  from public, anon, authenticated;
grant execute on function public.claim_operational_alert(text,boolean,uuid), public.release_operational_alert(text,uuid) to service_role;

-- Transactional operational evidence outbox. Derived only from committed, existing job/attempt
-- and processing records. No raw SQL/provider text, payload, user copy or external dispatch.
create table public.operational_job_events (
  event_key text primary key,
  event text not null check(event in ('result.confirm','rating.failure','replay.start','replay.complete','replay.fail')),
  outcome text not null check(outcome in ('success','failure')),
  reference uuid not null,
  attempt integer not null,
  code text,
  stage text,
  occurred_at timestamptz not null default now(),
  logged_at timestamptz
);
create index operational_job_events_pending on public.operational_job_events(occurred_at,event_key) where logged_at is null;
alter table public.operational_job_events enable row level security;
revoke all on public.operational_job_events from public, anon, authenticated;
grant all on public.operational_job_events to service_role;
create function public.record_operational_job_event() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_event text; v_code text; v_key text;
begin
  if tg_table_name = 'result_repair_attempts' then
    if tg_op = 'UPDATE' and old.status = new.status then return null; end if;
    v_event := case new.status when 'running' then 'replay.start' when 'succeeded' then 'replay.complete' else 'replay.fail' end;
    v_code := case when new.failure_code ~ '^[A-Z0-9_]{1,64}$' then new.failure_code else null end;
    v_key := new.job_id || ':' || new.attempt_number || ':' || new.status;
    insert into public.operational_job_events(event_key,event,outcome,reference,attempt,code,stage)
      values(v_key,v_event,case when new.status in ('running','succeeded') then 'success' else 'failure' end,
        new.job_id,new.attempt_number,v_code,new.stage) on conflict do nothing;
    if new.status = 'failed' and new.stage = 'replay' then
      insert into public.operational_job_events(event_key,event,outcome,reference,attempt,code,stage)
        values(v_key || ':rating','rating.failure','failure',new.job_id,new.attempt_number,v_code,'rating_projection') on conflict do nothing;
    end if;
  elsif tg_table_name = 'match_event_result_processing_state' then
    if new.last_failure_code is not null and (tg_op = 'INSERT' or new.attempt_count is distinct from old.attempt_count) then
      insert into public.operational_job_events(event_key,event,outcome,reference,attempt,code,stage)
        values('confirm:' || new.proposal_id || ':' || new.proposal_version || ':' || new.attempt_count,
          'result.confirm','failure',new.proposal_id,new.attempt_count,'AUTO_CONFIRM_FAILED','auto_confirm') on conflict do nothing;
    end if;
  elsif new.source = 'AUTO_48H' then
    insert into public.operational_job_events(event_key,event,outcome,reference,attempt,stage)
      values('confirm:' || new.id,'result.confirm','success',new.proposal_id,new.proposal_version,'auto_confirm') on conflict do nothing;
  end if;
  return null;
end $$;
revoke all on function public.record_operational_job_event() from public, anon, authenticated, service_role;
create trigger operational_repair_evidence after insert or update on public.result_repair_attempts
  for each row execute function public.record_operational_job_event();
create trigger operational_processing_evidence after insert or update on public.match_event_result_processing_state
  for each row execute function public.record_operational_job_event();
create trigger operational_auto_confirm_evidence after insert on public.match_event_result_confirmations
  for each row execute function public.record_operational_job_event();
create function public.read_operational_job_events() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(to_jsonb(e) order by e.occurred_at,e.event_key),'[]'::jsonb)
    from (select * from public.operational_job_events where logged_at is null order by occurred_at,event_key limit 100) e;
$$;
create function public.mark_operational_job_events(p_keys text[]) returns void
language plpgsql security definer set search_path = '' as $$
begin
  update public.operational_job_events set logged_at=now() where event_key=any(p_keys) and logged_at is null;
  delete from public.operational_job_events where logged_at < now()-interval '7 days';
end $$;
revoke all on function public.read_operational_job_events(), public.mark_operational_job_events(text[]) from public, anon, authenticated;
grant execute on function public.read_operational_job_events(), public.mark_operational_job_events(text[]) to service_role;

-- Exact rating-stage boundary: preserve original behavior, grants and exception.
create or replace function public.project_confirmed_rating_group(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.player_rating_projection_control%rowtype;
  v_group record; v_existing integer; v_revision bigint; v_member_ids uuid[];
  v_states jsonb; v_loaded integer; v_apply record; v_replay record;
begin
  if (select c.activation_enabled from public.player_rating_projection_control c) then
    perform public.rating_projection_lock_covered();
  else
    perform public.lock_global_rating_projection();
  end if;
  -- Everything below is read after the lock: the stream, ledger and states are current.
  select * into v_control from public.player_rating_projection_control c for update;
  if not found then
    raise exception 'Rating projection control is missing' using errcode = '23514';
  end if;
  if not v_control.activation_enabled then return; end if;
  select * into v_group from public.rating_projection_eligible_groups() g where g.game_group_id = p_proposal_id;
  if not found then return; end if;

  select pg_catalog.count(*) into v_existing from public.player_rating_events e
   where e.game_group_id = p_proposal_id;
  if v_existing > 0 then
    if public.rating_group_ledgered_at(p_proposal_id, null)
      and not exists (select 1 from public.player_rating_events e where e.game_group_id = p_proposal_id
        and not exists (select 1 from public.player_rating_event_calculations c where c.rating_event_id = e.id)) then
      return;
    end if;
    raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
  end if;

  v_revision := v_control.committed_revision + 1;
  if (v_control.last_processed_game_group_id is null
      or (v_group.played_at, v_group.game_group_id)
        > (v_control.last_processed_played_at, v_control.last_processed_game_group_id))
    and not exists (select 1 from public.player_rating_admin_adjustments a
      where (a.boundary_played_at, a.boundary_group_id) >= (v_group.played_at, v_group.game_group_id))
    and not exists (select 1 from public.rating_projection_eligible_groups() g
      where g.game_group_id <> p_proposal_id and not public.rating_group_ledgered_at(g.game_group_id, g.confirmation_id)) then
    -- Tail fast path: the four current states already include every earlier group and checkpoint.
    v_member_ids := array[(v_group.teams -> 'team_a' ->> 0)::uuid, (v_group.teams -> 'team_a' ->> 1)::uuid,
      (v_group.teams -> 'team_b' ->> 0)::uuid, (v_group.teams -> 'team_b' ->> 1)::uuid];
    select pg_catalog.jsonb_object_agg(r.user_id::text, pg_catalog.jsonb_build_object(
        'mu', r.mu, 'sigma', r.sigma, 'display_level', r.display_level,
        'reliability_percent', r.reliability_percent,
        'confirmed_competitive_game_groups', r.confirmed_competitive_game_groups,
        'highest_display_level', r.highest_display_level,
        'exception', exists (select 1 from public.player_rating_admin_adjustments a
          where a.user_id = r.user_id and a.reliability_mode <> 'preserve'))), pg_catalog.count(*)
      into v_states, v_loaded
      from (select * from public.global_player_ratings gr where gr.user_id = any (v_member_ids)
              order by gr.user_id for update) r;
    if v_loaded is distinct from 4 then
      raise exception 'Incomplete player state' using errcode = '23514';
    end if;
    select * into v_apply from public.rating_projection_apply_group(
      v_group.game_group_id, v_group.confirmation_id, v_group.match_event_id, v_group.game_group_number,
      v_group.proposal_version, v_group.played_at, v_group.classification, v_group.teams, v_states, v_revision);
    if v_apply.o_new_events <> 4 then
      raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
    end if;
    perform public.rating_projection_write_states(v_apply.o_states, v_apply.o_meta, v_revision);
    perform public.rating_projection_assert_consistent(v_member_ids);
    update public.player_rating_projection_control set committed_revision = v_revision,
      last_processed_played_at = v_group.played_at, last_processed_game_group_id = v_group.game_group_id
     where singleton;
  else
    -- Late insertion, insertion before a checkpoint (or self-heal): replay the merged stream.
    select * into v_replay from public.rating_projection_replay(v_revision);
    update public.player_rating_projection_control set
      committed_revision = case when v_replay.o_changed then v_revision else committed_revision end,
      last_processed_played_at = v_replay.o_last_played_at, last_processed_game_group_id = v_replay.o_last_group_id
     where singleton;
  end if;
end $$;

-- Patch final installed reader, not an older definition: retain every later lifecycle,
-- League, result and DTO extension and the original grants/security contract.
do $optimize$
declare d text;
begin
  d := pg_catalog.pg_get_functiondef('public.list_match_events(text,uuid,text,integer,timestamptz)'::regprocedure);
  d := replace(d, '  ), eligible as (', $candidates$  ), candidates as materialized (
    -- Restrict/order the personal page BEFORE roster/count/caller projection. Previously
    -- those lateral readers ran over the entire matching history before the final LIMIT.
    select e.* from public.match_events e cross join snapshot s cross join cursor_values v
    where (p_community_id is null or e.community_id=p_community_id)
      and public.can_read_match_event(e.id)
      and (p_entry='available' or (
        case p_entry when 'my' then e.starts_at>s.as_of when 'past' then e.starts_at<=s.as_of else false end
        and (e.created_by=auth.uid() or exists(select 1 from public.match_event_registrations r
          where r.match_event_id=e.id and r.user_id=auth.uid() and (r.lifecycle='accepted' or e.status='cancelled'))
          or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid()))))
      and (v.starts_at is null or (p_entry='past' and (e.starts_at,e.id)<(v.starts_at,v.event_id))
        or (p_entry<>'past' and (e.starts_at,e.id)>(v.starts_at,v.event_id)))
    order by case when p_entry='past' then null else e.starts_at end asc,case when p_entry='past' then null else e.id end asc,
      case when p_entry='past' then e.starts_at end desc,case when p_entry='past' then e.id end desc
    limit case when p_entry='available' then null else least(greatest(coalesce(p_limit,20),1),50) end
  ), eligible as ($candidates$);
  d := replace(d, 'from public.match_events e join public.communities c', 'from candidates e join public.communities c');
  if position('candidates as materialized' in d)=0 or position('from candidates e join' in d)=0 then
    raise exception 'Unexpected match reader definition; refusing partial optimization';
  end if;
  execute d;
end $optimize$;

commit;
