begin;

-- PAF-148 / T14.2 (1/4): versioned rating kernel for exception-bearing streams.
--
-- Engine app-wide-level / 1.0.0 stays exactly as shipped (strict reliability curve
-- min(100, 10 + 6n), unchanged arithmetic and evidence). A recorded administrative reliability
-- exception (reset or reduction approved through a level review) takes the stream OFF that
-- curve while the real confirmed-group count keeps counting. Such streams use 1.1.0:
--   * identical score, expected-outcome, K(r), rounding and clamping arithmetic;
--   * sigma stays 1;
--   * reliability after a group = min(100, reliability before + 6), i.e. six points from the
--     EFFECTIVE reliability instead of from the curve.
-- 1.1.0 is only ever stamped on a group when one of its four players carries a recorded
-- exception, so unadjusted streams keep producing byte-identical 1.0.0 evidence.

create function public.rating_v1_exception_supports(p_engine text, p_engine_version text, p_config_version integer)
returns boolean language sql immutable set search_path = '' as $$
  select p_engine = 'app-wide-level' and p_engine_version = '1.1.0' and p_config_version = 1;
$$;

-- The original kernel is retained untouched under a curve-specific name; the public name
-- becomes a pure version dispatcher with the identical signature and output columns.
alter function public.rating_v1_calculate_group(text, text, integer, jsonb)
  rename to rating_v1_calculate_group_curve;

create function public.rating_v1_calculate_group_exception(p_engine text, p_engine_version text,
  p_config_version integer, p_inputs jsonb)
returns table (
  ordinal smallint, user_id uuid, team text,
  own_team_strength numeric, opponent_team_strength numeric, expected_score numeric, outcome_value numeric,
  reliability_factor numeric, raw_delta numeric, rounded_delta numeric, applied_delta numeric, clamped boolean,
  before_mu numeric, before_sigma numeric, before_display_level numeric, before_reliability_percent smallint,
  before_confirmed_groups integer, before_highest_display_level numeric,
  after_mu numeric, after_sigma numeric, after_display_level numeric, after_reliability_percent smallint,
  after_confirmed_groups integer, after_highest_display_level numeric,
  last_rating_at timestamptz, rating_engine text, rating_engine_version text, rating_config_version integer)
language plpgsql immutable set search_path = '' as $$
declare
  v_played_at timestamptz;
begin
  if not public.rating_v1_exception_supports(p_engine, p_engine_version, p_config_version) then
    raise exception using errcode = '22023', message = 'RATING_ENGINE_UNSUPPORTED';
  end if;
  if not public.player_rating_calculation_inputs_valid(p_inputs) then
    raise exception using errcode = '22023', message = 'RATING_INPUT_INVALID';
  end if;
  -- Same state rules as 1.0.0 except reliability: any whole 0-100 percent is a legal starting
  -- point (it is only reachable through a recorded exception).
  if exists (
    select 1 from pg_catalog.jsonb_each(p_inputs -> 'states') s,
      lateral (select (s.value ->> 'mu')::numeric mu, (s.value ->> 'display_level')::numeric display_level,
        (s.value ->> 'highest_display_level')::numeric highest, (s.value ->> 'sigma')::numeric sigma,
        (s.value ->> 'reliability_percent')::numeric reliability,
        (s.value ->> 'confirmed_competitive_game_groups')::numeric n) v
    where v.mu not between 0 and 7 or v.mu <> pg_catalog.round(v.mu, 2) or v.display_level <> v.mu
      or v.highest not between v.mu and 7 or v.highest <> pg_catalog.round(v.highest, 2) or v.sigma <> 1
      or v.n < 0 or v.n <> pg_catalog.trunc(v.n) or v.n > 2147483647
      or v.reliability not between 0 and 100 or v.reliability <> pg_catalog.trunc(v.reliability)) then
    raise exception using errcode = '22023', message = 'RATING_INPUT_INVALID';
  end if;
  begin
    v_played_at := (p_inputs ->> 'played_at')::timestamptz;
  exception when others then
    raise exception using errcode = '22023', message = 'RATING_INPUT_INVALID';
  end;

  return query
  with member as (
    select v.ordinal, v.team, v.uid, (p_inputs -> 'states' -> v.uid ->> 'mu')::numeric as mu,
        (p_inputs -> 'states' -> v.uid ->> 'highest_display_level')::numeric as highest,
        (p_inputs -> 'states' -> v.uid ->> 'reliability_percent')::numeric as reliability,
        (p_inputs -> 'states' -> v.uid ->> 'confirmed_competitive_game_groups')::integer as n
      from (values
        (1, 'team_a', p_inputs -> 'teams' -> 'team_a' ->> 0), (2, 'team_a', p_inputs -> 'teams' -> 'team_a' ->> 1),
        (3, 'team_b', p_inputs -> 'teams' -> 'team_b' ->> 0), (4, 'team_b', p_inputs -> 'teams' -> 'team_b' ->> 1)
      ) v(ordinal, team, uid)
  ), strength as (
    select m.team, pg_catalog.sum(m.mu) / 2 as s from member m group by m.team
  ), expected as (
    select o.team, 1 / (1 + pg_catalog.power(10::numeric, (opp.s - o.s) / 2.0)) as e
      from strength o join strength opp on opp.team <> o.team
  ), step as (
    select m.*, own.s as own_s, opp.s as opp_s, ex.e,
        case p_inputs ->> 'classification'
          when 'draw' then 0.5
          when m.team then 1.0
          else 0.0 end as outcome,
        (6000 - 45 * m.reliability) / 20000 as k
      from member m
      join strength own on own.team = m.team
      join strength opp on opp.team <> m.team
      join expected ex on ex.team = m.team
  ), delta as (
    select st.*, st.k * (st.outcome - st.e) as raw from step st
  ), applied as (
    select d.*, pg_catalog.round(d.raw, 2) as rounded,
        pg_catalog.round(least(7.00, greatest(0.00, d.mu + pg_catalog.round(d.raw, 2))), 2) as mu_after
      from delta d
  )
  select a.ordinal::smallint, a.uid::uuid, a.team,
      pg_catalog.round(a.own_s, 3), pg_catalog.round(a.opp_s, 3), a.e, a.outcome::numeric, a.k, a.raw, a.rounded,
      a.mu_after - a.mu, a.mu + a.rounded <> a.mu_after,
      a.mu, 1.00::numeric, a.mu, a.reliability::smallint, a.n, a.highest,
      a.mu_after, 1.00::numeric, a.mu_after, least(100, a.reliability + 6)::smallint, a.n + 1,
      greatest(a.highest, a.mu_after),
      v_played_at, p_engine, p_engine_version, p_config_version
    from applied a order by a.ordinal;
