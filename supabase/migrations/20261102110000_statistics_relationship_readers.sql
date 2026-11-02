begin;

-- PAF-13 / U4: pair, partner and opponent readers. Projection tables only (pair/opponent summaries,
-- daily buckets and bounded indexed fact rows); never the official-source or rebuild functions.
--   * A pair is the canonical statistics_pair_id: independent of player order and team side.
--   * Head-to-head edges exist only ACROSS teams. subject 'opponent' rows are directed (subject_a is the
--     focal player), so a focal reader never reverses an outcome, set/game total or rating delta.
--   * Authorization matches get_player_statistics: the actor is a party to the relationship, or the
--     actor and the focal player are both active members of the selected community.

create function public.statistics_relationship_prepare(
  p_focal uuid, p_other uuid, p_community_id uuid, p_league_id uuid, p_type text, p_from date, p_through date
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  perform public.assert_actor_not_provisional();
  v_actor := public.statistics_read_actor();
  if p_focal is null or p_type is null or p_type not in ('all', 'competitive', 'friendly')
     or p_other = p_focal
     or (p_from is not null and p_through is not null and p_from > p_through)
     or (p_league_id is not null and p_community_id is null) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  if p_league_id is not null and not exists (
    select 1 from public.leagues l where l.id = p_league_id and l.community_id = p_community_id
  ) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  if v_actor <> p_focal and v_actor is distinct from p_other and (p_community_id is null or not exists (
    select 1 from public.community_members a join public.community_members b
      on a.community_id = b.community_id
     where a.community_id = p_community_id and a.user_id = v_actor and b.user_id = p_focal
       and a.status = 'active' and b.status = 'active'
       and a.valid_from <= now() and (a.valid_until is null or a.valid_until > now())
       and b.valid_from <= now() and (b.valid_until is null or b.valid_until > now())
  )) then
    raise exception using errcode = 'P0002', message = 'STATISTICS_NOT_FOUND';
  end if;
  perform public.statistics_assert_rating_aligned();
  return pg_catalog.jsonb_build_object(
    'scope', case when p_league_id is not null then 'league' when p_community_id is not null then 'community' else 'all' end,
    'scopeId', coalesce(p_league_id, p_community_id, public.statistics_nil_uuid()),
    'config', public.get_statistics_config());
end $$;

create function public.statistics_relationship_extremum(p_candidate jsonb) returns jsonb
language sql stable security definer set search_path = '' as $$
  select case when p_candidate is null then pg_catalog.jsonb_build_object('state', 'insufficient',
      'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1,
      'reason', 'no_applicable_result')
    else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', null,
      'value', p_candidate || pg_catalog.jsonb_build_object('eventId',
        (select f.match_event_id from public.statistics_group_facts f
          where f.game_group_id = (p_candidate ->> 'g')::uuid))) end;
$$;

