begin;

-- Call only after the canonical community/advisory/event/state lock chain.
-- Identity/target authorization remains inside each command, never a client flag.
create function public.assert_match_management_action_locked(p_event_id uuid,p_action text)
returns void language plpgsql security definer set search_path='' as $$
declare e public.match_events%rowtype; s public.match_event_registration_state%rowtype; t timestamptz:=clock_timestamp();
begin
  select * into e from public.match_events where id=p_event_id;
  select * into s from public.match_event_registration_state where match_event_id=p_event_id;
  if e.id is null or s.match_event_id is null then raise exception 'MATCH_MANAGEMENT_NOT_FOUND' using errcode='P0001'; end if;
  if e.status='cancelled' then raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode='P0001'; end if;
  if s.results_protected_at is not null then raise exception 'MATCH_MANAGEMENT_RESULT_PROTECTED' using errcode='P0001'; end if;
  if t>=e.starts_at then raise exception 'MATCH_MANAGEMENT_STARTED' using errcode='P0001'; end if;
  if p_action<>'cancel' and (t>=e.registration_cutoff_at or s.cutoff_processed_at is not null) then
    raise exception 'MATCH_MANAGEMENT_CLOSED' using errcode='P0001'; end if;
  if p_action is null or p_action not in ('invitation','submit','decision','withdraw','remove','transfer','cancel','edit','reconfirm') then
    raise exception 'Unknown management action' using errcode='42501'; end if;
end $$;
revoke all on function public.assert_match_management_action_locked(uuid,text) from public,anon,authenticated;