end $$;

create function public.rating_v1_calculate_group(p_engine text, p_engine_version text, p_config_version integer,
  p_inputs jsonb)
returns table (
  ordinal smallint, user_id uuid, team text,
  own_team_strength numeric, opponent_team_strength numeric, expected_score numeric, outcome_value numeric,
  reliability_factor numeric, raw_delta numeric, rounded_delta numeric, applied_delta numeric, clamped boolean,
  before_mu numeric, before_sigma numeric, before_display_level numeric, before_reliability_percent smallint,
  before_confirmed_groups integer, before_highest_display_level numeric,
  after_mu numeric, after_sigma numeric, after_display_level numeric, after_reliability_percent smallint,
  after_confirmed_groups integer, after_highest_display_level numeric,
  last_rating_at timestamptz, rating_engine text, rating_engine_version text, rating_config_version integer)
language plpgsql immutable set search_path = '' as $$
begin
  if public.rating_v1_exception_supports(p_engine, p_engine_version, p_config_version) then
    return query select * from public.rating_v1_calculate_group_exception(p_engine, p_engine_version, p_config_version, p_inputs);
  else
    -- 1.0.0 (and fail-closed rejection of every other tuple) stays in the original kernel.
    return query select * from public.rating_v1_calculate_group_curve(p_engine, p_engine_version, p_config_version, p_inputs);
  end if;
end $$;

revoke all on function public.rating_v1_exception_supports(text, text, integer),
  public.rating_v1_calculate_group_curve(text, text, integer, jsonb),
  public.rating_v1_calculate_group_exception(text, text, integer, jsonb),
  public.rating_v1_calculate_group(text, text, integer, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.rating_v1_calculate_group(text, text, integer, jsonb) is
  'Pure V1 rating kernel dispatcher: 1.0.0 (strict reliability curve) or 1.1.0 (recorded reliability exception). Four frozen pre-group states in, four calculated outcomes out. No writes, no wall clock.';
comment on function public.rating_v1_calculate_group_curve(text, text, integer, jsonb) is
  'Original 1.0.0 kernel, unchanged.';
comment on function public.rating_v1_calculate_group_exception(text, text, integer, jsonb) is
  '1.1.0 kernel: identical arithmetic, reliability after = min(100, before + 6) from the effective reliability.';

-- State constraints for the new version only; unadjusted 1.0.0 rows stay strictly on the curve.
alter table public.global_player_ratings
  add constraint global_player_ratings_exception_state check (
    rating_engine <> 'app-wide-level' or rating_engine_version <> '1.1.0' or sigma = 1.00);
alter table public.player_rating_event_calculations
  add constraint player_rating_calculation_exception_state check (
    rating_engine <> 'app-wide-level' or rating_engine_version <> '1.1.0'
    or (before_sigma = 1.00 and after_sigma = 1.00
      and after_reliability_percent = least(100, before_reliability_percent + 6)));

commit;
