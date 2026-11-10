-- Normal-confirmation rating-stage diagnostic (PRD §59 rating failure).
--
-- A rating-projection failure inside confirmation rolls the confirmation back, so evidence written
-- before the failure cannot survive. The durable boundary is the due processor's per-candidate
-- exception handler, which already records the failed attempt after the subtransaction rolled
-- back. The projector is wrapped so its errors carry a fixed stage marker (DETAIL) without
-- altering SQLSTATE, message, locks or rollback; the handler reads the marker and writes a safe
-- `rating.failure` event next to the existing `result.confirm` failure. No raw SQL or provider
-- text is stored: only the reference, attempt, a fixed code and the fixed stage.
begin;

alter function public.project_confirmed_rating_group(uuid)
  rename to project_confirmed_rating_group_core;

create function public.project_confirmed_rating_group(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform public.project_confirmed_rating_group_core(p_proposal_id);
exception when others then
  raise exception using errcode = SQLSTATE, message = SQLERRM, detail = 'rating_projection';
end $$;

revoke all on function public.project_confirmed_rating_group(uuid),
  public.project_confirmed_rating_group_core(uuid) from public, anon, authenticated, service_role;

do $patch$
declare
  v_original text;
  v_definition text;
begin
  v_original := pg_catalog.pg_get_functiondef('public.process_due_match_event_results(integer)'::regprocedure);

  v_definition := replace(v_original,
    $old$  v_sqlstate text;$old$,
    $new$  v_sqlstate text;
  v_detail text;$new$);
  if v_definition = v_original then
    raise exception 'Unexpected due processor declaration; refusing to omit rating diagnostics';
  end if;

  v_original := v_definition;
  v_definition := replace(v_definition,
    $old$      v_sqlstate := SQLSTATE;$old$,
    $new$      v_sqlstate := SQLSTATE;
      get stacked diagnostics v_detail = PG_EXCEPTION_DETAIL;$new$);
  if v_definition = v_original then
    raise exception 'Unexpected due processor handler; refusing to omit rating diagnostics';
  end if;

  v_original := v_definition;
  v_definition := replace(v_definition,
    $old$        null;
      end;
    end;
  end loop;$old$,
    $new$        null;
      end;
      if v_detail = 'rating_projection' then
        insert into public.operational_job_events(event_key,event,outcome,reference,attempt,code,stage)
          select 'rating:' || v_candidate.proposal_id || ':' || v_candidate.active_version || ':' || a.attempt,
              'rating.failure','failure',v_candidate.proposal_id,a.attempt,'RATING_PROJECTION_FAILED','rating_projection'
            from (select coalesce(max(s.attempt_count), 0) as attempt
                    from public.match_event_result_processing_state s
                   where s.proposal_id = v_candidate.proposal_id) a
          on conflict do nothing;
      end if;
    end;
  end loop;$new$);
  if v_definition = v_original then
    raise exception 'Unexpected due processor loop; refusing to omit rating diagnostics';
  end if;
  execute v_definition;
end
$patch$;

commit;