create or replace function public.protect_match_event_results(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
declare e public.match_events%rowtype;
begin
  e:=public.lock_match_event_registration(p_event_id);
  if e.status='cancelled' then raise exception 'MATCH_MANAGEMENT_CANCELLED' using errcode='P0001'; end if;
  if exists(select 1 from public.match_event_registration_state where match_event_id=p_event_id and results_protected_at is not null) then return; end if;
  -- Future result insertion MUST call this hook in the same transaction. Delayed
  -- cutoff/consent exclusion is finalized before any played quartet is frozen.
  perform public.process_match_event_registration_cutoff(p_event_id,false);
  update public.match_event_registration_state set results_protected_at=clock_timestamp() where match_event_id=p_event_id;
end $$;
comment on function public.protect_match_event_results(uuid) is
  'Internal event-wide monotonic protection. Future result writer must invoke under canonical locks in its result-insert transaction; overdue cutoff is finalized first. No results API exists yet.';
revoke all on function public.protect_match_event_results(uuid) from public,anon,authenticated;

do $$
declare d text; original text; sig text; action text;
begin
  -- Keep existing command implementations, audit/revision/notification atomicity,
  -- and action-specific authorization. Guard immediately after canonical locking.
  for sig,action in select * from (values
    ('public.submit_match_registration(uuid)','submit'),
    ('public.decide_match_registration(uuid,uuid,text)','decision'),
    ('public.transfer_match_event_ownership(uuid,uuid,bigint,uuid)','transfer'),
    ('public.edit_match_event(uuid,bigint,jsonb,uuid)','edit'),
    ('public.reconfirm_match_registration(uuid,uuid,bigint,uuid)','reconfirm')
  ) x(signature,command) loop
    original:=pg_get_functiondef(sig::regprocedure);
    d:=regexp_replace(original,'(public.lock_match_event_registration\(p_match_event_id\);)',
      '\1 perform public.assert_match_management_action_locked(p_match_event_id,'||quote_literal(action)||');');
    if d=original then raise exception 'Missing guard insertion: %',sig; end if;
    execute d;
  end loop;
  d:=pg_get_functiondef('public.depart_match_registration_locked(uuid,uuid,uuid,text,uuid,text)'::regprocedure);
  d:=replace(d,'v_event:=public.lock_match_event_registration(p_match_event_id);',
    'v_event:=public.lock_match_event_registration(p_match_event_id); perform public.assert_match_management_action_locked(p_match_event_id,p_action);');
  if position('assert_match_management_action_locked' in d)=0 then raise exception 'Missing departure guard'; end if;
  execute d;
  -- Internal entry body also guarded: invitation acceptance cannot bypass it.
  d:=pg_get_functiondef('public.submit_match_registration_locked(uuid,uuid)'::regprocedure);
  d:=replace(d,'perform public.assert_match_event_active_locked(p_match_event_id);',
    'perform public.assert_match_management_action_locked(p_match_event_id,''submit'');');
  execute d;
  d:=pg_get_functiondef('public.respond_match_event_invitation(uuid,uuid,text)'::regprocedure);
  d:=replace(d,'perform public.assert_match_event_active_locked(p_match_event_id);',
    'begin perform public.assert_match_management_action_locked(p_match_event_id,''invitation'');
     exception when raise_exception then
       if sqlerrm<>''MATCH_MANAGEMENT_CLOSED'' then raise; end if;
       if v_invite.status<>''pending'' and v_invite.status<>''expired'' then raise; end if;
       perform public.expire_match_event_invitations_locked(p_match_event_id,clock_timestamp());
       return jsonb_build_object(''event_id'',p_match_event_id,''invitation_id'',v_invite.id,''status'',''expired'',''registration'',null,''replayed'',v_invite.status=''expired'');
     end;');
  d:=replace(d,'if sqlerrm <> ''MATCH_REGISTRATION_CLOSED'' then',
    'if sqlerrm not in (''MATCH_REGISTRATION_CLOSED'',''MATCH_MANAGEMENT_CLOSED'') then');
  execute d;
  d:=pg_get_functiondef('public.cancel_match_event(uuid,text,bigint,uuid)'::regprocedure);
  original:='if t>=e.starts_at then raise exception ''MATCH_MANAGEMENT_STARTED'' using errcode=''P0001''; end if;';
  d:=replace(d,original,
    'begin perform public.assert_match_management_action_locked(e.id,''cancel'');
     exception when raise_exception then
       if sqlerrm<>''MATCH_MANAGEMENT_CANCELLED'' then raise; end if;
       -- Only exact original cancellation replay before start remains legal.
       select * into cmd from public.match_event_management_commands where match_event_id=e.id and actor_id=a and request_id=p_request_id;
       if not found or cmd.action<>''cancel'' or cmd.payload<>jsonb_build_object(''reason'',btrim(p_reason),''expected_version'',p_expected_version) then raise; end if;
       if t>=e.starts_at then raise exception ''MATCH_MANAGEMENT_STARTED'' using errcode=''P0001''; end if;
       return cmd.result||jsonb_build_object(''replayed'',true,''changed'',false);
     end;');
  if position('assert_match_management_action_locked' in d)=0 then raise exception 'Missing cancellation guard'; end if;
  execute d;
  d:=pg_get_functiondef('public.process_match_event_registration_cutoff(uuid,boolean)'::regprocedure);
  d:=replace(d,'v_now := clock_timestamp();',
    'v_now := clock_timestamp();
     if exists(select 1 from public.match_event_registration_state where match_event_id=p_match_event_id and results_protected_at is not null) then
       return jsonb_build_object(''event_id'',p_match_event_id,''processed'',false,''reason'',''already_frozen'');
     end if;');
  execute d;
end $$;

-- Existing helper retained for compatibility, with the same terminal precedence.
create or replace function public.assert_match_event_active_locked(p_event_id uuid) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform public.assert_match_management_action_locked(p_event_id,'cancel');
end $$;

do $$
declare d text;
begin
  d:=pg_get_functiondef('public.get_match_event_management(uuid)'::regprocedure);
  d:=replace(d,'array[''withdraw'',''remove'',''transfer'',''cancel'',''edit'']',
    'array[''withdraw'',''remove'',''transfer'',''cancel'',''edit'',''reconfirm'',''invitation'',''submit'',''decision'']');
  d:=replace(d,'when action=''withdraw'' then participant',
    'when action=''reconfirm'' then exists(select 1 from public.match_event_registrations where match_event_id=e.id and user_id=auth.uid() and lifecycle=''accepted'' and cancelled_at is null and confirmed_generation<required_generation)
     when action=''invitation'' then exists(select 1 from public.match_event_invites where match_event_id=e.id and invitee_user_id=auth.uid() and status=''pending'')
     when action=''submit'' then (public.match_registration_is_member(e.community_id,auth.uid()) or exists(select 1 from public.communities where id=e.community_id and visibility=''public''))
       and (e.visibility<>''invite_only'' or exists(select 1 from public.match_event_invites where match_event_id=e.id and invitee_user_id=auth.uid() and status in (''pending'',''accepted'')))
       and not exists(select 1 from public.match_event_registrations where match_event_id=e.id and user_id=auth.uid() and lifecycle in (''accepted'',''pending''))
     when action=''withdraw'' then participant');
  d:=replace(d,'when t>=e.starts_at then ''started'' when protected then ''result_protected''',
    'when coalesce(protected,true) then ''result_protected'' when t>=e.starts_at then ''started''');
  d:=replace(d,'case when not allowed then ''forbidden'' when reason is not null then reason',
    'case when reason is not null then reason');
  d:=replace(d,'then ''closed'' end;',
    'then ''closed'' when not allowed then ''forbidden'' end;');
  execute d;
end $$;

commit;
