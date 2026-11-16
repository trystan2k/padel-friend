-- PAF-196: bound the get_player_statistics activity series.
--
-- Body-only forward replacement of the latest effective get_player_statistics (20261102105000).
-- Signature, return type, SECURITY DEFINER, empty search_path and grants are unchanged (CREATE OR
-- REPLACE preserves the existing ACL). Authorization, rating-alignment and every scope/type/date
-- predicate are unchanged and still precede any private read.
--
-- Activity-display contract (the only semantic change):
--   * Supported finite date endpoints: 0001-01-01 .. 9999-12-31. Outside that range, infinity and
--     -infinity raise 22023 / STATISTICS_INVALID_INPUT before any date arithmetic or private read.
--     A reversed range (p_from > p_through) still raises 22023 / STATISTICS_INVALID_INPUT even when
--     there is no activity. Null-ended and both-null (lifetime) ranges remain supported.
--   * activity.fromDay / throughDay keep the FULL effective scope: supplied endpoints where matching
--     buckets exist, otherwise the observed first/last bucket day for a missing side; both null when
--     no bucket matches.
--   * activity.window = { fromDay, throughDay, maxDays: 366, truncated } is always present. With no
--     matching activity fromDay/throughDay are null and truncated is false. Otherwise the window ends
--     at the effective throughDay and starts at greatest(effective fromDay, throughDay - 365), i.e.
--     at most 366 inclusive UTC days; truncated is true iff the window starts after the effective
--     fromDay. A range of exactly 366 days is not truncated, 367 days is.
--   * activity.days / weeks / months describe the window only (days <= 366, weeks <= 54,
--     months <= 13). Week/month values at a clipped window edge are window portions, not full
--     calendar totals. The window start is clamped before generate_series, so every generated list is
--     bounded by construction (no post-generation LIMIT).
--   * Every other metric keeps the complete selected scope: matches, scores, form, rating,
--     relationships, weeklyAverage (constant-time calendar arithmetic over the full scope),
--     mostActiveWeek and mostActiveMonth. The best periods are computed from the grouped stored
--     daily buckets plus the zero-valued first period of the scope, which reproduces the former
--     gap-filled ordering (most groups, then earliest period) without generating the empty periods.
--   * Oversized valid ranges succeed with truthful window metadata; they are never rejected, never
--     silently clamped for aggregate filters and never answered with an empty success.
begin;

create or replace function public.get_player_statistics(
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
     or (p_from is not null and (p_from < date '0001-01-01' or p_from > date '9999-12-31'))
     or (p_through is not null and (p_through < date '0001-01-01' or p_through > date '9999-12-31'))
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
  -- Activity uses UTC calendar buckets. The full effective scope (fromDay/throughDay, weeklyAverage,
  -- mostActiveWeek, mostActiveMonth) is computed from stored daily buckets with constant-time date
  -- arithmetic; no series is ever generated over the full scope. Only the displayed days/weeks/months
  -- are generated, and only over the activity window: the latest max-366 inclusive UTC days of the
  -- scope. win_from is clamped BEFORE generate_series, so at most 366 dates are ever constructed.
  with buckets as (
    select d.played_day, d.confirmed_groups from public.statistics_daily_buckets d
     where d.subject_kind = 'player' and d.subject_a = p_player_id and d.subject_b = public.statistics_nil_uuid()
       and d.scope_kind = v_scope and d.scope_id = v_scope_id and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ), bounds as (
    select case when min(played_day) is not null then coalesce(p_from, min(played_day)) end as first_day,
           case when max(played_day) is not null then coalesce(p_through, max(played_day)) end as last_day
      from buckets
  ), win as (
    select first_day, last_day,
           case when last_day is not null then greatest(first_day, last_day - 365) end as win_from
      from bounds
  ), days as (
    select (win.win_from + series.off) as day, coalesce(b.confirmed_groups, 0) as groups
      from win cross join lateral pg_catalog.generate_series(0, case when win.win_from is not null then win.last_day - win.win_from else -1 end) series(off)
      left join buckets b on b.played_day = (win.win_from + series.off)
  ), weeks as (
    select pg_catalog.date_trunc('week', day::timestamp)::date as period, sum(groups) as groups
      from days group by 1
  ), months as (
    select pg_catalog.date_trunc('month', day::timestamp)::date as period, sum(groups) as groups
      from days group by 1
  ), full_weeks as (
    select pg_catalog.date_trunc('week', played_day::timestamp)::date as period, sum(confirmed_groups) as groups
      from buckets group by 1
  ), full_months as (
    select pg_catalog.date_trunc('month', played_day::timestamp)::date as period, sum(confirmed_groups) as groups
      from buckets group by 1
  ), best_week as (
    -- Stored periods plus the zero-valued first period of the scope: equals the former gap-filled
    -- ordering (groups desc, earliest period) without generating the empty periods in between.
    select period, groups from (
      select period, groups from full_weeks
      union all
      select pg_catalog.date_trunc('week', bounds.first_day::timestamp)::date, 0 from bounds where bounds.first_day is not null
    ) c order by groups desc, period limit 1
  ), best_month as (
    select period, groups from (
      select period, groups from full_months
      union all
      select pg_catalog.date_trunc('month', bounds.first_day::timestamp)::date, 0 from bounds where bounds.first_day is not null
    ) c order by groups desc, period limit 1
  )
  select v_result || pg_catalog.jsonb_build_object('activity', pg_catalog.jsonb_build_object(
    'fromDay', win.first_day, 'throughDay', win.last_day,
    'window', pg_catalog.jsonb_build_object('fromDay', win.win_from, 'throughDay', win.last_day,
      'maxDays', 366, 'truncated', coalesce(win.win_from > win.first_day, false)),
    'weeklyAverage', case when win.first_day is null then public.statistics_player_ratio(0, 0, 1)
      else public.statistics_player_ratio((v_result -> 'matches' ->> 'played')::numeric,
        greatest(1::numeric, (win.last_day - win.first_day + 1)::numeric / 7), 1) end,
    'days', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('period', day, 'groups', groups) order by day) from days), '[]'::jsonb),
    'weeks', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('period', period, 'groups', groups) order by period) from weeks), '[]'::jsonb),
    'months', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('period', pg_catalog.to_char(period, 'YYYY-MM'), 'groups', groups) order by period) from months), '[]'::jsonb),
    'mostActiveWeek', case when win.first_day is null then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1, 'reason', 'no_applicable_result')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', (select pg_catalog.jsonb_build_object('period', period, 'groups', groups) from best_week), 'numerator', null, 'denominator', null) end,
    'mostActiveMonth', case when win.first_day is null then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1, 'reason', 'no_applicable_result')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', (select pg_catalog.jsonb_build_object('period', pg_catalog.to_char(period, 'YYYY-MM'), 'groups', groups) from best_month), 'numerator', null, 'denominator', null) end))
    into v_result from win;
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
    'filteredDelta', v_result -> 'filteredDelta') || public.statistics_player_rank_block(p_player_id, p_community_id, p_league_id));
  return v_result;
end $$;

commit;
