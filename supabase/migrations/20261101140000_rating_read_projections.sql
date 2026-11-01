begin;

-- PAF-10 / U4: authorized sporting-data readers over committed rating projections.
--
-- Contract (see docs/plan/Plan PAF-10 T10, "Privacy" and U4):
--   * Every reader is a SECURITY DEFINER DTO RPC with an empty search_path that asserts the
--     actor first (authenticated, non-anonymous, not a provisional/revoked actor) and builds
--     its answer from an explicit key whitelist. Raw ledger tables, inviter/provenance
--     columns, claim data and the stored explanation payload are never passed through.
--   * Own summary/history/progress cross communities (the owner is the subject). A group
--     explanation or per-event rating summary is only readable under the existing result
--     reader rights (event creator, community admin, accepted registrant) or by a player
--     of that very group. Unknown and unauthorized groups fail identically, so a guessed
--     UUID is no existence oracle. Nothing here widens owner-only profile table policies.
--   * Every answer is computed at ONE committed projection revision: the control row is read
--     first and only calculations at/before it are used (latest per event), so a concurrent
--     replay can never mix old explanations with new summaries. A caller that carries a
--     revision (cursor, drill-down) gets RATING_REVISION_STALE on mismatch and restarts.
--   * Auth failures raise; they are never reported as an empty history.

-- 1. Internal helpers (no runtime grants).
create function public.rating_committed_revision() returns bigint
language sql stable security definer set search_path = '' as $$
  select c.committed_revision from public.player_rating_projection_control c;
$$;

-- Actor gate shared by every reader. assert_actor_not_provisional is also invoked inline
-- by each reader so the provisional-guard inventory test sees it in every entry point.
create function public.rating_read_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'true' then
    raise exception using errcode = '28000', message = 'RATING_UNAUTHENTICATED';
  end if;
  return v_uid;
end $$;

create function public.rating_read_assert_revision(p_revision bigint, p_committed bigint) returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if p_revision is not null and p_revision <> p_committed then
    raise exception using errcode = 'P0001', message = 'RATING_REVISION_STALE';
  end if;
end $$;

-- Existing result-reader rights plus play in the event itself.
create function public.rating_can_view_match_event(p_match_event_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.match_events e
     where e.id = p_match_event_id
       and (e.created_by = p_viewer
         or public.is_community_admin(e.community_id)
         or exists (select 1 from public.match_event_registrations r
              where r.match_event_id = e.id and r.user_id = p_viewer
                and r.lifecycle = 'accepted' and r.cancelled_at is null)
         or exists (select 1 from public.player_rating_events pe
              where pe.match_event_id = e.id and pe.user_id = p_viewer)));
$$;

-- Current calculation per event at a revision: the latest calc at/before it. Events whose
-- first calculation is newer than the revision are not visible at that revision.
create function public.rating_current_calculations(p_user_id uuid, p_revision bigint)
returns table (
  rating_event_id uuid, game_group_id uuid, match_event_id uuid, game_group_number bigint,
  played_at timestamptz, calculation_revision bigint, revision_count bigint,
  rating_engine text, rating_engine_version text, rating_config_version integer,
  before_display_level numeric, after_display_level numeric,
  before_reliability_percent smallint, after_reliability_percent smallint,
  before_confirmed_groups integer, after_confirmed_groups integer,
  before_highest_display_level numeric, after_highest_display_level numeric,
  last_rating_at timestamptz, inputs jsonb, explanation jsonb)
language sql stable security definer set search_path = '' as $$
  select e.id, e.game_group_id, e.match_event_id, e.game_group_number, e.played_at,
      c.projection_revision,
      (select pg_catalog.count(*) from public.player_rating_event_calculations a
        where a.rating_event_id = e.id and a.projection_revision <= p_revision),
      c.rating_engine, c.rating_engine_version, c.rating_config_version,
      c.before_display_level, c.after_display_level,
      c.before_reliability_percent, c.after_reliability_percent,
      c.before_confirmed_groups, c.after_confirmed_groups,
      c.before_highest_display_level, c.after_highest_display_level,
      c.last_rating_at, c.inputs, c.explanation
    from public.player_rating_events e
    cross join lateral (select k.* from public.player_rating_event_calculations k
        where k.rating_event_id = e.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) c
   where e.user_id = p_user_id;
