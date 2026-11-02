begin;

-- PAF-13 / U1 (2/2): deterministic statistics projection and rebuild.
--
-- Lock graph (preserved: community -> event/registration -> League -> global rating -> stats):
--   * The shared finalizer already holds community/event/registration locks and, through the League
--     hook, the League row. statistics_project_source() takes NO extra lock: it only replaces the
--     SOURCE-derived facts of the group the finalizer itself holds, so concurrent confirmations of
--     different communities still queue on the unchanged global rating lock, exactly as before.
--   * statistics_publish() runs AFTER the rating projector, still inside the same transaction. The
--     projector (active or dormant) always takes the rating lock first, so the deterministic
--     statistics lock acquired here is rating -> stats and never an upward acquisition. It only
--     writes statistics rows (no source FK is touched: keys are unchanged) and reads committed
--     rating calculations at ONE revision, so rating fields in a snapshot never mix revisions.
--   * rebuild_statistics() locks communities (id order), then the rating lock, then the statistics
--     lock (the same rating -> stats order). Its source rewrites only touch communities it holds
--     locked, so no finalizer can hold a conflicting event key while waiting for the rating lock.
--   * No AFTER INSERT trigger is attached to any source table.
--
-- Counting rules live in one place (statistics_build summaries below):
--   confirmed_groups includes confirmed Incomplete; W/L/D exclude Incomplete; sets/games come from
--   statistics_derive_sets (complete set: games once + set to the greater score; incomplete set:
--   recorded games, zero sets; tiebreak points are never games).

create function public.statistics_lock() returns void
language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('padel-friend:statistics-projection', 0));
$$;

-- Transaction-local worklists: groups replaced/rating-changed, plus the players/communities of
-- facts that were removed (their old keys must be recomputed too).
create function public.statistics_pending_init() returns void
language plpgsql security definer set search_path = '' as $$
begin
  create temporary table if not exists pg_temp.statistics_pending_groups (game_group_id uuid primary key) on commit drop;
  create temporary table if not exists pg_temp.statistics_pending_players (user_id uuid primary key) on commit drop;
  create temporary table if not exists pg_temp.statistics_pending_communities (community_id uuid primary key) on commit drop;
end $$;

