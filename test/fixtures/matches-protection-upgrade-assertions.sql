do $$
declare e public.match_events%rowtype; actual jsonb; expected jsonb;
begin
  select * into strict e from public.match_events where id='73000000-0000-4000-8000-000000000101';
  select to_jsonb(x) into expected from public.paf_consent_upgrade_snapshot x;
  select jsonb_build_object('event',to_jsonb(e),'state',to_jsonb(s),
    'registrations',(select jsonb_agg(to_jsonb(r) order by id) from public.match_event_registrations r where match_event_id=e.id),
    'attempts',(select jsonb_agg(to_jsonb(a) order by id) from public.match_event_registration_attempts a where match_event_id=e.id))
    into actual from public.match_event_registration_state s where s.match_event_id=e.id;
  if actual is distinct from expected
    or exists(select 1 from public.notifications where target_id=e.id)
    or exists(select 1 from public.match_event_audit_log where match_event_id=e.id) then
    raise exception 'Protection upgrade altered historical facts or emitted effects'; end if;
  if to_regprocedure('public.assert_match_management_action_locked(uuid,text)') is null then raise exception 'Protection guard missing';end if;
  if has_function_privilege('authenticated','public.protect_match_event_results(uuid)','EXECUTE')
    or has_function_privilege('anon','public.assert_match_management_action_locked(uuid,text)','EXECUTE')
    or has_table_privilege('authenticated','public.match_event_registration_state','UPDATE') then
    raise exception 'Protection seam exposed to browser'; end if;
end $$;
