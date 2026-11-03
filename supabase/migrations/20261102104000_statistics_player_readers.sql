begin;

-- A denominator of zero is missing evidence, not a zero percentage.
create function public.statistics_player_ratio(p_numerator numeric, p_denominator numeric, p_minimum integer)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_denominator < greatest(1, p_minimum) then
    pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null,
      'numerator', p_numerator, 'denominator', p_denominator, 'observed', p_denominator,
      'required', greatest(1, p_minimum),
      'reason', case when p_minimum > 1 then 'minimum_opportunities' else 'no_denominator' end)
    else pg_catalog.jsonb_build_object('state', 'ready', 'value', p_numerator / p_denominator,
      'numerator', p_numerator, 'denominator', p_denominator) end;
$$;
revoke all on function public.statistics_player_ratio(numeric, numeric, integer)
  from public, anon, authenticated, service_role;

create function public.statistics_player_value(p_value numeric, p_reason text)
returns jsonb language sql immutable set search_path = '' as $$
  select case when p_value is null then pg_catalog.jsonb_build_object('state', 'insufficient',
      'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1, 'reason', p_reason)
    else pg_catalog.jsonb_build_object('state', 'ready', 'value', p_value, 'numerator', null, 'denominator', null) end;
$$;
revoke all on function public.statistics_player_value(numeric, text)
  from public, anon, authenticated, service_role;

-- Associative merge of adjacent resolved-outcome runs. Draws break both streaks.
create function public.statistics_player_sequence_merge(a jsonb, b jsonb)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare
  an integer := (a ->> 'n')::integer; bn integer := (b ->> 'n')::integer;
  ap jsonb := a -> 'prefix'; ax jsonb := a -> 'suffix';
  bp jsonb := b -> 'prefix'; bx jsonb := b -> 'suffix';
  joined boolean; junction integer;
begin
  if an = 0 then return b; end if;
  if bn = 0 then return a; end if;
  joined := ax ->> 'k' = bp ->> 'k';
  junction := case when joined then (ax ->> 'len')::integer + (bp ->> 'len')::integer else 0 end;
  return pg_catalog.jsonb_build_object('n', an + bn,
    'prefix', case when (ap ->> 'len')::integer = an and ap ->> 'k' = bp ->> 'k'
      then pg_catalog.jsonb_build_object('k', ap ->> 'k', 'len', an + (bp ->> 'len')::integer) else ap end,
    'suffix', case when (bx ->> 'len')::integer = bn and bx ->> 'k' = ax ->> 'k'
      then pg_catalog.jsonb_build_object('k', bx ->> 'k', 'len', bn + (ax ->> 'len')::integer) else bx end,
    'best_win', greatest((a ->> 'best_win')::integer, (b ->> 'best_win')::integer,
      case when joined and ax ->> 'k' = 'W' then junction else 0 end),
    'best_loss', greatest((a ->> 'best_loss')::integer, (b ->> 'best_loss')::integer,
      case when joined and ax ->> 'k' = 'L' then junction else 0 end));
end $$;
revoke all on function public.statistics_player_sequence_merge(jsonb, jsonb)
  from public, anon, authenticated, service_role;

create function public.statistics_player_form(p_recent jsonb, p_capacity integer, p_minimum integer)
returns jsonb language sql immutable set search_path = '' as $$
  with selected as (
    select x.item, x.ord from pg_catalog.jsonb_array_elements(p_recent) with ordinality x(item, ord)
      order by x.ord desc limit p_capacity
  ), counts as (
    select pg_catalog.count(*)::integer as n,
      (pg_catalog.count(*) filter (where item ->> 'o' = 'W'))::integer as wins,
      (pg_catalog.count(*) filter (where item ->> 'o' = 'L'))::integer as losses,
      (pg_catalog.count(*) filter (where item ->> 'o' = 'D'))::integer as draws,
      coalesce(pg_catalog.jsonb_agg(item order by ord), '[]'::jsonb) as outcomes from selected
  ) select case when n < greatest(1, p_minimum) then pg_catalog.jsonb_build_object(
      'state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null,
      'observed', n, 'required', greatest(1, p_minimum), 'reason', 'no_resolved_matches')
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', n,
      'value', pg_catalog.jsonb_build_object('outcomes', outcomes, 'wins', wins, 'losses', losses,
        'draws', draws, 'sampleSize', n, 'capacity', p_capacity)) end from counts;
