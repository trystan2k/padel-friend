begin;

-- PAF-11 / U4: result-time Ranked eligibility.
--
-- Contract (docs/plan/Plan PAF-11 T11, "Eligibility helpers", "Atomic results/global independence"):
--   * Ranked = match_events.league_id IS NOT NULL on a Competitive event. The binding is fixed at
--     publication; nothing here binds or rebinds a League at result time.
--   * A Ranked result group is valid only when EVERY actual participant had an activated
--     membership interval covering the played instant
--       activated_at IS NOT NULL AND activated_at <= played_at AND valid_from <= played_at
--       AND (valid_until IS NULL OR played_at < valid_until)
--     (including intervals that have since ended: removal after play never invalidates it,
--     removal at or before play always does; pending time never counts) and the played instant
--     lies inside the League's effective window [start_at, coalesce(end_at, closed_at)]
--     (both ends inclusive; a Manual League that is still open has no upper bound).
--   * The check runs in the shared fact validator (submission + correction) and again, before the
--     FIRST official confirmation, in the shared finalizer (manual, deadline and scheduler paths).
--     A failed group fails as a whole; no player is silently excluded.
--   * Lock graph: the finalizer already holds communities -> event advisory/row -> registration
--     rows. League lifecycle commands take the community lock first, so reading the League row
--     here needs no extra lock and adds nothing before or after the global rating lock that
--     project_confirmed_rating_group() takes last. The existing T10 projector invocation and the
--     prelock order are untouched; Unranked/Friendly groups never consult League state.
--   * Resolution (approved Q2): reject + existing authorized correction workflow (truthful
--     played_at / actual-team correction). No post-start Unranked conversion exists.

