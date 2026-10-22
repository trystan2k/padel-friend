begin;

alter table public.match_events add column reconfirmation_generation bigint not null default 0
  check(reconfirmation_generation between 0 and 9007199254740991);
alter table public.match_event_registrations
  add column required_generation bigint not null default 0,
  add column confirmed_generation bigint not null default 0,
  add column reconfirmed_at timestamptz,
  add constraint match_registration_consent check(0<=confirmed_generation and confirmed_generation<=required_generation
    and required_generation<=9007199254740991),
  drop constraint match_registration_lifecycle_anchors,
  add constraint match_registration_lifecycle_anchors check(
    (lifecycle in ('accepted','withdrawn','removed_by_creator','expired') and accepted_at is not null
      and accepted_order is not null and (approved_at is null or approved_at=accepted_at))
    or (lifecycle in ('pending','rejected','expired') and accepted_at is null
      and accepted_order is null and approved_at is null));
alter table public.match_event_registration_attempts
  add column required_generation bigint not null default 0,
  add column confirmed_generation bigint not null default 0,
  add column reconfirmed_at timestamptz,
  add constraint match_attempt_consent check(0<=confirmed_generation and confirmed_generation<=required_generation
    and required_generation<=9007199254740991);
create index match_registration_required_generation on public.match_event_registrations
  (match_event_id,required_generation,confirmed_generation) where lifecycle='accepted';

-- Entry attests to current terms, unlike reconfirmation which must be explicit.
-- Covers creator auto-registration, direct joins, re-entry and approvals alike.
create function public.initialize_match_registration_consent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.lifecycle='accepted' and (tg_op='INSERT' or old.lifecycle<>'accepted') then
    select reconfirmation_generation into new.required_generation from public.match_events where id=new.match_event_id;
    new.confirmed_generation:=new.required_generation;
    new.reconfirmed_at:=null;
  elsif new.lifecycle='pending' and (tg_op='INSERT' or old.lifecycle<>'pending') then
    new.required_generation:=0;
    new.confirmed_generation:=0;
    new.reconfirmed_at:=null;
  end if;
  return new;
end $$;
create trigger match_registration_initial_consent before insert or update on public.match_event_registrations
  for each row execute function public.initialize_match_registration_consent();
create function public.initialize_match_attempt_consent() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.outcome='accepted' and (tg_op='INSERT' or old.outcome<>'accepted') then
    select required_generation,confirmed_generation,reconfirmed_at
      into new.required_generation,new.confirmed_generation,new.reconfirmed_at
      from public.match_event_registrations where id=new.registration_id;
  end if;
  return new;
end $$;
create trigger match_attempt_initial_consent before insert or update on public.match_event_registration_attempts
  for each row execute function public.initialize_match_attempt_consent();
revoke all on function public.initialize_match_registration_consent(),public.initialize_match_attempt_consent()
  from public,anon,authenticated;

-- Current membership at as_of, not a historical membership reconstruction.
create or replace function public.match_registration_roster(p_match_event_id uuid,p_as_of timestamptz)
returns table(registration_id uuid,user_id uuid,accepted_order bigint,roster_position integer,
  accepted_total integer,playing_total integer,reserve_total integer,participation_status public.match_registration_participation)
language sql stable security definer set search_path='' as $$
  with ranked as (
    select r.id,r.user_id,r.accepted_order,row_number() over(order by r.accepted_order,r.id)::integer pos,
      count(*) over()::integer total
    from public.match_event_registrations r join public.match_events e on e.id=r.match_event_id
    where e.id=p_match_event_id and e.status='open' and r.lifecycle='accepted' and r.cancelled_at is null
      and r.confirmed_generation=r.required_generation
  )
  select r.id,r.user_id,r.accepted_order,r.pos,r.total,(r.total/4)*4,r.total%4,
    case when r.pos<=(r.total/4)*4 then 'playing'::public.match_registration_participation
      when e.registration_cutoff_at<=coalesce(p_as_of,now()) or s.cutoff_processed_at<=coalesce(p_as_of,now())
      then 'reserve_not_playing'::public.match_registration_participation else 'reserve'::public.match_registration_participation end
  from ranked r cross join public.match_events e
  left join public.match_event_registration_state s on s.match_event_id=e.id where e.id=p_match_event_id;
