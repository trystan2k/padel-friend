do $paf_assertions$
declare
  v_event uuid;
  v_expected integer;
  v_actual integer;
  v_before bigint;
  v_after bigint;
begin
  if exists (select 1 from pg_catalog.pg_extension where extname='pg_cron') then
    begin
      delete from cron.job where jobname='match-registration-cutoff';
    exception
      when insufficient_privilege then
        raise notice 'Local cutoff job could not be unscheduled; continuing with scheduler-safe assertions';
      when undefined_table or undefined_object then
        raise notice 'Local cutoff job could not be unscheduled; pg_cron job table is unavailable';
    end;
  end if;

  raise notice 'Repeated migration-up snapshot excludes scheduler-owned participation_status, cutoff_processed_at, transition_revision, next_accepted_ordinal and notifications: local cutoff job could not be unscheduled';
  execute $ddl$create or replace function public.paf_upgrade_snapshot() returns text language sql as $fn$
  select md5(coalesce((select string_agg(concat_ws(':',r.id,r.match_event_id,r.user_id,r.lifecycle,r.accepted_order,r.registration_source),';' order by r.id) from public.match_event_registrations r where r.match_event_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002')),'') ||
    coalesce((select string_agg(concat_ws(':',i.id,i.match_event_id,i.invitee_user_id),';' order by i.id) from public.match_event_invites i where i.id='50000000-0000-4000-8000-000000000001'),'') ||
    '');
  $fn$$ddl$;

  if not exists (
    select 1 from pg_catalog.pg_trigger
    where tgname='match_event_published_notification' and not tgisinternal and tgenabled <> 'D'
  ) then
    raise exception 'fixture publication trigger is missing or left disabled';
  end if;

  if (select count(*) from public.match_events where id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002')) <> 2 then raise exception 'fixture events missing'; end if;
  if (select count(*) from public.match_event_invites where id='50000000-0000-4000-8000-000000000001') <> 1 then raise exception 'fixture invite missing'; end if;
  if (select count(*) from public.match_event_registrations r join public.paf_upgrade_expected x on x.event_id=r.match_event_id and x.registration_id=r.id) <> 10 then raise exception 'registration identities missing'; end if;
  if exists(select 1 from public.match_event_registrations r join public.paf_upgrade_expected x on x.registration_id=r.id where r.lifecycle <> 'accepted') then raise exception 'legacy rows not backfilled accepted'; end if;
  if exists(select 1 from public.match_event_registrations r join public.match_events e on e.id=r.match_event_id where r.registration_source <> case when r.user_id=e.created_by then 'creator'::public.match_registration_source else 'member'::public.match_registration_source end) then raise exception 'source backfill incorrect'; end if;
  if exists(select 1 from public.match_event_registrations r join public.paf_upgrade_expected x on x.registration_id=r.id where r.accepted_order <> x.expected_ordinal) then raise exception 'accepted order is not creator-first and deterministic'; end if;
  if exists(select 1 from public.match_event_registration_state where match_event_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002') and next_accepted_ordinal <> 6) then raise exception 'next ordinal is not six'; end if;
  if exists(select 1 from public.match_event_registrations r where r.match_event_id='30000000-0000-4000-8000-000000000001' and r.participation_status <> case when r.accepted_order<=4 then 'playing'::public.match_registration_participation else 'reserve'::public.match_registration_participation end) then raise exception 'future event roster split incorrect'; end if;
  if exists(select 1 from public.match_event_registrations r where r.match_event_id='30000000-0000-4000-8000-000000000002' and r.participation_status <> case when r.accepted_order<=4 then 'playing'::public.match_registration_participation else 'reserve_not_playing'::public.match_registration_participation end) then raise exception 'cutoff event roster split incorrect'; end if;
  if (select count(*) from public.match_registration_roster('30000000-0000-4000-8000-000000000001')) <> 5 then raise exception 'future roster count mismatch'; end if;
  if (select count(*) from public.match_registration_roster('30000000-0000-4000-8000-000000000002')) <> 5 then raise exception 'cutoff roster count mismatch'; end if;
  if (select playing_count from public.match_registration_counts('30000000-0000-4000-8000-000000000001')) <> 4 or (select reserve_count from public.match_registration_counts('30000000-0000-4000-8000-000000000001')) <> 1 then raise exception 'future count projection mismatch'; end if;
  if (select playing_count from public.match_registration_counts('30000000-0000-4000-8000-000000000002')) <> 4 or (select reserve_not_playing_count from public.match_registration_counts('30000000-0000-4000-8000-000000000002')) <> 1 then raise exception 'cutoff count projection mismatch'; end if;

  select count(*) into v_before from public.notifications where target_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
  perform public.reconcile_match_registration_participation('30000000-0000-4000-8000-000000000001',null);
  perform public.reconcile_match_registration_participation('30000000-0000-4000-8000-000000000002',null);
  select count(*) into v_after from public.notifications where target_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
  if v_after > v_before then raise exception 'reconcile emitted synthetic historical notifications'; end if;
  if exists(select 1 from public.notifications where target_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002') and kind in ('match_registration_promoted','match_registration_quartet_complete')) then raise exception 'synthetic historical promotion/quartet alert exists'; end if;

  if not exists(select 1 from pg_catalog.pg_trigger where tgname='match_registration_identity_guard' and not tgisinternal) then raise exception 'identity guard missing'; end if;
  if exists(select 1 from pg_catalog.pg_trigger where tgname='match_registration_immutable' and not tgisinternal) then raise exception 'obsolete blanket trigger remains'; end if;
  begin
    update public.match_event_registrations set user_id='10000000-0000-4000-8000-000000000006' where id='40000000-0000-4000-8000-000000000002';
    raise exception 'identity guard accepted identity mutation';
  exception when check_violation then null;
  end;
  if has_table_privilege('anon','public.match_event_registration_state','select') or has_table_privilege('authenticated','public.match_event_registration_state','select') then raise exception 'internal state grants are not revoked'; end if;
  if has_table_privilege('anon','public.match_event_registration_attempts','select') or has_table_privilege('authenticated','public.match_event_registration_attempts','select') then raise exception 'internal attempt grants are not revoked'; end if;

  raise notice 'PAF populated upgrade assertions passed';
  raise notice 'PASS: populated upgrade data and invariants asserted';
end
$paf_assertions$;
