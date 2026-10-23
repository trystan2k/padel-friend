begin;

-- No client UPDATE grants: only authenticated, locked command RPCs mutate facts.
create or replace function public.guard_match_event_mutation() returns trigger
language plpgsql security definer set search_path='' as $$
declare allowed text[]:=array['created_by','version','updated_at','status','cancelled_at','cancelled_by','cancel_reason',
  'venue_name','maps_url','court_notes','price_minor','currency','payment_note','notes',
  'maximum_registrations','registration_cutoff_at','saved_venue_id'];
begin
  if tg_op='DELETE' then raise exception 'Match history is immutable' using errcode='23514'; end if;
  if (to_jsonb(new)-allowed) is distinct from (to_jsonb(old)-allowed)
    or old.status='cancelled' or new.version<>old.version+1 then
    raise exception 'Invalid match event mutation' using errcode='23514';
  end if;
  return new;
end $$;

create function public.edit_match_event(p_match_event_id uuid,p_expected_version bigint,p_patch jsonb,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); e public.match_events%rowtype; merged public.match_events%rowtype;
  t timestamptz; rev bigint; recipient uuid; k text; v jsonb; payload jsonb; result jsonb;
  fields text[]; before_data jsonb; after_data jsonb; cmd public.match_event_management_commands%rowtype;
  allowed text[]:=array['venue_name','maps_url','court_notes','price_minor','currency','payment_note','notes',
    'maximum_registrations','registration_cutoff_at'];