$$;
create or replace function public.match_registration_roster(p_match_event_id uuid)
returns table(registration_id uuid,user_id uuid,accepted_order bigint,roster_position integer,
  accepted_total integer,playing_total integer,reserve_total integer,participation_status public.match_registration_participation)
language sql stable security definer set search_path='' as $$
  select * from public.match_registration_roster(p_match_event_id,now());
$$;
drop function public.match_registration_counts(uuid);
drop function public.match_registration_counts(uuid,timestamptz);
create function public.match_registration_counts(p_match_event_id uuid,p_as_of timestamptz)
returns table(accepted_count integer,playing_count integer,reserve_count integer,reserve_not_playing_count integer,
  reconfirmation_required_count integer)
language sql stable security definer set search_path='' as $$
  select (select count(*)::integer from public.match_event_registrations r join public.match_events e on e.id=r.match_event_id
      where e.id=p_match_event_id and e.status='open' and r.lifecycle='accepted' and r.cancelled_at is null),
    count(*) filter(where q.participation_status='playing')::integer,
    count(*) filter(where q.participation_status='reserve')::integer,
    count(*) filter(where q.participation_status='reserve_not_playing')::integer,
    (select count(*)::integer from public.match_event_registrations r join public.match_events e on e.id=r.match_event_id
      where e.id=p_match_event_id and e.status='open' and r.lifecycle='accepted' and r.cancelled_at is null
        and r.confirmed_generation<r.required_generation)
  from public.match_registration_roster(p_match_event_id,p_as_of) q;
$$;
create function public.match_registration_counts(p_match_event_id uuid)
returns table(accepted_count integer,playing_count integer,reserve_count integer,reserve_not_playing_count integer,
  reconfirmation_required_count integer)
language sql stable security definer set search_path='' as $$
  select * from public.match_registration_counts(p_match_event_id,now());
$$;
revoke all on function public.match_registration_counts(uuid),public.match_registration_counts(uuid,timestamptz)
  from public,anon,authenticated;