create or replace function public.match_result_fact_quartet(p_teams jsonb)
returns uuid[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(pg_catalog.array_agg(x.value::uuid order by x.value::uuid), '{}'::uuid[])
    from pg_catalog.jsonb_array_elements_text(
      coalesce(p_teams -> 'team_a', '[]'::jsonb) || coalesce(p_teams -> 'team_b', '[]'::jsonb)) x(value);
$$;

-- Returns NULL when the group may be Ranked (or is not Ranked), else a typed reason:
--   {"reason":"league_invalid"|"out_of_period"|"membership","user_ids":[...]}
create or replace function public.match_result_ranked_ineligibility(
  p_event_id uuid, p_quartet uuid[], p_played_at timestamptz
) returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_event public.match_events%rowtype;
  v_league public.leagues%rowtype;
  v_end timestamptz;
  v_missing uuid[];
begin
  select * into v_event from public.match_events e where e.id = p_event_id;
  if not found or v_event.league_id is null or v_event.event_type <> 'competitive' then
    return null;
  end if;
  select * into v_league from public.leagues l
   where l.id = v_event.league_id and l.community_id = v_event.community_id;
  if not found or v_league.created_at > v_event.published_at then
    return pg_catalog.jsonb_build_object('reason', 'league_invalid', 'user_ids', '[]'::jsonb);
  end if;
  v_end := public.match_league_effective_end(v_league.end_at, v_league.closed_at);
  if p_played_at < v_league.start_at or (v_end is not null and p_played_at > v_end) then
    return pg_catalog.jsonb_build_object('reason', 'out_of_period', 'user_ids', '[]'::jsonb);
  end if;
  select coalesce(pg_catalog.array_agg(u.id order by u.id), '{}'::uuid[]) into v_missing
    from pg_catalog.unnest(p_quartet) u(id)
   where not exists (
     select 1 from public.community_members m
      where m.community_id = v_event.community_id and m.user_id = u.id
        and m.activated_at is not null and m.activated_at <= p_played_at
        and m.valid_from <= p_played_at
        and (m.valid_until is null or p_played_at < m.valid_until));
  if pg_catalog.cardinality(v_missing) > 0 or pg_catalog.cardinality(p_quartet) <> 4 then
    return pg_catalog.jsonb_build_object('reason', 'membership', 'user_ids', pg_catalog.to_jsonb(v_missing));
  end if;
  return null;
end $$;

revoke all on function public.match_result_fact_quartet(jsonb),
  public.match_result_ranked_ineligibility(uuid, uuid[], timestamptz)
  from public, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.validate_match_event_result_facts(p_match_event_id uuid, p_group_number bigint, p_teams jsonb, p_sets jsonb, p_played_local jsonb, p_court_label text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_gate jsonb;
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
  -- Ranked play: every actual participant needs a membership interval covering the played
  -- instant and the played instant must sit inside the League's effective window. Unranked and
  -- Friendly groups are never restricted by League state.
  if v_event.league_id is not null and v_event.event_type = 'competitive' then
    v_gate := public.match_result_ranked_ineligibility(v_event.id, v_quartet, v_instant);
    if v_gate is not null then
      raise exception using errcode = 'P0001',
        message = 'MATCH_RESULT_RANKED_' || upper(v_gate ->> 'reason'),
        detail = jsonb_build_object('set_index',null,'side',null,
          'reason_token','RANKED_' || upper(v_gate ->> 'reason'))::text;
    end if;
  end if;
  return jsonb_build_object(
    'teams', v_teams,
    'sets', v_sets,
    'classification', public.classify_match_result_sets(v_sets),
    'played_at_utc', v_instant,
    'played_at_local', v_local_time,
    'played_at_offset_seconds', v_offset_seconds,
    'court_label', btrim(p_court_label)
  );
end $function$;

CREATE OR REPLACE FUNCTION public.finalize_match_event_result_locked(p_proposal_id uuid, p_expected_version bigint, p_source text, p_actor_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_existing public.match_event_result_confirmations%rowtype;
  v_now timestamptz;
  v_transition_revision bigint;
  v_confirmation_id uuid;
  v_gate jsonb;
begin
  if p_proposal_id is null or p_expected_version is null or p_expected_version < 1
    or p_source not in ('MANUAL', 'AUTO_48H')
    or (p_source = 'MANUAL' and p_actor_id is null)
    or (p_source = 'AUTO_48H' and p_actor_id is not null) then
    raise exception 'Invalid result finalization request' using errcode = '22023';
  end if;

  select p.match_event_id into v_event_id from public.match_event_result_proposals p
   where p.id = p_proposal_id;
  if not found then return null; end if;
  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;
  if not found then return null; end if;
  if v_proposal.active_version <> p_expected_version then return null; end if;

  if v_proposal.status = 'confirmed' then
    select * into v_existing from public.match_event_result_confirmations c
     where c.proposal_id = p_proposal_id and c.proposal_version = p_expected_version;
    if found then
      perform public.project_confirmed_rating_group(p_proposal_id);
      return v_existing.id;
    end if;
    raise exception 'Confirmed proposal is missing its confirmation evidence' using errcode = '23514';
  end if;
  if v_proposal.status <> 'pending' then return null; end if;

  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = p_expected_version;
  if not found then
    raise exception 'Active result version is missing immutable facts' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = p_proposal_id
       and r.proposal_version = p_expected_version
       and r.decision = 'reject'
  ) then return null; end if;

  v_now := clock_timestamp();
  if p_source = 'AUTO_48H' then
    if v_now < v_proposal.review_deadline_at then return null; end if;
  else
    if v_now >= v_proposal.review_deadline_at
      or not public.has_match_event_result_approval_coverage(
        p_proposal_id, p_expected_version, p_actor_id
      ) then return null; end if;
  end if;

  select s.transition_revision into v_transition_revision
    from public.match_event_registration_state s
   where s.match_event_id = v_event.id;
  if v_transition_revision is null then
    raise exception 'Result confirmation requires frozen registration state' using errcode = '23514';
  end if;

  -- First official confirmation only (confirmed replays returned above): repeat the historical
  -- Ranked check against the stored facts. Membership is judged at the played instant, never by
  -- today's status; the League window is judged by its current effective boundary. A failure
  -- aborts before any confirmation, audit or rating side effect.
  if v_event.league_id is not null and v_event.event_type = 'competitive' then
    v_gate := public.match_result_ranked_ineligibility(
      v_event.id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc);
    if v_gate is not null then
      raise exception using errcode = 'P0001',
        message = 'MATCH_RESULT_RANKED_' || upper(v_gate ->> 'reason'),
        detail = jsonb_build_object('set_index',null,'side',null,
          'reason_token','RANKED_' || upper(v_gate ->> 'reason'))::text;
    end if;
  end if;

  v_confirmation_id := gen_random_uuid();
  insert into public.match_event_result_confirmations(
    id, proposal_id, proposal_version, match_event_id, group_number, source,
    confirmed_at, effective_at, actor_id, event_type, ratable_eligible
  ) values (
    v_confirmation_id, v_proposal.id, v_proposal.active_version,
    v_proposal.match_event_id, v_proposal.group_number, p_source,
    v_now,
    case when p_source = 'AUTO_48H' then v_proposal.review_deadline_at else v_now end,
    p_actor_id, v_event.event_type,
    v_event.event_type = 'competitive' and v_fact.classification <> 'incomplete'
  );

  update public.match_event_result_proposals p set status = 'confirmed'
   where p.id = v_proposal.id and p.active_version = p_expected_version and p.status = 'pending';
  if not found then
    raise exception 'Result proposal changed during finalization' using errcode = '23514';
  end if;

  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields,
    confirmation_id
  ) values (
    v_event.id, v_event.community_id, p_actor_id, 'result_confirmed', null, v_now,
    p_expected_version, v_transition_revision,
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'pending'),
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'confirmed', 'source', p_source,
      'confirmation_id', v_confirmation_id),
    array['status', 'confirmation_id'], v_confirmation_id
  );
  perform public.project_confirmed_rating_group(v_proposal.id);
  return v_confirmation_id;