$$;

create function public.rating_utc_text(p_instant timestamptz) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.to_char(p_instant at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- Summary at a revision, derived from the ledger so it always agrees with the history
-- served at the same revision. A player with no visible event is at the initial level.
create function public.rating_summary_at(p_user_id uuid, p_revision bigint) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.global_player_ratings%rowtype; v_last record; v_count bigint;
begin
  select * into v_row from public.global_player_ratings r where r.user_id = p_user_id;
  if not found then return null; end if;
  select pg_catalog.count(*) into v_count from public.rating_current_calculations(p_user_id, p_revision);
  if v_count = 0 then
    return pg_catalog.jsonb_build_object(
      'initial_display_level', v_row.initial_display_level, 'display_level', v_row.initial_display_level,
      'highest_display_level', v_row.initial_display_level, 'reliability_percent', 10,
      'confirmed_competitive_game_groups', 0, 'last_rating_at', null,
      'rating_engine', v_row.rating_engine, 'rating_engine_version', v_row.rating_engine_version,
      'rating_config_version', v_row.rating_config_version);
  end if;
  select * into v_last from public.rating_current_calculations(p_user_id, p_revision) c
   order by c.played_at desc, c.game_group_id desc limit 1;
  return pg_catalog.jsonb_build_object(
    'initial_display_level', v_row.initial_display_level, 'display_level', v_last.after_display_level,
    'highest_display_level', v_last.after_highest_display_level,
    'reliability_percent', v_last.after_reliability_percent,
    'confirmed_competitive_game_groups', v_count,
    'last_rating_at', public.rating_utc_text(v_last.last_rating_at),
    'rating_engine', v_last.rating_engine, 'rating_engine_version', v_last.rating_engine_version,
    'rating_config_version', v_last.rating_config_version);
end $$;

-- 2. Own summary: committed revision + state. 'unavailable' = no rating row yet
-- (not onboarded); 'empty' = rated player with no confirmed group; 'ready' otherwise.
create function public.get_my_rating_summary() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.rating_read_actor(); v_revision bigint; v_summary jsonb;
begin
  perform public.assert_actor_not_provisional();
  v_revision := public.rating_committed_revision();
  v_summary := public.rating_summary_at(v_uid, v_revision);
  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'state', case when v_summary is null then 'unavailable'
      when (v_summary ->> 'confirmed_competitive_game_groups')::integer = 0 then 'empty' else 'ready' end,
    'summary', v_summary);
end $$;

