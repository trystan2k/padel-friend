-- Per-delivery retry budgets drive Push exhaustion. The job-level counter now bounds only consecutive
-- lease losses (crash recovery), so staggered retries of one device can never consume another device's
-- remaining attempts. A job completes only once every delivery is terminal.
create or replace function public.claim_notification_push_jobs(p_limit integer default 10)
returns setof public.notification_push_jobs
language plpgsql security definer set search_path = '' as $$
begin
  -- Expire only unowned/expired leases. A live worker remains fenced until its lease expires.
  -- attempt_count is the number of consecutive lease losses; normal retry claims never consume it.
  update public.notification_push_jobs j set status = 'exhausted', claim_token = null, lease_expires_at = null
    where j.status in ('pending','leased')
      and (j.lease_expires_at is null or j.lease_expires_at <= now())
      and (j.created_at <= now() - interval '24 hours' or (j.status = 'leased' and j.attempt_count >= 6));
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
    lease_expires_at = now() + interval '10 minutes',
    attempt_count = j.attempt_count + case when j.status = 'leased' then 1 else 0 end
  from due where j.notification_id = due.notification_id returning j.*;
end;
$$;

-- p_unavailable is kept for call compatibility: claims no longer consume a job attempt, so there is
-- nothing to restore. Finishing a claim cycle clears the consecutive lease-loss counter.
create or replace function public.finish_notification_push(p_notification_id uuid, p_claim_token uuid, p_unavailable boolean default false)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare v_job public.notification_push_jobs; v_due timestamptz; v_exhausted boolean;
begin
  select * into v_job from public.notification_push_jobs j where j.notification_id = p_notification_id and j.status = 'leased' and j.claim_token = p_claim_token and j.lease_expires_at > now() for update;
  if not found then return false; end if;
  select min(d.next_attempt_at) filter (where d.status = 'pending'), coalesce(bool_or(d.status = 'exhausted'), false)
    into v_due, v_exhausted from public.notification_push_deliveries d where d.notification_id = p_notification_id;
  update public.notification_push_jobs set status = case when v_due is not null then 'pending' when v_exhausted then 'exhausted' else 'completed' end,
    next_attempt_at = coalesce(v_due, now()), claim_token = null, lease_expires_at = null, attempt_count = 0
    where notification_id = p_notification_id;
  return true;
end;
$$;
