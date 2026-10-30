begin;

-- T08.3 scheduler: unattended 48-hour result confirmation on Supabase pg_cron.
-- The named schedule is a singleton. The processor is SECURITY DEFINER but its
-- EXECUTE privilege is revoked from browser roles; the job runs as the trusted
-- role that provisions it. Failed items retain sanitized retry state because
-- cron.job_run_details only reports command-level success/failure.
do $scheduler$
begin
  if not exists (
    select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron'
  ) then
    raise notice 'T08.3 scheduler: pg_cron is unavailable; the match result auto-confirm job was NOT provisioned.';
    return;
  end if;

  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'T08.3 scheduler: pg_cron could not be created (%); the match result auto-confirm job was NOT provisioned.', sqlerrm;
    return;
  end;

  if not exists (
    select 1 from pg_catalog.pg_extension where extname = 'pg_cron'
  ) then
    raise notice 'T08.3 scheduler: pg_cron is not installed; the match result auto-confirm job was NOT provisioned.';
    return;
  end if;

  begin
    perform cron.schedule(
      'padel-friend-match-result-auto-confirm',
      '* * * * *',
      'select public.process_due_match_event_results(25)'
    );
    raise notice 'T08.3 scheduler: match result auto-confirm job scheduled every minute (singleton job name padel-friend-match-result-auto-confirm).';
  exception when others then
    raise notice 'T08.3 scheduler: the pg_cron job could not be scheduled (%); the match result auto-confirm job was NOT provisioned.', sqlerrm;
  end;
end
$scheduler$;

commit;
