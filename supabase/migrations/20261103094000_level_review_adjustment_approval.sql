begin;

-- PAF-148 / T14.2 (4/4): atomic approval, checkpoint-aware readers.

-- 0. Rank dirty marks gain the cause of an administrative level correction (the mark is how a
-- corrected current level reaches the community skill ranks).
alter table public.statistics_rank_dirty drop constraint statistics_rank_dirty_cause_check;
alter table public.statistics_rank_dirty add constraint statistics_rank_dirty_cause_check
  check (cause in ('membership', 'rating_initialization', 'league_standings', 'level_review_adjustment'));

-- 1. DTO builder (internal; admin audit only). Fixed key whitelist.
create function public.level_review_adjustment_dto(a public.player_rating_admin_adjustments) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', a.id, 'level_review_request_id', a.level_review_request_id, 'user_id', a.user_id,
    'event_type', a.event_type, 'reason', a.reason, 'actor_id', a.actor_id,
    'decided_at', public.rating_utc_text(a.decided_at), 'effective_at', public.rating_utc_text(a.effective_at),
    'projection_revision', a.projection_revision,
    'boundary_played_at', public.rating_utc_text(a.boundary_played_at),
    'boundary_group_id', a.boundary_group_id, 'boundary_basis', a.boundary_basis,
    'rating_engine', a.rating_engine, 'rating_config_version', a.rating_config_version,
    'before_engine_version', a.before_engine_version, 'after_engine_version', a.after_engine_version,
    'before_display_level', a.before_display_level, 'after_display_level', a.after_display_level,
    'before_reliability_percent', a.before_reliability_percent,
    'after_reliability_percent', a.after_reliability_percent,
    'before_confirmed_groups', a.before_confirmed_groups, 'after_confirmed_groups', a.after_confirmed_groups,
    'before_highest_display_level', a.before_highest_display_level,
    'after_highest_display_level', a.after_highest_display_level,
    'before_sigma', a.before_sigma, 'after_sigma', a.after_sigma,
    'last_rating_at', public.rating_utc_text(a.last_rating_at),
    'reliability_mode', a.reliability_mode, 'reliability_target', a.reliability_target,
    'exception_justification', a.exception_justification);
$$;
revoke all on function public.level_review_adjustment_dto(public.player_rating_admin_adjustments)
  from public, anon, authenticated, service_role;