end $function$;

CREATE OR REPLACE FUNCTION public.try_auto_confirm_match_event_result(p_proposal_id uuid, p_expected_version bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_confirmation_id uuid;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_gate jsonb;
begin
  select p.match_event_id into v_event_id
    from public.match_event_result_proposals p where p.id = p_proposal_id;
  if not found then
    return pg_catalog.jsonb_build_object('reason', 'stale_candidate');
  end if;

  v_event := public.lock_match_event_registration_skip_locked(v_event_id);
  if v_event.id is null then
    return pg_catalog.jsonb_build_object('reason', 'locked');
  end if;

  select p.* into v_proposal
    from public.match_event_result_proposals p
   where p.id = p_proposal_id
   for update;
  if not found or v_proposal.active_version <> p_expected_version then
    return pg_catalog.jsonb_build_object('reason', 'stale_candidate');
  end if;
  if v_proposal.status <> 'pending' then
    return pg_catalog.jsonb_build_object('reason', 'not_pending');
  end if;
  if pg_catalog.clock_timestamp() < v_proposal.review_deadline_at then
    return pg_catalog.jsonb_build_object('reason', 'not_due');
  end if;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = v_proposal.id
       and r.proposal_version = p_expected_version
       and r.decision = 'reject'
  ) then
    return pg_catalog.jsonb_build_object('reason', 'rejected');
  end if;

  -- Due Ranked proposal that no longer satisfies historical eligibility: report a typed blocked
  -- reason instead of raising, so the scheduler records actionable evidence for this proposal.
  if v_event.league_id is not null and v_event.event_type = 'competitive' then
    select * into v_fact from public.match_event_result_proposal_versions v
     where v.proposal_id = v_proposal.id and v.version = p_expected_version;
    if found then
      v_gate := public.match_result_ranked_ineligibility(
        v_event.id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc);
      if v_gate is not null then
        return pg_catalog.jsonb_build_object(
          'reason', 'ranked_ineligible',
          'code', 'MATCH_RESULT_RANKED_' || upper(v_gate ->> 'reason'));
      end if;
    end if;
  end if;

  v_confirmation_id := public.finalize_match_event_result_locked(
    v_proposal.id, p_expected_version, 'AUTO_48H', null
  );
  if v_confirmation_id is null then
    return pg_catalog.jsonb_build_object('reason', 'not_eligible');
  end if;
  return pg_catalog.jsonb_build_object(
    'reason', 'confirmed', 'confirmation_id', v_confirmation_id
  );
end $function$;

CREATE OR REPLACE FUNCTION public.process_due_match_event_results(p_limit integer DEFAULT 25)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_candidate record;
  v_result jsonb;
  v_reason text;
  v_sqlstate text;
  v_attempted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_confirmed integer := 0;
  v_blocked integer := 0;
  v_blocked_items jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
  v_alerts jsonb;