-- One relationship record folded from the lifetime summary or the selected daily buckets. Days are
-- merged in UTC order so streaks and extrema equal the lifetime reduction.
create function public.statistics_relationship_record(
  p_kind text, p_a uuid, p_b uuid, p_scope text, p_scope_id uuid, p_type text, p_from date, p_through date,
  p_config jsonb
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_thresholds jsonb := p_config -> 'thresholds';
  v_min integer := (v_thresholds ->> 'basic_min_denominator')::integer;
  v_leader_min integer := case when p_kind = 'pair'
    then (v_thresholds ->> 'best_partnership_min_matches')::integer
    else (v_thresholds ->> 'best_opponent_min_meetings')::integer end;
  v_seq jsonb := '{"n":0,"prefix":null,"suffix":null,"best_win":0,"best_loss":0}'::jsonb;
  v_extrema jsonb := '{}'::jsonb;
  v_relations jsonb := '{}'::jsonb;
  v_row record; v_t record; v_key text; v_candidate jsonb; v_prior jsonb; v_resolved integer;
begin
  select coalesce(sum(src.confirmed_groups), 0)::integer as played, coalesce(sum(src.wins), 0)::integer as wins,
      coalesce(sum(src.losses), 0)::integer as losses, coalesce(sum(src.draws), 0)::integer as draws,
      coalesce(sum(src.incomplete_groups), 0)::integer as incomplete,
      coalesce(sum(src.competitive_groups), 0)::integer as competitive,
      coalesce(sum(src.friendly_groups), 0)::integer as friendly,
      coalesce(sum(src.sets_won), 0)::integer as sets_won, coalesce(sum(src.sets_lost), 0)::integer as sets_lost,
      coalesce(sum(src.games_won), 0)::integer as games_won, coalesce(sum(src.games_lost), 0)::integer as games_lost,
      coalesce(sum(src.opponent_strength_sum), 0) as strength_sum,
      coalesce(sum(src.opponent_strength_groups), 0)::integer as strength_groups,
      coalesce(sum(src.upset_wins), 0)::integer as upset_wins
    into v_t from (
      select s.confirmed_groups, s.wins, s.losses, s.draws, s.incomplete_groups, s.competitive_groups,
          s.friendly_groups, s.sets_won, s.sets_lost, s.games_won, s.games_lost, s.opponent_strength_sum,
          s.opponent_strength_groups, s.upset_wins
        from public.statistics_scope_summaries s
       where p_from is null and p_through is null and s.subject_kind = p_kind and s.subject_a = p_a
         and s.subject_b = p_b and s.scope_kind = p_scope and s.scope_id = p_scope_id and s.match_type = p_type
      union all
      select d.confirmed_groups, d.wins, d.losses, d.draws, d.incomplete_groups, d.competitive_groups,
          d.friendly_groups, d.sets_won, d.sets_lost, d.games_won, d.games_lost, d.opponent_strength_sum,
          d.opponent_strength_groups, d.upset_wins
        from public.statistics_daily_buckets d
       where (p_from is not null or p_through is not null) and d.subject_kind = p_kind and d.subject_a = p_a
         and d.subject_b = p_b and d.scope_kind = p_scope and d.scope_id = p_scope_id and d.match_type = p_type
         and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
    ) src;
  v_resolved := v_t.wins + v_t.losses + v_t.draws;

  for v_row in
    select s.sequence, s.extrema, s.relations, null::date as played_day
      from public.statistics_scope_summaries s
     where p_from is null and p_through is null and s.subject_kind = p_kind and s.subject_a = p_a
       and s.subject_b = p_b and s.scope_kind = p_scope and s.scope_id = p_scope_id and s.match_type = p_type
    union all
    select d.sequence, d.extrema, d.relations, d.played_day
      from public.statistics_daily_buckets d
     where (p_from is not null or p_through is not null) and d.subject_kind = p_kind and d.subject_a = p_a
       and d.subject_b = p_b and d.scope_kind = p_scope and d.scope_id = p_scope_id and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
    order by played_day
  loop
    v_seq := public.statistics_player_sequence_merge(v_seq, v_row.sequence);
    v_relations := public.statistics_json_add(v_relations, v_row.relations);
    foreach v_key in array array['biggest_gain', 'biggest_loss', 'strongest_upset', 'toughest_loss'] loop
      v_candidate := v_row.extrema -> v_key;
      v_prior := v_extrema -> v_key;
      if v_candidate is not null and (v_prior is null or
          ((v_candidate ->> 'k')::numeric, v_candidate ->> 'at', (v_candidate ->> 'g')::uuid)
          < ((v_prior ->> 'k')::numeric, v_prior ->> 'at', (v_prior ->> 'g')::uuid)) then
        v_extrema := pg_catalog.jsonb_set(v_extrema, array[v_key], v_candidate, true);
      end if;
    end loop;
  end loop;

  return pg_catalog.jsonb_build_object(
    'matches', pg_catalog.jsonb_build_object('played', v_t.played, 'competitive', v_t.competitive,
      'friendly', v_t.friendly, 'wins', v_t.wins, 'losses', v_t.losses, 'draws', v_t.draws,
      'incomplete', v_t.incomplete,
      'winRate', public.statistics_player_ratio(v_t.wins, v_resolved, v_min)),
    'sets', pg_catalog.jsonb_build_object('won', v_t.sets_won, 'lost', v_t.sets_lost,
      'differential', v_t.sets_won - v_t.sets_lost,
      'winRate', public.statistics_player_ratio(v_t.sets_won, v_t.sets_won + v_t.sets_lost, v_min)),
    'games', pg_catalog.jsonb_build_object('won', v_t.games_won, 'lost', v_t.games_lost,
      'differential', v_t.games_won - v_t.games_lost,
      'winRate', public.statistics_player_ratio(v_t.games_won, v_t.games_won + v_t.games_lost, v_min)),
    'streaks', pg_catalog.jsonb_build_object(
      'current', case when v_seq -> 'suffix' ->> 'k' in ('W', 'L') then
        pg_catalog.jsonb_build_object('kind', v_seq -> 'suffix' ->> 'k', 'length', (v_seq -> 'suffix' ->> 'len')::integer)
        else pg_catalog.jsonb_build_object('kind', null, 'length', 0) end,
      'longestWins', (v_seq ->> 'best_win')::integer, 'longestLosses', (v_seq ->> 'best_loss')::integer),
    'averageOpponentLevel', case when v_t.strength_groups = 0 then pg_catalog.jsonb_build_object(
        'state', 'insufficient', 'value', null, 'numerator', null, 'denominator', null,
        'observed', 0, 'required', 1, 'reason', 'missing_evidence')
      else pg_catalog.jsonb_build_object('state', 'ready', 'value', v_t.strength_sum / v_t.strength_groups,
        'numerator', null, 'denominator', v_t.strength_groups) end,
    'upsetWins', v_t.upset_wins,
    'biggestUpset', public.statistics_relationship_extremum(v_extrema -> 'strongest_upset'),
    'toughestLoss', public.statistics_relationship_extremum(v_extrema -> 'toughest_loss'),
    'biggestGain', public.statistics_relationship_extremum(v_extrema -> 'biggest_gain'),
    'biggestLoss', public.statistics_relationship_extremum(v_extrema -> 'biggest_loss'),
    'leaderEligibility', case when v_resolved >= greatest(1, v_leader_min)
      then pg_catalog.jsonb_build_object('state', 'ready', 'value', v_resolved, 'numerator', null, 'denominator', null)
      else pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null, 'numerator', null,
        'denominator', null, 'observed', v_resolved, 'required', greatest(1, v_leader_min),
        'reason', 'minimum_matches') end,
    'leagues', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('leagueId', e.key,
        'name', l.name, 'groups', (e.value ->> 'g')::integer) order by (e.value ->> 'g')::integer desc, e.key)
      from pg_catalog.jsonb_each(coalesce(v_relations -> 'leagues', '{}'::jsonb)) e
      left join public.leagues l on l.id = e.key::uuid), '[]'::jsonb));