-- 3. Own history, newest first, keyset (played_at, game_group_id) descending. The cursor
-- is (revision, played_at, group id); a revision that is no longer the committed one is
-- rejected so the client restarts instead of splicing pages from two projections.
create function public.get_my_rating_history(p_limit integer default 20, p_revision bigint default null,
  p_before_played_at timestamptz default null, p_before_game_group_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.rating_read_actor(); v_revision bigint; v_total bigint; v_items jsonb; v_more boolean;
  v_last_at timestamptz; v_last_group uuid; v_rows integer;
begin
  perform public.assert_actor_not_provisional();
  if p_limit is null or p_limit < 1 or p_limit > 50
    or (p_before_played_at is null) <> (p_before_game_group_id is null)
    or (p_before_played_at is not null and p_revision is null) then
    raise exception using errcode = '22023', message = 'RATING_HISTORY_INVALID_ARGUMENT';
  end if;
  v_revision := public.rating_committed_revision();
  perform public.rating_read_assert_revision(p_revision, v_revision);
  select pg_catalog.count(*) into v_total from public.rating_current_calculations(v_uid, v_revision);

  with page as (
    select c.* from public.rating_current_calculations(v_uid, v_revision) c
     where p_before_played_at is null or (c.played_at, c.game_group_id) < (p_before_played_at, p_before_game_group_id)
     order by c.played_at desc, c.game_group_id desc
     limit p_limit + 1
  ), numbered as (
    select p.*, pg_catalog.row_number() over (order by p.played_at desc, p.game_group_id desc) as rn from page p
  )
  select
      coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'game_group_id', n.game_group_id, 'match_event_id', n.match_event_id,
        'game_group_number', n.game_group_number, 'played_at', public.rating_utc_text(n.played_at),
        'classification', n.inputs ->> 'classification', 'team', n.explanation ->> 'team',
        'outcome_value', n.explanation -> 'outcome_value', 'expected_score', n.explanation -> 'expected_score',
        'before_display_level', n.before_display_level, 'after_display_level', n.after_display_level,
        'applied_delta', n.explanation -> 'applied_delta', 'clamped', n.explanation -> 'clamped',
        'before_reliability_percent', n.before_reliability_percent,
        'after_reliability_percent', n.after_reliability_percent,
        'after_confirmed_groups', n.after_confirmed_groups,
        'calculation_revision', n.calculation_revision, 'recalculated', n.revision_count > 1)
        order by n.rn) filter (where n.rn <= p_limit), '[]'::jsonb),
      pg_catalog.count(*) > p_limit,
      pg_catalog.count(*)::integer
    into v_items, v_more, v_rows
    from numbered n;

  if v_more then
    select x.played_at, x.game_group_id into v_last_at, v_last_group
      from public.rating_current_calculations(v_uid, v_revision) x
     where (p_before_played_at is null or (x.played_at, x.game_group_id) < (p_before_played_at, p_before_game_group_id))
     order by x.played_at desc, x.game_group_id desc
     offset p_limit - 1 limit 1;
  end if;
  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'state', case when v_total = 0 then 'empty' else 'ready' end,
    'total_events', v_total,
    'items', v_items,
    'next_cursor', case when v_more then pg_catalog.jsonb_build_object(
      'played_at', public.rating_utc_text(v_last_at), 'game_group_id', v_last_group) else null end);
end $$;

-- 4. Own progress for the chart: lifetime, chronological, bounded. The first and last
-- events are always kept; beyond p_max_points the middle is evenly sampled and the answer
-- says so (resolution 'sampled', abbreviated true). Never a paged tail pretending to be
-- lifetime progress. The baseline is the effective starting level.
create function public.get_my_rating_progress(p_max_points integer default 60) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.rating_read_actor(); v_revision bigint; v_total bigint; v_points jsonb;
  v_summary jsonb; v_first timestamptz; v_last timestamptz;