begin
  for v_candidate in
    select p.id as proposal_id,
           p.active_version,
           p.review_deadline_at,
           case when s.proposal_version = p.active_version then s.attempt_count else 0 end
             as attempt_count
      from public.match_event_result_proposals p
      left join public.match_event_result_processing_state s on s.proposal_id = p.id
     where p.status = 'pending'
       and p.review_deadline_at <= pg_catalog.clock_timestamp()
       and (s.proposal_id is null
         or s.proposal_version is distinct from p.active_version
         or s.next_attempt_at is null
         or s.next_attempt_at <= pg_catalog.clock_timestamp())
     order by case when s.proposal_version = p.active_version then s.attempt_count else 0 end,
              p.review_deadline_at, p.id
     limit v_limit
  loop
    v_attempted := v_attempted + 1;
    begin
      v_result := public.try_auto_confirm_match_event_result(
        v_candidate.proposal_id, v_candidate.active_version
      );
      v_reason := coalesce(v_result ->> 'reason', 'not_eligible');
      if v_reason = 'confirmed' then
        v_confirmed := v_confirmed + 1;
      elsif v_reason = 'ranked_ineligible' then
        v_blocked := v_blocked + 1;
      else
        v_skipped := v_skipped + 1;
      end if;

      if v_reason = 'ranked_ineligible' then
        -- Actionable evidence outside a failed batch item: the proposal stays queued with a typed
        -- failure code and backoff until an authorized correction supersedes the facts.
        v_blocked_items := v_blocked_items || pg_catalog.jsonb_build_object(
          'proposal_id', v_candidate.proposal_id,
          'version', v_candidate.active_version,
          'code', v_result ->> 'code',
          'message', 'Ranked result requirements are not met; an authorized correction is required.'
        );
        perform public.record_match_result_processing_attempt(
          v_candidate.proposal_id, v_candidate.active_version, true, v_result ->> 'code', false
        );
      else
        perform public.record_match_result_processing_attempt(
          v_candidate.proposal_id,
          v_candidate.active_version,
          false,
          null,
          v_reason in ('confirmed', 'stale_candidate', 'not_pending', 'rejected')
        );
      end if;
    exception when others then
      -- The exception subtransaction has rolled back confirmation/audit work
      -- and released event/proposal locks before failure bookkeeping begins.
      v_sqlstate := SQLSTATE;
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'proposal_id', v_candidate.proposal_id,
        'version', v_candidate.active_version,
        'code', case when v_sqlstate ~ '^[A-Z0-9_]{1,80}$' then v_sqlstate else 'PROCESSING_ERROR' end,
        'message', 'Automatic result confirmation failed; retry is scheduled.'
      );
      begin
        perform public.record_match_result_processing_attempt(
          v_candidate.proposal_id, v_candidate.active_version, true, v_sqlstate, false
        );
      exception when others then
        -- Bookkeeping is best-effort only when a non-cooperating state-row lock
        -- defeats the nonblocking claim; the next bounded tick retries it.
        null;
      end;
    end;
  end loop;

  begin
    v_alerts := public.process_match_result_lifecycle_alerts(25, 25);
  exception when others then
    v_alerts := pg_catalog.jsonb_build_object(
      'failed', 1,
      'message', 'Lifecycle alerts failed; retry is scheduled.'
    );
  end;
  return pg_catalog.jsonb_build_object(
    'attempted', v_attempted,
    'skipped', v_skipped,
    'failed', v_failed,
    'confirmed', v_confirmed,
    'blocked', v_blocked,
    'blocked_items', v_blocked_items,
    'errors', v_errors,
    'alerts', v_alerts
  );
end $function$;

