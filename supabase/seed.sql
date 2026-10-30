-- Local-only seed.
--
-- The registration-cutoff and result-auto-confirm migrations provision named
-- pg_cron jobs whenever pg_cron is available, which is the case on the local
-- stack. Unattended jobs can mutate backdated integration fixtures mid-suite,
-- so local reset removes both. Hosted `supabase db push` never runs this seed;
-- scheduled jobs persist there. Re-create either singleton job locally only
-- for an operational smoke run, then remove it before test gates:
--
--   select cron.schedule('padel-friend-match-registration-cutoff', '* * * * *',
--     'select public.process_due_match_event_registration_cutoffs(25)');
--   select cron.schedule('padel-friend-match-result-auto-confirm', '* * * * *',
--     'select public.process_due_match_event_results(25)');
--
-- then remove each with `select cron.unschedule('<job-name>');`.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
    and exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron')
    and exists (select 1 from cron.job where jobname = 'padel-friend-match-registration-cutoff') then
    perform cron.unschedule('padel-friend-match-registration-cutoff');
    raise notice 'PAF-5.4 scheduler: removed the local match registration cutoff job for deterministic tests.';
  end if;
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
    and exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron')
    and exists (select 1 from cron.job where jobname = 'padel-friend-match-result-auto-confirm') then
    perform cron.unschedule('padel-friend-match-result-auto-confirm');
    raise notice 'T08.3 scheduler: removed the local result auto-confirm job for deterministic tests.';
  end if;
exception when others then
  raise notice 'Local scheduler cleanup skipped (%).', sqlerrm;
end $$;
