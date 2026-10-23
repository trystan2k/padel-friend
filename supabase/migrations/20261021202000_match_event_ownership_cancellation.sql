begin;

alter table public.match_events
  add column published_by uuid references auth.users(id) on delete restrict,
  add column version bigint not null default 1 check(version between 1 and 9007199254740991),
  add column updated_at timestamptz not null default clock_timestamp(),
  add column status text not null default 'open' check(status in ('open','cancelled')),
  add column cancelled_at timestamptz,
  add column cancelled_by uuid references auth.users(id) on delete restrict,
  add column cancel_reason text check(cancel_reason=btrim(cancel_reason)
    and length(cancel_reason) between 1 and 500 and cancel_reason !~ '[[:cntrl:]]'),
  add constraint match_event_cancellation_shape check(
    (status='cancelled' and cancelled_at is not null and cancelled_by is not null and cancel_reason is not null)
    or (status='open' and cancelled_at is null and cancelled_by is null and cancel_reason is null));

-- Replace the blanket guard during the transactional anchor backfill only.
drop trigger match_event_immutable on public.match_events;
update public.match_events set published_by=created_by,updated_at=created_at;
alter table public.match_events alter column published_by set not null;
create or replace function public.guard_match_event_mutation() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if tg_op='DELETE' then raise exception 'Match history is immutable' using errcode='23514'; end if;
  if (to_jsonb(new)-array['created_by','version','updated_at','status','cancelled_at','cancelled_by','cancel_reason'])
    is distinct from (to_jsonb(old)-array['created_by','version','updated_at','status','cancelled_at','cancelled_by','cancel_reason'])
    or old.status='cancelled' or new.version<>old.version+1 then
    raise exception 'Invalid match event mutation' using errcode='23514';
  end if;
  return new;
end $$;
create trigger match_event_immutable before update or delete on public.match_events
  for each row execute function public.guard_match_event_mutation();
create function public.initialize_match_event_publisher() returns trigger
language plpgsql security definer set search_path='' as $$
begin
  if new.published_by is not null and new.published_by<>new.created_by then
    raise exception 'Invalid publisher' using errcode='23514';
  end if;
  new.published_by:=new.created_by;
  return new;
end $$;
create trigger match_event_publisher before insert on public.match_events
  for each row execute function public.initialize_match_event_publisher();
revoke update on public.match_events from public,anon,authenticated;
alter table public.match_event_registrations add column cancelled_at timestamptz;

create or replace function public.can_read_match_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path='' as $$
  select auth.uid() is not null and coalesce(auth.jwt()->>'is_anonymous','false')<>'true'
    and exists(select 1 from public.match_events e join public.communities c on c.id=e.community_id
      where e.id=p_event_id and (
        e.created_by=auth.uid() or public.is_community_admin(e.community_id)
        or (e.status='cancelled' and (e.cancelled_by=auth.uid()
          or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid())
          or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid())))
        or (e.status='open' and (
          (e.visibility='community_open' and (c.visibility='public' or public.is_community_member(e.community_id)))
          or (e.visibility='invite_only' and (
            exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=auth.uid())
            or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=auth.uid() and r.lifecycle='accepted')))))));
$$;

