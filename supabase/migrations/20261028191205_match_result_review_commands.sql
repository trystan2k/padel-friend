begin;

-- PAF-119 / T08.2: reviewer commands and immutable corrected versions.

-- Keep the PAF-7 submission rules as one private validator. Both the original
-- submission command and corrections use this exact fact-validation seam.
create function public.validate_match_event_result_facts(
  p_match_event_id uuid,
  p_group_number bigint,
  p_teams jsonb,
  p_sets jsonb,
  p_played_local jsonb,
  p_court_label text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_quartet uuid[];
  v_submitted uuid[] := '{}';
  v_teams jsonb;
  v_sets jsonb;
  v_side text;
  v_player jsonb;
  v_local_time timestamp;
  v_offset_seconds integer;
  v_instant timestamptz;
begin
  select * into v_event from public.match_events e where e.id = p_match_event_id;
  if not found then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;

  select array_agg(user_id order by user_id) into v_quartet from (
    select user_id, (row_number() over(order by accepted_order,id) - 1) / 4 + 1 as group_number
      from public.match_event_registrations
     where match_event_id = p_match_event_id
       and lifecycle = 'accepted' and cancelled_at is null and participation_status = 'playing'
  ) roster where group_number = p_group_number;
  if coalesce(cardinality(v_quartet),0) <> 4 then
    raise exception 'MATCH_RESULT_INVALID_GROUP' using errcode = 'P0001';
  end if;

  if p_teams is null or jsonb_typeof(p_teams) <> 'object'
    or p_teams <> jsonb_build_object('team_a',p_teams->'team_a','team_b',p_teams->'team_b') then
    raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
      detail = jsonb_build_object('set_index',null,'side',null,'reason_token','INVALID_TEAMS')::text;
  end if;
  v_teams := '{}'::jsonb;
  foreach v_side in array array['team_a','team_b'] loop
    if jsonb_typeof(p_teams->v_side) is distinct from 'array' then
      raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
        detail = jsonb_build_object('set_index',null,'side',v_side,'reason_token','INVALID_TEAMS')::text;
    end if;
    if jsonb_array_length(p_teams->v_side) <> 2 then
      raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
        detail = jsonb_build_object('set_index',null,'side',v_side,'reason_token','INVALID_TEAMS')::text;
    end if;
    v_teams := v_teams || jsonb_build_object(v_side,'[]'::jsonb);
    for v_player in select value from jsonb_array_elements(p_teams->v_side) loop
      if jsonb_typeof(v_player) <> 'string' or (v_player #>> '{}') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        raise exception 'MATCH_RESULT_INVALID_TEAMS' using errcode = 'P0001',
          detail = jsonb_build_object('set_index',null,'side',v_side,'reason_token','INVALID_TEAMS')::text;
      end if;
      if (v_player #>> '{}')::uuid = any(v_submitted) then
        raise exception 'MATCH_RESULT_DUPLICATE_PLAYER' using errcode = 'P0001',
          detail = jsonb_build_object('set_index',null,'side',v_side,'reason_token','DUPLICATE_PLAYER')::text;
      end if;
      v_submitted := array_append(v_submitted,(v_player #>> '{}')::uuid);
      v_teams := jsonb_set(v_teams,array[v_side],(v_teams->v_side) || jsonb_build_array(lower(v_player #>> '{}')));
    end loop;
  end loop;
  if not (v_submitted @> v_quartet and v_submitted <@ v_quartet) then
    raise exception 'MATCH_RESULT_GROUP_PLAYERS' using errcode = 'P0001';
  end if;

  -- Require explicit offset even on ambiguous DST wall times. Round-tripping
  -- the supplied instant through the event timezone rejects gaps and offsets
  -- that do not represent the same wall time.
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
    v_local_time := (p_played_local->>'local')::timestamp;
    v_offset_seconds := (p_played_local->>'offset_seconds')::integer;
    v_instant := (p_played_local->>'instant')::timestamptz;
    if v_offset_seconds not between -50400 and 50400 or v_offset_seconds % 60 <> 0
      or to_char(v_local_time,'YYYY-MM-DD HH24:MI:SS') <> p_played_local->>'local'
      or v_instant at time zone 'UTC' <> v_local_time - make_interval(secs => v_offset_seconds)
      or v_instant at time zone v_event.timezone <> v_local_time then
      raise exception 'Invalid played time';
    end if;
  exception when others then
    raise exception 'MATCH_RESULT_INVALID_PLAYED_AT' using errcode = 'P0001';
  end;
  if v_instant > clock_timestamp() then
    raise exception 'MATCH_RESULT_FUTURE_PLAYED_AT' using errcode = 'P0001';
  end if;
  if p_court_label is not null
    and (char_length(btrim(p_court_label)) not between 1 and 100 or p_court_label ~ '[[:cntrl:]]') then
    raise exception 'MATCH_RESULT_INVALID_COURT' using errcode = 'P0001';
  end if;

  v_sets := public.validate_match_result_sets(p_sets);
  return jsonb_build_object(
    'teams', v_teams,
    'sets', v_sets,
    'classification', public.classify_match_result_sets(v_sets),
    'played_at_utc', v_instant,
    'played_at_local', v_local_time,
    'played_at_offset_seconds', v_offset_seconds,
    'court_label', btrim(p_court_label)
  );
end $$;

revoke all on function public.validate_match_event_result_facts(uuid,bigint,jsonb,jsonb,jsonb,text)
  from public, anon, authenticated;

-- Replace only the existing submission validator block with the shared helper.
do $$
declare
  v_original text;
  v_definition text;
  v_start integer;
  v_end integer;
  v_end_marker text := '  sets := public.validate_match_result_sets(p_sets);';
begin
  v_original := pg_get_functiondef(
    'public.submit_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid)'::regprocedure
  );
  v_start := strpos(v_original, '  select array_agg(user_id order by user_id) into quartet from (');
  v_end := strpos(v_original, v_end_marker);
  if v_start = 0 or v_end = 0 or v_end < v_start then
    raise exception 'Unexpected submit_match_event_result definition; refusing validator extraction';
  end if;
  v_definition := substring(v_original from 1 for v_start - 1)
    || $replacement$  facts := public.validate_match_event_result_facts(
    e.id, p_group_number, p_teams, p_sets, p_played_local, p_court_label
  );
  teams := facts -> 'teams';
  sets := facts -> 'sets';
  instant := (facts ->> 'played_at_utc')::timestamptz;
  local_time := (facts ->> 'played_at_local')::timestamp;
  offset_seconds := (facts ->> 'played_at_offset_seconds')::integer;
$replacement$
    || substring(v_original from v_end + char_length(v_end_marker));
  v_definition := replace(v_definition, '  result jsonb;', E'  result jsonb;\n  facts jsonb;');
  if v_definition = v_original then
    raise exception 'Could not install shared result fact validator';
  end if;
  execute v_definition;
end $$;

create function public.review_match_event_result(
  p_proposal_id uuid,
  p_expected_version bigint,
  p_decision text,
  p_reason_code text default null,
  p_reason_note text default null,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_command public.match_event_management_commands%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_note text := nullif(btrim(p_reason_note), '');
  v_side text;
  v_submitter_side text;
  v_now timestamptz;
  v_confirmation_id uuid;
  v_transition_revision bigint;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_proposal_id is null then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  select p.match_event_id into v_event_id
    from public.match_event_result_proposals p where p.id = p_proposal_id;
  if not found then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;

  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;
  if not found then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;

  if p_request_id is null then raise exception 'MATCH_RESULT_INVALID_REQUEST' using errcode = 'P0001'; end if;
  v_payload := jsonb_build_object(
    'expected_version', p_expected_version,
    'decision', p_decision,
    'reason_code', p_reason_code,
    'reason_note', v_note
  );
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_request_id;
  if found then
    if v_command.action <> 'review_result' or v_command.payload <> v_payload then
      raise exception 'MATCH_RESULT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  -- Gate version/status conflicts to the actual frozen quartet for this group;
  -- community admins and unrelated event/group participants receive no state.
  if not exists (
    select 1 from (
      select r.user_id,
        ((row_number() over(order by r.accepted_order,r.id) - 1) / 4 + 1)::bigint as group_number
        from public.match_event_registrations r
       where r.match_event_id = v_event.id
         and r.lifecycle = 'accepted' and r.cancelled_at is null
         and r.participation_status = 'playing'
    ) roster
    where roster.user_id = v_actor and roster.group_number = v_proposal.group_number
  ) then
    raise exception 'MATCH_RESULT_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;

  if p_expected_version is null or p_expected_version < 1
    or p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'MATCH_RESULT_INVALID_REVIEW' using errcode = 'P0001';
  end if;
  if v_proposal.active_version <> p_expected_version then
    raise exception 'MATCH_RESULT_REVIEW_VERSION_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_version',v_proposal.active_version,'current_status',v_proposal.status)::text;
  end if;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = p_expected_version;
  if not found then raise exception 'MATCH_RESULT_FACTS_NOT_FOUND' using errcode = '23514'; end if;

  if p_decision = 'approve' then
    if p_reason_code is not null or v_note is not null then
      raise exception 'MATCH_RESULT_INVALID_REVIEW' using errcode = 'P0001';
    end if;
  else
    if p_reason_code is null or p_reason_code not in (
      'SCORE_INCORRECT', 'TEAMS_INCORRECT', 'PLAYERS_INCORRECT',
      'GROUP_ASSIGNMENT_INCORRECT', 'MATCH_DID_NOT_HAPPEN', 'MATCH_TYPE_INCORRECT',
      'CLASSIFICATION_INCORRECT', 'OTHER'
    ) or (p_reason_code = 'OTHER' and v_note is null)
      or (v_note is not null and (char_length(v_note) > 500 or v_note ~ '[[:cntrl:]]')) then
      raise exception 'MATCH_RESULT_INVALID_REJECTION_REASON' using errcode = 'P0001';
    end if;
  end if;

  v_side := case
    when v_fact.teams -> 'team_a' ? v_actor::text then 'team_a'
    when v_fact.teams -> 'team_b' ? v_actor::text then 'team_b'
    else null
  end;
  if p_decision = 'reject' then
    if v_side is null or v_actor = v_fact.submitted_by then
      raise exception 'MATCH_RESULT_REVIEW_FORBIDDEN' using errcode = '42501';
    end if;
  else
    v_submitter_side := case
      when v_fact.teams -> 'team_a' ? v_fact.submitted_by::text then 'team_a'
      when v_fact.teams -> 'team_b' ? v_fact.submitted_by::text then 'team_b'
      else null
    end;
    if v_side is null or v_actor = v_fact.submitted_by
      or (v_submitter_side = 'team_a' and v_side <> 'team_b')
      or (v_submitter_side = 'team_b' and v_side <> 'team_a') then
      raise exception 'MATCH_RESULT_REVIEW_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  if v_proposal.status <> 'pending' then
    raise exception 'MATCH_RESULT_REVIEW_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_version',v_proposal.active_version,'current_status',v_proposal.status)::text;
  end if;

  -- Clock read follows the canonical event chain and proposal row lock. A valid
  -- late command commits AUTO_48H and returns state instead of raising/rolling it back.
  v_now := clock_timestamp();
  if v_now >= v_proposal.review_deadline_at then
    v_confirmation_id := public.finalize_match_event_result_locked(
      v_proposal.id, v_proposal.active_version, 'AUTO_48H', null
    );
    select * into v_proposal from public.match_event_result_proposals p
     where p.id = p_proposal_id;
    select c.id into v_confirmation_id from public.match_event_result_confirmations c
     where c.proposal_id = p_proposal_id and c.proposal_version = p_expected_version;
    v_result := jsonb_build_object(
      'proposal_id',v_proposal.id,'version',v_proposal.active_version,'status',v_proposal.status,
      'confirmation_id',v_confirmation_id,'review_deadline_at',v_proposal.review_deadline_at,
      'request_id',p_request_id,'replayed',false,'conflict','deadline_elapsed'
    );
    insert into public.match_event_management_commands(
      match_event_id,actor_id,request_id,action,payload,result,created_at
    ) values (v_event.id,v_actor,p_request_id,'review_result',v_payload,v_result,v_now);
    return v_result;
  end if;

  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = p_proposal_id and r.proposal_version = p_expected_version
       and r.reviewer_user_id = v_actor and r.decision = p_decision
  ) then
    v_result := jsonb_build_object(
      'proposal_id',v_proposal.id,'version',v_proposal.active_version,'status',v_proposal.status,
      'confirmation_id',null,'review_deadline_at',v_proposal.review_deadline_at,
      'request_id',p_request_id,'replayed',false
    );
  else
    insert into public.match_event_result_reviews(
      proposal_id,proposal_version,reviewer_user_id,decision,reason_code,reason_note,decided_at,request_id
    ) values (
      v_proposal.id,v_proposal.active_version,v_actor,p_decision,
      case when p_decision = 'reject' then p_reason_code else null end,
      case when p_decision = 'reject' then v_note else null end,
      v_now,p_request_id
    );

    if p_decision = 'reject' then
      update public.match_event_result_proposals p set status = 'disputed'
       where p.id = v_proposal.id and p.active_version = p_expected_version and p.status = 'pending';
      if not found then raise exception 'MATCH_RESULT_REVIEW_CONFLICT' using errcode = 'P0001'; end if;
      v_proposal.status := 'disputed';
    elsif public.has_match_event_result_approval_coverage(
      v_proposal.id, v_proposal.active_version, v_actor
    ) then
      v_confirmation_id := public.finalize_match_event_result_locked(
        v_proposal.id, v_proposal.active_version, 'MANUAL', v_actor
      );
      if v_confirmation_id is null and clock_timestamp() >= v_proposal.review_deadline_at then
        v_confirmation_id := public.finalize_match_event_result_locked(
          v_proposal.id, v_proposal.active_version, 'AUTO_48H', null
        );
      end if;
      select * into v_proposal from public.match_event_result_proposals p
       where p.id = p_proposal_id;
    end if;

    select s.transition_revision into v_transition_revision
      from public.match_event_registration_state s where s.match_event_id = v_event.id;
    if v_transition_revision is null then
      raise exception 'MATCH_RESULT_REGISTRATION_STATE_MISSING' using errcode = '23514';
    end if;
    insert into public.match_event_audit_log(
      match_event_id,community_id,actor_id,action,reason,request_id,occurred_at,
      event_version,transition_revision,before_data,after_data,changed_fields
    ) values (
      v_event.id,v_event.community_id,v_actor,
      case when p_decision = 'reject' then 'result_disputed' else 'result_approved' end,
      case when p_decision = 'reject' then p_reason_code else null end,
      p_request_id,v_now,p_expected_version,v_transition_revision,
      jsonb_build_object('proposal_id',v_proposal.id,'group_number',v_proposal.group_number,
        'version',p_expected_version,'status','pending'),
      jsonb_strip_nulls(jsonb_build_object(
        'proposal_id',v_proposal.id,'group_number',v_proposal.group_number,
        'version',p_expected_version,'status',v_proposal.status,
        'decision',p_decision,'team',v_side,'reason_code',case when p_decision = 'reject' then p_reason_code end,
        'reason_note',case when p_decision = 'reject' then v_note end,
        'confirmation_id',case when p_decision = 'approve' then v_confirmation_id end
      )),
      case when p_decision = 'reject' then array['status','review','reason'] else array['review'] end
    );
    v_result := jsonb_build_object(
      'proposal_id',v_proposal.id,'version',v_proposal.active_version,'status',v_proposal.status,
      'confirmation_id',v_confirmation_id,'review_deadline_at',v_proposal.review_deadline_at,
      'request_id',p_request_id,'replayed',false
    );
  end if;

  insert into public.match_event_management_commands(
    match_event_id,actor_id,request_id,action,payload,result,created_at
  ) values (v_event.id,v_actor,p_request_id,'review_result',v_payload,v_result,v_now);
  return v_result;
end $$;

create function public.correct_match_event_result(
  p_proposal_id uuid,
  p_expected_version bigint,
  p_teams jsonb,
  p_sets jsonb,
  p_played_local jsonb,
  p_court_label text default null,
  p_request_id uuid default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := auth.uid();
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact jsonb;
  v_command public.match_event_management_commands%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_now timestamptz;
  v_next_version bigint;
  v_confirmation_id uuid;
  v_transition_revision bigint;
begin
  if v_actor is null or coalesce(auth.jwt()->>'is_anonymous','false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  if p_proposal_id is null then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  select p.match_event_id into v_event_id
    from public.match_event_result_proposals p where p.id = p_proposal_id;
  if not found then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;

  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;
  if not found then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;

  if p_request_id is null then raise exception 'MATCH_RESULT_INVALID_REQUEST' using errcode = 'P0001'; end if;
  v_payload := jsonb_build_object(
    'expected_version',p_expected_version,
    'teams',p_teams,
    'sets',p_sets,
    'played_local',p_played_local,
    'court_label',nullif(btrim(p_court_label),'')
  );
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_request_id;
  if found then
    if v_command.action <> 'correct_result' or v_command.payload <> v_payload then
      raise exception 'MATCH_RESULT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  if v_actor <> v_event.created_by and not public.is_community_admin(v_event.community_id) then
    raise exception 'MATCH_RESULT_CORRECTION_FORBIDDEN' using errcode = '42501';
  end if;
  if p_expected_version is null or p_expected_version < 1 then
    raise exception 'MATCH_RESULT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if v_proposal.active_version <> p_expected_version then
    raise exception 'MATCH_RESULT_CORRECTION_VERSION_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_version',v_proposal.active_version,'current_status',v_proposal.status)::text;
  end if;
  if v_proposal.status not in ('pending','disputed') then
    raise exception 'MATCH_RESULT_CORRECTION_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_version',v_proposal.active_version,'current_status',v_proposal.status)::text;
  end if;

  v_now := clock_timestamp();
  if v_proposal.status = 'pending' and v_now >= v_proposal.review_deadline_at then
    perform public.finalize_match_event_result_locked(
      v_proposal.id,v_proposal.active_version,'AUTO_48H',null
    );
    select * into v_proposal from public.match_event_result_proposals p
     where p.id = p_proposal_id;
    select c.id into v_confirmation_id from public.match_event_result_confirmations c
     where c.proposal_id = p_proposal_id and c.proposal_version = p_expected_version;
    v_result := jsonb_build_object(
      'proposal_id',v_proposal.id,'version',v_proposal.active_version,'status',v_proposal.status,
      'confirmation_id',v_confirmation_id,'review_deadline_at',v_proposal.review_deadline_at,
      'request_id',p_request_id,'replayed',false,'conflict','deadline_elapsed'
    );
    insert into public.match_event_management_commands(
      match_event_id,actor_id,request_id,action,payload,result,created_at
    ) values (v_event.id,v_actor,p_request_id,'correct_result',v_payload,v_result,v_now);
    return v_result;
  end if;

  v_fact := public.validate_match_event_result_facts(
    v_event.id,v_proposal.group_number,p_teams,p_sets,p_played_local,p_court_label
  );
  v_next_version := v_proposal.active_version + 1;
  insert into public.match_event_result_proposal_versions(
    proposal_id,version,submitted_by,submitted_at,review_deadline_at,
    teams,sets,classification,played_at_utc,played_at_local,played_at_offset_seconds,court_label
  ) values (
    v_proposal.id,v_next_version,v_actor,v_now,v_now + interval '48 hours',
    v_fact->'teams',v_fact->'sets',v_fact->>'classification',
    (v_fact->>'played_at_utc')::timestamptz,(v_fact->>'played_at_local')::timestamp,
    (v_fact->>'played_at_offset_seconds')::integer,v_fact->>'court_label'
  );
  update public.match_event_result_proposals p
     set active_version = v_next_version,
         status = 'pending',
         submitted_by = v_actor,
         submitted_at = v_now,
         review_deadline_at = v_now + interval '48 hours'
   where p.id = v_proposal.id and p.active_version = p_expected_version
     and p.status in ('pending','disputed');
  if not found then raise exception 'MATCH_RESULT_CORRECTION_CONFLICT' using errcode = 'P0001'; end if;

  select s.transition_revision into v_transition_revision
    from public.match_event_registration_state s where s.match_event_id = v_event.id;
  if v_transition_revision is null then
    raise exception 'MATCH_RESULT_REGISTRATION_STATE_MISSING' using errcode = '23514';
  end if;
  insert into public.match_event_audit_log(
    match_event_id,community_id,actor_id,action,request_id,occurred_at,
    event_version,transition_revision,before_data,after_data,changed_fields
  ) values (
    v_event.id,v_event.community_id,v_actor,'result_corrected',p_request_id,v_now,
    v_next_version,v_transition_revision,
    jsonb_build_object('proposal_id',v_proposal.id,'group_number',v_proposal.group_number,
      'version',v_proposal.active_version,'status',v_proposal.status),
    jsonb_build_object('proposal_id',v_proposal.id,'group_number',v_proposal.group_number,
      'version',v_next_version,'status','pending','submitted_by',v_actor,
      'submitted_at',v_now,'review_deadline_at',v_now + interval '48 hours',
      'teams',v_fact->'teams','sets',v_fact->'sets',
      'classification',v_fact->>'classification',
      'played_at_utc',v_fact->>'played_at_utc','played_at_local',v_fact->>'played_at_local',
      'played_at_offset_seconds',(v_fact->>'played_at_offset_seconds')::integer,
      'court_label',v_fact->>'court_label'),
    array['version','status','submitted_by','submitted_at','review_deadline_at','teams','sets',
      'classification','played_at_utc','played_at_local','played_at_offset_seconds','court_label']
  );
  v_result := jsonb_build_object(
    'proposal_id',v_proposal.id,'version',v_next_version,'status','pending',
    'confirmation_id',null,'review_deadline_at',v_now + interval '48 hours',
    'request_id',p_request_id,'replayed',false
  );
  insert into public.match_event_management_commands(
    match_event_id,actor_id,request_id,action,payload,result,created_at
  ) values (v_event.id,v_actor,p_request_id,'correct_result',v_payload,v_result,v_now);
  return v_result;
end $$;

revoke all on function public.review_match_event_result(uuid,bigint,text,text,text,uuid),
  public.correct_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid)
  from public, anon, authenticated;
grant execute on function public.review_match_event_result(uuid,bigint,text,text,text,uuid),
  public.correct_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid)
  to authenticated;

commit;