$$;
revoke all on function public.statistics_player_form(jsonb, integer, integer)
  from public, anon, authenticated, service_role;

-- Player reads use published summaries for lifetime and indexed daily buckets for date filters.
-- Merge ordered bucket reductions chronologically; never replay raw result history.
-- Never disclose an all-communities aggregate belonging to another player.
create function public.get_player_statistics(
  p_player_id uuid,
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid;
  v_scope text;
  v_scope_id uuid;
  v_config jsonb;
  v_result jsonb;
  v_row record;
  v_seq jsonb := '{"n":0,"prefix":null,"suffix":null,"best_win":0,"best_loss":0}'::jsonb;
  v_recent jsonb := '[]'::jsonb;
  v_extrema jsonb := '{}'::jsonb;
  v_key text;
  v_candidate jsonb;
  v_prior jsonb;
  v_rating_summary jsonb;
  v_established_low numeric;
  v_established_high numeric;
  v_relations jsonb;
begin
  perform public.assert_actor_not_provisional();
  v_actor := public.statistics_read_actor();
  if p_player_id is null or p_type is null or p_type not in ('all', 'competitive', 'friendly')
     or (p_from is not null and p_through is not null and p_from > p_through)
     or (p_league_id is not null and p_community_id is null) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  if p_league_id is not null and not exists (
    select 1 from public.leagues l where l.id = p_league_id and l.community_id = p_community_id
  ) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  if p_player_id <> v_actor and (p_community_id is null or not exists (
    select 1 from public.community_members a join public.community_members b
      on a.community_id = b.community_id
     where a.community_id = p_community_id and a.user_id = v_actor and b.user_id = p_player_id
       and a.status = 'active' and b.status = 'active'
       and a.valid_from <= now() and (a.valid_until is null or a.valid_until > now())
       and b.valid_from <= now() and (b.valid_until is null or b.valid_until > now())
  )) then
    raise exception using errcode = 'P0002', message = 'STATISTICS_NOT_FOUND';
  end if;
  perform public.statistics_assert_rating_aligned();
  v_scope := case when p_league_id is not null then 'league' when p_community_id is not null then 'community' else 'all' end;
  v_scope_id := coalesce(p_league_id, p_community_id, public.statistics_nil_uuid());
  v_config := public.get_statistics_config();

  with source as (
    select s.confirmed_groups, s.wins, s.losses, s.draws, s.incomplete_groups,
      s.competitive_groups, s.friendly_groups, s.sets_won, s.sets_lost, s.games_won, s.games_lost,
      s.straight_set_wins, s.straight_set_losses, s.three_set_groups, s.incomplete_decider_groups, s.deciding_set_wins, s.deciding_set_losses, s.first_set_won_groups, s.first_set_won_converted, s.first_set_lost_groups, s.first_set_lost_converted, s.rated_groups, s.rating_delta_sum
      from public.statistics_scope_summaries s
     where p_from is null and p_through is null and s.subject_kind = 'player' and s.subject_a = p_player_id
       and s.subject_b = public.statistics_nil_uuid() and s.scope_kind = v_scope and s.scope_id = v_scope_id and s.match_type = p_type
    union all
    select d.confirmed_groups, d.wins, d.losses, d.draws, d.incomplete_groups,
      d.competitive_groups, d.friendly_groups, d.sets_won, d.sets_lost, d.games_won, d.games_lost,
      d.straight_set_wins, d.straight_set_losses, d.three_set_groups, d.incomplete_decider_groups, d.deciding_set_wins, d.deciding_set_losses, d.first_set_won_groups, d.first_set_won_converted, d.first_set_lost_groups, d.first_set_lost_converted, d.rated_groups, d.rating_delta_sum
      from public.statistics_daily_buckets d
     where (p_from is not null or p_through is not null) and d.subject_kind = 'player' and d.subject_a = p_player_id
       and d.subject_b = public.statistics_nil_uuid() and d.scope_kind = v_scope and d.scope_id = v_scope_id and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ), type_source as (
    select s.match_type, s.wins, s.losses, s.draws, s.sets_won, s.sets_lost, s.games_won, s.games_lost
      from public.statistics_scope_summaries s
     where p_from is null and p_through is null and s.subject_kind = 'player' and s.subject_a = p_player_id
       and s.subject_b = public.statistics_nil_uuid() and s.scope_kind = v_scope and s.scope_id = v_scope_id
       and s.match_type in ('competitive', 'friendly') and (p_type = 'all' or s.match_type = p_type)
    union all
    select d.match_type, d.wins, d.losses, d.draws, d.sets_won, d.sets_lost, d.games_won, d.games_lost
      from public.statistics_daily_buckets d
     where (p_from is not null or p_through is not null) and d.subject_kind = 'player' and d.subject_a = p_player_id
       and d.subject_b = public.statistics_nil_uuid() and d.scope_kind = v_scope and d.scope_id = v_scope_id
       and d.match_type in ('competitive', 'friendly') and (p_type = 'all' or d.match_type = p_type)
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ), type_totals as (
    select typ.kind, coalesce(sum(s.wins), 0) as wins, coalesce(sum(s.losses), 0) as losses,
      coalesce(sum(s.draws), 0) as draws, coalesce(sum(s.sets_won), 0) as sets_won,
      coalesce(sum(s.sets_lost), 0) as sets_lost, coalesce(sum(s.games_won), 0) as games_won,
      coalesce(sum(s.games_lost), 0) as games_lost
      from (values ('competitive'), ('friendly')) typ(kind)
      left join type_source s on s.match_type = typ.kind group by typ.kind
  ), type_rates as (
    select pg_catalog.jsonb_object_agg(kind, pg_catalog.jsonb_build_object(
      'winRate', public.statistics_player_ratio(wins, wins+losses+draws, (v_config -> 'thresholds' ->> 'basic_min_denominator')::integer),
      'setRate', public.statistics_player_ratio(sets_won, sets_won+sets_lost, (v_config -> 'thresholds' ->> 'basic_min_denominator')::integer),
      'gameRate', public.statistics_player_ratio(games_won, games_won+games_lost, (v_config -> 'thresholds' ->> 'basic_min_denominator')::integer))) as rates
      from type_totals
  ), totals as (
    select coalesce(sum(confirmed_groups), 0) as played, coalesce(sum(wins), 0) as wins,
      coalesce(sum(losses), 0) as losses, coalesce(sum(draws), 0) as draws,
      coalesce(sum(incomplete_groups), 0) as incomplete, coalesce(sum(competitive_groups), 0) as competitive,
      coalesce(sum(friendly_groups), 0) as friendly, coalesce(sum(sets_won), 0) as sets_won,
      coalesce(sum(sets_lost), 0) as sets_lost, coalesce(sum(games_won), 0) as games_won,
      coalesce(sum(games_lost), 0) as games_lost,
      coalesce(sum(straight_set_wins), 0) as straight_set_wins,
      coalesce(sum(straight_set_losses), 0) as straight_set_losses,
      coalesce(sum(three_set_groups), 0) as three_set_groups,
      coalesce(sum(incomplete_decider_groups), 0) as incomplete_decider_groups,
      coalesce(sum(deciding_set_wins), 0) as deciding_set_wins,
      coalesce(sum(deciding_set_losses), 0) as deciding_set_losses,
      coalesce(sum(first_set_won_groups), 0) as first_set_won_groups,
      coalesce(sum(first_set_won_converted), 0) as first_set_won_converted,
      coalesce(sum(first_set_lost_groups), 0) as first_set_lost_groups,
      coalesce(sum(first_set_lost_converted), 0) as first_set_lost_converted,
      coalesce(sum(rated_groups), 0) as rated_groups,
      coalesce(sum(rating_delta_sum), 0) as rating_delta_sum from source
  )
  select pg_catalog.jsonb_build_object(
    'player_id', p_player_id, 'config', v_config,
    'filters', pg_catalog.jsonb_build_object('communityId', p_community_id, 'leagueId', p_league_id,
      'type', p_type, 'from', p_from, 'through', p_through),
    'typeRates', (select rates from type_rates),
    'matches', pg_catalog.jsonb_build_object('played', t.played, 'competitive', t.competitive,
      'friendly', t.friendly, 'wins', t.wins, 'losses', t.losses, 'draws', t.draws,
      'incomplete', t.incomplete,
      'competitiveWinRate', (select rates -> 'competitive' -> 'winRate' from type_rates),
      'friendlyWinRate', (select rates -> 'friendly' -> 'winRate' from type_rates),
      'winRate', public.statistics_player_ratio(t.wins, t.wins+t.losses+t.draws,
        (v_config -> 'thresholds' ->> 'basic_min_denominator')::integer)),
    'sets', pg_catalog.jsonb_build_object('won', t.sets_won, 'lost', t.sets_lost,
      'differential', t.sets_won-t.sets_lost, 'winRate', public.statistics_player_ratio(t.sets_won, t.sets_won+t.sets_lost,
        (v_config -> 'thresholds' ->> 'basic_min_denominator')::integer)),
    'advanced', pg_catalog.jsonb_build_object(
      'straightSetWins', t.straight_set_wins, 'straightSetLosses', t.straight_set_losses,
      'threeSetGroups', t.three_set_groups, 'incompleteDeciders', t.incomplete_decider_groups,
      'decidingSetWins', t.deciding_set_wins, 'decidingSetLosses', t.deciding_set_losses,
      'decidingSetWinRate', public.statistics_player_ratio(t.deciding_set_wins,
        t.deciding_set_wins + t.deciding_set_losses, (v_config -> 'thresholds' ->> 'rate_min_opportunities')::integer),
      'firstSetConversionRate', public.statistics_player_ratio(t.first_set_won_converted,
        t.first_set_won_groups, (v_config -> 'thresholds' ->> 'rate_min_opportunities')::integer),
      'comebackWinRate', public.statistics_player_ratio(t.first_set_lost_converted,
        t.first_set_lost_groups, (v_config -> 'thresholds' ->> 'rate_min_opportunities')::integer)),
    'filteredDelta', case when t.rated_groups = 0 then
      pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null, 'numerator', null,
        'denominator', null, 'observed', 0, 'required', 1, 'reason', 'missing_evidence')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', t.rating_delta_sum,
        'numerator', null, 'denominator', t.rated_groups) end,
    'games', pg_catalog.jsonb_build_object('won', t.games_won, 'lost', t.games_lost,
      'differential', t.games_won-t.games_lost, 'winRate', public.statistics_player_ratio(t.games_won, t.games_won+t.games_lost,
        (v_config -> 'thresholds' ->> 'basic_min_denominator')::integer),
      'averageWonPerGroup', public.statistics_player_ratio(t.games_won, t.played, 1),
      'averageConcededPerGroup', public.statistics_player_ratio(t.games_lost, t.played, 1))) into v_result from totals t;
  -- Each day already contains chronology-ordered reductions; fold days in UTC order.
  for v_row in
    select s.sequence, s.recent, s.extrema, null::date as played_day
      from public.statistics_scope_summaries s
     where p_from is null and p_through is null and s.subject_kind = 'player' and s.subject_a = p_player_id
       and s.subject_b = public.statistics_nil_uuid() and s.scope_kind = v_scope and s.scope_id = v_scope_id and s.match_type = p_type
    union all
    select d.sequence, d.recent, d.extrema, d.played_day
      from public.statistics_daily_buckets d
     where (p_from is not null or p_through is not null) and d.subject_kind = 'player' and d.subject_a = p_player_id
       and d.subject_b = public.statistics_nil_uuid() and d.scope_kind = v_scope and d.scope_id = v_scope_id and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
    order by played_day
  loop
    v_seq := public.statistics_player_sequence_merge(v_seq, v_row.sequence);
    v_recent := public.statistics_recent(v_recent || v_row.recent);
    foreach v_key in array array['cleanest_win', 'closest_win', 'biggest_gain', 'biggest_loss', 'strongest_upset', 'toughest_loss'] loop
      v_candidate := v_row.extrema -> v_key;
      v_prior := v_extrema -> v_key;
      if v_candidate is not null and (v_prior is null or
          ((v_candidate ->> 'k')::numeric, v_candidate ->> 'at', (v_candidate ->> 'g')::uuid)
          < ((v_prior ->> 'k')::numeric, v_prior ->> 'at', (v_prior ->> 'g')::uuid)) then
        v_extrema := pg_catalog.jsonb_set(v_extrema, array[v_key], v_candidate, true);
      end if;
    end loop;
  end loop;
  v_result := v_result || pg_catalog.jsonb_build_object('form', pg_catalog.jsonb_build_object(
    'last5', public.statistics_player_form(v_recent, 5, (v_config -> 'thresholds' ->> 'form_min_resolved')::integer),
    'last10', public.statistics_player_form(v_recent, 10, (v_config -> 'thresholds' ->> 'form_min_resolved')::integer),
    'current', case when v_seq -> 'suffix' ->> 'k' in ('W', 'L') then
      pg_catalog.jsonb_build_object('kind', v_seq -> 'suffix' ->> 'k', 'length', (v_seq -> 'suffix' ->> 'len')::integer)
      else pg_catalog.jsonb_build_object('kind', null, 'length', 0) end,
    'longestWins', (v_seq ->> 'best_win')::integer, 'longestLosses', (v_seq ->> 'best_loss')::integer));
  foreach v_key in array array['cleanest_win', 'closest_win', 'biggest_gain', 'biggest_loss', 'strongest_upset', 'toughest_loss'] loop
    v_candidate := v_extrema -> v_key;
    v_result := pg_catalog.jsonb_set(v_result, array['advanced', case v_key
      when 'cleanest_win' then 'cleanestWin' when 'closest_win' then 'closestWin'
      when 'biggest_gain' then 'biggestGain' when 'biggest_loss' then 'biggestLoss'
      when 'strongest_upset' then 'strongestUpset' else 'toughestLoss' end],
      case when v_candidate is null then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null,
        'numerator', null, 'denominator', null, 'observed', 0, 'required', 1, 'reason', 'no_applicable_result')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', v_candidate, 'numerator', null, 'denominator', null) end, true);
  end loop;
  -- Activity uses UTC calendar buckets and fills gaps inside the selected observed window.
  with buckets as (
    select d.played_day, d.confirmed_groups from public.statistics_daily_buckets d
     where d.subject_kind = 'player' and d.subject_a = p_player_id and d.subject_b = public.statistics_nil_uuid()
       and d.scope_kind = v_scope and d.scope_id = v_scope_id and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ), bounds as (
    select case when min(played_day) is not null then coalesce(p_from, min(played_day)) end as first_day,
           case when max(played_day) is not null then coalesce(p_through, max(played_day)) end as last_day
      from buckets
  ), days as (
    select series.day::date as day, coalesce(b.confirmed_groups, 0) as groups
      from bounds cross join lateral pg_catalog.generate_series(bounds.first_day::timestamp, bounds.last_day::timestamp, interval '1 day') series(day)
      left join buckets b on b.played_day = series.day::date
  ), weeks as (
    select pg_catalog.date_trunc('week', day::timestamp)::date as period, sum(groups) as groups
      from days group by 1
  ), months as (
    select pg_catalog.date_trunc('month', day::timestamp)::date as period, sum(groups) as groups
      from days group by 1
  ), best_week as (select period, groups from weeks order by groups desc, period limit 1),
  best_month as (select period, groups from months order by groups desc, period limit 1)
  select v_result || pg_catalog.jsonb_build_object('activity', pg_catalog.jsonb_build_object(
    'fromDay', bounds.first_day, 'throughDay', bounds.last_day,
    'weeklyAverage', case when bounds.first_day is null then public.statistics_player_ratio(0, 0, 1)
      else public.statistics_player_ratio((v_result -> 'matches' ->> 'played')::numeric,
        greatest(1::numeric, (bounds.last_day - bounds.first_day + 1)::numeric / 7), 1) end,
    'days', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('period', day, 'groups', groups) order by day) from days), '[]'::jsonb),
    'weeks', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('period', period, 'groups', groups) order by period) from weeks), '[]'::jsonb),
    'months', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('period', pg_catalog.to_char(period, 'YYYY-MM'), 'groups', groups) order by period) from months), '[]'::jsonb),
    'mostActiveWeek', case when bounds.first_day is null then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1, 'reason', 'no_applicable_result')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', (select pg_catalog.jsonb_build_object('period', period, 'groups', groups) from best_week), 'numerator', null, 'denominator', null) end,
    'mostActiveMonth', case when bounds.first_day is null then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1, 'reason', 'no_applicable_result')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', (select pg_catalog.jsonb_build_object('period', pg_catalog.to_char(period, 'YYYY-MM'), 'groups', groups) from best_month), 'numerator', null, 'denominator', null) end))
    into v_result from bounds;
  -- Relationship seeds fold the same lifetime or dated rows; counts are additive group counts per identity.
  select coalesce(public.statistics_json_sum(r.relations), '{}'::jsonb) into v_relations from (
    select s.relations from public.statistics_scope_summaries s
     where s.subject_kind = 'player' and s.subject_a = p_player_id and s.subject_b = public.statistics_nil_uuid() and s.scope_kind = v_scope and s.scope_id = v_scope_id and s.match_type = p_type and p_from is null and p_through is null
    union all
    select d.relations from public.statistics_daily_buckets d
     where d.subject_kind = 'player' and d.subject_a = p_player_id and d.subject_b = public.statistics_nil_uuid() and d.scope_kind = v_scope and d.scope_id = v_scope_id and d.match_type = p_type and (p_from is not null or p_through is not null)
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ) r;
  v_result := v_result || pg_catalog.jsonb_build_object('relationships', pg_catalog.jsonb_build_object(
    'uniquePartners', (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(coalesce(v_relations -> 'partners', '{}'::jsonb))),
    'uniqueOpponents', (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(coalesce(v_relations -> 'opponents', '{}'::jsonb))),
    'uniqueQuartets', (select pg_catalog.count(*) from pg_catalog.jsonb_object_keys(coalesce(v_relations -> 'combos', '{}'::jsonb))),
    'mostFrequentPartners', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('playerId', t.id, 'groups', t.groups) order by t.groups desc, t.id)
      from (select e.key as id, (e.value ->> 'g')::integer as groups from pg_catalog.jsonb_each(coalesce(v_relations -> 'partners', '{}'::jsonb)) e
        order by 2 desc, 1 limit 3) t), '[]'::jsonb),
    'mostFrequentOpponents', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('playerId', t.id, 'groups', t.groups) order by t.groups desc, t.id)
      from (select e.key as id, (e.value ->> 'g')::integer as groups from pg_catalog.jsonb_each(coalesce(v_relations -> 'opponents', '{}'::jsonb)) e
        order by 2 desc, 1 limit 3) t), '[]'::jsonb),
    'mostFrequentPartnerShare', public.statistics_player_ratio(
      coalesce((select max((e.value ->> 'g')::integer) from pg_catalog.jsonb_each(coalesce(v_relations -> 'partners', '{}'::jsonb)) e), 0),
      (v_result -> 'matches' ->> 'played')::numeric, 1)));
  -- Rating values are app-wide authority at the aligned committed projection revision.
  v_rating_summary := public.rating_summary_at(p_player_id, (v_config ->> 'rating_revision')::bigint);
  select min(x.level), max(x.level) into v_established_low, v_established_high from (
    select c.before_display_level as level from public.rating_current_calculations(p_player_id, (v_config ->> 'rating_revision')::bigint) c where c.before_reliability_percent >= 100
    union all
    select c.after_display_level from public.rating_current_calculations(p_player_id, (v_config ->> 'rating_revision')::bigint) c where c.after_reliability_percent >= 100
  ) x;
  v_result := v_result || pg_catalog.jsonb_build_object('rating', pg_catalog.jsonb_build_object(
    'currentLevel', public.statistics_player_value((v_rating_summary ->> 'display_level')::numeric, 'missing_evidence'),
    'reliability', public.statistics_player_value((v_rating_summary ->> 'reliability_percent')::numeric, 'missing_evidence'),
    'startingLevel', public.statistics_player_value((v_rating_summary ->> 'initial_display_level')::numeric, 'missing_evidence'),
    'highestLevel', public.statistics_player_value(v_established_high, 'not_established'),
    'lowestEstablishedLevel', public.statistics_player_value(v_established_low, 'not_established'),
    'filteredDelta', v_result -> 'filteredDelta',
    'communitySkillRank', pg_catalog.jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'rank_history_pending'),
    'activeLeaguePosition', pg_catalog.jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'rank_history_pending'),
    'bestCommunitySkillRank', pg_catalog.jsonb_build_object('best', pg_catalog.jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'rank_history_pending'), 'coverageFrom', null, 'coverageComplete', false),
    'bestLeaguePosition', pg_catalog.jsonb_build_object('best', pg_catalog.jsonb_build_object('state', 'unavailable', 'value', null, 'reason', 'rank_history_pending'), 'coverageFrom', null, 'coverageComplete', false)));
  return v_result;
end $$;
revoke all on function public.get_player_statistics(uuid, uuid, uuid, text, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_player_statistics(uuid, uuid, uuid, text, date, date) to authenticated;

commit;
