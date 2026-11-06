begin;

-- Transactional operator failure notices for a failed repair attempt.
--
-- Contract (plan "Data and authorization contracts" 8): a failed attempt notifies the operators of
-- the job's community in the same transaction as the failed receipt, deduplicated by semantic
-- event: one notice per recipient, job and sanitized failure code. Automatic retries and operator
-- retries that fail the same way never add another notice; a different failure code is a new
-- event. A later success resolves (marks read) every failure notice of the job. Recipients are the
-- community's current Admins: the audience the existing result context reader already authorizes for
-- the community's results, so the notice opens without widening any permission. The payload is the
-- sanitized failure code only (carried by the kind and the job's diagnostics), never raw errors.

create function public.notify_result_repair_failure(p_job_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  j public.result_repair_jobs%rowtype;
  v_count integer;
begin
  select * into j from public.result_repair_jobs x where x.id = p_job_id;
  if not found or j.status <> 'failed' or j.failure_code is null then return 0; end if;
  select pg_catalog.count(public.persist_match_result_notification(
      m.user_id, 'result.repair_failed:' || j.id::text || ':' || j.failure_code, 'result_repair_failed',
      j.match_event_id, j.community_id, j.proposal_id, j.candidate_version)) into v_count
    from public.community_members m
   where m.community_id = j.community_id and m.status = 'active' and m.role = 'admin'
     and m.valid_from <= pg_catalog.clock_timestamp()
     and (m.valid_until is null or m.valid_until > pg_catalog.clock_timestamp());
  -- Each new failed attempt re-arms the job's live notice for this code: an operator who already read
  -- an earlier failure is alerted again, while the dedupe key still keeps a single row per recipient.
  update public.notifications n set read_at = null
   where n.kind = 'result_repair_failed' and n.read_at is not null
     and n.event_key = 'result.repair_failed:' || j.id::text || ':' || j.failure_code;
  return v_count;
end $$;

create function public.resolve_result_repair_failure_notices(p_job_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_count integer;
begin
  update public.notifications n set read_at = coalesce(n.read_at, pg_catalog.clock_timestamp())
   where n.kind = 'result_repair_failed' and n.read_at is null
     and pg_catalog.starts_with(n.event_key, 'result.repair_failed:' || p_job_id::text || ':');
  get diagnostics v_count = row_count;
  return v_count;
end $$;

revoke all on function public.notify_result_repair_failure(uuid),
  public.resolve_result_repair_failure_notices(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_patch record;
  v_original text;
begin
  for v_patch in select * from (values
    -- A failed attempt notifies the operators inside the failed-receipt transaction.
    ('public.execute_result_repair(uuid,uuid)'::regprocedure,
      E'      pg_catalog.jsonb_build_object(''failure_code'', v_code, ''failure_stage'', v_stage));\n',
      E'      pg_catalog.jsonb_build_object(''failure_code'', v_code, ''failure_stage'', v_stage));\n'
      || E'    perform public.notify_result_repair_failure(j.id);\n'),
    -- A success resolves the job's earlier failure notices.
    ('public.execute_result_repair(uuid,uuid)'::regprocedure,
      E'    perform public.notify_match_result_lifecycle(j.proposal_id, j.candidate_version, v_key, ''result_repair_applied'');\n',
      E'    perform public.notify_match_result_lifecycle(j.proposal_id, j.candidate_version, v_key, ''result_repair_applied'');\n'
      || E'    perform public.resolve_result_repair_failure_notices(j.id);\n'),
    -- The failure notice resolves through the existing result context reader.
    ('public.get_my_result_notification_contexts(uuid[])'::regprocedure,
      '''result_repair_queued'', ''result_repair_applied'')',
      '''result_repair_queued'', ''result_repair_applied'', ''result_repair_failed'')')
  ) as t(signature, needle, replacement) loop
    v_original := pg_get_functiondef(v_patch.signature);
    if (length(v_original) - length(replace(v_original, v_patch.needle, '')))
      <> length(v_patch.needle) then
      raise exception 'Unexpected % definition; refusing to patch (%)', v_patch.signature,
        left(v_patch.needle, 60);
    end if;
    execute replace(v_original, v_patch.needle, v_patch.replacement);
  end loop;
end $patch$;

commit;