CREATE OR REPLACE FUNCTION public.correct_match_event_result(p_proposal_id uuid, p_expected_version bigint, p_teams jsonb, p_sets jsonb, p_played_local jsonb, p_court_label text DEFAULT NULL::text, p_request_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_active public.match_event_result_proposal_versions%rowtype;
  v_gate jsonb;
begin perform public.assert_actor_not_provisional();
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
  v_payload := jsonb_build_object('proposal_id', p_proposal_id,
    'expected_version',p_expected_version,
    'teams',p_teams,
    'sets',p_sets,
    'played_local',p_played_local,
    'court_label',nullif(btrim(p_court_label),'')
  );
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_request_id;
  if found then
    if v_command.action <> 'correct_result'
       or v_command.result ->> 'proposal_id' is distinct from p_proposal_id::text
        or (case when v_command.payload ? 'proposal_id' then v_command.payload <> v_payload
             else v_command.payload <> (v_payload - 'proposal_id') end) then
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

  -- An overdue pending Ranked proposal that cannot be confirmed must stay correctable: the
  -- authorized correction is the resolution, so it must not be pre-empted by deadline finalization.
  if v_proposal.status = 'pending' and v_event.league_id is not null
    and v_event.event_type = 'competitive' then
    select * into v_active from public.match_event_result_proposal_versions v
     where v.proposal_id = v_proposal.id and v.version = v_proposal.active_version;
    if found then
      v_gate := public.match_result_ranked_ineligibility(
        v_event.id, public.match_result_fact_quartet(v_active.teams), v_active.played_at_utc);
    end if;
  end if;

  v_now := clock_timestamp();
  if v_proposal.status = 'pending' and v_now >= v_proposal.review_deadline_at
    and v_gate is null then
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
end $function$;

CREATE OR REPLACE FUNCTION public.get_match_event_result_proposals(p_match_event_id uuid)
 RETURNS SETOF jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  e public.match_events%rowtype;
  caller_id uuid := auth.uid();
begin perform public.assert_actor_not_provisional();
  if caller_id is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into e from public.match_events where id = p_match_event_id;
  if e.id is null then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  if e.created_by <> caller_id and not public.is_community_admin(e.community_id)
    and not exists (
      select 1 from public.match_event_registrations r
       where r.match_event_id = e.id and r.user_id = caller_id
         and r.lifecycle = 'accepted' and r.cancelled_at is null
    ) then
    raise exception 'MATCH_RESULT_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select pg_catalog.jsonb_build_object(
    'event_id', p.match_event_id,
    'proposal_id', p.id,
    'group_number', p.group_number,
    'status', p.status,
    'version', v.version,
    'teams', (
      select pg_catalog.jsonb_object_agg(side, players)
        from (
          select side, (
            select pg_catalog.jsonb_agg(
              pg_catalog.jsonb_build_object('user_id', u.value, 'display_name', profile.display_name, 'is_provisional', coalesce(profile.is_provisional, false))
              order by u.ordinality
            )
              from pg_catalog.jsonb_array_elements_text(v.teams -> side)
                with ordinality u(value, ordinality)
              left join public.player_profiles profile on profile.user_id = u.value::uuid
          ) as players
            from pg_catalog.unnest(array['team_a', 'team_b']) side
        ) named
    ),
    'sets', v.sets,
    'classification', v.classification,
    'played_at_utc', v.played_at_utc,
    'played_at_local', pg_catalog.to_char(v.played_at_local, 'YYYY-MM-DD HH24:MI:SS'),
    'played_at_offset_seconds', v.played_at_offset_seconds,
    'court_label', v.court_label,
    'submitted_by', v.submitted_by,
    'submitted_by_name', (select profile.display_name from public.player_profiles profile where profile.user_id = v.submitted_by),
    'submitted_at', v.submitted_at,
    'review_deadline_at', v.review_deadline_at,
    'rating_effective', e.event_type = 'competitive' and v.classification <> 'incomplete',
    'ranked_blocked', ranked.value,
    'can_approve', p.status = 'pending'
      and ranked.value is null
      and clock_timestamp() < v.review_deadline_at
      and caller_id <> v.submitted_by
      and (v.teams -> 'team_a' ? caller_id::text or v.teams -> 'team_b' ? caller_id::text)
      and case
        when v.teams -> 'team_a' ? v.submitted_by::text then v.teams -> 'team_b' ? caller_id::text
        when v.teams -> 'team_b' ? v.submitted_by::text then v.teams -> 'team_a' ? caller_id::text
        else true
      end
      and not exists (
        select 1 from public.match_event_result_reviews r
         where r.proposal_id = p.id and r.proposal_version = v.version
           and r.reviewer_user_id = caller_id and r.decision = 'approve'
      ),
    'can_reject', p.status = 'pending'
      and clock_timestamp() < v.review_deadline_at
      and caller_id <> v.submitted_by
      and (v.teams -> 'team_a' ? caller_id::text or v.teams -> 'team_b' ? caller_id::text),
    'can_correct', (caller_id = e.created_by or public.is_community_admin(e.community_id))
      and p.status in ('pending', 'disputed')
      and (p.status = 'disputed' or ranked.value is not null or clock_timestamp() < v.review_deadline_at),
    'caller_decision', (
      select r.decision from public.match_event_result_reviews r
       where r.proposal_id = p.id and r.proposal_version = v.version
         and r.reviewer_user_id = caller_id
       order by r.decided_at desc, r.id desc limit 1
    ),
    'required_team_coverage_count', case
      when v.teams -> 'team_a' ? v.submitted_by::text or v.teams -> 'team_b' ? v.submitted_by::text then 1
      else 2
    end,
    'received_team_coverage_count', case
      when v.teams -> 'team_a' ? v.submitted_by::text then least(coverage.team_b_approval_count, 1)
      when v.teams -> 'team_b' ? v.submitted_by::text then least(coverage.team_a_approval_count, 1)
      else (case when coverage.team_a_approval_count > 0 then 1 else 0 end)
         + (case when coverage.team_b_approval_count > 0 then 1 else 0 end)
    end,
    'team_a_approval_count', coverage.team_a_approval_count,
    'team_b_approval_count', coverage.team_b_approval_count,
    'dispute_evidence', case when p.status = 'disputed' then (
      select pg_catalog.jsonb_build_object(
        'rejector_id', r.reviewer_user_id,
        'rejector_name', profile.display_name,
        'reason_code', r.reason_code,
        'reason_note', r.reason_note,
        'decided_at', r.decided_at
      )
        from public.match_event_result_reviews r
        left join public.player_profiles profile on profile.user_id = r.reviewer_user_id
       where r.proposal_id = p.id and r.proposal_version = v.version and r.decision = 'reject'
       order by r.decided_at desc, r.id desc limit 1
    ) else null end,
    'confirmation', case when c.id is null then null else pg_catalog.jsonb_build_object(
      'confirmation_id', c.id,
      'source', c.source,
      'confirmed_at', c.confirmed_at,
      'effective_at', c.effective_at,
      'actor_id', c.actor_id
    ) end,
    'version_timeline', (
      select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'version', history.version,
        'status', case when history.version = p.active_version then p.status else 'superseded' end,
        'submitted_by', history.submitted_by,
        'submitted_by_name', (select profile.display_name from public.player_profiles profile where profile.user_id = history.submitted_by),
        'submitted_at', history.submitted_at,
        'review_deadline_at', history.review_deadline_at,
        'decisions', (
          select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'reviewer_id', review.reviewer_user_id,
            'reviewer_name', reviewer.display_name,
            'decision', review.decision,
            'reason_code', review.reason_code,
            'reason_note', review.reason_note,
            'decided_at', review.decided_at
          ) order by review.decided_at, review.id), '[]'::jsonb)
            from public.match_event_result_reviews review
            left join public.player_profiles reviewer on reviewer.user_id = review.reviewer_user_id
           where review.proposal_id = p.id and review.proposal_version = history.version
        ),
        'confirmation_id', (
          select confirmation.id from public.match_event_result_confirmations confirmation
           where confirmation.proposal_id = p.id and confirmation.proposal_version = history.version
        )
      ) order by history.version), '[]'::jsonb)
        from public.match_event_result_proposal_versions history
       where history.proposal_id = p.id
    )
  )
  from public.match_event_result_proposals p
  join public.match_event_result_proposal_versions v
    on v.proposal_id = p.id and v.version = p.active_version
  left join public.match_event_result_confirmations c
    on c.proposal_id = p.id and c.proposal_version = v.version
  cross join lateral (
    select case when p.status <> 'confirmed' and e.league_id is not null
        and e.event_type = 'competitive'
      then public.match_result_ranked_ineligibility(
        e.id, public.match_result_fact_quartet(v.teams), v.played_at_utc) end as value
  ) ranked
  cross join lateral (
    select
      count(distinct r.reviewer_user_id) filter (where v.teams -> 'team_a' ? r.reviewer_user_id::text)::integer as team_a_approval_count,
      count(distinct r.reviewer_user_id) filter (where v.teams -> 'team_b' ? r.reviewer_user_id::text)::integer as team_b_approval_count
      from public.match_event_result_reviews r
     where r.proposal_id = p.id and r.proposal_version = v.version and r.decision = 'approve'
       and r.reviewer_user_id <> v.submitted_by
  ) coverage
  where p.match_event_id = e.id
  order by p.group_number;
end $function$;

commit;