-- 2. Atomic resolution. Approval is ONE transaction: request lock -> terminal/idempotency
-- decision -> FK key-share locks (deterministic UUID order) -> global rating lock -> projection
-- control -> target rating row -> fresh-state validation -> immutable adjustment + checkpoint
-- state -> materialization -> committed revision -> statistics publication -> request update.
-- Any failure rolls all of it back. Nothing here takes event/profile write locks and nothing
-- replays history, League standings or the finalizer.
drop function public.resolve_level_review_request(uuid, uuid, text, text, numeric, bigint);
create function public.resolve_level_review_request(p_request_id uuid, p_command_id uuid, p_decision text,
  p_note text, p_target_level numeric default null, p_expected_revision bigint default null,
  p_reliability_mode text default null, p_reliability_target integer default null,
  p_exception_justification text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.level_review_admin_actor();
  v_note text := pg_catalog.btrim(p_note, E' \t\n\r\f\v');
  v_justification text := nullif(pg_catalog.btrim(p_exception_justification, E' \t\n\r\f\v'), '');
  v_mode text := case when p_decision = 'approve' then coalesce(p_reliability_mode, 'preserve') else p_reliability_mode end;
  v_row public.player_level_review_requests%rowtype; v_fingerprint text;
  v_control public.player_rating_projection_control%rowtype; v_rating public.global_player_ratings%rowtype;
  v_adjustment public.player_rating_admin_adjustments%rowtype;
  v_now timestamptz; v_revision bigint; v_boundary_at timestamptz; v_basis text; v_prior timestamptz;
  v_after_rel integer; v_after_version text; v_target numeric(4,2);
begin
  perform public.assert_actor_not_provisional();
  if p_request_id is null or p_command_id is null or p_decision is null
    or p_decision not in ('approve', 'reject')
    or v_note is null or pg_catalog.char_length(v_note) not between 1 and 2000
    or (p_decision = 'approve' and (not public.level_review_valid_level(p_target_level)
      or p_expected_revision is null or p_expected_revision < 0
      or v_mode not in ('preserve', 'reset', 'reduce')
      or (v_mode = 'preserve' and (p_reliability_target is not null or v_justification is not null))
      or (v_mode = 'reset' and (p_reliability_target is not null or v_justification is null))
      or (v_mode = 'reduce' and (p_reliability_target is null or p_reliability_target not between 0 and 99
        or v_justification is null))
      or (v_justification is not null and pg_catalog.char_length(v_justification) > 2000)))
    or (p_decision = 'reject' and (p_target_level is not null or p_expected_revision is not null
      or p_reliability_mode is not null or p_reliability_target is not null
      or p_exception_justification is not null)) then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;

  select * into v_row from public.player_level_review_requests r where r.id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_NOT_FOUND';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(p_decision, v_note,
    p_target_level::numeric(4,2)::text, v_mode, p_reliability_target, v_justification)::text);

  -- Exact retry of a terminal decision returns the original outcome, regardless of how stale
  -- the caller's preview revision is by now.
  if v_row.status in ('approved', 'rejected') then
    if v_row.decision_command_id = p_command_id and v_row.decision_fingerprint = v_fingerprint then
      select * into v_adjustment from public.player_rating_admin_adjustments a where a.id = v_row.adjustment_id;
      return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', true,
        'adjustment', case when v_adjustment.id is null then null else public.level_review_adjustment_dto(v_adjustment) end);
    end if;
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RESOLUTION_CONFLICT';
  end if;
  if v_row.status = 'canceled' then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_INVALID_TRANSITION';
  end if;

  if p_decision = 'reject' then
    update public.player_level_review_requests r
       set status = 'rejected', decision_actor_id = v_uid, decision_command_id = p_command_id,
           decision_fingerprint = v_fingerprint, decision_note = v_note,
           decided_at = pg_catalog.clock_timestamp()
     where r.id = v_row.id returning * into v_row;
    return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', false,
      'adjustment', null);
  end if;

  if p_target_level not between v_row.requested_min_level and v_row.requested_max_level then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_TARGET_OUT_OF_RANGE';
  end if;

  -- FK key-share locks BEFORE the rating lock (deterministic UUID order): the inserts below
  -- reference the owner profile and the auth users; taking those key shares after the global
  -- lock would be a reverse edge against claim/onboarding writers.
  perform 1 from auth.users u where u.id in (v_row.owner_id, v_uid) order by u.id for key share;
  perform 1 from public.player_profiles p where p.user_id = v_row.owner_id for key share;

  perform public.lock_global_rating_projection();
  select * into v_control from public.player_rating_projection_control c for update;
  if not found or not v_control.activation_enabled then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RATING_UNAVAILABLE';
  end if;
  select * into v_rating from public.global_player_ratings r where r.user_id = v_row.owner_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RATING_UNAVAILABLE';
  end if;

  -- Everything below is decided on state re-read under the locks.
  if p_expected_revision <> v_control.committed_revision then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_STALE_RATING';
  end if;
  perform public.rating_projection_assert_consistent(array[v_row.owner_id]);
  if (v_mode = 'reset' and v_rating.reliability_percent <= 10)
    or (v_mode = 'reduce' and p_reliability_target >= v_rating.reliability_percent) then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RELIABILITY_INVALID';
  end if;

  v_target := p_target_level::numeric(4,2);
  v_after_rel := case v_mode when 'preserve' then v_rating.reliability_percent
    when 'reset' then 10 else p_reliability_target end;
  v_after_version := case v_mode when 'preserve' then v_rating.rating_engine_version else '1.1.0' end;

  -- Immutable forward-only boundary: strictly after the decision instant, every committed match
  -- key (watermark) and every earlier checkpoint. Actual decision time stays separate.
  v_now := pg_catalog.clock_timestamp();
  v_boundary_at := v_now;
  v_basis := 'decision_clock';
  if v_control.last_processed_played_at is not null
    and v_control.last_processed_played_at + interval '1 microsecond' > v_boundary_at then
    v_boundary_at := v_control.last_processed_played_at + interval '1 microsecond';
    v_basis := 'match_watermark';
  end if;
  select pg_catalog.max(a.boundary_played_at) into v_prior from public.player_rating_admin_adjustments a;
  if v_prior is not null and v_prior + interval '1 microsecond' > v_boundary_at then
    v_boundary_at := v_prior + interval '1 microsecond';
    v_basis := 'prior_checkpoint';
  end if;
  v_revision := v_control.committed_revision + 1;

  insert into public.player_rating_admin_adjustments (level_review_request_id, user_id, reason, actor_id,
      decided_at, effective_at, projection_revision, boundary_played_at, boundary_group_id, boundary_basis,
      rating_engine, rating_config_version, before_engine_version, after_engine_version,
      before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups,
      before_highest_display_level, after_mu, after_sigma, after_display_level, after_reliability_percent,
      after_confirmed_groups, after_highest_display_level, last_rating_at,
      reliability_mode, reliability_target, exception_justification)
    values (v_row.id, v_row.owner_id, v_note, v_uid, v_now, v_now, v_revision, v_boundary_at,
      'ffffffff-ffff-ffff-ffff-ffffffffffff'::uuid, v_basis,
      v_rating.rating_engine, v_rating.rating_config_version, v_rating.rating_engine_version, v_after_version,
      v_rating.mu, v_rating.sigma, v_rating.display_level, v_rating.reliability_percent,
      v_rating.confirmed_competitive_game_groups, v_rating.highest_display_level,
      v_target, v_rating.sigma, v_target, v_after_rel, v_rating.confirmed_competitive_game_groups,
      greatest(v_rating.highest_display_level, v_target), v_rating.last_rating_at,
      v_mode, case v_mode when 'reset' then 10 when 'reduce' then p_reliability_target end, v_justification)
    returning * into v_adjustment;
  insert into public.player_rating_adjustment_states (adjustment_id, projection_revision, rating_engine,
      rating_engine_version, rating_config_version, mu, sigma, display_level, reliability_percent,
      confirmed_groups, highest_display_level, last_rating_at)
    values (v_adjustment.id, v_revision, v_rating.rating_engine, v_after_version, v_rating.rating_config_version,
      v_target, v_rating.sigma, v_target, v_after_rel, v_rating.confirmed_competitive_game_groups,
      v_adjustment.after_highest_display_level, v_rating.last_rating_at);

  -- Materialize: only level/peak/reliability (and the exception's engine stamp) move; sigma, group
  -- count, initial level and last-match timestamp are preserved.
  update public.global_player_ratings r set mu = v_target, display_level = v_target,
      highest_display_level = v_adjustment.after_highest_display_level, reliability_percent = v_after_rel,
      rating_engine_version = v_after_version, projection_revision = v_revision
    where r.user_id = v_row.owner_id;
  update public.player_rating_projection_control set committed_revision = v_revision where singleton;
  perform public.rating_projection_assert_consistent(array[v_row.owner_id]);

  -- Publish corrected sporting summaries and skill ranks (rating -> statistics lock order). No
  -- per-match fact changes and no League standings work are emitted for an adjustment.
  perform public.statistics_rank_mark_player(v_row.owner_id, 'level_review_adjustment');
  perform public.statistics_publish(null, array[v_row.owner_id], null, false);
  perform public.statistics_rank_refresh();

  update public.player_level_review_requests r
     set status = 'approved', decision_actor_id = v_uid, decision_command_id = p_command_id,
         decision_fingerprint = v_fingerprint, decision_note = v_note, decided_at = v_now,
         approved_level = v_target, adjustment_id = v_adjustment.id
   where r.id = v_row.id returning * into v_row;
  return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', false,
    'adjustment', public.level_review_adjustment_dto(v_adjustment));