-- Extend existing single writers/readers, keeping their ACLs and return shapes.
do $$
declare d text; sig text;
begin
  foreach sig in array array['public.match_registration_roster(uuid)','public.match_registration_roster(uuid,timestamptz)'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    d:=regexp_replace(d,'r.lifecycle\s*=\s*''accepted''',
      'r.lifecycle=''accepted'' and r.cancelled_at is null and exists(select 1 from public.match_events ce where ce.id=r.match_event_id and ce.status=''open'')','g');
    if position('ce.status' in d)=0 then raise exception 'Roster extension failed: %',sig; end if;
    execute d;
  end loop;
  d:=pg_get_functiondef('public.check_match_registration_final_state()'::regprocedure);
  d:=replace(d,'(r.participation_status is null or a.outcome <> ''accepted'' or a.ended_at is not null)',
    '(a.outcome <> ''accepted'' or (r.cancelled_at is null and (r.participation_status is null or a.ended_at is not null)) or (r.cancelled_at is not null and (r.participation_status is not null or a.end_kind is distinct from ''cancelled'' or a.ended_at is distinct from r.cancelled_at)))');
  d:=replace(d,'if r.lifecycle=''accepted'' and exists(', 'if r.lifecycle=''accepted'' and r.cancelled_at is null and exists(');
  d:=replace(d,'if a.id is null',
    'if r.cancelled_at is not null and (not exists(select 1 from public.match_events ce where ce.id=r.match_event_id and ce.status=''cancelled'' and ce.cancelled_at=r.cancelled_at) or a.end_kind is distinct from ''cancelled'' or a.ended_at is distinct from r.cancelled_at) then raise exception ''Invalid cancellation evidence'' using errcode=''23514''; end if; if a.id is null');
  if position('a.end_kind is distinct from ''cancelled''' in d)=0 then raise exception 'Final state extension failed'; end if;
  execute d;
  d:=pg_get_functiondef('public.reconcile_match_registration_participation(uuid,uuid,jsonb)'::regprocedure);
  d:=replace(d,'lifecycle<>''accepted'' and participation_status is not null',
    '(lifecycle<>''accepted'' or cancelled_at is not null) and participation_status is not null');
  execute d;
  -- Replay cannot invoke INSERT-only photo/creator registration triggers.
  d:=pg_get_functiondef('public.publish_match_event(uuid,jsonb,uuid[])'::regprocedure);
  d:=replace(d,'v_row.created_by<>v_uid','v_row.published_by<>v_uid');
  execute d;
  d:=pg_get_functiondef('public.depart_match_registration_locked(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
  d:=replace(d,'''version'',1,','''version'',v_event.version,');
  execute d;
  d:=pg_get_functiondef('public.list_match_event_management_participants(uuid)'::regprocedure);
  d:=replace(d,'r.lifecycle=''accepted'' order by', 'r.lifecycle=''accepted'' and r.cancelled_at is null order by');
  execute d;
  d:=pg_get_functiondef('public.get_my_match_registration(uuid)'::regprocedure);
  d:=replace(d,'''event_id'',e.id,', '''event_id'',e.id,''event_status'',e.status,''cancelled_at'',e.cancelled_at,');
  execute d;
end $$;

create function public.assert_match_event_active_locked(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.match_events%rowtype; t timestamptz:=clock_timestamp();
begin
  select * into e from public.match_events where id=p_event_id;
  if e.status='cancelled' then raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode='P0001'; end if;
  if t>=e.starts_at then raise exception 'MATCH_MANAGEMENT_STARTED' using errcode='P0001'; end if;
  if exists(select 1 from public.match_event_registration_state where match_event_id=p_event_id and results_protected_at is not null) then
    raise exception 'MATCH_MANAGEMENT_RESULT_PROTECTED' using errcode='P0001'; end if;
end $$;
do $$
declare d text; sig text;
begin
  foreach sig in array array['public.submit_match_registration_locked(uuid,uuid)',
    'public.decide_match_registration(uuid,uuid,text)','public.respond_match_event_invitation(uuid,uuid,text)'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    if sig like '%submit_match_registration_locked%' then
      d:=replace(d,'select * into v_event from public.match_events where id=p_match_event_id;',
        'select * into v_event from public.match_events where id=p_match_event_id; perform public.assert_match_event_active_locked(p_match_event_id);');
    elsif sig like '%decide_match_registration%' then
      d:=replace(d,'raise exception ''Registration decisions are creator-only'' using errcode=''42501''; end if;',
        'raise exception ''Registration decisions are creator-only'' using errcode=''42501''; end if; perform public.assert_match_event_active_locked(p_match_event_id);');
    else
      d:=replace(d,'if not found then raise exception ''MATCH_INVITATION_NOT_FOUND'' using errcode = ''P0001''; end if;',
        'if not found then raise exception ''MATCH_INVITATION_NOT_FOUND'' using errcode = ''P0001''; end if; perform public.assert_match_event_active_locked(p_match_event_id);');
    end if;
    if position('perform public.assert_match_event_active_locked' in d)=0 then raise exception 'Action extension failed: %',sig; end if;
    execute d;
  end loop;
  d:=pg_get_functiondef('public.process_match_event_registration_cutoff(uuid,boolean)'::regprocedure);
  d:=replace(d,'v_now := clock_timestamp();', 'v_now := clock_timestamp();
    if v_event.status=''cancelled'' then
      update public.match_event_registration_state set cutoff_processed_at=coalesce(cutoff_processed_at,v_now) where match_event_id=p_match_event_id;
      return jsonb_build_object(''event_id'',p_match_event_id,''processed'',false,''reason'',''already_processed'');
    end if;');
  execute d;
end $$;

create function public.transfer_match_event_ownership(p_match_event_id uuid,p_target_user_id uuid,
  p_expected_version bigint,p_request_id uuid) returns jsonb
language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); e public.match_events%rowtype; t timestamptz; rev bigint; recipient uuid;
  payload jsonb; result jsonb; cmd public.match_event_management_commands%rowtype;
begin
  if a is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_target_user_id is null or p_request_id is null or p_expected_version is null or p_expected_version not between 1 and 9007199254740991 then raise exception 'Invalid transfer' using errcode='22023'; end if;
  begin
    e:=public.lock_match_event_registration(p_match_event_id);
  exception when raise_exception then
    if sqlerrm='MATCH_REGISTRATION_EVENT_NOT_FOUND' then raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode='P0001'; end if;
    raise;
  end;
  perform 1 from public.match_event_registrations where match_event_id=e.id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id=e.id order by id for update;
  t:=clock_timestamp();
  if e.created_by<>a then raise exception 'Organizer required' using errcode='42501'; end if;
  perform public.assert_match_event_active_locked(e.id);
  if t>=e.registration_cutoff_at then raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode='P0001'; end if;
  payload:=jsonb_build_object('target_user_id',p_target_user_id,'expected_version',p_expected_version);
  select * into cmd from public.match_event_management_commands where match_event_id=e.id and actor_id=a and request_id=p_request_id;
  if found then
    if cmd.action<>'transfer' or cmd.payload<>payload then raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return cmd.result||jsonb_build_object('replayed',true);
  end if;
  if e.version<>p_expected_version then raise exception 'MATCH_MANAGEMENT_VERSION_CONFLICT' using errcode='P0001',detail=jsonb_build_object('current_version',e.version)::text; end if;
  if p_target_user_id=a or not exists(select 1 from public.match_registration_roster(e.id) r
    where r.user_id=p_target_user_id and r.participation_status in ('playing','reserve')) then
    raise exception 'MATCH_MANAGEMENT_TARGET_NOT_ACCEPTED' using errcode='P0001'; end if;
  update public.match_events set created_by=p_target_user_id,version=version+1,updated_at=t where id=e.id;
  rev:=public.advance_match_registration_revision_locked(e.id);
  insert into public.match_event_audit_log(match_event_id,community_id,actor_id,target_user_id,action,request_id,
    occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
  values(e.id,e.community_id,a,p_target_user_id,'transfer',p_request_id,t,e.version+1,rev,
    jsonb_build_object('owner_id',a),jsonb_build_object('owner_id',p_target_user_id),array['created_by']);
  for recipient in select distinct x from unnest(array[a,p_target_user_id]) x loop
    perform public.persist_notification(recipient,'match.transferred:'||e.id||':'||(e.version+1),
      'match_event_ownership_transferred','matches','match_event',e.id,e.community_id);
  end loop;
  result:=jsonb_build_object('event_id',e.id,'version',e.version+1,'owner_id',p_target_user_id,
    'transition_revision',rev,'request_id',p_request_id,'replayed',false,'changed',true);
  insert into public.match_event_management_commands values(e.id,a,p_request_id,'transfer',payload,result,t);
  return result;
end $$;

create function public.cancel_match_event(p_match_event_id uuid,p_reason text,p_expected_version bigint,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path='' as $$
declare a uuid:=auth.uid(); e public.match_events%rowtype; t timestamptz; rev bigint; recipient uuid;
  payload jsonb; result jsonb; before_roster jsonb; cmd public.match_event_management_commands%rowtype;
begin
  if a is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  if p_reason is null or length(btrim(p_reason)) not between 1 and 500 or p_reason ~ '[[:cntrl:]]'
    or p_request_id is null or p_expected_version is null or p_expected_version not between 1 and 9007199254740991 then
    raise exception 'Invalid cancellation' using errcode='22023'; end if;
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
  if e.created_by<>a and not public.is_community_admin(e.community_id) then raise exception 'Cancellation forbidden' using errcode='42501'; end if;
  if t>=e.starts_at then raise exception 'MATCH_MANAGEMENT_STARTED' using errcode='P0001'; end if;
  if exists(select 1 from public.match_event_registration_state where match_event_id=e.id and results_protected_at is not null) then raise exception 'MATCH_MANAGEMENT_RESULT_PROTECTED' using errcode='P0001'; end if;
  payload:=jsonb_build_object('reason',btrim(p_reason),'expected_version',p_expected_version);
  select * into cmd from public.match_event_management_commands where match_event_id=e.id and actor_id=a and request_id=p_request_id;
  if found then
    if cmd.action<>'cancel' or cmd.payload<>payload then raise exception 'MATCH_MANAGEMENT_IDEMPOTENCY_CONFLICT' using errcode='P0001'; end if;
    return cmd.result||jsonb_build_object('replayed',true,'changed',false);
  end if;
  if e.status='cancelled' then raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode='P0001'; end if;
  if e.version<>p_expected_version then raise exception 'MATCH_MANAGEMENT_VERSION_CONFLICT' using errcode='P0001',detail=jsonb_build_object('current_version',e.version)::text; end if;
  before_roster:=public.snapshot_match_registration_roster_locked(e.id);
  update public.match_events set status='cancelled',cancelled_at=t,cancelled_by=a,cancel_reason=btrim(p_reason),
    version=version+1,updated_at=t where id=e.id;
  update public.match_event_registration_attempts set ended_at=t,ended_by=a,end_kind='cancelled',
    outcome=case when outcome='pending' then 'expired'::public.match_registration_lifecycle else outcome end,
    decided_at=case when outcome='pending' then t else decided_at end,
    actor_id=case when outcome='pending' then a else actor_id end
    where match_event_id=e.id and ended_at is null and outcome in ('pending','accepted');
  update public.match_event_registrations set cancelled_at=t,
    lifecycle=case when lifecycle='pending' then 'expired'::public.match_registration_lifecycle else lifecycle end,
    resolved_at=case when lifecycle='pending' then t else resolved_at end,
    resolved_by=case when lifecycle='pending' then a else resolved_by end
    where match_event_id=e.id and lifecycle in ('pending','accepted');
  update public.match_event_invites set status='cancelled',responded_at=t,responded_by=a
    where match_event_id=e.id and status='pending';
  -- Empty cancelled roster suppresses ordinary demotion/group/expiry effects.
  result:=public.reconcile_match_registration_participation(e.id,null,before_roster);
  rev:=(result->>'transition_revision')::bigint;
  insert into public.match_event_audit_log(match_event_id,community_id,actor_id,action,reason,request_id,
    occurred_at,event_version,transition_revision,before_data,after_data,changed_fields)
  values(e.id,e.community_id,a,'cancel',btrim(p_reason),p_request_id,t,e.version+1,rev,
    jsonb_build_object('status','open'),jsonb_build_object('status','cancelled'),array['status','cancel_reason']);
  for recipient in select e.created_by union select a
    union select user_id from public.match_event_registrations where match_event_id=e.id
    union select invitee_user_id from public.match_event_invites where match_event_id=e.id loop
    perform public.persist_notification(recipient,'match.cancelled:'||e.id||':'||(e.version+1),
      'match_event_cancelled','matches','match_event',e.id,e.community_id);
  end loop;
  result:=jsonb_build_object('event_id',e.id,'version',e.version+1,'status','cancelled',
    'transition_revision',rev,'request_id',p_request_id,'replayed',false,'changed',true);
  insert into public.match_event_management_commands values(e.id,a,p_request_id,'cancel',payload,result,t);
  return result;
end $$;

create function public.get_match_event_management(p_match_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare e public.match_events%rowtype; t timestamptz:=now(); protected boolean; participant boolean;
  reason text; actions jsonb:='{}'; action text; allowed boolean; action_reason text;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false')='true' then raise exception 'Authentication required' using errcode='28000'; end if;
  select * into e from public.match_events where id=p_match_event_id and public.can_read_match_event(id);
  if not found then return null; end if;
  select results_protected_at is not null into protected from public.match_event_registration_state where match_event_id=e.id;
  participant:=exists(select 1 from public.match_event_registrations where match_event_id=e.id and user_id=auth.uid() and lifecycle='accepted' and cancelled_at is null);
  reason:=case when e.status='cancelled' then 'cancelled' when t>=e.starts_at then 'started' when protected then 'result_protected' end;
  foreach action in array array['withdraw','remove','transfer','cancel'] loop
    allowed:=case when action='cancel' then e.created_by=auth.uid() or public.is_community_admin(e.community_id)
      when action='withdraw' then participant else e.created_by=auth.uid() end;
    action_reason:=case when not allowed then 'forbidden' when reason is not null then reason
      when action<>'cancel' and t>=e.registration_cutoff_at then 'closed' end;
    actions:=actions||jsonb_build_object(action,jsonb_build_object('allowed',action_reason is null,'reason',action_reason));
  end loop;
  return jsonb_build_object('version',e.version,'status',e.status,'phase',case when e.status='cancelled' then 'cancelled'
    when t>=e.starts_at then 'started' when t<e.registration_cutoff_at then 'open'
    when exists(select 1 from public.match_registration_roster(e.id) where participation_status='playing') then 'awaiting_results' else 'incomplete' end,
    'as_of',t,'owner_id',e.created_by,'is_organizer',e.created_by=auth.uid(),'is_participant',participant,
    'results_protected',coalesce(protected,false),'reconfirmation_generation',0,'required_count',0,'actions',actions,
    'correction',jsonb_build_object('available',false,'reason','results_workflow_unavailable'));
end $$;

-- Extend both duplicated allowlists with producers; tombstones remain targets.
do $$
declare d text; sig text;
begin
  foreach sig in array array['public.get_my_notification_target_v2(uuid)','public.get_my_match_notification_contexts(uuid[])'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    d:=replace(d,'''match_registration_group_changed'')', '''match_registration_group_changed'',''match_event_ownership_transferred'',''match_event_cancelled'')');
    if position('match_event_cancelled' in d)=0 then raise exception 'Notification extension failed: %',sig; end if;
    execute d;
  end loop;
  foreach sig in array array['public.get_match_event(uuid)','public.list_match_events(text,uuid,text,integer,timestamptz)'] loop
    d:=pg_get_functiondef(sig::regprocedure);
    d:=replace(d,'''event_id'',e.id,','''event_id'',e.id,''status'',e.status,');
    d:=replace(d,'''registration_open'',e.starts_at>', '''registration_open'',e.status=''open'' and e.starts_at>');
    d:=replace(d,'when ''available'' then e.visibility=', 'when ''available'' then e.status=''open'' and e.visibility=');
    d:=replace(d,'and r.lifecycle=''accepted'') or exists', 'and (r.lifecycle=''accepted'' or e.status=''cancelled'')) or exists');
    execute d;
  end loop;
end $$;

-- Existing alerts resolve to a current cancelled tombstone too, rather than
-- continuing to advertise an old Playing/Reserve position.
do $$
declare d text;
begin
  d:=pg_get_functiondef('public.get_my_match_notification_contexts(uuid[])'::regprocedure);
  d:=replace(d,'match_event_id uuid, creator_display_name text','match_event_id uuid, event_status text, creator_display_name text');
  d:=replace(d,'select n.id,e.id,p.display_name','select n.id,e.id,e.status,p.display_name');
  if position('event_status text' in d)=0 then raise exception 'Notification status extension failed'; end if;
  drop function public.get_my_match_notification_contexts(uuid[]);
  execute d;
end $$;
revoke all on function public.get_my_match_notification_contexts(uuid[]) from public,anon,authenticated;
grant execute on function public.get_my_match_notification_contexts(uuid[]) to authenticated;

revoke all on function public.initialize_match_event_publisher(),public.assert_match_event_active_locked(uuid),
  public.transfer_match_event_ownership(uuid,uuid,bigint,uuid),public.cancel_match_event(uuid,text,bigint,uuid),
  public.get_match_event_management(uuid) from public,anon,authenticated;
grant execute on function public.transfer_match_event_ownership(uuid,uuid,bigint,uuid),
  public.cancel_match_event(uuid,text,bigint,uuid),public.get_match_event_management(uuid) to authenticated;

commit;
