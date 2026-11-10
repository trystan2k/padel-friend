begin;

-- F39: rollout-safe operational alert reconciliation.
--
-- 20261110100000 revoked reconcile_operational_alerts(jsonb) from the service role, which breaks a
-- mixed-version rollout (old Worker + new database) and a code rollback (new database + old
-- Worker). The snapshot-applying core moves to an internal name no API role can call; the old
-- signature stays callable as a thin compatibility wrapper that IGNORES the caller's snapshot and
-- delegates to the fenced reconciler, so an old Worker gets the same fenced, fresh-signal
-- behavior and a self-supplied stale set can still never be applied.
alter function public.reconcile_operational_alerts(jsonb) rename to apply_operational_alert_signals;
revoke all on function public.apply_operational_alert_signals(jsonb) from public, anon, authenticated, service_role;

create or replace function public.reconcile_current_operational_alerts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_signals jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('padel-friend:operational-alert-reconcile', 0));
  v_signals := public.operational_failure_signals();
  return public.apply_operational_alert_signals(v_signals)
    || pg_catalog.jsonb_build_object('signals', v_signals);
end $$;

create function public.reconcile_operational_alerts(p_signals jsonb) returns jsonb
language sql security definer set search_path = '' as $$
  select public.reconcile_current_operational_alerts();
$$;
revoke all on function public.reconcile_operational_alerts(jsonb) from public, anon, authenticated;
grant execute on function public.reconcile_operational_alerts(jsonb) to service_role;

-- F38: manual rating-stage evidence no longer depends on the proposal still being pending.
--
-- The fixed rating-stage marker on a failed manual confirmation is itself proof of a real failure.
-- Between the rolled-back command and this report another reviewer or the due processor can
-- confirm the proposal; the observed failure must still be recorded. Idempotency stays keyed by
-- (proposal, command request). The proposal only has to exist.
create or replace function public.record_manual_rating_failure(p_proposal_id uuid, p_request_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.operational_job_events(event_key,event,outcome,reference,attempt,code,stage)
    select 'rating:manual:' || p.id || ':' || p_request_id,
        'rating.failure','failure',p.id,0,'RATING_PROJECTION_FAILED','rating_projection'
      from public.match_event_result_proposals p
     where p.id = p_proposal_id
  on conflict do nothing;
$$;

commit;