end $$;

create function public.statistics_relationship_name(p_user_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('userId', p_user_id,
    'displayName', (select p.display_name from public.player_profiles p where p.user_id = p_user_id));
$$;

-- Pair record: matches together for the canonical pair, newest matches first (bounded to 20).
create function public.get_pair_statistics(
  p_player_id uuid,
  p_partner_id uuid,
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ctx jsonb; v_pair uuid; v_scope text; v_scope_id uuid; v_config jsonb;
begin
  if p_partner_id is null then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  v_ctx := public.statistics_relationship_prepare(p_player_id, p_partner_id, p_community_id, p_league_id,
    p_type, p_from, p_through);
  v_scope := v_ctx ->> 'scope'; v_scope_id := (v_ctx ->> 'scopeId')::uuid; v_config := v_ctx -> 'config';
  v_pair := public.statistics_pair_id(p_player_id, p_partner_id);
  return pg_catalog.jsonb_build_object(
    'focalId', p_player_id, 'otherId', p_partner_id, 'pairId', v_pair, 'config', v_config,
    'filters', pg_catalog.jsonb_build_object('communityId', p_community_id, 'leagueId', p_league_id,
      'type', p_type, 'from', p_from, 'through', p_through),
    'players', (select pg_catalog.jsonb_agg(public.statistics_relationship_name(x.id) order by x.id)
      from (values (p_player_id), (p_partner_id)) x(id)),
    'record', public.statistics_relationship_record('pair', v_pair, public.statistics_nil_uuid(), v_scope,
      v_scope_id, p_type, p_from, p_through, v_config),
    'recent', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'groupId', r.game_group_id, 'eventId', r.match_event_id,
        'playedAt', public.statistics_utc_text(r.played_at), 'matchType', r.match_type,
        'outcome', r.outcome, 'setsFor', r.sets_for, 'setsAgainst', r.sets_against,
        'gamesFor', r.games_for, 'gamesAgainst', r.games_against, 'expectedScore', r.expected_score)
        order by r.played_at desc, r.game_group_id desc)
      from (
        select pf.game_group_id, g.match_event_id, pf.played_at, pf.match_type, pf.expected_score,
            case when g.classification = 'incomplete' then 'I' when g.classification = 'draw' then 'D'
                 when g.classification = pf.side then 'W' else 'L' end as outcome,
            case when pf.side = 'team_a' then g.sets_a else g.sets_b end as sets_for,
            case when pf.side = 'team_a' then g.sets_b else g.sets_a end as sets_against,
            case when pf.side = 'team_a' then g.games_a else g.games_b end as games_for,
            case when pf.side = 'team_a' then g.games_b else g.games_a end as games_against
          from public.statistics_pair_facts pf
          join public.statistics_group_facts g on g.game_group_id = pf.game_group_id
         where pf.player_low = least(p_player_id, p_partner_id) and pf.player_high = greatest(p_player_id, p_partner_id)
           and (v_scope = 'all' or (v_scope = 'community' and pf.community_id = v_scope_id)
                or (v_scope = 'league' and pf.league_id = v_scope_id and pf.league_eligible))
           and (p_type = 'all' or pf.match_type = p_type)
           and (p_from is null or pf.played_day >= p_from) and (p_through is null or pf.played_day <= p_through)
         order by pf.played_at desc, pf.game_group_id desc limit 20
      ) r), '[]'::jsonb));