-- Recursive additive merge: numbers add, objects merge by key. Used for relations and activity.
create function public.statistics_json_add(a jsonb, b jsonb) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare r jsonb; k text;
begin
  if a is null or a = '{}'::jsonb then return b; end if;
  if b is null or b = '{}'::jsonb then return a; end if;
  if pg_catalog.jsonb_typeof(a) = 'number' and pg_catalog.jsonb_typeof(b) = 'number' then
    return pg_catalog.to_jsonb((a #>> '{}')::numeric + (b #>> '{}')::numeric);
  end if;
  r := a;
  for k in select pg_catalog.jsonb_object_keys(b) loop
    r := pg_catalog.jsonb_set(r, array[k],
      case when a ? k then public.statistics_json_add(a -> k, b -> k) else b -> k end);
  end loop;
  return r;
end $$;

create aggregate public.statistics_json_sum(jsonb) (
  sfunc = public.statistics_json_add, stype = jsonb, initcond = '{}');

-- Streak monoid of an ordered outcome string (W/L/D). prefix/suffix are the first/last runs.
create function public.statistics_seq_from(p_outcomes text) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  n integer := coalesce(pg_catalog.length(p_outcomes), 0);
  i integer; c text; run_k text; run_len integer := 0; best_w integer := 0; best_l integer := 0;
  first_k text; first_len integer;
begin
  if n = 0 then
    return '{"n":0,"prefix":null,"suffix":null,"best_win":0,"best_loss":0}'::jsonb;
  end if;
  for i in 1..n loop
    c := pg_catalog.substr(p_outcomes, i, 1);
    if c = run_k then
      run_len := run_len + 1;
    else
      if run_k is not null and first_k is null then first_k := run_k; first_len := run_len; end if;
      run_k := c;
      run_len := 1;
    end if;
    if c = 'W' then best_w := greatest(best_w, run_len);
    elsif c = 'L' then best_l := greatest(best_l, run_len); end if;
  end loop;
  if first_k is null then first_k := run_k; first_len := run_len; end if;
  return pg_catalog.jsonb_build_object('n', n,
    'prefix', pg_catalog.jsonb_build_object('k', first_k, 'len', first_len),
    'suffix', pg_catalog.jsonb_build_object('k', run_k, 'len', run_len),
    'best_win', best_w, 'best_loss', best_l);
end $$;

-- Last ten keyed outcomes of an ordered array.
create function public.statistics_recent(p_items jsonb) returns jsonb
language sql immutable set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(s.x order by s.o), '[]'::jsonb)
    from (select t.x, t.o from pg_catalog.jsonb_array_elements(p_items) with ordinality t(x, o)
           order by t.o desc limit 10) s;
$$;

-- Extremum candidate. k is the ascending sort key (smaller is better); ties break by (at, g).
create function public.statistics_cand(p_key numeric, p_value numeric, p_at timestamptz, p_group uuid) returns jsonb
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('k', p_key, 'v', p_value, 'at', public.statistics_utc_text(p_at), 'g', p_group);
$$;

-- Latest committed calculation per (group, player) at one revision, in business terms.
create function public.statistics_rating_rows(p_game_group_ids uuid[], p_revision bigint)
returns table (game_group_id uuid, user_id uuid, calc_revision bigint, delta numeric, expected numeric,
  own_strength numeric, opp_strength numeric, before_level numeric, after_level numeric,
  before_rel smallint, after_rel smallint)
language sql stable security definer set search_path = '' as $$
  select distinct on (e.game_group_id, e.user_id) e.game_group_id, e.user_id, c.projection_revision,
      (c.explanation ->> 'applied_delta')::numeric, (c.explanation ->> 'expected_score')::numeric,
      (c.explanation ->> 'own_team_strength')::numeric, (c.explanation ->> 'opponent_team_strength')::numeric,
      c.before_display_level, c.after_display_level, c.before_reliability_percent, c.after_reliability_percent
    from public.player_rating_events e
    join public.player_rating_event_calculations c
      on c.rating_event_id = e.id and c.projection_revision <= p_revision
   where e.game_group_id = any (p_game_group_ids)
   order by e.game_group_id, e.user_id, c.projection_revision desc;
$$;

-- Replaces the source-derived facts of the given groups. A group whose official evidence is
-- unchanged (same hash) is a no-op, so duplicate delivery changes nothing. A changed group is
-- deleted (children cascade) and rebuilt, so old dimension keys disappear and new ones appear;
-- the old and new players/communities are queued for the summary recompute. A group that is no
-- longer official loses its facts. Returns the number of groups replaced or removed.
create function public.statistics_project_source(p_game_group_ids uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  r record; v_old text; v_changed integer := 0;
  v_a uuid[]; v_b uuid[]; v_pa uuid; v_pb uuid; v_day date; v_gone uuid;
begin
  perform public.statistics_pending_init();

  for v_gone in
    select f.game_group_id from public.statistics_group_facts f
     where f.game_group_id = any (p_game_group_ids)
       and not (f.game_group_id = any (array(select og.game_group_id from public.statistics_official_groups(p_game_group_ids) og)))
  loop
    insert into pg_temp.statistics_pending_players select pf.user_id from public.statistics_participant_facts pf
      where pf.game_group_id = v_gone on conflict do nothing;
    insert into pg_temp.statistics_pending_communities select f.community_id from public.statistics_group_facts f
      where f.game_group_id = v_gone on conflict do nothing;
    delete from public.statistics_group_facts f where f.game_group_id = v_gone;
    v_changed := v_changed + 1;
  end loop;

  for r in
    select og.*, d.*, pg_catalog.md5(pg_catalog.to_jsonb(og)::text) as src_hash
      from public.statistics_official_groups(p_game_group_ids) og
      cross join lateral public.statistics_derive_sets(og.sets, og.classification) d
     order by og.game_group_id
  loop
    select f.source_hash into v_old from public.statistics_group_facts f where f.game_group_id = r.game_group_id;
    if found and v_old = r.src_hash then continue; end if;

    insert into pg_temp.statistics_pending_players select pf.user_id from public.statistics_participant_facts pf
      where pf.game_group_id = r.game_group_id on conflict do nothing;
    insert into pg_temp.statistics_pending_communities select f.community_id from public.statistics_group_facts f
      where f.game_group_id = r.game_group_id on conflict do nothing;
    delete from public.statistics_group_facts f where f.game_group_id = r.game_group_id;

    v_a := array[(r.teams -> 'team_a' ->> 0)::uuid, (r.teams -> 'team_a' ->> 1)::uuid];
    v_b := array[(r.teams -> 'team_b' ->> 0)::uuid, (r.teams -> 'team_b' ->> 1)::uuid];
    v_pa := public.statistics_pair_id(v_a[1], v_a[2]);
    v_pb := public.statistics_pair_id(v_b[1], v_b[2]);
    v_day := (r.played_at at time zone 'UTC')::date;

    insert into public.statistics_group_facts (
      game_group_id, confirmation_id, proposal_version, match_event_id, group_number, community_id,
      match_type, league_id, league_eligible, rating_expected, played_at, played_day, classification,
      confirmation_source, confirmed_at, audit_event_id, team_a_players, team_b_players, quartet_id,
      team_a_pair_id, team_b_pair_id, matchup_id, matchup_low_pair_id, matchup_high_pair_id,
      matchup_low_side, sets, set_count, sets_a, sets_b, games_a, games_b, straight_winner, three_set,
      incomplete_decider, deciding_winner, first_set_winner, source_hash)
    values (
      r.game_group_id, r.confirmation_id, r.proposal_version, r.match_event_id, r.group_number,
      r.community_id, r.match_type, r.league_id, r.league_eligible, r.rating_expected, r.played_at, v_day,
      r.classification, r.confirmation_source, r.confirmed_at, r.audit_event_id, v_a, v_b,
      public.statistics_quartet_id(v_a || v_b), v_pa, v_pb, public.statistics_matchup_id(v_pa, v_pb),
      least(v_pa, v_pb), greatest(v_pa, v_pb), case when v_pa < v_pb then 'team_a' else 'team_b' end,
      r.sets, r.set_count, r.sets_a, r.sets_b, r.games_a, r.games_b, r.straight_winner, r.three_set,
      r.incomplete_decider, r.deciding_winner, r.first_set_winner, r.src_hash);

    insert into public.statistics_participant_facts (
      game_group_id, user_id, side, partner_id, community_id, match_type, league_id, league_eligible,
      played_at, played_day, rating_expected)
    select r.game_group_id, p.user_id, p.side, p.partner, r.community_id, r.match_type, r.league_id,
        r.league_eligible, r.played_at, v_day, r.rating_expected
      from (values (v_a[1], 'team_a', v_a[2]), (v_a[2], 'team_a', v_a[1]),
                   (v_b[1], 'team_b', v_b[2]), (v_b[2], 'team_b', v_b[1])) p(user_id, side, partner);

    insert into public.statistics_pair_facts (
      game_group_id, side, player_low, player_high, pair_id, opponent_pair_id, matchup_id, community_id,
      match_type, league_id, league_eligible, played_at, played_day, rating_expected)
    select r.game_group_id, p.side, least(p.x, p.y), greatest(p.x, p.y), p.pair_id, p.opp_pair,
        public.statistics_matchup_id(v_pa, v_pb), r.community_id, r.match_type, r.league_id,
        r.league_eligible, r.played_at, v_day, r.rating_expected
      from (values ('team_a', v_a[1], v_a[2], v_pa, v_pb), ('team_b', v_b[1], v_b[2], v_pb, v_pa))
        p(side, x, y, pair_id, opp_pair);

    insert into public.statistics_opponent_facts (
      game_group_id, player_low, player_high, low_side, community_id, match_type, league_id,
      league_eligible, played_at, played_day, rating_expected)
    select r.game_group_id, least(a.u, b.u), greatest(a.u, b.u),
        case when a.u < b.u then 'team_a' else 'team_b' end, r.community_id, r.match_type, r.league_id,
        r.league_eligible, r.played_at, v_day, r.rating_expected
      from pg_catalog.unnest(v_a) a(u) cross join pg_catalog.unnest(v_b) b(u);

    insert into pg_temp.statistics_pending_groups values (r.game_group_id) on conflict do nothing;
    v_changed := v_changed + 1;
  end loop;
  return v_changed;
end $$;

-- Recomputes the summaries (lifetime) and daily buckets of every subject involving p_players, plus
-- the community subjects of p_communities, directly from the projected facts, and publishes only
-- the rows whose business values differ. Both NULL means every subject. Returns rows changed.
-- Ordered reductions sort by (played_at, game_group_id); the all-communities scope is built in one
-- global chronology, never concatenated from community streaks.
create function public.statistics_apply_summaries(p_players uuid[], p_communities uuid[]) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  c_keys constant text := 'subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type';
  c_vals constant text := 'subject_players, confirmed_groups, wins, losses, draws, incomplete_groups, '
    || 'competitive_groups, friendly_groups, sets_won, sets_lost, games_won, games_lost, straight_set_wins, '
    || 'straight_set_losses, three_set_groups, incomplete_decider_groups, deciding_set_wins, '
    || 'deciding_set_losses, first_set_won_groups, first_set_won_converted, first_set_lost_groups, '
    || 'first_set_lost_converted, rated_groups, rating_delta_sum, opponent_strength_sum, '
    || 'opponent_strength_groups, upset_wins, first_played_at, first_game_group_id, last_played_at, '
    || 'last_game_group_id, sequence, recent, extrema, relations, activity';
  v_excluded text := pg_catalog.regexp_replace(c_vals, '([a-z_]+)', 'excluded.\1', 'g');
  v_current text := pg_catalog.regexp_replace(c_vals, '([a-z_]+)', 't.\1', 'g');
  v_select text;
  v_domain constant text := '($1 is null or (t.subject_kind <> ''community'' and t.subject_players && $1) '
    || 'or (t.subject_kind = ''community'' and t.subject_a = any ($2)))';
  v_changed integer := 0; n integer;
begin
  v_select := $sql$
    with cfg as (select (c.thresholds ->> 'upset_expected_score_max')::numeric as upset
                   from public.statistics_config c where c.active),
    g as (
      select f.* from public.statistics_group_facts f
       where $1 is null
          or f.community_id = any ($2)
          or exists (select 1 from public.statistics_participant_facts pf
                      where pf.game_group_id = f.game_group_id and pf.user_id = any ($1))
    ), u as (
      select 'player'::text as k, pf.user_id as a, public.statistics_nil_uuid() as b, array[pf.user_id] as players,
          pf.game_group_id as gid, pf.side, (pf.rating_calc_revision is not null) as rated,
          pf.rating_delta as delta, pf.expected_score as expected, pf.opponent_team_strength as opp_strength,
          pf.partner_id as partner, null::uuid as pair_id, null::uuid as opp_pair_id
        from public.statistics_participant_facts pf join g on g.game_group_id = pf.game_group_id
      union all
      select 'pair', pr.pair_id, public.statistics_nil_uuid(), array[pr.player_low, pr.player_high],
          pr.game_group_id, pr.side, (pr.rating_calc_revision is not null), null::numeric, pr.expected_score,
          pr.opponent_team_strength, null::uuid, pr.pair_id, pr.opponent_pair_id
        from public.statistics_pair_facts pr join g on g.game_group_id = pr.game_group_id
      union all
      select 'opponent', d.focal, d.other, array[d.focal, d.other], o.game_group_id, d.side,
          (d.delta is not null), d.delta, d.expected, d.strength, null::uuid, null::uuid, null::uuid
        from public.statistics_opponent_facts o join g on g.game_group_id = o.game_group_id
        cross join lateral (values
          (o.player_low, o.player_high, o.low_side, o.low_rating_delta, o.low_expected_score, o.low_opponent_strength),
          (o.player_high, o.player_low, case when o.low_side = 'team_a' then 'team_b' else 'team_a' end,
             o.high_rating_delta, o.high_expected_score, o.high_opponent_strength))
          d(focal, other, side, delta, expected, strength)
      union all
      select 'matchup', g.matchup_low_pair_id, g.matchup_high_pair_id,
          (select pg_catalog.array_agg(q order by q) from pg_catalog.unnest(g.team_a_players || g.team_b_players) q),
          g.game_group_id, g.matchup_low_side, false, null::numeric, null::numeric, null::numeric,
          null::uuid, null::uuid, null::uuid
        from g
      union all
      select 'community', g.community_id, public.statistics_nil_uuid(), '{}'::uuid[],
          g.game_group_id, 'team_a', false, null::numeric, null::numeric, null::numeric,
          null::uuid, null::uuid, null::uuid
        from g where $1 is null or g.community_id = any ($2)
    ), m as (
      select u.*, g.community_id, g.match_type,
          case when g.league_eligible then g.league_id end as league_id,
          g.played_at, g.played_day, g.quartet_id, g.matchup_id, g.team_a_players, g.team_b_players,
          g.team_a_pair_id, g.team_b_pair_id, g.three_set, g.incomplete_decider,
          case when g.classification = 'incomplete' then 'I' when g.classification = 'draw' then 'D'
               when u.k = 'community' then 'W' when g.classification = u.side then 'W' else 'L' end as outcome,
          case when u.k = 'community' then g.sets_a + g.sets_b when u.side = 'team_a' then g.sets_a else g.sets_b end as sets_w,
          case when u.k = 'community' then 0 when u.side = 'team_a' then g.sets_b else g.sets_a end as sets_l,
          case when u.k = 'community' then g.games_a + g.games_b when u.side = 'team_a' then g.games_a else g.games_b end as games_w,
          case when u.k = 'community' then 0 when u.side = 'team_a' then g.games_b else g.games_a end as games_l,
          case when u.k = 'community' then g.straight_winner is not null else g.straight_winner = u.side end as straight_w,
          (u.k <> 'community' and g.straight_winner is not null and g.straight_winner <> u.side) as straight_l,
          case when u.k = 'community' then g.deciding_winner is not null else g.deciding_winner = u.side end as dec_w,
          (u.k <> 'community' and g.deciding_winner is not null and g.deciding_winner <> u.side) as dec_l,
          (u.k <> 'community' and g.first_set_winner = u.side) as fs_won,
          (u.k <> 'community' and g.first_set_winner is not null and g.first_set_winner <> u.side) as fs_lost,
          (select o.opp1 from (select (case when u.side = 'team_a' then g.team_b_players else g.team_a_players end)[1] as opp1) o) as opp1,
          (case when u.side = 'team_a' then g.team_b_players else g.team_a_players end)[2] as opp2
        from u join g on g.game_group_id = u.gid
       where ($1 is null or u.k = 'community' or u.players && $1)
         and (u.k <> 'community' or $1 is null or g.community_id = any ($2))
    ), r as (
      select m.*, s.scope_kind, s.scope_id, t.mt,
          pg_catalog.jsonb_build_object('g', 1, 'w', (m.outcome = 'W')::integer, 'l', (m.outcome = 'L')::integer,
            'd', (m.outcome = 'D')::integer) as wld
        from m
        cross join lateral (values ('all', public.statistics_nil_uuid()), ('community', m.community_id),
          ('league', m.league_id)) s(scope_kind, scope_id)
        cross join lateral (values ('all'), (m.match_type)) t(mt)
       where s.scope_id is not null and not (m.k = 'community' and s.scope_kind = 'all')
    ), x as (
      select r.*,
          (case r.k
            when 'player' then pg_catalog.jsonb_build_object(
              'partners', pg_catalog.jsonb_build_object(r.partner::text, r.wld),
              'opponents', pg_catalog.jsonb_build_object(r.opp1::text, r.wld) || pg_catalog.jsonb_build_object(r.opp2::text, r.wld),
              'pairs', pg_catalog.jsonb_build_object(case when r.side = 'team_a' then r.team_a_pair_id else r.team_b_pair_id end::text, r.wld),
              'combos', pg_catalog.jsonb_build_object(r.quartet_id::text, pg_catalog.jsonb_build_object('g', 1)),
              'matchups', pg_catalog.jsonb_build_object(r.matchup_id::text, pg_catalog.jsonb_build_object('g', 1)))
            when 'pair' then pg_catalog.jsonb_build_object(
              'opponent_pairs', pg_catalog.jsonb_build_object(r.opp_pair_id::text, r.wld),
              'matchups', pg_catalog.jsonb_build_object(r.matchup_id::text, pg_catalog.jsonb_build_object('g', 1)))
            when 'community' then pg_catalog.jsonb_build_object(
              'players', (select pg_catalog.jsonb_object_agg(p::text, pg_catalog.jsonb_build_object('g', 1))
                            from pg_catalog.unnest(r.team_a_players || r.team_b_players) p),
              'pairs', pg_catalog.jsonb_build_object(r.team_a_pair_id::text, pg_catalog.jsonb_build_object('g', 1))
                || pg_catalog.jsonb_build_object(r.team_b_pair_id::text, pg_catalog.jsonb_build_object('g', 1)),
              'combos', pg_catalog.jsonb_build_object(r.quartet_id::text, pg_catalog.jsonb_build_object('g', 1)),
              'matchups', pg_catalog.jsonb_build_object(r.matchup_id::text, pg_catalog.jsonb_build_object('g', 1)))
            else '{}'::jsonb end)
          || case when r.league_id is not null then pg_catalog.jsonb_build_object('leagues',
               pg_catalog.jsonb_build_object(r.league_id::text, pg_catalog.jsonb_build_object('g', 1))) else '{}'::jsonb end as rel
        from r
    )
    select x.k as subject_kind, x.a as subject_a, x.b as subject_b, x.scope_kind, x.scope_id, x.mt as match_type,
        %1$s as played_day, x.players as subject_players,
        pg_catalog.count(*)::integer as confirmed_groups,
        (pg_catalog.count(*) filter (where x.outcome = 'W'))::integer as wins,
        (pg_catalog.count(*) filter (where x.outcome = 'L'))::integer as losses,
        (pg_catalog.count(*) filter (where x.outcome = 'D'))::integer as draws,
        (pg_catalog.count(*) filter (where x.outcome = 'I'))::integer as incomplete_groups,
        (pg_catalog.count(*) filter (where x.match_type = 'competitive'))::integer as competitive_groups,
        (pg_catalog.count(*) filter (where x.match_type = 'friendly'))::integer as friendly_groups,
        pg_catalog.sum(x.sets_w)::integer as sets_won, pg_catalog.sum(x.sets_l)::integer as sets_lost,
        pg_catalog.sum(x.games_w)::integer as games_won, pg_catalog.sum(x.games_l)::integer as games_lost,
        (pg_catalog.count(*) filter (where x.straight_w))::integer as straight_set_wins,
        (pg_catalog.count(*) filter (where x.straight_l))::integer as straight_set_losses,
        (pg_catalog.count(*) filter (where x.three_set))::integer as three_set_groups,
        (pg_catalog.count(*) filter (where x.incomplete_decider))::integer as incomplete_decider_groups,
        (pg_catalog.count(*) filter (where x.dec_w))::integer as deciding_set_wins,
        (pg_catalog.count(*) filter (where x.dec_l))::integer as deciding_set_losses,
        (pg_catalog.count(*) filter (where x.fs_won and x.outcome <> 'I'))::integer as first_set_won_groups,
        (pg_catalog.count(*) filter (where x.fs_won and x.outcome = 'W'))::integer as first_set_won_converted,
        (pg_catalog.count(*) filter (where x.fs_lost and x.outcome <> 'I'))::integer as first_set_lost_groups,
        (pg_catalog.count(*) filter (where x.fs_lost and x.outcome = 'W'))::integer as first_set_lost_converted,
        (pg_catalog.count(*) filter (where x.rated))::integer as rated_groups,
        coalesce(pg_catalog.sum(x.delta) filter (where x.rated), 0) as rating_delta_sum,
        coalesce(pg_catalog.sum(x.opp_strength) filter (where x.opp_strength is not null), 0) as opponent_strength_sum,
        (pg_catalog.count(*) filter (where x.opp_strength is not null))::integer as opponent_strength_groups,
        (pg_catalog.count(*) filter (where x.outcome = 'W' and x.expected is not null
          and x.expected <= (select upset from cfg)))::integer as upset_wins,
        pg_catalog.min(x.played_at) as first_played_at,
        (pg_catalog.array_agg(x.gid order by x.played_at, x.gid))[1] as first_game_group_id,
        pg_catalog.max(x.played_at) as last_played_at,
        (pg_catalog.array_agg(x.gid order by x.played_at desc, x.gid desc))[1] as last_game_group_id,
        public.statistics_seq_from(coalesce(pg_catalog.string_agg(x.outcome, '' order by x.played_at, x.gid)
          filter (where x.outcome <> 'I'), '')) as sequence,
        public.statistics_recent(coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('g', x.gid, 'o', x.outcome,
          'at', public.statistics_utc_text(x.played_at)) order by x.played_at, x.gid) filter (where x.outcome <> 'I'), '[]'::jsonb)) as recent,
        pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'cleanest_win', (pg_catalog.array_agg(public.statistics_cand(-(x.games_w - x.games_l)::numeric, (x.games_w - x.games_l)::numeric, x.played_at, x.gid)
            order by -(x.games_w - x.games_l), x.played_at, x.gid) filter (where x.outcome = 'W' and x.k <> 'community'))[1],
          'closest_win', (pg_catalog.array_agg(public.statistics_cand((x.games_w - x.games_l)::numeric, (x.games_w - x.games_l)::numeric, x.played_at, x.gid)
            order by (x.games_w - x.games_l), x.played_at, x.gid) filter (where x.outcome = 'W' and x.k <> 'community'))[1],
          'biggest_gain', (pg_catalog.array_agg(public.statistics_cand(-x.delta, x.delta, x.played_at, x.gid)
            order by -x.delta, x.played_at, x.gid) filter (where x.rated and x.delta > 0))[1],
          'biggest_loss', (pg_catalog.array_agg(public.statistics_cand(x.delta, x.delta, x.played_at, x.gid)
            order by x.delta, x.played_at, x.gid) filter (where x.rated and x.delta < 0))[1],
          'strongest_upset', (pg_catalog.array_agg(public.statistics_cand(x.expected, x.expected, x.played_at, x.gid)
            order by x.expected, x.played_at, x.gid) filter (where x.outcome = 'W' and x.expected is not null))[1],
          'toughest_loss', (pg_catalog.array_agg(public.statistics_cand(-x.expected, x.expected, x.played_at, x.gid)
            order by -x.expected, x.played_at, x.gid) filter (where x.outcome = 'L' and x.expected is not null))[1]
        )) as extrema,
        public.statistics_json_sum(x.rel) as relations,
        public.statistics_json_sum(pg_catalog.jsonb_build_object(
          'weeks', pg_catalog.jsonb_build_object(pg_catalog.date_trunc('week', x.played_day::timestamp)::date::text, 1),
          'months', pg_catalog.jsonb_build_object(pg_catalog.to_char(x.played_day, 'YYYY-MM'), 1))) as activity
      from x
     group by x.k, x.a, x.b, x.scope_kind, x.scope_id, x.mt, x.players%2$s
  $sql$;

  create temporary table if not exists pg_temp.statistics_expected_days
    (like public.statistics_daily_buckets including defaults) on commit drop;
  create temporary table if not exists pg_temp.statistics_expected_summaries
    (like public.statistics_scope_summaries including defaults) on commit drop;
  truncate pg_temp.statistics_expected_days;
  truncate pg_temp.statistics_expected_summaries;

  execute pg_catalog.format('insert into pg_temp.statistics_expected_days (' || c_keys || ', played_day, ' || c_vals
    || ') select ' || c_keys || ', played_day, ' || c_vals || ' from (' || v_select || ') q', 'x.played_day', ', x.played_day')
    using p_players, p_communities;
  execute pg_catalog.format('insert into pg_temp.statistics_expected_summaries (' || c_keys || ', ' || c_vals
    || ') select ' || c_keys || ', ' || c_vals || ' from (' || v_select || ') q', 'null::date', '')
    using p_players, p_communities;

  -- Daily buckets.
  execute 'delete from public.statistics_daily_buckets t where ' || v_domain
    || ' and not exists (select 1 from pg_temp.statistics_expected_days e where (e.subject_kind, e.subject_a, e.subject_b, '
    || 'e.scope_kind, e.scope_id, e.match_type, e.played_day) = (t.subject_kind, t.subject_a, t.subject_b, t.scope_kind, '
    || 't.scope_id, t.match_type, t.played_day))' using p_players, p_communities;
  get diagnostics n = row_count; v_changed := v_changed + n;
  execute 'insert into public.statistics_daily_buckets as t (' || c_keys || ', played_day, ' || c_vals || ') select '
    || c_keys || ', played_day, ' || c_vals || ' from pg_temp.statistics_expected_days '
    || 'on conflict (subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type, played_day) do update set '
    || (select pg_catalog.string_agg(c || ' = excluded.' || c, ', ')
          from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.replace(c_vals, ' ', ''), ',')) c)
    || ', updated_at = pg_catalog.clock_timestamp() where (' || v_current || ') is distinct from (' || v_excluded || ')';
  get diagnostics n = row_count; v_changed := v_changed + n;

  -- Lifetime summaries.
  execute 'delete from public.statistics_scope_summaries t where ' || v_domain
    || ' and not exists (select 1 from pg_temp.statistics_expected_summaries e where (e.subject_kind, e.subject_a, e.subject_b, '
    || 'e.scope_kind, e.scope_id, e.match_type) = (t.subject_kind, t.subject_a, t.subject_b, t.scope_kind, t.scope_id, t.match_type))'
    using p_players, p_communities;
  get diagnostics n = row_count; v_changed := v_changed + n;
  execute 'insert into public.statistics_scope_summaries as t (' || c_keys || ', ' || c_vals || ') select '
    || c_keys || ', ' || c_vals || ' from pg_temp.statistics_expected_summaries '
    || 'on conflict (subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type) do update set '
    || (select pg_catalog.string_agg(c || ' = excluded.' || c, ', ')
          from pg_catalog.unnest(pg_catalog.string_to_array(pg_catalog.replace(c_vals, ' ', ''), ',')) c)
    || ', updated_at = pg_catalog.clock_timestamp() where (' || v_current || ') is distinct from (' || v_excluded || ')';
  get diagnostics n = row_count; v_changed := v_changed + n;
  return v_changed;
