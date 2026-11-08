-- Transactional, private Push outbox. No historic backfill, network calls or config dependencies.
create table public.notification_push_jobs (
  notification_id uuid primary key references public.notifications(id) on delete cascade,
  status text not null default 'pending' check (status in ('pending','leased','completed','exhausted')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  next_attempt_at timestamptz not null default now(),
  lease_expires_at timestamptz,
  claim_token uuid,
  materialized_at timestamptz,
  created_at timestamptz not null default now(),
  check ((status = 'leased') = (claim_token is not null and lease_expires_at is not null))
);
create index notification_push_jobs_due_idx on public.notification_push_jobs(next_attempt_at) where status in ('pending','leased');
create table public.notification_push_deliveries (
  notification_id uuid not null references public.notification_push_jobs(notification_id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  enrollment_created_at timestamptz not null,
  status text not null default 'pending' check (status in ('pending','accepted','expired','failed','skipped','exhausted')),
  attempt_count integer not null default 0 check (attempt_count between 0 and 6),
  next_attempt_at timestamptz not null default now(),
  last_http_status integer,
  updated_at timestamptz not null default now(),
  primary key (notification_id, subscription_id)
);
alter table public.notification_push_jobs enable row level security;
alter table public.notification_push_deliveries enable row level security;
revoke all on public.notification_push_jobs, public.notification_push_deliveries from public, anon, authenticated;
grant all on public.notification_push_jobs, public.notification_push_deliveries to service_role;

create function public.enqueue_notification_push() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.notification_push_jobs(notification_id, created_at) values (new.id, new.created_at) on conflict do nothing;
  return null;
end;
$$;
create trigger notification_push_enqueue after insert on public.notifications for each row execute function public.enqueue_notification_push();
revoke execute on function public.enqueue_notification_push() from public, anon, authenticated, service_role;

create function public.claim_notification_push_jobs(p_limit integer default 10)
returns setof public.notification_push_jobs
language plpgsql security definer set search_path = '' as $$
begin
  -- Expire only unowned/expired leases. A live worker remains fenced until its lease expires.
  update public.notification_push_jobs j set status = 'exhausted', claim_token = null, lease_expires_at = null
    where j.status in ('pending','leased')
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
      and (j.created_at <= now() - interval '24 hours' or j.attempt_count >= 6);
  update public.notification_push_deliveries d set status = 'exhausted', updated_at = now()
    where d.status = 'pending' and exists (select 1 from public.notification_push_jobs j where j.notification_id = d.notification_id and j.status = 'exhausted');
  return query
  with due as (
    select j.notification_id from public.notification_push_jobs j
    where (j.status = 'pending' and j.next_attempt_at <= now())
       or (j.status = 'leased' and j.lease_expires_at <= now())
    order by j.next_attempt_at, j.notification_id
    limit greatest(1, least(coalesce(p_limit, 10), 25)) for update skip locked
  )
  update public.notification_push_jobs j set status = 'leased', claim_token = gen_random_uuid(),
    lease_expires_at = now() + interval '10 minutes', attempt_count = j.attempt_count + 1
  from due where j.notification_id = due.notification_id returning j.*;
end;
$$;

create function public.materialize_notification_push(p_notification_id uuid, p_claim_token uuid)
returns setof public.notification_push_deliveries
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_push_jobs;
begin
  select * into v_job from public.notification_push_jobs j where j.notification_id = p_notification_id
    and j.status = 'leased' and j.claim_token = p_claim_token and j.lease_expires_at > now() for update;
  if not found then return; end if;
  if v_job.materialized_at is null then
    insert into public.notification_push_deliveries(notification_id, subscription_id, enrollment_created_at)
    select n.id, s.id, s.created_at from public.notifications n join public.push_subscriptions s on s.user_id = n.recipient_user_id
    where n.id = p_notification_id and s.created_at <= n.created_at and s.retired_at is null
      and (s.expires_at is null or s.expires_at > now())
    on conflict do nothing;
    update public.notification_push_jobs set materialized_at = now() where notification_id = p_notification_id;
  end if;
  return query select d.* from public.notification_push_deliveries d
    where d.notification_id = p_notification_id and d.status = 'pending' and d.next_attempt_at <= now() order by d.subscription_id;
end;
$$;

-- This is the per-send authorization boundary, including enrollment generation (endpoint re-use).
create function public.prepare_notification_push(p_notification_id uuid, p_subscription_id uuid, p_claim_token uuid)
returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_push_jobs; v_sub public.push_subscriptions; v_n public.notifications; v_d public.notification_push_deliveries; v_allowed boolean;
begin
  select * into v_job from public.notification_push_jobs j where j.notification_id = p_notification_id
    and j.status = 'leased' and j.claim_token = p_claim_token and j.lease_expires_at > now() for update;
  if not found then return null; end if;
  select * into v_d from public.notification_push_deliveries d where d.notification_id = p_notification_id and d.subscription_id = p_subscription_id and d.status = 'pending' and d.next_attempt_at <= now() for update;
  if not found then return null; end if;
  select * into v_n from public.notifications where id = p_notification_id;
  select * into v_sub from public.push_subscriptions where id = p_subscription_id;
  select p.push_enabled and case v_n.category when 'community' then p.push_community when 'matches' then p.push_matches when 'results' then p.push_results when 'rankings' then p.push_rankings when 'leagues' then p.push_leagues else false end
    into v_allowed from public.notification_preferences p where p.user_id = v_n.recipient_user_id;
  if not coalesce(v_allowed, false) or v_sub.retired_at is not null or v_sub.user_id <> v_n.recipient_user_id
    or v_sub.created_at <> v_d.enrollment_created_at or v_sub.created_at > v_n.created_at
    or (v_sub.expires_at is not null and v_sub.expires_at <= now()) then
    update public.notification_push_deliveries set status = 'skipped', updated_at = now() where notification_id = p_notification_id and subscription_id = p_subscription_id;
    return null;
  end if;
  if v_d.attempt_count >= 6 or v_n.created_at <= now() - interval '24 hours' then
    update public.notification_push_deliveries set status = 'exhausted', updated_at = now() where notification_id = p_notification_id and subscription_id = p_subscription_id;
    return null;
  end if;
  update public.notification_push_deliveries set attempt_count = attempt_count + 1, updated_at = now() where notification_id = p_notification_id and subscription_id = p_subscription_id;
  return jsonb_build_object('subscription', to_jsonb(v_sub), 'category', v_n.category, 'attempt', v_d.attempt_count + 1);
end;
$$;

create function public.settle_notification_push_delivery(p_notification_id uuid, p_subscription_id uuid, p_claim_token uuid, p_status text, p_http_status integer default null, p_delay_seconds integer default 300)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_push_jobs; v_d public.notification_push_deliveries;
begin
  if p_status not in ('accepted','expired','failed','pending','unavailable') or p_status is null then raise exception 'PUSH_INVALID_STATUS'; end if;
  select * into v_job from public.notification_push_jobs j where j.notification_id = p_notification_id and j.status = 'leased' and j.claim_token = p_claim_token and j.lease_expires_at > now() for update;
  if not found then return false; end if;
  select * into v_d from public.notification_push_deliveries d where d.notification_id = p_notification_id and d.subscription_id = p_subscription_id and d.status = 'pending' for update;
  if not found then return false; end if;
  update public.notification_push_deliveries set
    status = case when p_status = 'unavailable' then 'pending' when p_status = 'pending' and (attempt_count >= 6 or v_job.created_at <= now() - interval '24 hours') then 'exhausted' else p_status end,
    attempt_count = case when p_status = 'unavailable' then greatest(0, attempt_count - 1) else attempt_count end,
    next_attempt_at = now() + make_interval(secs => greatest(1, least(coalesce(p_delay_seconds,300),21600))),
    last_http_status = p_http_status, updated_at = now()
    where notification_id = p_notification_id and subscription_id = p_subscription_id;
  if p_status = 'expired' then
    update public.push_subscriptions set retired_at = now(), retired_reason = 'endpoint_gone', updated_at = now()
    where id = p_subscription_id and created_at = v_d.enrollment_created_at and retired_at is null;
  end if;
  return true;
end;
$$;

create function public.finish_notification_push(p_notification_id uuid, p_claim_token uuid, p_unavailable boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_push_jobs; v_due timestamptz; v_exhausted boolean;
begin
  select * into v_job from public.notification_push_jobs j where j.notification_id = p_notification_id and j.status = 'leased' and j.claim_token = p_claim_token and j.lease_expires_at > now() for update;
  if not found then return false; end if;
  select min(d.next_attempt_at), bool_or(d.status = 'exhausted') into v_due, v_exhausted
    from public.notification_push_deliveries d where d.notification_id = p_notification_id and d.status in ('pending','exhausted');
  -- Exhausted deliveries must not keep the job pending.
  select min(d.next_attempt_at) into v_due from public.notification_push_deliveries d where d.notification_id = p_notification_id and d.status = 'pending';
  update public.notification_push_jobs set status = case when v_due is not null then 'pending' when coalesce(v_exhausted,false) then 'exhausted' else 'completed' end,
    next_attempt_at = coalesce(v_due, now()), claim_token = null, lease_expires_at = null,
    attempt_count = case when p_unavailable then greatest(0, attempt_count - 1) else attempt_count end
    where notification_id = p_notification_id;
  return true;
end;
$$;

create function public.revoke_notification_push_keys(p_key_ids text[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.push_subscriptions set retired_at = now(), retired_reason = 'key_changed', updated_at = now()
    where vapid_key_id = any(p_key_ids) and retired_at is null;
  get diagnostics v_count = row_count; return v_count;
end;
$$;

create function public.notification_push_health() returns jsonb
language sql security definer set search_path = '' as $$
  select jsonb_build_object('pending',count(*) filter (where status in ('pending','leased')),
    'oldestDue', min(next_attempt_at) filter (where status = 'pending' and next_attempt_at <= now()),
    'exhausted', count(*) filter (where status = 'exhausted')) from public.notification_push_jobs;
$$;

revoke execute on function public.claim_notification_push_jobs(integer), public.materialize_notification_push(uuid,uuid), public.prepare_notification_push(uuid,uuid,uuid), public.settle_notification_push_delivery(uuid,uuid,uuid,text,integer,integer), public.finish_notification_push(uuid,uuid,boolean), public.revoke_notification_push_keys(text[]), public.notification_push_health() from public, anon, authenticated;
grant execute on function public.claim_notification_push_jobs(integer), public.materialize_notification_push(uuid,uuid), public.prepare_notification_push(uuid,uuid,uuid), public.settle_notification_push_delivery(uuid,uuid,uuid,text,integer,integer), public.finish_notification_push(uuid,uuid,boolean), public.revoke_notification_push_keys(text[]), public.notification_push_health() to service_role;
