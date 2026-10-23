begin;

create function public.submit_match_event_result(
  p_match_event_id uuid, p_group_number bigint, p_teams jsonb, p_sets jsonb,
  p_played_local jsonb, p_court_label text default null, p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  e public.match_events%rowtype;
  a uuid := auth.uid();
  cmd public.match_event_management_commands%rowtype;
  proposal public.match_event_result_proposals%rowtype;
  payload jsonb;
  result jsonb;
  teams jsonb;
  sets jsonb;
  side text;
  player jsonb;
  submitted uuid[] := '{}';
  quartet uuid[];
  local_time timestamp;
  offset_seconds integer;
  instant timestamptz;
  t timestamptz;
begin
  if a is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  begin
    e := public.lock_match_event_registration(p_match_event_id);
  exception when raise_exception then
    if sqlerrm <> 'MATCH_REGISTRATION_EVENT_NOT_FOUND' then raise; end if;
    raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001';
  end;
  if e.id is null then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  if e.status = 'cancelled' then raise exception 'MATCH_RESULT_CANCELLED' using errcode = 'P0001'; end if;
  if e.created_by <> a and not public.is_community_admin(e.community_id) then
    raise exception 'MATCH_RESULT_FORBIDDEN' using errcode = '42501';
  end if;
  if p_request_id is null or p_group_number is null or p_group_number not between 1 and 9007199254740991 then
    raise exception 'MATCH_RESULT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  payload := jsonb_build_object('group_number',p_group_number,'teams',p_teams,'sets',p_sets,
    'played_local',p_played_local,'court_label',p_court_label);
  select * into cmd from public.match_event_management_commands
    where match_event_id = e.id and actor_id = a and request_id = p_request_id;
  if found then
    if cmd.action <> 'submit_result' or cmd.payload <> payload then
      raise exception 'MATCH_RESULT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return cmd.result || jsonb_build_object('replayed',true);
  end if;
  select * into proposal from public.match_event_result_proposals
    where match_event_id = e.id and group_number = p_group_number;
  if found then
    raise exception 'MATCH_RESULT_ACTIVE_PROPOSAL' using errcode = 'P0001',
      detail = jsonb_build_object('active_version',proposal.active_version,'review_deadline_at',proposal.review_deadline_at)::text;
  end if;
  -- Authorization precedes the monotonic hook. Any later rejection rolls back
  -- protection and overdue-cutoff effects along with the proposed facts.
  if not exists(select 1 from public.match_event_registration_state where match_event_id = e.id and results_protected_at is not null) then
    perform public.protect_match_event_results(e.id);
  end if;
  select array_agg(user_id order by user_id) into quartet from (
    select user_id, (row_number() over(order by accepted_order,id) - 1) / 4 + 1 as group_number
    from public.match_event_registrations
    where match_event_id = e.id and lifecycle = 'accepted' and cancelled_at is null and participation_status = 'playing'
  ) roster where group_number = p_group_number;
  if coalesce(cardinality(quartet),0) <> 4 then
    raise exception 'MATCH_RESULT_INVALID_GROUP' using errcode = 'P0001';
  end if;
  if p_teams is null or jsonb_typeof(p_teams) <> 'object'
    or p_teams <> jsonb_build_object('team_a',p_teams->'team_a','team_b',p_teams->'team_b') then
    raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
      detail = jsonb_build_object('set_index',null,'side',null,'reason_token','INVALID_TEAMS')::text;
  end if;
  teams := '{}'::jsonb;
  foreach side in array array['team_a','team_b'] loop
    if jsonb_typeof(p_teams->side) is distinct from 'array' then
      raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
        detail = jsonb_build_object('set_index',null,'side',side,'reason_token','INVALID_TEAMS')::text;
    end if;
    if jsonb_array_length(p_teams->side) <> 2 then
      raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
        detail = jsonb_build_object('set_index',null,'side',side,'reason_token','INVALID_TEAMS')::text;
    end if;
    teams := teams || jsonb_build_object(side,'[]'::jsonb);
    for player in select value from jsonb_array_elements(p_teams->side) loop
      if jsonb_typeof(player) <> 'string' or (player #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
          detail = jsonb_build_object('set_index',null,'side',side,'reason_token','INVALID_TEAMS')::text;
      end if;
      if (player #>> '{}')::uuid = any(submitted) then
        raise exception 'MATCH_RESULT_DUPLICATE_PLAYER' using errcode = 'P0001',
          detail = jsonb_build_object('set_index',null,'side',side,'reason_token','DUPLICATE_PLAYER')::text;
      end if;
      submitted := array_append(submitted,(player #>> '{}')::uuid);
      teams := jsonb_set(teams,array[side],(teams->side) || jsonb_build_array(lower(player #>> '{}')));
    end loop;
  end loop;
  if not (submitted @> quartet and submitted <@ quartet) then
    raise exception 'MATCH_RESULT_GROUP_PLAYERS' using errcode = 'P0001';
  end if;
  -- Require explicit offset even on ambiguous DST wall times. Round-tripping
  -- the supplied instant through the EVENT timezone rejects both gaps and
  -- forged offsets, independently of the server's Intl implementation.
  begin
    if p_played_local is null or jsonb_typeof(p_played_local) <> 'object'
      or p_played_local <> jsonb_build_object('local',p_played_local->'local','offset_seconds',p_played_local->'offset_seconds','instant',p_played_local->'instant')
      or jsonb_typeof(p_played_local->'local') is distinct from 'string'
      or (p_played_local->>'local') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2} [0-9]{2}:[0-9]{2}:[0-9]{2}$'
      or jsonb_typeof(p_played_local->'offset_seconds') is distinct from 'number'
      or (p_played_local->>'offset_seconds') !~ '^-?[0-9]+$'
      or jsonb_typeof(p_played_local->'instant') is distinct from 'string'
      or (p_played_local->>'instant') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(\.000)?Z$' then
      raise exception 'Invalid played time';
    end if;
    local_time := (p_played_local->>'local')::timestamp;
    offset_seconds := (p_played_local->>'offset_seconds')::integer;
    instant := (p_played_local->>'instant')::timestamptz;
    if offset_seconds not between -50400 and 50400 or offset_seconds % 60 <> 0
      or to_char(local_time,'YYYY-MM-DD HH24:MI:SS') <> p_played_local->>'local'
      or instant at time zone 'UTC' <> local_time - make_interval(secs => offset_seconds)
      or instant at time zone e.timezone <> local_time then
      raise exception 'Invalid played time';
    end if;
  exception when others then
    raise exception 'MATCH_RESULT_INVALID_PLAYED_AT' using errcode = 'P0001';
  end;
  if instant > clock_timestamp() then raise exception 'MATCH_RESULT_FUTURE_PLAYED_AT' using errcode = 'P0001'; end if;
  if p_court_label is not null and (char_length(btrim(p_court_label)) not between 1 and 100 or p_court_label ~ '[[:cntrl:]]') then
    raise exception 'MATCH_RESULT_INVALID_COURT' using errcode = 'P0001';
  end if;
  sets := public.validate_match_result_sets(p_sets);
  t := clock_timestamp();
  insert into public.match_event_result_proposals(match_event_id,group_number,status,active_version,review_deadline_at,submitted_by,submitted_at)
    values(e.id,p_group_number,'pending',1,t + interval '48 hours',a,t) returning * into proposal;
  insert into public.match_event_result_proposal_versions(proposal_id,version,teams,sets,classification,played_at_utc,played_at_local,played_at_offset_seconds,court_label)
    values(proposal.id,1,teams,sets,public.classify_match_result_sets(sets),instant,local_time,offset_seconds,btrim(p_court_label));
  result := jsonb_build_object('event_id',e.id,'proposal_id',proposal.id,'group_number',p_group_number,'version',1,
    'review_deadline_at',proposal.review_deadline_at,'submitted_at',t,'request_id',p_request_id,'replayed',false);
  insert into public.match_event_management_commands(match_event_id,actor_id,request_id,action,payload,result,created_at)
    values(e.id,a,p_request_id,'submit_result',payload,result,t);
  return result;
end $$;
revoke all on function public.submit_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid) from public,anon,authenticated;
grant execute on function public.submit_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid) to authenticated;

create function public.get_match_event_result_proposals(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare e public.match_events%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into e from public.match_events where id = p_match_event_id;
  if e.id is null then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  if e.created_by <> auth.uid() and not public.is_community_admin(e.community_id)
    and not exists(select 1 from public.match_event_registrations where match_event_id = e.id and user_id = auth.uid() and lifecycle = 'accepted' and cancelled_at is null) then
    raise exception 'MATCH_RESULT_FORBIDDEN' using errcode = '42501';
  end if;
  return query select jsonb_build_object(
    'event_id',p.match_event_id,'proposal_id',p.id,'group_number',p.group_number,'status',p.status,'version',v.version,
    'teams',(select jsonb_object_agg(side,players) from (
      select side,(select jsonb_agg(jsonb_build_object('user_id',u.value,'display_name',profile.display_name) order by u.ordinality)
        from jsonb_array_elements_text(v.teams->side) with ordinality u(value,ordinality)
        left join public.player_profiles profile on profile.user_id = u.value::uuid) players
      from unnest(array['team_a','team_b']) side) named),
    'sets',v.sets,'classification',v.classification,
    'played_at_utc',v.played_at_utc,'played_at_local',to_char(v.played_at_local,'YYYY-MM-DD HH24:MI:SS'),
    'played_at_offset_seconds',v.played_at_offset_seconds,'court_label',v.court_label,
    'submitted_at',p.submitted_at,'review_deadline_at',p.review_deadline_at,
    'rating_effective',e.event_type = 'competitive' and v.classification <> 'incomplete')
  from public.match_event_result_proposals p join public.match_event_result_proposal_versions v on v.proposal_id = p.id and v.version = p.active_version
  where p.match_event_id = e.id order by p.group_number;
end $$;
revoke all on function public.get_match_event_result_proposals(uuid) from public,anon,authenticated;
grant execute on function public.get_match_event_result_proposals(uuid) to authenticated;

do $$
declare d text; original text;
begin
  original := pg_get_functiondef('public.get_match_event_management(uuid)'::regprocedure);
  d := replace(original,
    'jsonb_build_object(''available'',false,''reason'',''results_workflow_unavailable'')',
    'case when e.status=''cancelled'' then jsonb_build_object(''available'',false,''reason'',''cancelled'')
      when e.created_by=auth.uid() or public.is_community_admin(e.community_id) then
        jsonb_build_object(''available'',true,''target'',''record_result'',''event_id'',e.id)
      else jsonb_build_object(''available'',false,''reason'',''forbidden'') end');
  if d = original then raise exception 'Missing result capability insertion'; end if;
  execute d;
end $$;

commit;
