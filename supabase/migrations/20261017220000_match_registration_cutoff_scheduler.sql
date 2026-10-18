begin;

-- PAF-5.4 scheduler: unattended cutoff processing on Supabase pg_cron.
--
-- Guarded and conditional: the extension and the singleton job are created only
-- when pg_cron is actually available and schedulable in this environment, and
-- the migration still succeeds otherwise (the internal processors from
-- 20261017210000 remain callable for manual/controlled operation). The job is
-- named, so re-applying this migration updates the single job instead of
-- creating duplicates. A 1-minute cadence keeps the maximum alert latency at
-- roughly one interval plus processing time; hard closure stays exact at the
-- cutoff instant because joins/approvals evaluate the DB clock under lock.
-- Overdue events that became due during downtime are caught up by the same
-- unprocessed-marker predicate; failures are retained per event on
-- match_event_registration_state (cutoff_failure_count / cutoff_last_failure_*)
-- because pg_cron only records "1 row" for a successful command, never the
-- batch's errors JSON.

do $scheduler$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'PAF-5.4 scheduler: pg_cron is not available in this environment; the match registration cutoff job was NOT provisioned. Cutoff processing remains internal/manual until an approved scheduler is available.';
    return;
  end if;

  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'PAF-5.4 scheduler: pg_cron could not be created (%); the match registration cutoff job was NOT provisioned.', sqlerrm;
    return;
  end;

  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'PAF-5.4 scheduler: pg_cron is not installed; the match registration cutoff job was NOT provisioned.';
    return;
  end if;

  begin
    perform cron.schedule(
      'padel-friend-match-registration-cutoff',
      '* * * * *',
      'select public.process_due_match_event_registration_cutoffs(25)');
    raise notice 'PAF-5.4 scheduler: match registration cutoff job scheduled every minute (singleton job name padel-friend-match-registration-cutoff).';
  exception when others then
    raise notice 'PAF-5.4 scheduler: the pg_cron job could not be scheduled (%); the match registration cutoff job was NOT provisioned.', sqlerrm;
  end;
end
$scheduler$;

commit;