end $$;

-- Aligns rating-derived fields to ONE committed rating revision, recomputes affected summaries and
-- bumps the published revision only when a business value changed. The caller holds the statistics
-- lock (finalizer: taken by project_source; rebuild: taken first) and, for the rating read, either
-- the rating lock (rebuild) or the projector's own transaction (finalizer).
create function public.statistics_publish(
  p_force_groups uuid[] default null, p_force_players uuid[] default null,
  p_force_communities uuid[] default null, p_all boolean default false) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.statistics_projection_control%rowtype;
  v_rating bigint; v_cands uuid[]; v_players uuid[]; v_comms uuid[]; v_summary integer := 0;
  v_dirty boolean; v_bumped boolean := false;
begin
  perform public.statistics_lock();
  perform public.statistics_pending_init();
  select * into v_control from public.statistics_projection_control k where k.singleton for update;
  select r.committed_revision into v_rating from public.player_rating_projection_control r;

  select coalesce(pg_catalog.array_agg(distinct q.gid), '{}'::uuid[]) into v_cands from (
      select pg.game_group_id as gid from pg_temp.statistics_pending_groups pg
      union
      select e.game_group_id from public.player_rating_event_calculations c
        join public.player_rating_events e on e.id = c.rating_event_id
       where c.projection_revision > v_control.rating_revision and c.projection_revision <= v_rating
      union
      select g from pg_catalog.unnest(coalesce(p_force_groups, '{}'::uuid[])) g
    ) q where exists (select 1 from public.statistics_group_facts f where f.game_group_id = q.gid);

  create temporary table if not exists pg_temp.statistics_rating_stage (
    game_group_id uuid, user_id uuid, calc_revision bigint, delta numeric, expected numeric,
    own_strength numeric, opp_strength numeric, before_level numeric, after_level numeric,
    before_rel smallint, after_rel smallint) on commit drop;
  truncate pg_temp.statistics_rating_stage;
  insert into pg_temp.statistics_rating_stage select * from public.statistics_rating_rows(v_cands, v_rating);

  with upd as (
    update public.statistics_participant_facts pf set
        rating_calc_revision = s.calc_revision, rating_delta = s.delta, expected_score = s.expected,
        own_team_strength = s.own_strength, opponent_team_strength = s.opp_strength,
        before_level = s.before_level, after_level = s.after_level,
        before_reliability = s.before_rel, after_reliability = s.after_rel,
        updated_at = pg_catalog.clock_timestamp()
      from public.statistics_participant_facts p0
      left join pg_temp.statistics_rating_stage s on s.game_group_id = p0.game_group_id and s.user_id = p0.user_id
     where pf.game_group_id = p0.game_group_id and pf.user_id = p0.user_id and pf.game_group_id = any (v_cands)
       and (pf.rating_calc_revision, pf.rating_delta, pf.expected_score, pf.own_team_strength,
            pf.opponent_team_strength, pf.before_level, pf.after_level, pf.before_reliability, pf.after_reliability)
         is distinct from (s.calc_revision, s.delta, s.expected, s.own_strength, s.opp_strength,
            s.before_level, s.after_level, s.before_rel, s.after_rel)
     returning pf.game_group_id)
  insert into pg_temp.statistics_pending_groups select distinct u.game_group_id from upd u on conflict do nothing;

  update public.statistics_pair_facts pr set
      rating_calc_revision = s.rev, expected_score = s.expected, own_team_strength = s.own,
      opponent_team_strength = s.opp, updated_at = pg_catalog.clock_timestamp()
    from (select pf.game_group_id, pf.side, pg_catalog.max(pf.rating_calc_revision) as rev,
              (pg_catalog.array_agg(pf.expected_score order by pf.user_id) filter (where pf.expected_score is not null))[1] as expected,
              (pg_catalog.array_agg(pf.own_team_strength order by pf.user_id) filter (where pf.own_team_strength is not null))[1] as own,
              (pg_catalog.array_agg(pf.opponent_team_strength order by pf.user_id) filter (where pf.opponent_team_strength is not null))[1] as opp
            from public.statistics_participant_facts pf where pf.game_group_id = any (v_cands)
           group by pf.game_group_id, pf.side) s
   where pr.game_group_id = s.game_group_id and pr.side = s.side
     and (pr.rating_calc_revision, pr.expected_score, pr.own_team_strength, pr.opponent_team_strength)
       is distinct from (s.rev, s.expected, s.own, s.opp);

  update public.statistics_opponent_facts o set
      low_rating_delta = pl.rating_delta, high_rating_delta = ph.rating_delta,
      low_expected_score = pl.expected_score, high_expected_score = ph.expected_score,
      low_opponent_strength = pl.opponent_team_strength, high_opponent_strength = ph.opponent_team_strength,
      updated_at = pg_catalog.clock_timestamp()
    from public.statistics_participant_facts pl, public.statistics_participant_facts ph
   where pl.game_group_id = o.game_group_id and pl.user_id = o.player_low
     and ph.game_group_id = o.game_group_id and ph.user_id = o.player_high
     and o.game_group_id = any (v_cands)
     and (o.low_rating_delta, o.high_rating_delta, o.low_expected_score, o.high_expected_score,
          o.low_opponent_strength, o.high_opponent_strength)
       is distinct from (pl.rating_delta, ph.rating_delta, pl.expected_score, ph.expected_score,
          pl.opponent_team_strength, ph.opponent_team_strength);

  -- The group's rating revision is the newest calculation its participants reflect: stable across
  -- rebuilds of unchanged data, advanced only by a replay that really changed the group.
  update public.statistics_group_facts f
     set rating_revision = (select pg_catalog.max(pf.rating_calc_revision) from public.statistics_participant_facts pf
                             where pf.game_group_id = f.game_group_id)
   where f.game_group_id = any (v_cands)
     and f.rating_revision is distinct from (select pg_catalog.max(pf.rating_calc_revision)
           from public.statistics_participant_facts pf where pf.game_group_id = f.game_group_id);

  v_dirty := exists (select 1 from pg_temp.statistics_pending_groups)
    or exists (select 1 from pg_temp.statistics_pending_players)
    or exists (select 1 from pg_temp.statistics_pending_communities);

  if p_all then
    v_summary := public.statistics_apply_summaries(null, null);
  elsif v_dirty or p_force_players is not null or p_force_communities is not null then
    select coalesce(pg_catalog.array_agg(distinct q.u), '{}'::uuid[]) into v_players from (
        select pf.user_id as u from public.statistics_participant_facts pf
         where pf.game_group_id in (select pg.game_group_id from pg_temp.statistics_pending_groups pg)
        union select pp.user_id from pg_temp.statistics_pending_players pp
        union select x from pg_catalog.unnest(coalesce(p_force_players, '{}'::uuid[])) x) q;
    select coalesce(pg_catalog.array_agg(distinct q.c), '{}'::uuid[]) into v_comms from (
        select f.community_id as c from public.statistics_group_facts f
         where f.game_group_id in (select pg.game_group_id from pg_temp.statistics_pending_groups pg)
        union select pc.community_id from pg_temp.statistics_pending_communities pc
        union select x from pg_catalog.unnest(coalesce(p_force_communities, '{}'::uuid[])) x) q;
    v_summary := public.statistics_apply_summaries(v_players, v_comms);
  end if;

  if v_dirty or v_summary > 0 then
    update public.statistics_projection_control k
       set revision = k.revision + 1, rating_revision = v_rating, updated_at = pg_catalog.clock_timestamp()
     where k.singleton;
    v_bumped := true;
  elsif v_control.rating_revision <> v_rating then
    update public.statistics_projection_control k
       set rating_revision = v_rating, updated_at = pg_catalog.clock_timestamp() where k.singleton;
  end if;

  truncate pg_temp.statistics_pending_groups, pg_temp.statistics_pending_players, pg_temp.statistics_pending_communities;
  return pg_catalog.jsonb_build_object('revision', (select k.revision from public.statistics_projection_control k),
    'rating_revision', v_rating, 'changed', v_bumped, 'summary_rows_changed', v_summary);
