begin;

-- F34: durable ordering for operational alert reconciliation.
--
-- The Worker used to read failure signals and then reconcile them in two RPCs, ordered only by a
-- per-isolate queue. Scheduled executions in separate Workers isolates could therefore apply an
-- older snapshot after a newer one and falsely resolve or reopen an alert. Reading and reconciling
-- now happen in ONE transaction behind a transaction-scoped advisory lock: every run observes the
-- signals only after the previous run committed, so a snapshot can never land out of order.
-- Alert delivery stays outside this lock, fenced by its own leases. The snapshot-taking function
-- is no longer callable by the service role, so no caller can reconcile a self-supplied stale set.
create function public.reconcile_current_operational_alerts() returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_signals jsonb;
begin
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('padel-friend:operational-alert-reconcile', 0));
  v_signals := public.operational_failure_signals();
  return public.reconcile_operational_alerts(v_signals)
    || pg_catalog.jsonb_build_object('signals', v_signals);
end $$;
revoke all on function public.reconcile_current_operational_alerts() from public, anon, authenticated;
grant execute on function public.reconcile_current_operational_alerts() to service_role;
revoke execute on function public.reconcile_operational_alerts(jsonb) from service_role;

-- F35: durable rating-stage evidence for a MANUAL confirmation.
--
-- A manual confirmation that fails at rating projection rolls back completely, so nothing it wrote
-- can survive. The server function calls this AFTER the failed command, in a separate transaction,
-- and only when the database reported the fixed rating-stage marker. The row has the same shape
-- as the due processor's rating.failure event (fixed code, fixed stage, proposal reference), keyed
-- by the command request so a retried report is idempotent. Only a still-pending proposal counts.
create function public.record_manual_rating_failure(p_proposal_id uuid, p_request_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.operational_job_events(event_key,event,outcome,reference,attempt,code,stage)
    select 'rating:manual:' || p.id || ':' || p_request_id,
        'rating.failure','failure',p.id,0,'RATING_PROJECTION_FAILED','rating_projection'
      from public.match_event_result_proposals p
     where p.id = p_proposal_id and p.status = 'pending'
  on conflict do nothing;
$$;
revoke all on function public.record_manual_rating_failure(uuid, uuid) from public, anon, authenticated;
grant execute on function public.record_manual_rating_failure(uuid, uuid) to service_role;

commit;
