-- Local-only seed.
--
-- The PAF-5.4 scheduler migration provisions the pg_cron cutoff job whenever
-- pg_cron is available, which is the case on the local stack. An unattended job
-- that mutates fixture events mid-suite would make the deterministic
-- integration/E2E gates flaky (it flips a backdated event's residual Reserve to
-- Reserve Not Playing and writes cutoff alerts while assertions run), so local
-- reset removes the job. Hosted `supabase db push` never runs this seed, so the
-- scheduled job persists there. To exercise the unattended scheduler locally on
-- demand, re-create the singleton job with:
--
--   select cron.schedule('padel-friend-match-registration-cutoff', '* * * * *',
--     'select public.process_due_match_event_registration_cutoffs(25)');
--
-- and remove it again with `select cron.unschedule('padel-friend-match-registration-cutoff');`.
do $$
begin
  if exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron')
    and exists (select 1 from pg_catalog.pg_namespace where nspname = 'cron')
    and exists (select 1 from cron.job where jobname = 'padel-friend-match-registration-cutoff') then
    perform cron.unschedule('padel-friend-match-registration-cutoff');
    raise notice 'PAF-5.4 scheduler: removed the local match registration cutoff job for deterministic tests.';
  end if;
exception when others then
  raise notice 'PAF-5.4 scheduler: local cutoff job removal skipped (%).', sqlerrm;
end $$;