end $$;

-- Head-to-head record, oriented to the focal player. Teammates have no opponent edge.
create function public.get_opponent_statistics(
  p_player_id uuid,
  p_opponent_id uuid,
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_ctx jsonb; v_scope text; v_scope_id uuid; v_config jsonb;
begin
  if p_opponent_id is null then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  v_ctx := public.statistics_relationship_prepare(p_player_id, p_opponent_id, p_community_id, p_league_id,
    p_type, p_from, p_through);
  v_scope := v_ctx ->> 'scope'; v_scope_id := (v_ctx ->> 'scopeId')::uuid; v_config := v_ctx -> 'config';
  return pg_catalog.jsonb_build_object(
    'focalId', p_player_id, 'otherId', p_opponent_id, 'config', v_config,
    'filters', pg_catalog.jsonb_build_object('communityId', p_community_id, 'leagueId', p_league_id,
      'type', p_type, 'from', p_from, 'through', p_through),
    'focal', public.statistics_relationship_name(p_player_id),
    'other', public.statistics_relationship_name(p_opponent_id),
    'record', public.statistics_relationship_record('opponent', p_player_id, p_opponent_id, v_scope,
      v_scope_id, p_type, p_from, p_through, v_config),
    'recent', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'groupId', r.game_group_id, 'eventId', r.match_event_id,
        'playedAt', public.statistics_utc_text(r.played_at), 'matchType', r.match_type,
        'outcome', r.outcome, 'setsFor', r.sets_for, 'setsAgainst', r.sets_against,
        'gamesFor', r.games_for, 'gamesAgainst', r.games_against,
        'ratingDelta', r.rating_delta, 'expectedScore', r.expected_score)
        order by r.played_at desc, r.game_group_id desc)
      from (
        select o.game_group_id, g.match_event_id, o.played_at, o.match_type,
            case when o.player_low = p_player_id then o.low_rating_delta else o.high_rating_delta end as rating_delta,
            case when o.player_low = p_player_id then o.low_expected_score else o.high_expected_score end as expected_score,
            case when g.classification = 'incomplete' then 'I' when g.classification = 'draw' then 'D'
                 when g.classification = f.side then 'W' else 'L' end as outcome,
            case when f.side = 'team_a' then g.sets_a else g.sets_b end as sets_for,
            case when f.side = 'team_a' then g.sets_b else g.sets_a end as sets_against,
            case when f.side = 'team_a' then g.games_a else g.games_b end as games_for,
            case when f.side = 'team_a' then g.games_b else g.games_a end as games_against
          from public.statistics_opponent_facts o
          join public.statistics_group_facts g on g.game_group_id = o.game_group_id
          cross join lateral (select case when o.player_low = p_player_id then o.low_side
            when o.low_side = 'team_a' then 'team_b' else 'team_a' end as side) f
         where o.player_low = least(p_player_id, p_opponent_id) and o.player_high = greatest(p_player_id, p_opponent_id)
           and (v_scope = 'all' or (v_scope = 'community' and o.community_id = v_scope_id)
                or (v_scope = 'league' and o.league_id = v_scope_id and o.league_eligible))
           and (p_type = 'all' or o.match_type = p_type)
           and (p_from is null or o.played_day >= p_from) and (p_through is null or o.played_day <= p_through)
         order by o.played_at desc, o.game_group_id desc limit 20
      ) r), '[]'::jsonb));