begin
  perform public.assert_actor_not_provisional();
  if p_max_points is null or p_max_points < 2 or p_max_points > 120 then
    raise exception using errcode = '22023', message = 'RATING_PROGRESS_INVALID_ARGUMENT';
  end if;
  v_revision := public.rating_committed_revision();
  v_summary := public.rating_summary_at(v_uid, v_revision);
  if v_summary is null then
    return pg_catalog.jsonb_build_object('revision', v_revision, 'state', 'unavailable', 'scope', 'lifetime',
      'resolution', 'event', 'abbreviated', false, 'total_events', 0, 'baseline', null, 'range', null,
      'points', '[]'::jsonb);
  end if;
  with ordered as (
    select c.game_group_id, c.played_at, c.after_display_level,
        pg_catalog.row_number() over (order by c.played_at, c.game_group_id) as rn,
        pg_catalog.count(*) over () as n
      from public.rating_current_calculations(v_uid, v_revision) c
  ), picked as (
    select o.* from ordered o
     where o.n <= p_max_points
        or o.rn in (select 1 + pg_catalog.round(k * (o.n - 1)::numeric / (p_max_points - 1))::bigint
                      from pg_catalog.generate_series(0, p_max_points - 1) k)
  )
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'ordinal', p.rn, 'game_group_id', p.game_group_id, 'played_at', public.rating_utc_text(p.played_at),
        'display_level', p.after_display_level) order by p.rn), '[]'::jsonb),
      coalesce(pg_catalog.max(p.n), 0), pg_catalog.min(p.played_at), pg_catalog.max(p.played_at)
    into v_points, v_total, v_first, v_last
    from picked p;
  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'state', case when v_total = 0 then 'empty' else 'ready' end,
    'scope', 'lifetime',
    'resolution', case when v_total > p_max_points then 'sampled' else 'event' end,
    'abbreviated', v_total > p_max_points,
    'total_events', v_total,
    'baseline', pg_catalog.jsonb_build_object('display_level', v_summary -> 'initial_display_level'),
    'range', case when v_total = 0 then null else pg_catalog.jsonb_build_object(
      'from', public.rating_utc_text(v_first), 'to', public.rating_utc_text(v_last)) end,
    'points', v_points);
end $$;

-- 5. Authorized group explanation: all four players of one confirmed group with the
-- CURRENT stored calculation. Names and the current provisional flag come from the profile
-- through this definer join only; no inviter, email, bio or claim data is selected.
create function public.get_rating_group_explanation(p_game_group_id uuid, p_revision bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.rating_read_actor(); v_revision bigint; v_event_id uuid; v_players jsonb;
  v_count integer; v_head record;
begin
  perform public.assert_actor_not_provisional();
  if p_game_group_id is null then
    raise exception using errcode = '22023', message = 'RATING_EXPLANATION_INVALID_ARGUMENT';
  end if;
  select e.match_event_id into v_event_id from public.player_rating_events e
   where e.game_group_id = p_game_group_id limit 1;
  if v_event_id is null or not public.rating_can_view_match_event(v_event_id, v_uid) then
    raise exception using errcode = '42501', message = 'RATING_EXPLANATION_FORBIDDEN';
  end if;
  v_revision := public.rating_committed_revision();
  perform public.rating_read_assert_revision(p_revision, v_revision);

  with calc as (
    select e.user_id, c.*
      from public.player_rating_events e
      cross join lateral (select k.* from public.player_rating_event_calculations k
          where k.rating_event_id = e.id and k.projection_revision <= v_revision
          order by k.projection_revision desc limit 1) c
     where e.game_group_id = p_game_group_id
  )
  select pg_catalog.count(*)::integer,
      pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', c.user_id, 'display_name', p.display_name, 'is_provisional', p.is_provisional,
        'team', c.explanation ->> 'team',
        'calculation_revision', c.projection_revision,
        'recalculated', (select pg_catalog.count(*) from public.player_rating_event_calculations a
            where a.rating_event_id = c.rating_event_id and a.projection_revision <= v_revision) > 1,
        'engine', c.rating_engine, 'engine_version', c.rating_engine_version, 'config_version', c.rating_config_version,
        'before_display_level', c.before_display_level, 'after_display_level', c.after_display_level,
        'before_reliability_percent', c.before_reliability_percent,
        'after_reliability_percent', c.after_reliability_percent,
        'before_confirmed_groups', c.before_confirmed_groups, 'after_confirmed_groups', c.after_confirmed_groups,
        'own_team_strength', c.explanation -> 'own_team_strength',
        'opponent_team_strength', c.explanation -> 'opponent_team_strength',
        'expected_score', c.explanation -> 'expected_score', 'outcome_value', c.explanation -> 'outcome_value',
        'reliability_factor', c.explanation -> 'reliability_factor', 'raw_delta', c.explanation -> 'raw_delta',
        'rounded_delta', c.explanation -> 'rounded_delta', 'applied_delta', c.explanation -> 'applied_delta',
        'clamped', c.explanation -> 'clamped')
        order by c.explanation ->> 'team', c.explanation -> 'ordinal', c.user_id)
    into v_count, v_players
    from calc c join public.player_profiles p on p.user_id = c.user_id;
  if v_count is distinct from 4 then
    raise exception using errcode = 'P0001', message = 'RATING_EXPLANATION_UNAVAILABLE';
  end if;

  select e.match_event_id, e.game_group_number, e.played_at into v_head
    from public.player_rating_events e where e.game_group_id = p_game_group_id limit 1;
  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'game_group_id', p_game_group_id,
    'match_event_id', v_head.match_event_id,
    'game_group_number', v_head.game_group_number,
    'played_at', public.rating_utc_text(v_head.played_at),
    'players', v_players);
