begin;

-- PAF-10 / U2: approved V1 rating kernel (docs/rating/v1-calibration.md).
--
-- One production implementation, pure and immutable: no table access, no writes, no
-- wall clock. The projector (later unit) feeds it the four frozen pre-group states and
-- persists the returned rows. Engine app-wide-level / 1.0.0 / configuration 1 only;
-- every other tuple fails closed.
--
-- Arithmetic is exact `numeric` throughout: E = 1 / (1 + power(10, (S_opp - S_own) / 2)),
-- K(r) = (6000 - 45 r) / 20000 with r = reliability BEFORE the group, one rounding of the
-- delta (numeric round = half away from zero), then clamp to [0, 7]. Both team strengths
-- and expected outcomes are computed once, before any player is updated. Score margin,
-- provisional flag, community and League metrics are not inputs.

create function public.rating_v1_supports(p_engine text, p_engine_version text, p_config_version integer)
returns boolean language sql immutable set search_path = '' as $$
  select p_engine = 'app-wide-level' and p_engine_version = '1.0.0' and p_config_version = 1;
$$;

-- Ratable = competitive, confirmed, decisive or drawn. Anything else has zero effect:
-- no calculation, no event, no state change.
create function public.rating_v1_is_ratable(p_match_type text, p_classification text, p_result_status text)
returns boolean language sql immutable set search_path = '' as $$
  select coalesce(p_match_type = 'competitive' and p_result_status = 'confirmed'
    and p_classification in ('team_a', 'team_b', 'draw'), false);
$$;

-- p_inputs uses the ledger's frozen-input shape (classification, played_at, teams, states).
-- Returns the four players in team_a[0], team_a[1], team_b[0], team_b[1] order.
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
declare
  v_played_at timestamptz;
begin
  if not public.rating_v1_supports(p_engine, p_engine_version, p_config_version) then
    raise exception using errcode = '22023', message = 'RATING_ENGINE_UNSUPPORTED';
  end if;
  if not public.player_rating_calculation_inputs_valid(p_inputs) then
    raise exception using errcode = '22023', message = 'RATING_INPUT_INVALID';
  end if;
  -- V1 state rules: 0-7 two-decimal levels, display = mu, highest >= display, sigma 1,
  -- whole non-negative counts and reliability on the min(100, 10 + 6n) curve.
  if exists (
    select 1 from pg_catalog.jsonb_each(p_inputs -> 'states') s,
      lateral (select (s.value ->> 'mu')::numeric mu, (s.value ->> 'display_level')::numeric display_level,
        (s.value ->> 'highest_display_level')::numeric highest, (s.value ->> 'sigma')::numeric sigma,
        (s.value ->> 'reliability_percent')::numeric reliability,
        (s.value ->> 'confirmed_competitive_game_groups')::numeric n) v
    where v.mu not between 0 and 7 or v.mu <> pg_catalog.round(v.mu, 2) or v.display_level <> v.mu
      or v.highest not between v.mu and 7 or v.highest <> pg_catalog.round(v.highest, 2) or v.sigma <> 1
      or v.n < 0 or v.n <> pg_catalog.trunc(v.n) or v.n > 2147483647
      or v.reliability <> least(100, 10 + 6 * v.n)) then
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
      a.mu_after, 1.00::numeric, a.mu_after, least(100, 10 + 6 * (a.n + 1))::smallint, a.n + 1,
      greatest(a.highest, a.mu_after),
      v_played_at, p_engine, p_engine_version, p_config_version
    from applied a order by a.ordinal;
end $$;

revoke all on function public.rating_v1_supports(text, text, integer),
  public.rating_v1_is_ratable(text, text, text),
  public.rating_v1_calculate_group(text, text, integer, jsonb)
  from public, anon, authenticated, service_role;

comment on function public.rating_v1_calculate_group(text, text, integer, jsonb) is
  'Pure V1 rating kernel: four frozen pre-group states in, four calculated outcomes out. No writes, no wall clock.';

commit;