begin
  if a is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_request_id is null or p_expected_version is null or p_expected_version not between 1 and 9007199254740991
    or p_patch is null or jsonb_typeof(p_patch)<>'object' then raise exception 'Invalid edit' using errcode='22023'; end if;
  begin
    e:=public.lock_match_event_registration(p_match_event_id);
  exception when raise_exception then
    if sqlerrm='MATCH_REGISTRATION_EVENT_NOT_FOUND' then raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode='P0001'; end if;
    raise;
  end;
  perform 1 from public.match_event_registrations where match_event_id=e.id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id=e.id order by id for update;
  perform 1 from public.match_event_invites where match_event_id=e.id order by id for update;
  t:=clock_timestamp();
  if e.created_by<>a then raise exception 'Organizer required' using errcode='42501'; end if;
  perform public.assert_match_event_active_locked(e.id);
  if t>=e.registration_cutoff_at or exists(select 1 from public.match_event_registration_state
    where match_event_id=e.id and cutoff_processed_at is not null) then
    raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode='P0001';
  end if;
  -- Validate types before jsonb_populate_record can coerce strings into numbers/text.
  for k,v in select key,value from jsonb_each(p_patch) loop
    if not k=any(allowed) then raise exception 'Field is not editable: %',k using errcode='22023'; end if;
    if v='null'::jsonb then
      if k in ('venue_name','maps_url','registration_cutoff_at') then raise exception 'Nonnullable edit field' using errcode='22023'; end if;
    elsif k in ('price_minor','maximum_registrations') then
      if jsonb_typeof(v)<>'number' or v::text !~ '^\d+$' or (v::text)::numeric>9007199254740991
        or (k='maximum_registrations' and ((v::text)::numeric<1 or (v::text)::numeric>2147483647)) then
        raise exception 'Invalid edit integer' using errcode='22023'; end if;
    elsif jsonb_typeof(v)<>'string' then raise exception 'Invalid edit text' using errcode='22023';
    elsif k='registration_cutoff_at' then
      if (p_patch->>k) !~ '^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d:[0-5]\d(\.\d{1,3})?(Z|[+-]([01]\d|2[0-3]):[0-5]\d)$' then
        raise exception 'Invalid edit instant' using errcode='22023'; end if;
      begin
        -- Canonical UTC serialization makes offset-equivalent retry payloads equal.
        p_patch:=jsonb_set(p_patch,array[k],to_jsonb(to_char((p_patch->>k)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')));
      exception when datetime_field_overflow or invalid_datetime_format then
        raise exception 'Invalid edit instant' using errcode='22023';
      end;
    end if;
  end loop;
  payload:=jsonb_build_object('expected_version',p_expected_version,'patch',p_patch);
  select * into cmd from public.match_event_management_commands where match_event_id=e.id and actor_id=a and request_id=p_request_id;
  if found then
    if cmd.action<>'edit' or cmd.payload<>payload then raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return cmd.result||jsonb_build_object('replayed',true);
  end if;
  if e.version<>p_expected_version then raise exception 'MATCH_MANAGEMENT_VERSION_CONFLICT' using errcode='P0001',detail=jsonb_build_object('current_version',e.version)::text; end if;
  merged:=jsonb_populate_record(e,p_patch);
  -- Explicit pair check closes SQL CHECK's UNKNOWN/null loophole.
  if (merged.price_minor is null)<>(merged.currency is null)
    or (merged.currency is not null and merged.currency not in ('BRL','USD','EUR')) then
    raise exception 'Invalid price/currency pair' using errcode='22023'; end if;
  if merged.registration_cutoff_at<=t or merged.registration_cutoff_at>=merged.starts_at then
    raise exception 'Invalid future cutoff' using errcode='22023'; end if;
  if merged.maximum_registrations is not null and merged.maximum_registrations<(
    select count(*) from public.match_event_registrations where match_event_id=e.id and lifecycle='accepted' and cancelled_at is null) then
    raise exception 'MATCH_MANAGEMENT_CAPACITY_BELOW_ACCEPTED' using errcode='P0001'; end if;
  if e.saved_venue_id is not null and (merged.venue_name is distinct from e.venue_name or merged.maps_url is distinct from e.maps_url)
    and not exists(select 1 from public.community_venues where id=e.saved_venue_id and name=merged.venue_name and maps_url=merged.maps_url) then
    merged.saved_venue_id:=null;
  end if;
  select coalesce(array_agg(key order by key collate "C"),'{}'::text[]),
    coalesce(jsonb_object_agg(key,to_jsonb(e)->key),'{}'),coalesce(jsonb_object_agg(key,to_jsonb(merged)->key),'{}')
    into fields,before_data,after_data from unnest(allowed||array['saved_venue_id']) key
    where to_jsonb(e)->key is distinct from to_jsonb(merged)->key;
  select transition_revision into rev from public.match_event_registration_state where match_event_id=e.id;
  if cardinality(fields)>0 then
    -- Existing row CHECKs validate all merged text/maps/price/timestamp limits atomically.
    update public.match_events set venue_name=merged.venue_name,maps_url=merged.maps_url,court_notes=merged.court_notes,
      price_minor=merged.price_minor,currency=merged.currency,payment_note=merged.payment_note,notes=merged.notes,
      maximum_registrations=merged.maximum_registrations,registration_cutoff_at=merged.registration_cutoff_at,
      saved_venue_id=merged.saved_venue_id,version=version+1,updated_at=t where id=e.id;
    rev:=public.advance_match_registration_revision_locked(e.id);
    insert into public.match_event_audit_log(match_event_id,community_id,actor_id,action,request_id,
      occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
    values(e.id,e.community_id,a,'minor_edit',p_request_id,t,e.version+1,rev,before_data,after_data,fields);
    for recipient in select user_id from public.match_event_registrations
      where match_event_id=e.id and lifecycle in ('accepted','pending') and cancelled_at is null
      union select invitee_user_id from public.match_event_invites where match_event_id=e.id and status='pending' loop
      perform public.persist_notification(recipient,'match.updated:'||e.id||':'||(e.version+1),
        'match_event_updated','matches','match_event',e.id,e.community_id);
    end loop;
  end if;
  result:=jsonb_build_object('event_id',e.id,'version',e.version+case when cardinality(fields)>0 then 1 else 0 end,
    'transition_revision',rev,'request_id',p_request_id,'replayed',false,'changed',cardinality(fields)>0,
    'change_kind',case when cardinality(fields)>0 then 'minor' else 'none' end,'changed_fields',fields,'reconfirmation_generation',0);
  insert into public.match_event_management_commands values(e.id,a,p_request_id,'edit',payload,result,t);
  return result;
end $$;

do $$
declare d text; sig text;
begin
  d:=pg_get_functiondef('public.get_match_event_management(uuid)'::regprocedure);
  d:=replace(d,'array[''withdraw'',''remove'',''transfer'',''cancel'']','array[''withdraw'',''remove'',''transfer'',''cancel'',''edit'']');
  d:=replace(d,'when action<>''cancel'' and t>=e.registration_cutoff_at',
    'when action<>''cancel'' and (t>=e.registration_cutoff_at or exists(select 1 from public.match_event_registration_state where match_event_id=e.id and cutoff_processed_at is not null))');
  if position('''edit''' in d)=0 then raise exception 'Edit capability extension failed'; end if;
  execute d;
  foreach sig in array array['public.get_my_notification_target_v2(uuid)','public.get_my_match_notification_contexts(uuid[])'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    d:=replace(d,'''match_event_cancelled'')','''match_event_cancelled'',''match_event_updated'')');
    if position('match_event_updated' in d)=0 then raise exception 'Notification extension failed: %',sig; end if;
    execute d;
  end loop;
end $$;
revoke all on function public.edit_match_event(uuid,bigint,jsonb,uuid) from public,anon,authenticated;
grant execute on function public.edit_match_event(uuid,bigint,jsonb,uuid) to authenticated;
commit;