end $$;

-- Validates the derived cardinalities and the summary partition after a rebuild.
create function public.statistics_assert_consistent(p_community_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_groups bigint; v_official bigint; v_bad bigint;
begin
  select pg_catalog.count(*) into v_groups from public.statistics_group_facts f
   where p_community_id is null or f.community_id = p_community_id;
  select pg_catalog.count(*) into v_official from public.statistics_official_groups() og
   where p_community_id is null or og.community_id = p_community_id;
  select pg_catalog.count(*) into v_bad from (
    select 1 where v_groups <> v_official
    union all
    select 1 where (select pg_catalog.count(*) from public.statistics_participant_facts pf
      where p_community_id is null or pf.community_id = p_community_id) <> 4 * v_groups
    union all
    select 1 where (select pg_catalog.count(*) from public.statistics_pair_facts pr
      where p_community_id is null or pr.community_id = p_community_id) <> 2 * v_groups
    union all
    select 1 where (select pg_catalog.count(*) from public.statistics_opponent_facts o
      where p_community_id is null or o.community_id = p_community_id) <> 4 * v_groups
    union all
    select 1 from public.statistics_scope_summaries s
     where s.subject_kind = 'community' and s.scope_kind = 'community' and s.match_type = 'all'
       and (p_community_id is null or s.subject_a = p_community_id)
       and s.confirmed_groups <> (select pg_catalog.count(*) from public.statistics_group_facts f where f.community_id = s.subject_a)
    union all
    select 1 where p_community_id is null and (
      select coalesce(pg_catalog.sum(s.confirmed_groups), 0) from public.statistics_scope_summaries s
       where s.subject_kind = 'player' and s.scope_kind = 'all' and s.match_type = 'all')
      <> (select pg_catalog.count(*) from public.statistics_participant_facts)
  ) q;
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'STATISTICS_REBUILD_INCONSISTENT';
  end if;
end $$;

-- Internal repair entry (also the backfill). Complete replacement of the affected facts and
-- summaries; unchanged input rewrites nothing and publishes no new revision.
create function public.rebuild_statistics(p_community_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_gids uuid[]; v_changed integer; v_players uuid[]; v_result jsonb;
begin
  if p_community_id is not null and not exists (select 1 from public.communities c where c.id = p_community_id) then
    raise exception using errcode = 'P0002', message = 'COMMUNITY_NOT_FOUND';
  end if;
  -- Community locks first (every result command serializes here), then the statistics lock.
  perform 1 from public.communities c where p_community_id is null or c.id = p_community_id order by c.id for update;
  perform public.lock_global_rating_projection();
  perform public.statistics_lock();
  perform public.statistics_pending_init();

  select coalesce(pg_catalog.array_agg(q.gid), '{}'::uuid[]) into v_gids from (
      select og.game_group_id as gid from public.statistics_official_groups() og
       where p_community_id is null or og.community_id = p_community_id
      union
      select f.game_group_id from public.statistics_group_facts f
       where p_community_id is null or f.community_id = p_community_id) q;
  v_changed := public.statistics_project_source(v_gids);

  -- Rating-derived fields are aligned last, under the rating lock taken above.
  if p_community_id is null then
    v_result := public.statistics_publish(v_gids, null, null, true);
  else
    select coalesce(pg_catalog.array_agg(distinct pf.user_id), '{}'::uuid[]) into v_players
      from public.statistics_participant_facts pf where pf.community_id = p_community_id;
    v_result := public.statistics_publish(v_gids, v_players, array[p_community_id], false);
  end if;
  perform public.statistics_assert_consistent(p_community_id);
  return v_result || pg_catalog.jsonb_build_object('groups_replaced', v_changed, 'groups', pg_catalog.cardinality(v_gids));
end $$;

revoke all on function public.statistics_lock(), public.statistics_pending_init(),
  public.statistics_json_add(jsonb, jsonb), public.statistics_seq_from(text), public.statistics_recent(jsonb),
  public.statistics_cand(numeric, numeric, timestamptz, uuid), public.statistics_rating_rows(uuid[], bigint),
  public.statistics_project_source(uuid[]), public.statistics_apply_summaries(uuid[], uuid[]),
  public.statistics_publish(uuid[], uuid[], uuid[], boolean), public.statistics_assert_consistent(uuid),
  public.rebuild_statistics(uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.statistics_json_sum(jsonb) from public, anon, authenticated, service_role;

-- Finalizer integration (replaces the 20261101195000 definition by patching the four projector
-- call sites, the same technique earlier migrations used): statistics facts follow the League hook
-- and precede the rating projector; the rating-aligned publication follows the projector.
do $finalizer$
declare v_definition text; v_updated text; v_pair text[];
begin
  v_definition := pg_catalog.pg_get_functiondef(
    'public.finalize_match_event_result_locked(uuid, bigint, text, uuid)'::regprocedure);
  v_updated := v_definition;
  foreach v_pair slice 1 in array array[
    array['perform public.project_league_confirmation(v_existing.id);',
          E'perform public.project_league_confirmation(v_existing.id);\n      perform public.statistics_project_source(array[p_proposal_id]);'],
    array['perform public.project_confirmed_rating_group(p_proposal_id);',
          E'perform public.project_confirmed_rating_group(p_proposal_id);\n      perform public.statistics_publish();'],
    array['perform public.project_league_confirmation(v_confirmation_id);',
          E'perform public.project_league_confirmation(v_confirmation_id);\n  perform public.statistics_project_source(array[v_proposal.id]);'],
    array['perform public.project_confirmed_rating_group(v_proposal.id);',
          E'perform public.project_confirmed_rating_group(v_proposal.id);\n  perform public.statistics_publish();']
  ] loop
    if pg_catalog.strpos(v_updated, v_pair[1]) = 0 then
      raise exception 'Unexpected finalize_match_event_result_locked definition; missing %', v_pair[1];
    end if;
    v_updated := pg_catalog.replace(v_updated, v_pair[1], v_pair[2]);
  end loop;
  execute v_updated;
end $finalizer$;

-- Backfill: every confirmed Friendly, Competitive and Incomplete group, in one atomic rebuild.
select public.rebuild_statistics(null);

commit;
