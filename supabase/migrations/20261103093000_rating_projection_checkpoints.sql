begin;

-- PAF-148 / T14.2 (3/4): checkpoint-aware rating projection.
--
-- An ADMIN_REVIEW_ADJUSTMENT is a checkpoint in the chronological stream, keyed
-- (boundary_played_at, boundary_group_id). Ordering contract of the merged stream:
--   (key time, key id, kind: match 0 / checkpoint 1, projection revision).
-- Every match committed before an approval sorts before its checkpoint; a match whose played
-- key is before the checkpoint is computed from the pre-adjustment state and the checkpoint then
-- re-applies the absolute corrected level (never erased), a match after it continues from the
-- corrected state. Reliability / group count / sigma flow through unchanged unless the
-- adjustment recorded a reliability exception, in which case the stream is stamped 1.1.0.
-- Lock graph is unchanged: nothing here takes event/profile locks; source prelocking stays in
-- rating_projection_lock_covered().

-- 1. One group. Same as 20261101120000 plus: a per-player "exception" marker in the stream
-- state (stripped before the frozen kernel inputs) selects engine version 1.1.0 for every
-- group containing an exception-bearing player, and survives in the returned states.
create or replace function public.rating_projection_apply_group(
  p_game_group_id uuid, p_confirmation_id uuid, p_match_event_id uuid, p_group_number bigint,
  p_proposal_version bigint, p_played_at timestamptz, p_classification text, p_teams jsonb,
  p_states jsonb, p_revision bigint,
  out o_states jsonb, out o_meta jsonb, out o_changed boolean, out o_new_events integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_members text[]; v_member_ids uuid[]; v_inputs jsonb; v_group_states jsonb; v_exception boolean;
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
  select pg_catalog.jsonb_object_agg(m, (p_states -> m) - 'exception'),
      coalesce(pg_catalog.bool_or(coalesce((p_states -> m ->> 'exception')::boolean, false)), false)
    into v_group_states, v_exception
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
  -- A recorded reliability exception on any of the four players selects the exception-capable
  -- kernel for the whole group, so all four results carry the same deterministic stamp.
  if v_exception then v_version := '1.1.0'; end if;

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
      'highest_display_level', r.after_highest_display_level,
      'exception', coalesce((p_states -> r.user_id::text ->> 'exception')::boolean, false)));
    o_meta := o_meta || pg_catalog.jsonb_build_object(r.user_id::text, pg_catalog.jsonb_build_object(
      'engine', r.rating_engine, 'engine_version', r.rating_engine_version, 'config_version', r.rating_config_version));
  end loop;
end $$;