end $$;

-- Per-partner / per-opponent relation counts of one player, folded from the same rows.
create function public.statistics_relationship_relations(
  p_player_id uuid, p_scope text, p_scope_id uuid, p_type text, p_from date, p_through date
) returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(public.statistics_json_sum(r.relations), '{}'::jsonb) from (
    select s.relations from public.statistics_scope_summaries s
     where p_from is null and p_through is null and s.subject_kind = 'player' and s.subject_a = p_player_id
       and s.subject_b = public.statistics_nil_uuid() and s.scope_kind = p_scope and s.scope_id = p_scope_id
       and s.match_type = p_type
    union all
    select d.relations from public.statistics_daily_buckets d
     where (p_from is not null or p_through is not null) and d.subject_kind = 'player' and d.subject_a = p_player_id
       and d.subject_b = public.statistics_nil_uuid() and d.scope_kind = p_scope and d.scope_id = p_scope_id
       and d.match_type = p_type
       and (p_from is null or d.played_day >= p_from) and (p_through is null or d.played_day <= p_through)
  ) r;
$$;

create function public.statistics_leader_metric(p_value jsonb, p_observed integer, p_required integer) returns jsonb
language sql immutable set search_path = '' as $$
  select case when p_value is null then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null,
      'numerator', null, 'denominator', null, 'observed', p_observed, 'required', p_required,
      'reason', 'minimum_matches')
    else pg_catalog.jsonb_build_object('state', 'ready', 'value', p_value, 'numerator', null, 'denominator', null) end;
$$;

