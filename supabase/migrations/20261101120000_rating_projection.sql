begin;

-- PAF-10 / U3: transactional projection of confirmed results into the app-wide rating.
--
-- The projector connects the pure V1 kernel (20261101110000) to the shared result
-- finalizer. It is internal: no runtime role can execute it and no caller supplies
-- levels or results; every input is re-read from immutable official facts and the
-- ledgered initialization audit AFTER the app-wide rating lock is held (READ COMMITTED).
--
-- Lock graph (see plan "Lock graph"):
--   community/event/registration/proposal locks (held by the finalizer)
--     -> lock_global_rating_projection()
--       -> rating rows in UUID order.
-- The projector never takes community/event/identity/profile locks while holding the
-- rating lock. Claim keeps its identity advisory lock and profile row lock before the
-- rating lock, but takes the profile lock as FOR NO KEY UPDATE: the ledger FKs need only
-- FOR KEY SHARE on the profile row, so a claim waiting for the rating lock can never
-- block the projector that holds it.
--
-- Chronology (see plan "Chronological order versus immutability"): events and their
-- first calculation are immutable. A group newer than every processed group appends four
-- events (tail fast path). A group that sorts before the processed watermark triggers a
-- full replay of the confirmed stream from the ledgered effective starting levels; only
-- calculations whose frozen inputs or outputs changed append a new revision.
--
-- Projection stays dormant until 20261101130000 activates and backfills it.
--
-- Every UPDATE carries a WHERE clause: PostgREST sessions run with pg-safeupdate, which
-- rejects unqualified UPDATE/DELETE even inside SECURITY DEFINER functions.

-- 1. Claim lock order. Two edits keep claim out of the confirmation lock graph:
--   * the profile row lock is FOR NO KEY UPDATE: the ledger FKs only need FOR KEY SHARE on it;
--   * the community/event rows the audit insert references are key-share locked BEFORE the
--     rating lock. A confirmation holds those rows FOR UPDATE while it waits for the rating
--     lock, so taking them (through the audit FK check) after it would deadlock.
do $claim$
declare v_definition text; v_updated text;
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.claim_provisional_player(text, text, numeric, text, text)'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    'from public.player_profiles p where p.user_id = v_uid for update;',
    'from public.player_profiles p where p.user_id = v_uid for no key update;');
  if v_updated = v_definition then
    raise exception 'Unexpected claim_provisional_player definition; refusing to change its profile lock';
  end if;
  v_definition := v_updated;
  v_updated := pg_catalog.replace(v_definition,
    E'  perform public.lock_global_rating_projection();\n  select * into v_rating',
    E'  select * into v_event from public.match_events e where e.id = v_profile.source_match_event_id for key share;\n'
    || E'  perform 1 from public.communities c where c.id = v_event.community_id for key share;\n'
    || E'  perform public.lock_global_rating_projection();\n  select * into v_rating');
  if v_updated = v_definition then
    raise exception 'Unexpected claim_provisional_player definition; refusing to reorder its locks';
  end if;
  execute v_updated;
end $claim$;

-- 2. Official eligible stream: immutable confirmation facts only. Pending/disputed
-- versions have no confirmation row; reserve registrations are not part of the version
-- teams. Later membership/status changes cannot remove a group from this stream.
create function public.rating_projection_eligible_groups()
returns table (game_group_id uuid, confirmation_id uuid, match_event_id uuid, game_group_number bigint,
  proposal_version bigint, played_at timestamptz, classification text, teams jsonb)
language sql stable security definer set search_path = '' as $$
  select c.proposal_id, c.id, c.match_event_id, c.group_number, c.proposal_version,
      v.played_at_utc, v.classification, v.teams
    from public.match_event_result_confirmations c
    join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
   where c.ratable_eligible and public.rating_v1_is_ratable(c.event_type::text, v.classification, 'confirmed');
$$;

create function public.rating_projection_initial_state(p_level numeric) returns jsonb
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('mu', p_level, 'sigma', 1.00, 'display_level', p_level,
    'reliability_percent', 10, 'confirmed_competitive_game_groups', 0, 'highest_display_level', p_level);
$$;