end $$;

-- 6. Per-event rating changes for result screens: one compact row per played participant
-- of each rated group of the event. Same rights as the official result reader (plus the
-- players themselves); the full numeric explanation stays behind get_rating_group_explanation.
create function public.get_match_event_rating_changes(p_match_event_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.rating_read_actor(); v_revision bigint; v_groups jsonb;
begin
  perform public.assert_actor_not_provisional();
  if p_match_event_id is null or not public.rating_can_view_match_event(p_match_event_id, v_uid) then
    raise exception using errcode = '42501', message = 'RATING_EXPLANATION_FORBIDDEN';
  end if;
  v_revision := public.rating_committed_revision();
  select coalesce(pg_catalog.jsonb_agg(g.item order by g.group_number), '[]'::jsonb) into v_groups
    from (
      select e.game_group_number as group_number,
        pg_catalog.jsonb_build_object(
          'game_group_id', e.game_group_id, 'game_group_number', e.game_group_number,
          'played_at', public.rating_utc_text(pg_catalog.min(e.played_at)),
          'players', pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'user_id', e.user_id, 'display_name', p.display_name, 'is_provisional', p.is_provisional,
            'team', c.explanation ->> 'team',
            'before_display_level', c.before_display_level, 'after_display_level', c.after_display_level,
            'before_reliability_percent', c.before_reliability_percent,
            'after_reliability_percent', c.after_reliability_percent,
            'applied_delta', c.explanation -> 'applied_delta', 'clamped', c.explanation -> 'clamped')
            order by c.explanation ->> 'team', c.explanation -> 'ordinal', e.user_id)) as item
        from public.player_rating_events e
        join public.player_profiles p on p.user_id = e.user_id
        cross join lateral (select k.* from public.player_rating_event_calculations k
            where k.rating_event_id = e.id and k.projection_revision <= v_revision
            order by k.projection_revision desc limit 1) c
       where e.match_event_id = p_match_event_id
       group by e.game_group_id, e.game_group_number
      having pg_catalog.count(*) = 4
    ) g;
  return pg_catalog.jsonb_build_object('revision', v_revision, 'match_event_id', p_match_event_id,
    'groups', v_groups);
end $$;

-- 7. Grants: only the five DTO readers are callable by signed-in users.
revoke all on function public.rating_committed_revision(), public.rating_read_actor(),
  public.rating_read_assert_revision(bigint, bigint), public.rating_can_view_match_event(uuid, uuid),
  public.rating_current_calculations(uuid, bigint), public.rating_utc_text(timestamptz),
  public.rating_summary_at(uuid, bigint), public.get_my_rating_summary(),
  public.get_my_rating_history(integer, bigint, timestamptz, uuid), public.get_my_rating_progress(integer),
  public.get_rating_group_explanation(uuid, bigint), public.get_match_event_rating_changes(uuid)
  from public, anon, authenticated, service_role;
grant execute on function public.get_my_rating_summary(),
  public.get_my_rating_history(integer, bigint, timestamptz, uuid), public.get_my_rating_progress(integer),
  public.get_rating_group_explanation(uuid, bigint), public.get_match_event_rating_changes(uuid)
  to authenticated;

commit;
