begin;

-- PAF-13 / U5: scoped community statistics reader.
--
-- Contract (docs/plan/Plan PAF-13 T13, "Filter and authorization matrix" + PRD 38):
--   * One reader, get_community_statistics. Projection tables only (community/player/opponent
--     summaries and daily buckets); never the official-source or rebuild functions.
--   * Authorization BEFORE any summary read: a selected community requires the actor to be a current
--     active member (anything else fails identically with STATISTICS_NOT_FOUND).
--     Community insights require a selected community; subject-wide history uses subject readers.
--   * Each Game Group is counted once at community level (community subject rows), never as four
--     player contributions or two pair contributions. Leaders come from player/opponent summaries of
--     the same scope; ties keep every identity in id order (first ten listed, total reported).
--   * League scope = eligible bound groups only. Friendly + League has no eligible group, so the
--     reader answers with an empty result and a typed notice instead of coercing the type.
--   * Date ranges are whole UTC dates (both inclusive) over indexed daily buckets; lifetime reads
--     use summary lookups. Weeks are UTC ISO weeks (Monday), months are UTC calendar months.

create function public.statistics_community_top(
  p_rows jsonb, p_observed integer, p_required integer, p_reason text
) returns jsonb language sql stable security definer set search_path = '' as $$
  with r as (
    select (x ->> 'id')::uuid as id, (x ->> 'v')::numeric as v from pg_catalog.jsonb_array_elements(p_rows) x
  ), best as (select pg_catalog.max(r.v) as v from r),
  tied as (select r.id from r join best on r.v = best.v)
  select case when not exists (select 1 from tied) then pg_catalog.jsonb_build_object('state', 'insufficient',
      'value', null, 'numerator', null, 'denominator', null, 'observed', p_observed, 'required', p_required,
      'reason', p_reason)
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', null,
      'value', pg_catalog.jsonb_build_object('value', (select best.v from best),
        'total', (select pg_catalog.count(*) from tied),
        'players', (select pg_catalog.jsonb_agg(public.statistics_relationship_name(t.id) order by t.id)
          from (select tied.id from tied order by tied.id limit 10) t))) end;
$$;

-- Most frequent pair / matchup of a merged community relations object (ties keep every identity).
create function public.statistics_community_relation_top(p_relations jsonb, p_key text) returns jsonb
language sql stable security definer set search_path = '' as $$
  with r as (
    select e.key::uuid as id, (e.value ->> 'g')::integer as g
      from pg_catalog.jsonb_each(coalesce(p_relations -> p_key, '{}'::jsonb)) e
  ), best as (select pg_catalog.max(r.g) as g from r),
  tied as (select r.id from r join best on r.g = best.g)
  select case when not exists (select 1 from tied) then pg_catalog.jsonb_build_object('state', 'insufficient',
      'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1,
      'reason', 'no_applicable_result')
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', null,
      'value', pg_catalog.jsonb_build_object('groups', (select best.g from best),
        'total', (select pg_catalog.count(*) from tied),
        'items', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', t.id, 'teams', t.teams) order by t.id)
          from (
            select tied.id,
                case when p_key = 'pairs' then
                  (select pg_catalog.jsonb_build_array(pg_catalog.jsonb_build_array(
                      public.statistics_relationship_name(pf.player_low),
                      public.statistics_relationship_name(pf.player_high)))
                    from public.statistics_pair_facts pf where pf.pair_id = tied.id limit 1)
                else
                  (select pg_catalog.jsonb_build_array(
                      pg_catalog.jsonb_build_array(
                        public.statistics_relationship_name(least(g.team_a_players[1], g.team_a_players[2])),
                        public.statistics_relationship_name(greatest(g.team_a_players[1], g.team_a_players[2]))),
                      pg_catalog.jsonb_build_array(
                        public.statistics_relationship_name(least(g.team_b_players[1], g.team_b_players[2])),
                        public.statistics_relationship_name(greatest(g.team_b_players[1], g.team_b_players[2]))))
                    from public.statistics_group_facts g where g.matchup_id = tied.id limit 1)
                end as teams
              from tied order by tied.id limit 10) t))) end;
$$;