-- 3. One group: compute from the supplied pre-group states, then write. A group with no
-- ledger identity gets four events and four first calculations; a group already
-- ledgered gets a new calculation only for players whose frozen inputs or outputs
-- changed. Identity is all-or-nothing: 1-3 existing events is corrupt evidence.
create function public.rating_projection_apply_group(
  p_game_group_id uuid, p_confirmation_id uuid, p_match_event_id uuid, p_group_number bigint,
  p_proposal_version bigint, p_played_at timestamptz, p_classification text, p_teams jsonb,
  p_states jsonb, p_revision bigint,
  out o_states jsonb, out o_meta jsonb, out o_changed boolean, out o_new_events integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_members text[]; v_member_ids uuid[]; v_inputs jsonb; v_group_states jsonb;
  v_existing integer; v_matching integer;
  v_engine text := 'app-wide-level'; v_version text := '1.0.0'; v_config integer := 1;
  r record; v_event_id uuid; v_last public.player_rating_event_calculations%rowtype;
  v_explanation jsonb; v_write boolean;
begin
  v_members := array[p_teams -> 'team_a' ->> 0, p_teams -> 'team_a' ->> 1,
    p_teams -> 'team_b' ->> 0, p_teams -> 'team_b' ->> 1];
  if exists (select 1 from pg_catalog.unnest(v_members) m where m is null)
    or (select pg_catalog.count(distinct m) from pg_catalog.unnest(v_members) m) <> 4 then
    raise exception using errcode = '22023', message = 'RATING_INPUT_INVALID';
  end if;
  v_member_ids := v_members::uuid[];
  select pg_catalog.jsonb_object_agg(m, p_states -> m) into v_group_states
    from (select distinct m from pg_catalog.unnest(v_members) m) d;
  v_inputs := pg_catalog.jsonb_build_object(
    'classification', p_classification,
    'played_at', pg_catalog.to_char(p_played_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'teams', pg_catalog.jsonb_build_object('team_a', p_teams -> 'team_a', 'team_b', p_teams -> 'team_b'),
    'states', v_group_states);

  select pg_catalog.count(*), pg_catalog.count(*) filter (where e.user_id = any (v_member_ids))
    into v_existing, v_matching
    from public.player_rating_events e where e.game_group_id = p_game_group_id;
  if v_existing <> 0 and (v_existing <> 4 or v_matching <> 4) then
    raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
  end if;
  if v_existing = 4 then
    -- Recorded engine/config of the source event, never the current default.
    select c.rating_engine, c.rating_engine_version, c.rating_config_version
      into v_engine, v_version, v_config
      from public.player_rating_event_calculations c
      join public.player_rating_events e on e.id = c.rating_event_id
     where e.game_group_id = p_game_group_id
     order by c.projection_revision desc, e.user_id limit 1;
    if not found then
      raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
    end if;
  end if;

  o_states := p_states;
  o_meta := '{}'::jsonb;
  o_changed := false;
  o_new_events := 0;
  for r in select * from public.rating_v1_calculate_group(v_engine, v_version, v_config, v_inputs) loop
    v_explanation := pg_catalog.jsonb_build_object(
      'engine', r.rating_engine, 'engine_version', r.rating_engine_version, 'config_version', r.rating_config_version,
      'classification', p_classification, 'ordinal', r.ordinal, 'team', r.team,
      'own_team_strength', r.own_team_strength, 'opponent_team_strength', r.opponent_team_strength,
      'expected_score', r.expected_score, 'outcome_value', r.outcome_value,
      'reliability_factor', r.reliability_factor, 'raw_delta', r.raw_delta,
      'rounded_delta', r.rounded_delta, 'applied_delta', r.applied_delta, 'clamped', r.clamped);
    if v_existing = 0 then
      insert into public.player_rating_events
        (game_group_id, user_id, match_event_id, game_group_number, confirmation_id, proposal_version, played_at)
        values (p_game_group_id, r.user_id, p_match_event_id, p_group_number, p_confirmation_id,
          p_proposal_version, p_played_at)
        returning id into v_event_id;
      o_new_events := o_new_events + 1;
      v_write := true;
    else
      select e.id into v_event_id from public.player_rating_events e
       where e.game_group_id = p_game_group_id and e.user_id = r.user_id;
      select * into v_last from public.player_rating_event_calculations c
       where c.rating_event_id = v_event_id order by c.projection_revision desc limit 1;
      if not found then
        raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
      end if;
      v_write := (v_last.inputs, v_last.explanation, v_last.rating_engine, v_last.rating_engine_version,
          v_last.rating_config_version)
        is distinct from (v_inputs, v_explanation, r.rating_engine, r.rating_engine_version, r.rating_config_version);
    end if;
    if v_write then
      insert into public.player_rating_event_calculations
        (rating_event_id, projection_revision, rating_engine, rating_engine_version, rating_config_version,
         before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups,
         before_highest_display_level, after_mu, after_sigma, after_display_level, after_reliability_percent,
         after_confirmed_groups, after_highest_display_level, last_rating_at, inputs, explanation)
        values (v_event_id, p_revision, r.rating_engine, r.rating_engine_version, r.rating_config_version,
          r.before_mu, r.before_sigma, r.before_display_level, r.before_reliability_percent,
          r.before_confirmed_groups, r.before_highest_display_level, r.after_mu, r.after_sigma,
          r.after_display_level, r.after_reliability_percent, r.after_confirmed_groups,
          r.after_highest_display_level, r.last_rating_at, v_inputs, v_explanation);
      o_changed := true;
    end if;
    o_states := pg_catalog.jsonb_set(o_states, array[r.user_id::text], pg_catalog.jsonb_build_object(
      'mu', r.after_mu, 'sigma', r.after_sigma, 'display_level', r.after_display_level,
      'reliability_percent', r.after_reliability_percent,
      'confirmed_competitive_game_groups', r.after_confirmed_groups,
      'highest_display_level', r.after_highest_display_level));
    o_meta := o_meta || pg_catalog.jsonb_build_object(r.user_id::text, pg_catalog.jsonb_build_object(
      'engine', r.rating_engine, 'engine_version', r.rating_engine_version, 'config_version', r.rating_config_version));
  end loop;
end $$;

-- 4. Materialize the projected states. Rating rows are locked in UUID order; only rows
-- whose values differ are written, stamped with the revision that changed them.
-- last_rating_at is the latest ledgered played_at, never the wall clock.
create function public.rating_projection_write_states(p_states jsonb, p_meta jsonb, p_revision bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  perform 1 from public.global_player_ratings r
   where r.user_id in (select k::uuid from pg_catalog.jsonb_object_keys(p_states) k)
   order by r.user_id for update;
  with s as (
    select e.key::uuid as user_id, e.value as st, p_meta -> e.key as meta from pg_catalog.jsonb_each(p_states) e
  ), last_event as (
    select ev.user_id, pg_catalog.max(ev.played_at) as played_at from public.player_rating_events ev
     where ev.user_id in (select s.user_id from s) group by ev.user_id
  )
  update public.global_player_ratings r set
      mu = (s.st ->> 'mu')::numeric, sigma = (s.st ->> 'sigma')::numeric,
      display_level = (s.st ->> 'display_level')::numeric,
      reliability_percent = (s.st ->> 'reliability_percent')::smallint,
      confirmed_competitive_game_groups = (s.st ->> 'confirmed_competitive_game_groups')::integer,
      highest_display_level = (s.st ->> 'highest_display_level')::numeric,
      last_rating_at = l.played_at,
      rating_engine = coalesce(s.meta ->> 'engine', r.rating_engine),
      rating_engine_version = coalesce(s.meta ->> 'engine_version', r.rating_engine_version),
      rating_config_version = coalesce((s.meta ->> 'config_version')::integer, r.rating_config_version),
      projection_revision = p_revision
    from s left join last_event l on l.user_id = s.user_id
   where r.user_id = s.user_id
     and (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
          r.highest_display_level, r.last_rating_at, r.rating_engine, r.rating_engine_version, r.rating_config_version)
       is distinct from ((s.st ->> 'mu')::numeric, (s.st ->> 'sigma')::numeric, (s.st ->> 'display_level')::numeric,
          (s.st ->> 'reliability_percent')::integer, (s.st ->> 'confirmed_competitive_game_groups')::integer,
          (s.st ->> 'highest_display_level')::numeric, l.played_at,
          coalesce(s.meta ->> 'engine', r.rating_engine), coalesce(s.meta ->> 'engine_version', r.rating_engine_version),
          coalesce((s.meta ->> 'config_version')::integer, r.rating_config_version));
  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

-- 5. Consistency gate: every listed player's state equals the latest calculation of the
-- chronologically last ledgered event, and the counted groups equal the logical events.
create function public.rating_projection_assert_consistent(p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_bad bigint;
begin
  select pg_catalog.count(*) into v_bad
    from public.global_player_ratings r
    left join lateral (select e.id from public.player_rating_events e where e.user_id = r.user_id
        order by e.played_at desc, e.game_group_id desc limit 1) le on true
    left join lateral (select c.* from public.player_rating_event_calculations c
        where c.rating_event_id = le.id order by c.projection_revision desc limit 1) lc on true
   where r.user_id = any (p_user_ids)
     and (r.confirmed_competitive_game_groups <>
          (select pg_catalog.count(*) from public.player_rating_events e2 where e2.user_id = r.user_id)
       or (le.id is null and (r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level
            or r.highest_display_level <> r.initial_display_level or r.last_rating_at is not null))
       or (le.id is not null and (lc.rating_event_id is null
            or (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
                r.highest_display_level, r.last_rating_at)
              is distinct from (lc.after_mu, lc.after_sigma, lc.after_display_level,
                lc.after_reliability_percent::integer, lc.after_confirmed_groups,
                lc.after_highest_display_level, lc.last_rating_at))));
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
end $$;

-- 6. Full replay of the confirmed stream, sorted by (played_at UTC, proposal UUID).
-- Starting states are the ledgered effective initial levels, never current mu. Group
-- credits come from the distinct eligible groups walked, not from calculation revisions.
create function public.rating_projection_replay(p_revision bigint,
  out o_changed boolean, out o_groups integer, out o_last_played_at timestamptz, out o_last_group_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_states jsonb; v_meta jsonb := '{}'::jsonb; v_users uuid[]; v_expected integer; v_found integer;
  v_group record; v_apply record; v_written integer;
begin
  o_changed := false;
  o_groups := 0;
  select pg_catalog.array_agg(distinct m.value::uuid) into v_users
    from public.rating_projection_eligible_groups() g,
      pg_catalog.jsonb_array_elements_text((g.teams -> 'team_a') || (g.teams -> 'team_b')) m(value);
  if v_users is null then return; end if;
  v_expected := pg_catalog.cardinality(v_users);
  -- The ledger may have been written in this very transaction (or just before autovacuum
  -- gathered statistics): without fresh statistics the per-event lookups below can fall
  -- back to sequential scans and turn a seconds-long replay into minutes (measured: 5000
  -- groups, >10 min unanalyzed versus ~7 s analyzed).
  analyze public.player_rating_events, public.player_rating_event_calculations;
  select pg_catalog.jsonb_object_agg(i.user_id::text, public.rating_projection_initial_state(i.initial_level)),
      pg_catalog.count(*)
    into v_states, v_found
    from (select distinct on (a.user_id) a.user_id, a.initial_level
            from public.player_rating_initializations a
           where a.user_id = any (v_users)
           order by a.user_id, a.sequence desc) i
    join public.global_player_ratings r on r.user_id = i.user_id and r.initial_display_level = i.initial_level;
  if v_found is distinct from v_expected then
    raise exception 'Incomplete player state' using errcode = '23514';
  end if;
  -- Only players of the confirmed stream are recomputed. Rating rows outside it are not
  -- touched here: the upgrade audit (20261101100000) already refused unprojected history.

  for v_group in select * from public.rating_projection_eligible_groups() g
      order by g.played_at, g.game_group_id loop
    select * into v_apply from public.rating_projection_apply_group(
      v_group.game_group_id, v_group.confirmation_id, v_group.match_event_id, v_group.game_group_number,
      v_group.proposal_version, v_group.played_at, v_group.classification, v_group.teams, v_states, p_revision);
    v_states := v_apply.o_states;
    v_meta := v_meta || v_apply.o_meta;
    if v_apply.o_changed then o_changed := true; end if;
    o_groups := o_groups + 1;
    o_last_played_at := v_group.played_at;
    o_last_group_id := v_group.game_group_id;
  end loop;

  v_written := public.rating_projection_write_states(v_states, v_meta, p_revision);
  if v_written > 0 then o_changed := true; end if;
  if exists (select 1 from public.player_rating_events e
      where e.game_group_id in (select g.game_group_id from public.rating_projection_eligible_groups() g)
      group by e.game_group_id having pg_catalog.count(*) <> 4)
    or (select pg_catalog.count(distinct e.game_group_id) from public.player_rating_events e) <> o_groups then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
  perform public.rating_projection_assert_consistent(v_users);
end $$;

-- 7. Projector entry point. Caller (the shared finalizer) already holds the canonical
-- community/event/proposal locks. Idempotent: an already-ledgered group returns after
-- verifying its evidence; an ineligible group (friendly, incomplete) changes nothing.
create function public.project_confirmed_rating_group(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.player_rating_projection_control%rowtype;
  v_group record; v_existing integer; v_revision bigint; v_member_ids uuid[];
  v_states jsonb; v_loaded integer; v_apply record; v_replay record;
begin
  perform public.lock_global_rating_projection();
  -- Everything below is read after the lock: the stream, ledger and states are current.
  select * into v_control from public.player_rating_projection_control c for update;
  if not found then
    raise exception 'Rating projection control is missing' using errcode = '23514';
  end if;
  if not v_control.activation_enabled then return; end if;
  select * into v_group from public.rating_projection_eligible_groups() g where g.game_group_id = p_proposal_id;
  if not found then return; end if;

  select pg_catalog.count(*) into v_existing from public.player_rating_events e
   where e.game_group_id = p_proposal_id;
  if v_existing = 4 then
    if exists (select 1 from public.player_rating_events e where e.game_group_id = p_proposal_id
        and not exists (select 1 from public.player_rating_event_calculations c where c.rating_event_id = e.id)) then
      raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
    end if;
    return;
  elsif v_existing <> 0 then
    raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
  end if;

  v_revision := v_control.committed_revision + 1;
  if (v_control.last_processed_game_group_id is null
      or (v_group.played_at, v_group.game_group_id)
        > (v_control.last_processed_played_at, v_control.last_processed_game_group_id))
    and not exists (select 1 from public.rating_projection_eligible_groups() g
      where g.game_group_id <> p_proposal_id
        and not exists (select 1 from public.player_rating_events e where e.game_group_id = g.game_group_id)) then
    -- Tail fast path: the four current states already include every earlier group.
    v_member_ids := array[(v_group.teams -> 'team_a' ->> 0)::uuid, (v_group.teams -> 'team_a' ->> 1)::uuid,
      (v_group.teams -> 'team_b' ->> 0)::uuid, (v_group.teams -> 'team_b' ->> 1)::uuid];
    select pg_catalog.jsonb_object_agg(r.user_id::text, pg_catalog.jsonb_build_object(
        'mu', r.mu, 'sigma', r.sigma, 'display_level', r.display_level,
        'reliability_percent', r.reliability_percent,
        'confirmed_competitive_game_groups', r.confirmed_competitive_game_groups,
        'highest_display_level', r.highest_display_level)), pg_catalog.count(*)
      into v_states, v_loaded
      from (select * from public.global_player_ratings gr where gr.user_id = any (v_member_ids)
              order by gr.user_id for update) r;
    if v_loaded is distinct from 4 then
      raise exception 'Incomplete player state' using errcode = '23514';
    end if;
    select * into v_apply from public.rating_projection_apply_group(
      v_group.game_group_id, v_group.confirmation_id, v_group.match_event_id, v_group.game_group_number,
      v_group.proposal_version, v_group.played_at, v_group.classification, v_group.teams, v_states, v_revision);
    if v_apply.o_new_events <> 4 then
      raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
    end if;
    perform public.rating_projection_write_states(v_apply.o_states, v_apply.o_meta, v_revision);
    perform public.rating_projection_assert_consistent(v_member_ids);
    update public.player_rating_projection_control set committed_revision = v_revision,
      last_processed_played_at = v_group.played_at, last_processed_game_group_id = v_group.game_group_id
     where singleton;
  else
    -- Late insertion (or self-heal): replay the whole confirmed stream chronologically.
    select * into v_replay from public.rating_projection_replay(v_revision);
    update public.player_rating_projection_control set
      committed_revision = case when v_replay.o_changed then v_revision else committed_revision end,
      last_processed_played_at = v_replay.o_last_played_at, last_processed_game_group_id = v_replay.o_last_group_id
     where singleton;
  end if;
end $$;

revoke all on function public.rating_projection_eligible_groups(), public.rating_projection_initial_state(numeric),
  public.rating_projection_apply_group(uuid, uuid, uuid, bigint, bigint, timestamptz, text, jsonb, jsonb, bigint),
  public.rating_projection_write_states(jsonb, jsonb, bigint), public.rating_projection_assert_consistent(uuid[]),
  public.rating_projection_replay(bigint), public.project_confirmed_rating_group(uuid)
  from public, anon, authenticated, service_role;

-- 8. Shared finalizer: identical to 20261028180302 plus the projector call after the
-- terminal transition and its audit, and on the idempotent already-confirmed branch. A
-- projector failure raises, so the confirmation, status change, audit and notification
-- roll back together; the scheduler's per-candidate handling records the failure.
create or replace function public.finalize_match_event_result_locked(
  p_proposal_id uuid, p_expected_version bigint, p_source text, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_existing public.match_event_result_confirmations%rowtype;
  v_now timestamptz;
  v_transition_revision bigint;
  v_confirmation_id uuid;
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
end $$;

commit;
