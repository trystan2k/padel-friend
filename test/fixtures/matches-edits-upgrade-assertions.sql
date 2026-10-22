do $$
declare e public.match_events%rowtype; snapshot jsonb; expected jsonb; capability jsonb;
begin
  select * into strict e from public.match_events where id='73000000-0000-4000-8000-000000000100';
  select to_jsonb(x) into expected from public.paf_minor_edit_upgrade_snapshot x;
  select jsonb_build_object('event',to_jsonb(e),'state',to_jsonb(s),
    'registrations',(select jsonb_agg(to_jsonb(r) order by id) from public.match_event_registrations r where match_event_id=e.id),
    'attempts',(select jsonb_agg(to_jsonb(a) order by id) from public.match_event_registration_attempts a where match_event_id=e.id))
    into snapshot from public.match_event_registration_state s where match_event_id=e.id;
  if snapshot is distinct from expected or e.version<>1 or e.published_by<>e.created_by
    or exists(select 1 from public.match_event_audit_log where match_event_id=e.id)
    or exists(select 1 from public.match_event_management_commands where match_event_id=e.id)
    or exists(select 1 from public.notifications where target_id=e.id) then
    raise exception 'Minor edit migration changed historical facts, anchors, or effects'; end if;
  perform set_config('request.jwt.claim.sub',e.created_by::text,true);
  capability:=public.get_match_event_management(e.id);
  if capability->'actions'->'edit'->>'allowed'<>'true' or capability->>'version'<>'1' then
    raise exception 'Edit capability unavailable after upgrade'; end if;
  if to_regprocedure('public.edit_match_event(uuid,bigint,jsonb,uuid)') is null then raise exception 'Edit RPC missing'; end if;
end $$;