-- Eligible League groups of a community scope (community subject rows, lifetime or daily buckets).
create function public.statistics_community_league_groups(
  p_communities uuid[], p_league_ids uuid[], p_type text, p_from date, p_through date
) returns integer language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.sum(q.n), 0)::integer from (
    select s.confirmed_groups as n from public.statistics_scope_summaries s
     where p_from is null and p_through is null and s.subject_kind = 'community'
       and s.subject_a = any (p_communities) and s.subject_b = public.statistics_nil_uuid()
       and s.scope_kind = 'league' and s.scope_id = any (p_league_ids) and s.match_type = p_type
    union all
    select d.confirmed_groups from public.statistics_daily_buckets d
     where (p_from is not null or p_through is not null) and d.subject_kind = 'community'
       and d.subject_a = any (p_communities) and d.subject_b = public.statistics_nil_uuid()
       and d.scope_kind = 'league' and d.scope_id = any (p_league_ids) and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ) q;
$$;

create function public.get_community_statistics(
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid; v_config jsonb; v_thresholds jsonb;
  v_member uuid[]; v_comms uuid[]; v_scope text; v_scope_ids uuid[];
  v_leader_min integer; v_rival_min integer; v_min integer;
  v_t record; v_players jsonb; v_opponents jsonb; v_active_leagues uuid[];
  v_ranking jsonb; v_league jsonb; v_active_league uuid;
  v_first date; v_last date; v_start date; v_end date; v_elapsed integer;
  v_weeks jsonb; v_months jsonb; v_average jsonb;
  v_win_observed integer; v_rival jsonb; v_rival_observed integer; v_revision bigint;
begin
  perform public.assert_actor_not_provisional();
  v_actor := public.statistics_read_actor();
  if p_type is null or p_type not in ('all', 'competitive', 'friendly')
     or (p_from is not null and p_through is not null and p_from > p_through)
     or (p_league_id is not null and p_community_id is null) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;

  -- Community insights require a concrete community; subject-wide statistics use subject readers.
  if p_community_id is null then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;

  -- Authorize the scope before any summary is read.
  select coalesce(pg_catalog.array_agg(m.community_id order by m.community_id), '{}'::uuid[]) into v_member
    from public.community_members m
   where m.user_id = v_actor and m.status = 'active'
     and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now());
  if p_community_id is not null and not (p_community_id = any (v_member)) then
    raise exception using errcode = 'P0002', message = 'STATISTICS_NOT_FOUND';
  end if;
  if p_league_id is not null then
    select pg_catalog.jsonb_build_object('id', l.id, 'name', l.name, 'status', l.status::text) into v_league
      from public.leagues l where l.id = p_league_id and l.community_id = p_community_id;
    if v_league is null then
      raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
    end if;
  end if;
  perform public.statistics_assert_rating_aligned();

  v_config := public.get_statistics_config();
  v_thresholds := v_config -> 'thresholds';
  v_min := (v_thresholds ->> 'basic_min_denominator')::integer;
  v_leader_min := greatest(1, (v_thresholds ->> 'community_leader_min_matches')::integer);
  v_rival_min := greatest(1, (v_thresholds ->> 'closest_rivalry_min_meetings')::integer);
  v_comms := case when p_community_id is null then v_member else array[p_community_id] end;
  v_scope := case when p_league_id is not null then 'league' else 'community' end;
  v_scope_ids := case when p_league_id is not null then array[p_league_id] else v_comms end;

  -- Community totals: each Game Group once.
  select coalesce(pg_catalog.sum(q.confirmed_groups), 0)::integer as played, coalesce(pg_catalog.sum(q.wins), 0)::integer as decided,
      coalesce(pg_catalog.sum(q.draws), 0)::integer as draws, coalesce(pg_catalog.sum(q.incomplete_groups), 0)::integer as incomplete,
      coalesce(pg_catalog.sum(q.competitive_groups), 0)::integer as competitive,
      coalesce(pg_catalog.sum(q.friendly_groups), 0)::integer as friendly,
      coalesce(pg_catalog.sum(q.sets_won), 0)::integer as sets, coalesce(pg_catalog.sum(q.games_won), 0)::integer as games,
      pg_catalog.min(q.first_played_at) as first_at, pg_catalog.max(q.last_played_at) as last_at,
      coalesce(public.statistics_json_sum(q.relations), '{}'::jsonb) as relations,
      coalesce(public.statistics_json_sum(q.activity), '{}'::jsonb) as activity
    into v_t from (
      select s.confirmed_groups, s.wins, s.draws, s.incomplete_groups, s.competitive_groups, s.friendly_groups,
          s.sets_won, s.games_won, s.first_played_at, s.last_played_at, s.relations, s.activity
        from public.statistics_scope_summaries s
       where p_from is null and p_through is null and s.subject_kind = 'community'
         and s.subject_a = any (v_comms) and s.subject_b = public.statistics_nil_uuid()
         and s.scope_kind = v_scope and s.scope_id = any (v_scope_ids) and s.match_type = p_type
      union all
      select d.confirmed_groups, d.wins, d.draws, d.incomplete_groups, d.competitive_groups, d.friendly_groups,
          d.sets_won, d.games_won, d.first_played_at, d.last_played_at, d.relations, d.activity
        from public.statistics_daily_buckets d
       where (p_from is not null or p_through is not null) and d.subject_kind = 'community'
         and d.subject_a = any (v_comms) and d.subject_b = public.statistics_nil_uuid()
         and d.scope_kind = v_scope and d.scope_id = any (v_scope_ids) and d.match_type = p_type
         and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
    ) q;

  -- Per-player totals of the same scope (leaders). Played counts the player's own confirmed groups.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', p.id, 'played', p.played, 'wins', p.wins,
      'losses', p.losses, 'draws', p.draws, 'set_diff', p.set_diff, 'game_diff', p.game_diff,
      'rated', p.rated, 'delta', p.delta)), '[]'::jsonb) into v_players
    from (
      select q.subject_a as id, pg_catalog.sum(q.confirmed_groups)::integer as played, pg_catalog.sum(q.wins)::integer as wins,
          pg_catalog.sum(q.losses)::integer as losses, pg_catalog.sum(q.draws)::integer as draws,
          (pg_catalog.sum(q.sets_won) - pg_catalog.sum(q.sets_lost))::integer as set_diff,
          (pg_catalog.sum(q.games_won) - pg_catalog.sum(q.games_lost))::integer as game_diff,
          pg_catalog.sum(q.rated_groups)::integer as rated, pg_catalog.sum(q.rating_delta_sum) as delta
        from (
          select s.subject_a, s.confirmed_groups, s.wins, s.losses, s.draws, s.sets_won, s.sets_lost,
              s.games_won, s.games_lost, s.rated_groups, s.rating_delta_sum
            from public.statistics_scope_summaries s
           where p_from is null and p_through is null and s.scope_kind = v_scope and s.scope_id = any (v_scope_ids)
             and s.subject_kind = 'player' and s.match_type = p_type
          union all
          select d.subject_a, d.confirmed_groups, d.wins, d.losses, d.draws, d.sets_won, d.sets_lost,
              d.games_won, d.games_lost, d.rated_groups, d.rating_delta_sum
            from public.statistics_daily_buckets d
           where (p_from is not null or p_through is not null) and d.scope_kind = v_scope
             and d.scope_id = any (v_scope_ids) and d.subject_kind = 'player' and d.match_type = p_type
             and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
        ) q group by q.subject_a
    ) p;

  -- Opposed relationships (one undirected row per pair of players) for the closest rivalry.
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('a', o.a, 'b', o.b, 'w', o.w, 'l', o.l, 'd', o.d)),
      '[]'::jsonb) into v_opponents
    from (
      select q.subject_a as a, q.subject_b as b, pg_catalog.sum(q.wins)::integer as w,
          pg_catalog.sum(q.losses)::integer as l, pg_catalog.sum(q.draws)::integer as d
        from (
          select s.subject_a, s.subject_b, s.wins, s.losses, s.draws
            from public.statistics_scope_summaries s
           where p_from is null and p_through is null and s.scope_kind = v_scope and s.scope_id = any (v_scope_ids)
             and s.subject_kind = 'opponent' and s.match_type = p_type and s.subject_a < s.subject_b
          union all
          select d.subject_a, d.subject_b, d.wins, d.losses, d.draws
            from public.statistics_daily_buckets d
           where (p_from is not null or p_through is not null) and d.scope_kind = v_scope
             and d.scope_id = any (v_scope_ids) and d.subject_kind = 'opponent' and d.match_type = p_type
             and d.subject_a < d.subject_b
             and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
        ) q group by q.subject_a, q.subject_b
    ) o;

  select coalesce(pg_catalog.max(p.wins + p.losses + p.draws), 0) into v_win_observed
    from pg_catalog.jsonb_to_recordset(v_players) as p(wins integer, losses integer, draws integer);
  select coalesce(pg_catalog.max(o.w + o.l + o.d), 0) into v_rival_observed
    from pg_catalog.jsonb_to_recordset(v_opponents) as o(w integer, l integer, d integer);

  -- Closest rivalry: smallest |W-L| among relationships with enough resolved meetings, then the
  -- largest sample; every tied relationship is kept (first ten listed).
  with r as (
    select o.a, o.b, o.w, o.l, o.d, o.w + o.l + o.d as resolved, pg_catalog.abs(o.w - o.l) as imbalance
      from pg_catalog.jsonb_to_recordset(v_opponents) as o(a uuid, b uuid, w integer, l integer, d integer)
     where o.w + o.l + o.d >= v_rival_min
  ), best as (select pg_catalog.min(r.imbalance) as imbalance from r),
  sample as (select pg_catalog.max(r.resolved) as resolved from r join best on r.imbalance = best.imbalance),
  tied as (
    select r.* from r join best on r.imbalance = best.imbalance join sample on r.resolved = sample.resolved
  )
  select case when not exists (select 1 from tied) then pg_catalog.jsonb_build_object('state', 'insufficient',
      'value', null, 'numerator', null, 'denominator', null, 'observed', v_rival_observed,
      'required', v_rival_min,
      'reason', case when v_rival_observed > 0 then 'minimum_matches' else 'no_applicable_result' end)
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', null,
      'value', pg_catalog.jsonb_build_object('imbalance', (select best.imbalance from best),
        'resolved', (select sample.resolved from sample), 'total', (select pg_catalog.count(*) from tied),
        'relationships', (select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
            'first', public.statistics_relationship_name(t.a), 'second', public.statistics_relationship_name(t.b),
            'wins', t.w, 'losses', t.l, 'draws', t.d) order by t.a, t.b)
          from (select tied.* from tied order by tied.a, tied.b limit 10) t))) end into v_rival;

  -- Active ranking is independent of the selected historical League.
  select coalesce(pg_catalog.array_agg(l.id order by l.id), '{}'::uuid[]) into v_active_leagues
    from public.leagues l where l.community_id = any (v_comms) and l.status = 'active';
  v_ranking := case when pg_catalog.cardinality(v_active_leagues) = 0 then pg_catalog.jsonb_build_object(
      'state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null, 'observed', 0,
      'required', 1, 'reason', 'not_in_league')
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', null,
      'value', pg_catalog.jsonb_build_object(
        'groups', case when p_league_id is not null and not (p_league_id = any (v_active_leagues)) then 0
          when p_league_id is not null then v_t.played
          else public.statistics_community_league_groups(v_comms, v_active_leagues, p_type, p_from, p_through) end,
        'leagues', pg_catalog.cardinality(v_active_leagues))) end;

  -- Window and frequency. The window is the selected date range, else the observed first..last day.
  v_first := (v_t.first_at at time zone 'UTC')::date;
  v_last := (v_t.last_at at time zone 'UTC')::date;
  v_start := coalesce(p_from, v_first);
  v_end := coalesce(p_through, v_last);
  v_elapsed := case when v_start is null or v_end is null then 0 else greatest(1, v_end - v_start + 1) end;
  v_average := case when v_t.played = 0 or v_elapsed = 0 then pg_catalog.jsonb_build_object('state', 'insufficient',
      'value', null, 'numerator', v_t.played, 'denominator', v_elapsed, 'observed', v_t.played, 'required', 1,
      'reason', 'no_denominator')
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', v_t.played, 'denominator', v_elapsed,
      'value', v_t.played / greatest(1::numeric, v_elapsed / 7.0)) end;
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('start', w.d::date,
      'groups', coalesce((v_t.activity -> 'weeks' ->> (w.d::date)::text)::integer, 0)) order by w.d), '[]'::jsonb) into v_weeks
    from pg_catalog.generate_series(
      (select pg_catalog.min(k::date) from pg_catalog.jsonb_object_keys(coalesce(v_t.activity -> 'weeks', '{}'::jsonb)) k)::timestamp,
      (select pg_catalog.max(k::date) from pg_catalog.jsonb_object_keys(coalesce(v_t.activity -> 'weeks', '{}'::jsonb)) k)::timestamp,
      interval '7 days') w(d);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('month', pg_catalog.to_char(m.d, 'YYYY-MM'),
      'groups', coalesce((v_t.activity -> 'months' ->> pg_catalog.to_char(m.d, 'YYYY-MM'))::integer, 0)) order by m.d), '[]'::jsonb)
    into v_months
    from pg_catalog.generate_series(
      (select pg_catalog.min(pg_catalog.to_date(k, 'YYYY-MM')) from pg_catalog.jsonb_object_keys(coalesce(v_t.activity -> 'months', '{}'::jsonb)) k)::timestamp,
      (select pg_catalog.max(pg_catalog.to_date(k, 'YYYY-MM')) from pg_catalog.jsonb_object_keys(coalesce(v_t.activity -> 'months', '{}'::jsonb)) k)::timestamp,
      interval '1 month') m(d);

  select l.id into v_active_league from public.leagues l
   where p_community_id is not null and l.community_id = p_community_id and l.status = 'active';

  v_revision := (select k.revision from public.statistics_projection_control k);
  if v_revision <> (v_config ->> 'statistics_revision')::bigint then
    raise exception using errcode = 'P0001', message = 'STATISTICS_STALE_REVISION';
  end if;

  return pg_catalog.jsonb_build_object(
    'config', v_config,
    'filters', pg_catalog.jsonb_build_object('communityId', p_community_id, 'leagueId', p_league_id,
      'type', p_type, 'from', p_from, 'through', p_through),
    'notice', case when p_league_id is not null and p_type = 'friendly' then 'friendly_league' end,
    'communities', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', c.id, 'name', c.name)
        order by c.name, c.id), '[]'::jsonb) from public.communities c where c.id = any (v_member)),
    'leagues', (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('id', l.id, 'name', l.name,
        'status', l.status::text) order by (l.status = 'active') desc, l.closed_at desc nulls last, l.id), '[]'::jsonb)
        from public.leagues l where p_community_id is not null and l.community_id = p_community_id
          and l.status in ('active', 'closed')),
    'activeLeagueId', v_active_league,
    'league', v_league,
    'matches', pg_catalog.jsonb_build_object('played', v_t.played, 'competitive', v_t.competitive,
      'friendly', v_t.friendly, 'decided', v_t.decided, 'draws', v_t.draws, 'incomplete', v_t.incomplete),
    'totals', pg_catalog.jsonb_build_object('sets', v_t.sets, 'games', v_t.games),
    'rankingMatches', v_ranking,
    'activePlayers', (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(coalesce(v_t.relations -> 'players', '{}'::jsonb))),
    'mostActivePlayer', public.statistics_community_top((select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'v', p.played)), '[]'::jsonb)
        from pg_catalog.jsonb_to_recordset(v_players) as p(id uuid, played integer) where p.played > 0),
        0, 1, 'no_applicable_result'),
    'mostWins', public.statistics_community_top((select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'v', p.wins)), '[]'::jsonb)
        from pg_catalog.jsonb_to_recordset(v_players) as p(id uuid, wins integer) where p.wins > 0),
        0, 1, 'no_applicable_result'),
    'highestWinRate', public.statistics_community_top((select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'v', p.wins::numeric / (p.wins + p.losses + p.draws))), '[]'::jsonb)
        from pg_catalog.jsonb_to_recordset(v_players) as p(id uuid, wins integer, losses integer, draws integer)
       where p.wins + p.losses + p.draws >= v_leader_min),
        v_win_observed, v_leader_min, case when v_win_observed > 0 then 'minimum_matches' else 'no_applicable_result' end),
    'bestSetDifferential', public.statistics_community_top((select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'v', p.set_diff)), '[]'::jsonb)
        from pg_catalog.jsonb_to_recordset(v_players) as p(id uuid, set_diff integer) where p.set_diff > 0),
        0, 1, 'no_applicable_result'),
    'bestGameDifferential', public.statistics_community_top((select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'v', p.game_diff)), '[]'::jsonb)
        from pg_catalog.jsonb_to_recordset(v_players) as p(id uuid, game_diff integer) where p.game_diff > 0),
        0, 1, 'no_applicable_result'),
    'mostImproved', public.statistics_community_top((select coalesce(pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object('id', p.id, 'v', p.delta)), '[]'::jsonb)
        from pg_catalog.jsonb_to_recordset(v_players) as p(id uuid, rated integer, delta numeric)
       where p.rated >= greatest(1, (v_thresholds ->> 'extremum_min_facts')::integer) and p.delta > 0),
        0, 1, 'no_applicable_result'),
    'mostFrequentPair', public.statistics_community_relation_top(v_t.relations, 'pairs'),
    'mostCommonMatchup', public.statistics_community_relation_top(v_t.relations, 'matchups'),
    'closestRivalry', v_rival,
    'window', pg_catalog.jsonb_build_object('from', v_start, 'through', v_end, 'elapsedDays', v_elapsed),
    'averageMatchesPerWeek', v_average,
    'weeks', v_weeks,
    'months', v_months);
end $$;

-- Internal helpers: no runtime access. Only the reader is granted.
revoke all on function public.statistics_community_top(jsonb, integer, integer, text),
  public.statistics_community_relation_top(jsonb, text),
  public.statistics_community_league_groups(uuid[], uuid[], text, date, date)
  from public, anon, authenticated, service_role;
revoke all on function public.get_community_statistics(uuid, uuid, text, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_community_statistics(uuid, uuid, text, date, date) to authenticated;

commit;
