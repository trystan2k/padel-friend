do $$
declare e public.match_events%rowtype; actual jsonb; expected jsonb;
begin
  select * into strict e from public.match_events where id='73000000-0000-4000-8000-000000000101';
  select to_jsonb(x) into expected from public.paf_consent_upgrade_snapshot x;
  select jsonb_build_object('event',to_jsonb(e)-'reconfirmation_generation','state',to_jsonb(s),
    'registrations',(select jsonb_agg(to_jsonb(r)-array['required_generation','confirmed_generation','reconfirmed_at'] order by id) from public.match_event_registrations r where match_event_id=e.id),
    'attempts',(select jsonb_agg(to_jsonb(a)-array['required_generation','confirmed_generation','reconfirmed_at'] order by id) from public.match_event_registration_attempts a where match_event_id=e.id))
    into actual from public.match_event_registration_state s where s.match_event_id=e.id;
  if actual is distinct from expected or e.reconfirmation_generation<>0
    or exists(select 1 from public.match_event_registrations where match_event_id=e.id and (required_generation<>0 or confirmed_generation<>0 or reconfirmed_at is not null))
    or exists(select 1 from public.match_event_registration_attempts where match_event_id=e.id and (required_generation<>0 or confirmed_generation<>0 or reconfirmed_at is not null))
    or exists(select 1 from public.notifications where target_id=e.id)
    or exists(select 1 from public.match_event_audit_log where match_event_id=e.id) then
    raise exception 'Consent migration changed historical facts or fabricated consent'; end if;
  if to_regprocedure('public.reconfirm_match_registration(uuid,uuid,bigint,uuid)') is null then raise exception 'Consent RPC missing';end if;
  if (select reconfirmation_required_count from public.match_registration_counts(e.id))<>0 then raise exception 'Existing accepted player requires consent';end if;
end $$;