-- Ranked list plus thresholded leaders. Sort: played desc then player id. Leaders keep every tied
-- identity (id order); below the threshold the record stays listed but no leader claim is made.
create function public.statistics_relationship_leaders(
  p_relations jsonb, p_key text, p_config jsonb, p_limit integer, p_offset integer
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_thresholds jsonb := p_config -> 'thresholds';
  v_min integer := (v_thresholds ->> 'basic_min_denominator')::integer;
  v_best_min integer := greatest(1, case when p_key = 'partners'
    then (v_thresholds ->> 'best_partnership_min_matches')::integer
    else (v_thresholds ->> 'best_opponent_min_meetings')::integer end);
  v_rival_min integer := greatest(1, (v_thresholds ->> 'closest_rivalry_min_meetings')::integer);
  v_result jsonb; v_observed integer; v_rival_observed integer;
begin
  with rel as (
    select e.key::uuid as id, (e.value ->> 'g')::integer as played, (e.value ->> 'w')::integer as wins,
        (e.value ->> 'l')::integer as losses, (e.value ->> 'd')::integer as draws
      from pg_catalog.jsonb_each(coalesce(p_relations -> p_key, '{}'::jsonb)) e
  ), r as (
    select rel.*, rel.wins + rel.losses + rel.draws as resolved,
        case when rel.wins + rel.losses + rel.draws > 0
          then rel.wins::numeric / (rel.wins + rel.losses + rel.draws) end as rate
      from rel
  ), best_rank as (
    select r.*, pg_catalog.dense_rank() over (order by r.rate desc, r.resolved desc) as rk
      from r where r.resolved >= v_best_min
  ), worst_rank as (
    select r.*, pg_catalog.dense_rank() over (order by r.rate, r.resolved desc) as rk
      from r where r.resolved >= v_best_min
  ), rival_rank as (
    select r.*, pg_catalog.dense_rank() over (order by abs(r.wins - r.losses), r.resolved desc) as rk
      from r where r.resolved >= v_rival_min
  )
  select pg_catalog.jsonb_build_object(
    'total', (select pg_catalog.count(*) from r),
    'items', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'playerId', p.id, 'displayName', pp.display_name, 'played', p.played, 'wins', p.wins,
        'losses', p.losses, 'draws', p.draws, 'incomplete', p.played - p.resolved,
        'winRate', public.statistics_player_ratio(p.wins, p.resolved, v_min)) order by p.played desc, p.id)
      from (select * from r order by r.played desc, r.id limit p_limit offset p_offset) p
      left join public.player_profiles pp on pp.user_id = p.id), '[]'::jsonb),
    'mostFrequent', (select case when pg_catalog.count(*) = 0 then pg_catalog.jsonb_build_object('state', 'insufficient',
        'value', null, 'numerator', null, 'denominator', null, 'observed', 0, 'required', 1,
        'reason', 'no_applicable_result')
      else pg_catalog.jsonb_build_object('state', 'ready', 'numerator', null, 'denominator', null,
        'value', pg_catalog.jsonb_build_object('groups', pg_catalog.max(r.played), 'players',
          (select pg_catalog.jsonb_agg(public.statistics_relationship_name(x.id) order by x.id) from r x where x.played = (select pg_catalog.max(played) from r)))) end
      from r),
    'best', (select public.statistics_leader_metric(case when pg_catalog.count(*) = 0 then null else
        pg_catalog.jsonb_build_object('players', pg_catalog.jsonb_agg(public.statistics_relationship_name(b.id) order by b.id), 'resolved', pg_catalog.min(b.resolved),
          'winRate', pg_catalog.min(b.rate), 'imbalance', pg_catalog.min(abs(b.wins - b.losses))) end,
        (select coalesce(pg_catalog.max(resolved), 0) from r), v_best_min)
      from best_rank b where b.rk = 1)
  ) || case when p_key = 'opponents' then pg_catalog.jsonb_build_object(
    'toughest', (select public.statistics_leader_metric(case when pg_catalog.count(*) = 0 then null else
        pg_catalog.jsonb_build_object('players', pg_catalog.jsonb_agg(public.statistics_relationship_name(b.id) order by b.id), 'resolved', pg_catalog.min(b.resolved),
          'winRate', pg_catalog.min(b.rate), 'imbalance', pg_catalog.min(abs(b.wins - b.losses))) end,
        (select coalesce(pg_catalog.max(resolved), 0) from r), v_best_min)
      from worst_rank b where b.rk = 1),
    'closestRivalry', (select public.statistics_leader_metric(case when pg_catalog.count(*) = 0 then null else
        pg_catalog.jsonb_build_object('players', pg_catalog.jsonb_agg(public.statistics_relationship_name(b.id) order by b.id), 'resolved', pg_catalog.min(b.resolved),
          'winRate', pg_catalog.min(b.rate), 'imbalance', pg_catalog.min(abs(b.wins - b.losses))) end,
        (select coalesce(pg_catalog.max(resolved), 0) from r), v_rival_min)
      from rival_rank b where b.rk = 1))
    else '{}'::jsonb end into v_result;
  return v_result;