-- 2. Consistency gate over the merged stream. A player's materialized state must equal the
-- state after the chronologically LAST stream item: the latest match calculation, or the latest
-- recorded checkpoint state when the checkpoint sorts after every match. Reliability off the
-- 1.0.0 curve is only legal for a 1.1.0 row backed by a recorded reset/reduce adjustment, and
-- checkpoint order must follow committed revision order.
create or replace function public.rating_projection_assert_consistent(p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_bad bigint;
begin
  select pg_catalog.count(*) into v_bad
    from public.global_player_ratings r
    left join lateral (select e.id, e.played_at, e.game_group_id from public.player_rating_events e
        where e.user_id = r.user_id order by e.played_at desc, e.game_group_id desc limit 1) le on true
    left join lateral (select c.* from public.player_rating_event_calculations c
        where c.rating_event_id = le.id order by c.projection_revision desc limit 1) lc on true
    left join lateral (select a.id, a.boundary_played_at, a.boundary_group_id
        from public.player_rating_admin_adjustments a where a.user_id = r.user_id
        order by a.boundary_played_at desc, a.boundary_group_id desc limit 1) la on true
    left join lateral (select s.* from public.player_rating_adjustment_states s
        where s.adjustment_id = la.id order by s.projection_revision desc limit 1) ls on true
   where r.user_id = any (p_user_ids)
     and (r.confirmed_competitive_game_groups <>
          (select pg_catalog.count(*) from public.player_rating_events e2 where e2.user_id = r.user_id)
       or (le.id is null and la.id is null
           and (r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level
             or r.highest_display_level <> r.initial_display_level or r.last_rating_at is not null))
       or (la.id is not null
           and (le.id is null or (la.boundary_played_at, la.boundary_group_id) > (le.played_at, le.game_group_id))
           and (ls.adjustment_id is null
             or (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
                 r.highest_display_level, r.last_rating_at)
               is distinct from (ls.mu, ls.sigma, ls.display_level, ls.reliability_percent::integer,
                 ls.confirmed_groups, ls.highest_display_level, ls.last_rating_at)))
       or (le.id is not null
           and (la.id is null or (la.boundary_played_at, la.boundary_group_id) < (le.played_at, le.game_group_id))
           and (lc.rating_event_id is null
             or (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
                 r.highest_display_level, r.last_rating_at)
               is distinct from (lc.after_mu, lc.after_sigma, lc.after_display_level,
                 lc.after_reliability_percent::integer, lc.after_confirmed_groups,
                 lc.after_highest_display_level, lc.last_rating_at)))
       or (r.reliability_percent <> least(100, 10 + 6 * r.confirmed_competitive_game_groups)
           and not (r.rating_engine_version = '1.1.0' and exists (select 1
             from public.player_rating_admin_adjustments x
            where x.user_id = r.user_id and x.reliability_mode <> 'preserve'))));
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
  if exists (select 1 from public.player_rating_admin_adjustments a1
      join public.player_rating_admin_adjustments a2 on a1.projection_revision < a2.projection_revision
     where a1.user_id = any (p_user_ids)
       and (a1.boundary_played_at, a1.boundary_group_id) >= (a2.boundary_played_at, a2.boundary_group_id)) then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
end $$;

-- 3. Full replay of the merged stream. Same contract as before for matches; checkpoints apply
-- the absolute corrected level (highest keeps the historical peak) and, for a recorded
-- reliability exception, the explicit post-exception reliability. A checkpoint whose
-- reconstructed state differs from the last recorded one gets a new checkpoint-state revision;
-- the adjustment row itself is never touched.
create or replace function public.rating_projection_replay(p_revision bigint,
  out o_changed boolean, out o_groups integer, out o_last_played_at timestamptz, out o_last_group_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_states jsonb; v_meta jsonb := '{}'::jsonb; v_users uuid[]; v_expected integer; v_found integer;
  v_item record; v_apply record; v_written integer; v_state jsonb; v_prev record; v_last_rating_at timestamptz;
begin
  o_changed := false;
  o_groups := 0;
  select pg_catalog.array_agg(distinct q.u) into v_users from (
      select m.value::uuid as u
        from public.rating_projection_eligible_groups() g,
          pg_catalog.jsonb_array_elements_text((g.teams -> 'team_a') || (g.teams -> 'team_b')) m(value)
      union
      select a.user_id from public.player_rating_admin_adjustments a) q;
  if v_users is null then return; end if;
  v_expected := pg_catalog.cardinality(v_users);
  -- See 20261101120000: fresh statistics keep the per-event lookups on index scans.
  analyze public.player_rating_events, public.player_rating_event_calculations;
  select pg_catalog.jsonb_object_agg(i.user_id::text,
        public.rating_projection_initial_state(i.initial_level) || pg_catalog.jsonb_build_object('exception', false)),
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

  for v_item in
    select 0 as kind, g.played_at as item_at, g.game_group_id as gid, 0::bigint as rev,
        g.confirmation_id, g.match_event_id, g.game_group_number, g.proposal_version, g.classification, g.teams,
        null::uuid as adjustment_id, null::uuid as user_id, null::text as mode, null::smallint as target,
        null::numeric as after_level
      from public.rating_projection_eligible_groups() g
    union all
    select 1, a.boundary_played_at, a.boundary_group_id, a.projection_revision,
        null, null, null, null, null, null,
        a.id, a.user_id, a.reliability_mode, a.reliability_target, a.after_display_level
      from public.player_rating_admin_adjustments a
    order by item_at, gid, kind, rev loop
    if v_item.kind = 0 then
      select * into v_apply from public.rating_projection_apply_group(
        v_item.gid, v_item.confirmation_id, v_item.match_event_id, v_item.game_group_number,
        v_item.proposal_version, v_item.item_at, v_item.classification, v_item.teams, v_states, p_revision);
      v_states := v_apply.o_states;
      v_meta := v_meta || v_apply.o_meta;
      if v_apply.o_changed then o_changed := true; end if;
      o_groups := o_groups + 1;
      o_last_played_at := v_item.item_at;
      o_last_group_id := v_item.gid;
    else
      v_state := v_states -> v_item.user_id::text;
      v_state := v_state || pg_catalog.jsonb_build_object(
        'mu', v_item.after_level, 'display_level', v_item.after_level,
        'highest_display_level', greatest((v_state ->> 'highest_display_level')::numeric, v_item.after_level));
      if v_item.mode <> 'preserve' then
        v_state := v_state || pg_catalog.jsonb_build_object('reliability_percent', v_item.target, 'exception', true);
        v_meta := v_meta || pg_catalog.jsonb_build_object(v_item.user_id::text, pg_catalog.jsonb_build_object(
          'engine', 'app-wide-level', 'engine_version', '1.1.0', 'config_version', 1));
      end if;
      v_states := pg_catalog.jsonb_set(v_states, array[v_item.user_id::text], v_state);
      -- Matches of this player before the checkpoint are all ledgered by now (stream order).
      select pg_catalog.max(e.played_at) into v_last_rating_at from public.player_rating_events e
       where e.user_id = v_item.user_id and (e.played_at, e.game_group_id) < (v_item.item_at, v_item.gid);
      select s.* into v_prev from public.player_rating_adjustment_states s
       where s.adjustment_id = v_item.adjustment_id order by s.projection_revision desc limit 1;
      if not found or (v_prev.mu, v_prev.sigma, v_prev.display_level, v_prev.reliability_percent::integer,
          v_prev.confirmed_groups, v_prev.highest_display_level, v_prev.last_rating_at)
        is distinct from ((v_state ->> 'mu')::numeric, (v_state ->> 'sigma')::numeric,
          (v_state ->> 'display_level')::numeric, (v_state ->> 'reliability_percent')::integer,
          (v_state ->> 'confirmed_competitive_game_groups')::integer,
          (v_state ->> 'highest_display_level')::numeric, v_last_rating_at) then
        insert into public.player_rating_adjustment_states
          (adjustment_id, projection_revision, rating_engine, rating_engine_version, rating_config_version,
           mu, sigma, display_level, reliability_percent, confirmed_groups, highest_display_level, last_rating_at)
          values (v_item.adjustment_id, p_revision, 'app-wide-level',
            coalesce(v_meta -> v_item.user_id::text ->> 'engine_version', '1.0.0'),
            1, (v_state ->> 'mu')::numeric, (v_state ->> 'sigma')::numeric, (v_state ->> 'display_level')::numeric,
            (v_state ->> 'reliability_percent')::integer, (v_state ->> 'confirmed_competitive_game_groups')::integer,
            (v_state ->> 'highest_display_level')::numeric, v_last_rating_at);
        o_changed := true;
      end if;
    end if;
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

-- 4. Projector entry point: same as the lock-patched effective definition plus checkpoint
-- awareness. The tail fast path is only legal for a group whose played key sorts AFTER every
-- checkpoint (and the match watermark); a group before the latest checkpoint is routed through
-- the replay, which places it before the checkpoint in the merged stream.
create or replace function public.project_confirmed_rating_group(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.player_rating_projection_control%rowtype;
  v_group record; v_existing integer; v_revision bigint; v_member_ids uuid[];
  v_states jsonb; v_loaded integer; v_apply record; v_replay record;
begin
  if (select c.activation_enabled from public.player_rating_projection_control c) then
    perform public.rating_projection_lock_covered();
  else
    perform public.lock_global_rating_projection();
  end if;
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
    and not exists (select 1 from public.player_rating_admin_adjustments a
      where (a.boundary_played_at, a.boundary_group_id) >= (v_group.played_at, v_group.game_group_id))
    and not exists (select 1 from public.rating_projection_eligible_groups() g
      where g.game_group_id <> p_proposal_id
        and not exists (select 1 from public.player_rating_events e where e.game_group_id = g.game_group_id)) then
    -- Tail fast path: the four current states already include every earlier group and checkpoint.
    v_member_ids := array[(v_group.teams -> 'team_a' ->> 0)::uuid, (v_group.teams -> 'team_a' ->> 1)::uuid,
      (v_group.teams -> 'team_b' ->> 0)::uuid, (v_group.teams -> 'team_b' ->> 1)::uuid];
    select pg_catalog.jsonb_object_agg(r.user_id::text, pg_catalog.jsonb_build_object(
        'mu', r.mu, 'sigma', r.sigma, 'display_level', r.display_level,
        'reliability_percent', r.reliability_percent,
        'confirmed_competitive_game_groups', r.confirmed_competitive_game_groups,
        'highest_display_level', r.highest_display_level,
        'exception', exists (select 1 from public.player_rating_admin_adjustments a
          where a.user_id = r.user_id and a.reliability_mode <> 'preserve'))), pg_catalog.count(*)
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
    -- Late insertion, insertion before a checkpoint (or self-heal): replay the merged stream.
    select * into v_replay from public.rating_projection_replay(v_revision);
    update public.player_rating_projection_control set
      committed_revision = case when v_replay.o_changed then v_revision else committed_revision end,
      last_processed_played_at = v_replay.o_last_played_at, last_processed_game_group_id = v_replay.o_last_group_id
     where singleton;
  end if;
end $$;

commit;