end $$;
revoke all on function public.resolve_level_review_request(uuid, uuid, text, text, numeric, bigint, text, integer, text)
  from public, anon, authenticated, service_role;
grant execute on function public.resolve_level_review_request(uuid, uuid, text, text, numeric, bigint, text, integer, text)
  to authenticated;

-- Admin detail carries the audit event once the request is approved.
do $detail$
declare v_definition text; v_updated text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.get_level_review_admin_detail(uuid)'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    '''rating_changed'', v_row.snapshot_rating_revision <> v_revision,',
    '''rating_changed'', v_row.snapshot_rating_revision <> v_revision,
    ''adjustment'', (select public.level_review_adjustment_dto(a) from public.player_rating_admin_adjustments a
       where a.level_review_request_id = v_row.id),');
  if v_updated = v_definition then
    raise exception 'Unexpected get_level_review_admin_detail definition; refusing to patch it';
  end if;
  execute v_updated;
end $detail$;

-- 3. Checkpoint-aware readers. Match items keep their exact PAF-10 shape (plus kind); an
-- adjustment is a discriminated item built from the stored safe fields only: no opponent
-- internals, no exception justification, no actor.
create function public.rating_timeline_items(p_user_id uuid, p_revision bigint)
returns table (kind text, sort_at timestamptz, sort_id uuid, item_id uuid, display_level numeric,
  effective_at timestamptz, dto jsonb)
language sql stable security definer set search_path = '' as $$
  select 'match'::text, c.played_at, c.game_group_id, c.game_group_id, c.after_display_level, c.played_at,
      pg_catalog.jsonb_build_object(
        'kind', 'match',
        'game_group_id', c.game_group_id, 'match_event_id', c.match_event_id,
        'game_group_number', c.game_group_number, 'played_at', public.rating_utc_text(c.played_at),
        'classification', c.inputs ->> 'classification', 'team', c.explanation ->> 'team',
        'outcome_value', c.explanation -> 'outcome_value', 'expected_score', c.explanation -> 'expected_score',
        'before_display_level', c.before_display_level, 'after_display_level', c.after_display_level,
        'applied_delta', c.explanation -> 'applied_delta', 'clamped', c.explanation -> 'clamped',
        'before_reliability_percent', c.before_reliability_percent,
        'after_reliability_percent', c.after_reliability_percent,
        'after_confirmed_groups', c.after_confirmed_groups,
        'calculation_revision', c.calculation_revision, 'recalculated', c.revision_count > 1)
    from public.rating_current_calculations(p_user_id, p_revision) c
  union all
  select 'adjustment'::text, a.boundary_played_at, a.boundary_group_id, a.id, s.display_level, a.effective_at,
      pg_catalog.jsonb_build_object(
        'kind', 'adjustment',
        'adjustment_id', a.id, 'level_review_request_id', a.level_review_request_id,
        'event_type', a.event_type, 'effective_at', public.rating_utc_text(a.effective_at),
        'reason', a.reason, 'outcome', 'approved',
        'before_display_level', a.before_display_level, 'after_display_level', a.after_display_level,
        'before_reliability_percent', a.before_reliability_percent,
        'after_reliability_percent', a.after_reliability_percent,
        'reliability_changed', a.before_reliability_percent <> a.after_reliability_percent,
        'after_confirmed_groups', a.after_confirmed_groups,
        'calculation_revision', s.projection_revision)
    from public.player_rating_admin_adjustments a
    cross join lateral (select k.* from public.player_rating_adjustment_states k
        where k.adjustment_id = a.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) s
   where a.user_id = p_user_id and a.projection_revision <= p_revision;
$$;
revoke all on function public.rating_timeline_items(uuid, bigint) from public, anon, authenticated, service_role;

-- Summary at a revision = state after the chronologically last visible stream item.
create or replace function public.rating_summary_at(p_user_id uuid, p_revision bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.global_player_ratings%rowtype; v_last record; v_cp record; v_count bigint; v_checkpoint_last boolean := false;
begin
  select * into v_row from public.global_player_ratings r where r.user_id = p_user_id;
  if not found then return null; end if;
  select pg_catalog.count(*) into v_count from public.rating_current_calculations(p_user_id, p_revision);
  if v_count > 0 then
    select * into v_last from public.rating_current_calculations(p_user_id, p_revision) c
     order by c.played_at desc, c.game_group_id desc limit 1;
  end if;
  select a.boundary_played_at, a.boundary_group_id, s.display_level, s.highest_display_level,
      s.reliability_percent, s.last_rating_at, s.rating_engine, s.rating_engine_version, s.rating_config_version
    into v_cp
    from public.player_rating_admin_adjustments a
    cross join lateral (select k.* from public.player_rating_adjustment_states k
        where k.adjustment_id = a.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) s
   where a.user_id = p_user_id and a.projection_revision <= p_revision
   order by a.boundary_played_at desc, a.boundary_group_id desc limit 1;
  if v_cp.display_level is not null then
    if v_count = 0 then
      v_checkpoint_last := true;
    else
      v_checkpoint_last := (v_cp.boundary_played_at, v_cp.boundary_group_id) > (v_last.played_at, v_last.game_group_id);
    end if;
  end if;
  if v_checkpoint_last then
    return pg_catalog.jsonb_build_object(
      'initial_display_level', v_row.initial_display_level, 'display_level', v_cp.display_level,
      'highest_display_level', v_cp.highest_display_level, 'reliability_percent', v_cp.reliability_percent,
      'confirmed_competitive_game_groups', v_count,
      'last_rating_at', public.rating_utc_text(v_cp.last_rating_at),
      'rating_engine', v_cp.rating_engine, 'rating_engine_version', v_cp.rating_engine_version,
      'rating_config_version', v_cp.rating_config_version);
  end if;
  if v_count = 0 then
    return pg_catalog.jsonb_build_object(
      'initial_display_level', v_row.initial_display_level, 'display_level', v_row.initial_display_level,
      'highest_display_level', v_row.initial_display_level, 'reliability_percent', 10,
      'confirmed_competitive_game_groups', 0, 'last_rating_at', null,
      'rating_engine', v_row.rating_engine, 'rating_engine_version', v_row.rating_engine_version,
      'rating_config_version', v_row.rating_config_version);
  end if;
  return pg_catalog.jsonb_build_object(
    'initial_display_level', v_row.initial_display_level, 'display_level', v_last.after_display_level,
    'highest_display_level', v_last.after_highest_display_level,
    'reliability_percent', v_last.after_reliability_percent,
    'confirmed_competitive_game_groups', v_count,
    'last_rating_at', public.rating_utc_text(v_last.last_rating_at),
    'rating_engine', v_last.rating_engine, 'rating_engine_version', v_last.rating_engine_version,
    'rating_config_version', v_last.rating_config_version);
end $$;

-- Own history, newest first over the merged timeline. Keyset = (sort time, sort id) of the
-- last returned item; total_events stays the MATCH count.
create or replace function public.get_my_rating_history(p_limit integer default 20, p_revision bigint default null,
  p_before_played_at timestamptz default null, p_before_game_group_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.rating_read_actor(); v_revision bigint; v_total bigint; v_items_total bigint; v_items jsonb;
  v_more boolean; v_last_at timestamptz; v_last_id uuid;
begin
  perform public.assert_actor_not_provisional();
  if p_limit is null or p_limit < 1 or p_limit > 50
    or (p_before_played_at is null) <> (p_before_game_group_id is null)
    or (p_before_played_at is not null and p_revision is null) then
    raise exception using errcode = '22023', message = 'RATING_HISTORY_INVALID_ARGUMENT';
  end if;
  v_revision := public.rating_committed_revision();
  perform public.rating_read_assert_revision(p_revision, v_revision);
  select pg_catalog.count(*) filter (where t.kind = 'match'), pg_catalog.count(*)
    into v_total, v_items_total from public.rating_timeline_items(v_uid, v_revision) t;

  with page as (
    select t.* from public.rating_timeline_items(v_uid, v_revision) t
     where p_before_played_at is null or (t.sort_at, t.sort_id) < (p_before_played_at, p_before_game_group_id)
     order by t.sort_at desc, t.sort_id desc
     limit p_limit + 1
  ), numbered as (
    select p.*, pg_catalog.row_number() over (order by p.sort_at desc, p.sort_id desc) as rn from page p
  )
  select coalesce(pg_catalog.jsonb_agg(n.dto order by n.rn) filter (where n.rn <= p_limit), '[]'::jsonb),
      pg_catalog.count(*) > p_limit,
      (pg_catalog.array_agg(n.sort_at order by n.rn) filter (where n.rn = p_limit))[1],
      (pg_catalog.array_agg(n.sort_id order by n.rn) filter (where n.rn = p_limit))[1]
    into v_items, v_more, v_last_at, v_last_id
    from numbered n;

  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'state', case when v_items_total = 0 then 'empty' else 'ready' end,
    'total_events', v_total,
    'items', v_items,
    'next_cursor', case when v_more then pg_catalog.jsonb_build_object(
      'played_at', public.rating_utc_text(v_last_at), 'game_group_id', v_last_id) else null end);
end $$;

-- Own progress: lifetime, chronological, bounded; adjustment checkpoints are first-class points.
create or replace function public.get_my_rating_progress(p_max_points integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.rating_read_actor(); v_revision bigint; v_total bigint; v_points jsonb;
  v_summary jsonb; v_first timestamptz; v_last timestamptz; v_matches bigint;
begin
  perform public.assert_actor_not_provisional();
  if p_max_points is null or p_max_points < 2 or p_max_points > 120 then
    raise exception using errcode = '22023', message = 'RATING_PROGRESS_INVALID_ARGUMENT';
  end if;
  v_revision := public.rating_committed_revision();
  v_summary := public.rating_summary_at(v_uid, v_revision);
  if v_summary is null then
    return pg_catalog.jsonb_build_object('revision', v_revision, 'state', 'unavailable', 'scope', 'lifetime',
      'resolution', 'event', 'abbreviated', false, 'total_events', 0, 'total_points', 0, 'baseline', null,
      'range', null, 'points', '[]'::jsonb);
  end if;
  with ordered as (
    select t.kind, t.item_id, t.sort_at, t.effective_at, t.display_level,
        pg_catalog.row_number() over (order by t.sort_at, t.sort_id) as rn,
        pg_catalog.count(*) over () as n
      from public.rating_timeline_items(v_uid, v_revision) t
  ), picked as (
    select o.* from ordered o
     where o.n <= p_max_points
        or o.rn in (select 1 + pg_catalog.round(k * (o.n - 1)::numeric / (p_max_points - 1))::bigint
                      from pg_catalog.generate_series(0, p_max_points - 1) k)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ordinal', p.rn, 'kind', p.kind, 'event_id', p.item_id,
        'game_group_id', case when p.kind = 'match' then p.item_id end,
        'played_at', public.rating_utc_text(p.effective_at),
        'display_level', p.display_level) order by p.rn), '[]'::jsonb),
      coalesce(pg_catalog.max(p.n), 0), pg_catalog.min(p.effective_at), pg_catalog.max(p.effective_at)
    into v_points, v_total, v_first, v_last
    from picked p;
  select pg_catalog.count(*) into v_matches from public.rating_current_calculations(v_uid, v_revision);
  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'state', case when v_total = 0 then 'empty' else 'ready' end,
    'scope', 'lifetime',
    'resolution', case when v_total > p_max_points then 'sampled' else 'event' end,
    'abbreviated', v_total > p_max_points,
    'total_events', v_matches,
    'total_points', v_total,
    'baseline', pg_catalog.jsonb_build_object('display_level', v_summary -> 'initial_display_level'),
    'range', case when v_total = 0 then null else pg_catalog.jsonb_build_object(
      'from', public.rating_utc_text(v_first), 'to', public.rating_utc_text(v_last)) end,
    'points', v_points);
end $$;

commit;