end $$;

create function public.get_player_partner_records(
  p_player_id uuid,
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ctx jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  v_ctx := public.statistics_relationship_prepare(p_player_id, null, p_community_id, p_league_id, p_type, p_from, p_through);
  return pg_catalog.jsonb_build_object('playerId', p_player_id, 'config', v_ctx -> 'config',
    'filters', pg_catalog.jsonb_build_object('communityId', p_community_id, 'leagueId', p_league_id,
      'type', p_type, 'from', p_from, 'through', p_through),
    'limit', p_limit, 'offset', p_offset)
    || public.statistics_relationship_leaders(
      public.statistics_relationship_relations(p_player_id, v_ctx ->> 'scope', (v_ctx ->> 'scopeId')::uuid,
        p_type, p_from, p_through), 'partners', v_ctx -> 'config', p_limit, p_offset);
end $$;

create function public.get_player_opponent_records(
  p_player_id uuid,
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null,
  p_limit integer default 20,
  p_offset integer default 0
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_ctx jsonb;
begin
  if p_limit is null or p_limit < 1 or p_limit > 100 or p_offset is null or p_offset < 0 then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  v_ctx := public.statistics_relationship_prepare(p_player_id, null, p_community_id, p_league_id, p_type, p_from, p_through);
  return pg_catalog.jsonb_build_object('playerId', p_player_id, 'config', v_ctx -> 'config',
    'filters', pg_catalog.jsonb_build_object('communityId', p_community_id, 'leagueId', p_league_id,
      'type', p_type, 'from', p_from, 'through', p_through),
    'limit', p_limit, 'offset', p_offset)
    || public.statistics_relationship_leaders(
      public.statistics_relationship_relations(p_player_id, v_ctx ->> 'scope', (v_ctx ->> 'scopeId')::uuid,
        p_type, p_from, p_through), 'opponents', v_ctx -> 'config', p_limit, p_offset);
end $$;

-- Internal helpers: no runtime access. Only the four readers are granted.
revoke all on function public.statistics_relationship_prepare(uuid, uuid, uuid, uuid, text, date, date),
  public.statistics_relationship_extremum(jsonb),
  public.statistics_relationship_record(text, uuid, uuid, text, uuid, text, date, date, jsonb),
  public.statistics_relationship_name(uuid),
  public.statistics_relationship_relations(uuid, text, uuid, text, date, date),
  public.statistics_leader_metric(jsonb, integer, integer),
  public.statistics_relationship_leaders(jsonb, text, jsonb, integer, integer)
  from public, anon, authenticated, service_role;
revoke all on function public.get_pair_statistics(uuid, uuid, uuid, uuid, text, date, date),
  public.get_opponent_statistics(uuid, uuid, uuid, uuid, text, date, date),
  public.get_player_partner_records(uuid, uuid, uuid, text, date, date, integer, integer),
  public.get_player_opponent_records(uuid, uuid, uuid, text, date, date, integer, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_pair_statistics(uuid, uuid, uuid, uuid, text, date, date),
  public.get_opponent_statistics(uuid, uuid, uuid, uuid, text, date, date),
  public.get_player_partner_records(uuid, uuid, uuid, text, date, date, integer, integer),
  public.get_player_opponent_records(uuid, uuid, uuid, text, date, date, integer, integer) to authenticated;

commit;