-- Extend existing writers and deferred evidence validation; accepted attempts
-- retain outcome/anchors when ended by consent expiry, exactly like departures.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.check_match_registration_final_state()'::regprocedure);
  d:=replace(d,'r.participation_status is null or a.ended_at is not null',
    '(r.participation_status is null and r.confirmed_generation=r.required_generation) or a.ended_at is not null');
  d:=replace(d,'r.lifecycle in (''pending'',''rejected'',''expired'') and a.outcome is distinct from r.lifecycle',
    '(r.lifecycle in (''pending'',''rejected'') or (r.lifecycle=''expired'' and r.accepted_at is null)) and a.outcome is distinct from r.lifecycle');
  d:=replace(d,'r.lifecycle in (''accepted'',''withdrawn'',''removed_by_creator'') and',
    '(r.lifecycle in (''accepted'',''withdrawn'',''removed_by_creator'') or (r.lifecycle=''expired'' and r.accepted_at is not null)) and');
  d:=replace(d,'if a.id is null',
    'if (r.required_generation,r.confirmed_generation,r.reconfirmed_at) is distinct from (a.required_generation,a.confirmed_generation,a.reconfirmed_at)
      or (r.lifecycle=''expired'' and r.accepted_at is not null and (a.outcome<>''accepted'' or a.end_kind is distinct from ''reconfirmation_expired'' or a.ended_at is distinct from r.resolved_at or r.confirmed_generation>=r.required_generation))
      or (r.lifecycle=''accepted'' and r.confirmed_generation<r.required_generation and r.participation_status is not null)
      then raise exception ''Invalid consent evidence'' using errcode=''23514''; end if; if a.id is null');
  execute d;
  d:=pg_get_functiondef('public.reconcile_match_registration_participation(uuid,uuid,jsonb)'::regprocedure);
  d:=replace(d,'lifecycle<>''accepted'' or cancelled_at is not null',
    'lifecycle<>''accepted'' or cancelled_at is not null or confirmed_generation<required_generation');
  execute d;
  d:=pg_get_functiondef('public.guard_match_event_mutation()'::regprocedure);
  d:=replace(d,'''registration_cutoff_at'',''saved_venue_id'']',
    '''registration_cutoff_at'',''saved_venue_id'',''starts_at'',''event_type'',''reconfirmation_generation'']');
  execute d;
  -- Natural approval replay may now be accepted but suspended for consent.
  d:=pg_get_functiondef('public.decide_match_registration(uuid,uuid,text)'::regprocedure);
  d:=replace(d,'''participation'',v_row.participation_status,',
    '''required_generation'',v_row.required_generation,''confirmed_generation'',v_row.confirmed_generation,''participation'',v_row.participation_status,');
  execute d;
end $$;

-- Extend locked edit implementation without changing unit 4 normalization,
-- request replay, patch validation or transactional minor-edit behavior.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.edit_match_event(uuid,bigint,jsonb,uuid)'::regprocedure);
  d:=replace(d,'fields text[];', 'major boolean; before_roster jsonb; generation bigint; fields text[];');
  d:=replace(d,'''maximum_registrations'',''registration_cutoff_at''];',
    '''maximum_registrations'',''registration_cutoff_at'',''event_type'',''starts_at''];');
  d:=replace(d,'''venue_name'',''maps_url'',''registration_cutoff_at'')',
    '''venue_name'',''maps_url'',''registration_cutoff_at'',''event_type'',''starts_at'')');
  d:=replace(d,'elsif k=''registration_cutoff_at'' then', 'elsif k in (''registration_cutoff_at'',''starts_at'') then');
  d:=replace(d,'if merged.registration_cutoff_at<=t', 'if merged.starts_at<=t or merged.registration_cutoff_at<=t');
  d:=replace(d,'if cardinality(fields)>0 then',
    'major:=(fields && array[''event_type'',''starts_at'']) and exists(select 1 from public.match_event_registrations where match_event_id=e.id and lifecycle=''accepted'' and cancelled_at is null);
    generation:=e.reconfirmation_generation+case when major then 1 else 0 end;
    if major then before_roster:=public.snapshot_match_registration_roster_locked(e.id); end if;
    if cardinality(fields)>0 then');
  d:=replace(d,'update public.match_events set venue_name=',
    'update public.match_events set event_type=merged.event_type,starts_at=merged.starts_at,reconfirmation_generation=generation,venue_name=');
  d:=replace(d,'rev:=public.advance_match_registration_revision_locked(e.id);',
    'if major then
      update public.match_event_registrations set required_generation=generation where match_event_id=e.id and lifecycle=''accepted'' and cancelled_at is null;
      update public.match_event_registration_attempts a set required_generation=generation
        from public.match_event_registrations r where r.match_event_id=e.id and r.lifecycle=''accepted'' and r.cancelled_at is null and a.id=r.current_attempt_id;
      result:=public.reconcile_match_registration_participation(e.id,null,before_roster);
      rev:=(result->>''transition_revision'')::bigint;
      for recipient in select user_id from public.match_event_registrations where match_event_id=e.id and lifecycle=''accepted'' and cancelled_at is null loop
        perform public.persist_notification(recipient,''match.reconfirmation_required:''||e.id||'':''||generation,
          ''match_reconfirmation_required'',''matches'',''match_event'',e.id,e.community_id);
      end loop;
    else rev:=public.advance_match_registration_revision_locked(e.id); end if;');
  d:=replace(d,'''minor_edit'',p_request_id', 'case when major then ''major_edit'' else ''minor_edit'' end,p_request_id');
  d:=replace(d,'rev,before_data,after_data,fields)',
    'rev,before_data,after_data||jsonb_build_object(''reconfirmation_generation'',generation),fields)');
  d:=replace(d,'lifecycle in (''accepted'',''pending'') and cancelled_at is null',
    'lifecycle in (''accepted'',''pending'') and cancelled_at is null and (not major or lifecycle=''pending'')');
  d:=replace(d,'where match_event_id=e.id and status=''pending'' loop',
    'where match_event_id=e.id and status=''pending'' and (not major or not exists(select 1 from public.match_event_registrations ar where ar.match_event_id=e.id and ar.user_id=invitee_user_id and ar.lifecycle=''accepted'' and ar.cancelled_at is null)) loop');
  d:=replace(d,'then ''minor'' else ''none'' end', 'then case when major then ''major'' else ''minor'' end else ''none'' end');
  d:=replace(d,'''reconfirmation_generation'',0', '''reconfirmation_generation'',generation');
  if position('required_generation=generation' in d)=0 then raise exception 'Major edit extension failed'; end if;
  execute d;
end $$;

create function public.reconfirm_match_registration(p_match_event_id uuid,p_attempt_id uuid,p_generation bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); e public.match_events%rowtype; r public.match_event_registrations%rowtype;
  cmd public.match_event_management_commands%rowtype; t timestamptz; payload jsonb; result jsonb;
  before_roster jsonb; rev bigint; recipient uuid; changed boolean;
begin
  if actor is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_attempt_id is null or p_request_id is null or p_generation is null or p_generation not between 1 and 9007199254740991 then
    raise exception 'Invalid reconfirmation' using errcode='22023'; end if;
  begin
    e:=public.lock_match_event_registration(p_match_event_id);
  exception when raise_exception then
    if sqlerrm='MATCH_REGISTRATION_EVENT_NOT_FOUND' then raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode='P0001'; end if;
    raise;
  end;
  perform 1 from public.match_event_registrations where match_event_id=e.id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id=e.id order by id for update;
  t:=clock_timestamp();
  perform public.assert_match_event_active_locked(e.id);
  if t>=e.registration_cutoff_at or exists(select 1 from public.match_event_registration_state where match_event_id=e.id and cutoff_processed_at is not null) then
    raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode='P0001'; end if;
  select * into r from public.match_event_registrations where match_event_id=e.id and user_id=actor;
  if r.current_attempt_id is distinct from p_attempt_id then raise exception 'MATCH_MANAGEMENT_STALE_ATTEMPT' using errcode='P0001'; end if;
  if r.lifecycle<>'accepted' or r.cancelled_at is not null then raise exception 'MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED' using errcode='P0001'; end if;
  if p_generation<>e.reconfirmation_generation or p_generation<>r.required_generation then
    raise exception 'MATCH_MANAGEMENT_STALE_GENERATION' using errcode='P0001'; end if;
  payload:=jsonb_build_object('attempt_id',p_attempt_id,'generation',p_generation);
  select * into cmd from public.match_event_management_commands where match_event_id=e.id and actor_id=actor and request_id=p_request_id;
  if found then
    if cmd.action<>'reconfirm' or cmd.payload<>payload then raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return cmd.result||jsonb_build_object('replayed',true,'changed',false);
  end if;
  changed:=r.confirmed_generation<r.required_generation;
  if changed then
    before_roster:=public.snapshot_match_registration_roster_locked(e.id);
    update public.match_event_registrations set confirmed_generation=p_generation,reconfirmed_at=t where id=r.id;
    update public.match_event_registration_attempts set confirmed_generation=p_generation,reconfirmed_at=t where id=p_attempt_id and ended_at is null;
    result:=public.reconcile_match_registration_participation(e.id,null,before_roster);
    rev:=(result->>'transition_revision')::bigint;
    insert into public.match_event_audit_log(match_event_id,community_id,actor_id,target_user_id,action,request_id,
      occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
    values(e.id,e.community_id,actor,actor,'reconfirm',p_request_id,t,e.version,rev,
      jsonb_build_object('attempt_id',p_attempt_id,'confirmed_generation',r.confirmed_generation),
      jsonb_build_object('attempt_id',p_attempt_id,'confirmed_generation',p_generation,'event_version',e.version,'reconfirmed_at',t),
      array['confirmed_generation','reconfirmed_at']);
    for recipient in select distinct x from unnest(array[actor,e.created_by]) x loop
      perform public.persist_notification(recipient,'match.reconfirmed:'||e.id||':'||p_generation||':'||p_attempt_id,
        'match_registration_reconfirmed','matches','match_event',e.id,e.community_id);
    end loop;
  else select transition_revision into rev from public.match_event_registration_state where match_event_id=e.id; end if;
  select * into r from public.match_event_registrations where id=r.id;
  result:=jsonb_build_object('event_id',e.id,'version',e.version,'transition_revision',rev,'request_id',p_request_id,
    'replayed',not changed,'changed',changed,'confirmed_generation',p_generation,'participation',r.participation_status);
  insert into public.match_event_management_commands values(e.id,actor,p_request_id,'reconfirm',payload,result,t);
  return result;
end $$;
revoke all on function public.reconfirm_match_registration(uuid,uuid,bigint,uuid) from public,anon,authenticated;
grant execute on function public.reconfirm_match_registration(uuid,uuid,bigint,uuid) to authenticated;

-- Exclude consent-expired attempts before the single final reconcile. Marker,
-- evidence and all effects share the transaction (including notification failure).
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.process_match_event_registration_cutoff(uuid,boolean)'::regprocedure);
  d:=replace(d,'v_invites integer;', 'v_invites integer; before_roster jsonb; excluded jsonb; ex jsonb; recipient uuid;');
  d:=replace(d,'v_now := clock_timestamp();',
    'perform 1 from public.match_event_registrations where match_event_id=p_match_event_id order by id for update;
    perform 1 from public.match_event_registration_attempts where match_event_id=p_match_event_id order by id for update;
    perform 1 from public.match_event_invites where match_event_id=p_match_event_id order by id for update;
    v_now := clock_timestamp();');
  d:=replace(d,'select coalesce(array_agg(r.user_id)',
    'before_roster:=public.snapshot_match_registration_roster_locked(p_match_event_id);
    select coalesce(jsonb_agg(jsonb_build_object(''user_id'',user_id,''attempt_id'',current_attempt_id,''generation'',required_generation,''accepted_order'',accepted_order)),''[]'') into excluded
      from public.match_event_registrations where match_event_id=p_match_event_id and lifecycle=''accepted'' and cancelled_at is null and confirmed_generation<required_generation;
    update public.match_event_registration_attempts a set ended_at=v_now,end_kind=''reconfirmation_expired''
      from public.match_event_registrations r where r.match_event_id=p_match_event_id and r.lifecycle=''accepted'' and r.cancelled_at is null
        and r.confirmed_generation<r.required_generation and a.id=r.current_attempt_id;
    update public.match_event_registrations set lifecycle=''expired'',resolved_at=v_now,resolved_by=null
      where match_event_id=p_match_event_id and lifecycle=''accepted'' and cancelled_at is null and confirmed_generation<required_generation;
    select coalesce(array_agg(r.user_id)');
  d:=replace(d,'public.reconcile_match_registration_participation(p_match_event_id);',
    'public.reconcile_match_registration_participation(p_match_event_id,null,before_roster);');
  d:=replace(d,'foreach v_uid in array v_users loop',
    'for ex in select value from jsonb_array_elements(excluded) loop
      insert into public.match_event_audit_log(match_event_id,community_id,target_user_id,action,occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
      values(p_match_event_id,v_event.community_id,(ex->>''user_id'')::uuid,''reconfirmation_excluded'',v_now,v_event.version,v_revision,
        ex||jsonb_build_object(''lifecycle'',''accepted''),ex||jsonb_build_object(''lifecycle'',''expired'',''resolved_at'',v_now),array[''lifecycle'']);
      for recipient in select distinct x from unnest(array[(ex->>''user_id'')::uuid,v_event.created_by]) x loop
        perform public.persist_notification(recipient,''match.reconfirmation_expired:''||p_match_event_id||'':''||(ex->>''generation'')||'':''||(ex->>''attempt_id''),
          ''match_reconfirmation_expired'',''matches'',''match_event'',p_match_event_id,v_event.community_id);
      end loop;
    end loop;
    foreach v_uid in array v_users loop');
  d:=replace(d,'''expired_count'', cardinality(v_users)',
    '''reconfirmation_expired_count'',jsonb_array_length(excluded),''expired_count'', cardinality(v_users)');
  execute d;
end $$;

-- All count consumers distinguish capacity from eligible complete quartets.
do $$
declare d text; sig text; alias text;
begin
  foreach sig in array array['public.get_match_event(uuid)','public.list_match_events(text,uuid,text,integer,timestamptz)'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    foreach alias in array array['n','e'] loop
      d:=replace(d,'''group_count'','||alias||'.accepted_count/4', '''group_count'','||alias||'.playing_count/4');
      d:=replace(d,'''more_needed'',4-('||alias||'.accepted_count%4)',
        '''more_needed'',4-(('||alias||'.playing_count+'||alias||'.reserve_count+'||alias||'.reserve_not_playing_count)%4)');
      d:=replace(d,'''reserve_not_playing_count'','||alias||'.reserve_not_playing_count,',
        '''reserve_not_playing_count'','||alias||'.reserve_not_playing_count,''reconfirmation_required_count'','||alias||'.reconfirmation_required_count,');
    end loop;
    d:=replace(d,'n.reserve_not_playing_count,s.as_of', 'n.reserve_not_playing_count,n.reconfirmation_required_count,s.as_of');
    d:=replace(d,'''status'',e.status,', '''status'',e.status,''reconfirmation_generation'',e.reconfirmation_generation,');
    d:=replace(d,'case when e.created_by=auth.uid() then ''creator''',
      'case when exists(select 1 from public.match_event_registrations cr where cr.match_event_id=e.id and cr.user_id=auth.uid() and cr.lifecycle=''accepted'' and cr.cancelled_at is null and cr.confirmed_generation<cr.required_generation) then ''reconfirmation_required'' when e.created_by=auth.uid() then ''creator''');
    execute d;
  end loop;
  d:=pg_get_functiondef('public.get_match_event_management(uuid)'::regprocedure);
  d:=replace(d,'''reconfirmation_generation'',0,''required_count'',0',
    '''reconfirmation_generation'',e.reconfirmation_generation,''required_count'',(select reconfirmation_required_count from public.match_registration_counts(e.id,t))');
  execute d;
  d:=pg_get_functiondef('public.list_match_event_management_participants(uuid)'::regprocedure);
  d:=replace(d,'''participation'',r.participation_status,',
    '''required_generation'',r.required_generation,''confirmed_generation'',r.confirmed_generation,''reconfirmed_at'',r.reconfirmed_at,''participation'',q.participation_status,');
  d:=replace(d,'where e.id=p_match_event_id',
    'left join lateral (select * from public.match_registration_roster(e.id) x where x.registration_id=r.id) q on true where e.id=p_match_event_id');
  execute d;
  d:=pg_get_functiondef('public.get_my_match_registration(uuid)'::regprocedure);
  d:=replace(d,'''left_at'',r.left_at,',
    '''required_generation'',r.required_generation,''confirmed_generation'',r.confirmed_generation,''reconfirmed_at'',r.reconfirmed_at,''registration_cutoff_at'',e.registration_cutoff_at,''left_at'',r.left_at,');
  execute d;
  d:=pg_get_functiondef('public.list_match_event_registration_requests(uuid)'::regprocedure);
  d:=replace(d,'''accepted_count'', n.accepted_count,',
    '''accepted_count'', n.accepted_count,''reconfirmation_required_count'',n.reconfirmation_required_count,');
  execute d;
  foreach sig in array array['public.get_my_notification_target_v2(uuid)','public.get_my_match_notification_contexts(uuid[])'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    d:=replace(d,'''match_event_updated'')',
      '''match_event_updated'',''match_reconfirmation_required'',''match_registration_reconfirmed'',''match_reconfirmation_expired'')');
    if position('match_reconfirmation_required' in d)=0 then raise exception 'Notification allowlist extension failed: %',sig; end if;
    execute d;
  end loop;
end $$;

do $$
declare d text;
begin
  d:=pg_get_functiondef('public.get_my_match_notification_contexts(uuid[])'::regprocedure);
  d:=replace(d,'playing_count integer, reserve_count integer, reserve_not_playing_count integer,',
    'playing_count integer, reserve_count integer, reserve_not_playing_count integer, accepted_count integer, reconfirmation_required_count integer,');
  d:=replace(d,'c.playing_count,c.reserve_count,c.reserve_not_playing_count,',
    'c.playing_count,c.reserve_count,c.reserve_not_playing_count,c.accepted_count,c.reconfirmation_required_count,');
  drop function public.get_my_match_notification_contexts(uuid[]);
  execute d;
end $$;
revoke all on function public.get_my_match_notification_contexts(uuid[]) from public,anon,authenticated;
grant execute on function public.get_my_match_notification_contexts(uuid[]) to authenticated;

commit;
