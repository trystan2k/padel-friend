begin;

-- PAF-13 / U1 (1/2): statistics domain. Rebuildable facts, scope summaries and daily buckets.
--
-- Contract (docs/plan/Plan PAF-13 T13, "Shared contracts and calculation decisions"):
--   * Counting unit is the Game Group (game_group_id = result proposal id, never the confirmation
--     UUID). statistics_official_groups() is the ONE canonical source: official confirmation +
--     exact immutable proposal version + actual teams + event community/type/League. The
--     statistics_official_confirmations() seam decides which confirmation is official, so a later
--     amendment workflow replaces that one function and no reader.
--   * Facts (group, participant, pair, opponent) are DERIVED and rebuildable, never authority.
--     Reserve registrations are not part of the version teams, so they never get facts.
--   * statistics_scope_summaries (lifetime) and statistics_daily_buckets (UTC played day) carry the
--     same additive counters and ordered reductions per subject x scope x match type, so a date
--     range is an associative merge of daily rows and never a history scan.
--   * Every table is internal: RLS enabled, no runtime grants. Only whitelisted readers are granted.
--   * Community subjects count each Game Group once and are orientation-neutral: 'wins' holds the
--     decided groups, 'losses' stays 0, sets_won/games_won hold the totals of both teams.

create function public.statistics_nil_uuid() returns uuid
language sql immutable set search_path = '' as $$
  select '00000000-0000-0000-0000-000000000000'::uuid;
$$;

-- Canonical pair identity: independent of player order and of team side. A self-pair is invalid.
create function public.statistics_pair_id(p_first uuid, p_second uuid) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p_first is null or p_second is null or p_first = p_second then
    raise exception using errcode = '22023', message = 'STATISTICS_PAIR_INVALID';
  end if;
  return pg_catalog.md5('pair:' || least(p_first, p_second)::text || ':' || greatest(p_first, p_second)::text)::uuid;
end $$;

-- Matchup identity: the two canonical pairs, sorted. A pair cannot face itself.
create function public.statistics_matchup_id(p_first_pair uuid, p_second_pair uuid) returns uuid
language plpgsql immutable set search_path = '' as $$
begin
  if p_first_pair is null or p_second_pair is null or p_first_pair = p_second_pair then
    raise exception using errcode = '22023', message = 'STATISTICS_MATCHUP_INVALID';
  end if;
  return pg_catalog.md5('matchup:' || least(p_first_pair, p_second_pair)::text || ':'
    || greatest(p_first_pair, p_second_pair)::text)::uuid;
end $$;

-- Actual quartet identity, independent of team and position.
create function public.statistics_quartet_id(p_players uuid[]) returns uuid
language plpgsql immutable set search_path = '' as $$
declare v_sorted uuid[];
begin
  select pg_catalog.array_agg(x order by x) into v_sorted from pg_catalog.unnest(p_players) x;
  if pg_catalog.cardinality(v_sorted) <> 4 or (select pg_catalog.count(distinct x) from pg_catalog.unnest(v_sorted) x) <> 4 then
    raise exception using errcode = '22023', message = 'STATISTICS_QUARTET_INVALID';
  end if;
  return pg_catalog.md5('quartet:' || pg_catalog.array_to_string(v_sorted, ':'))::uuid;
end $$;

create function public.statistics_utc_text(p_instant timestamptz) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.to_char(p_instant at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

create function public.statistics_thresholds_valid(p_thresholds jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_typeof(p_thresholds) = 'object'
    and (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p_thresholds) k) = array[
      'basic_min_denominator', 'best_opponent_min_meetings', 'best_partnership_min_matches',
      'closest_rivalry_min_meetings', 'community_leader_min_matches', 'extremum_min_facts',
      'form_min_resolved', 'lowest_established_min_states', 'rank_min_states',
      'rate_min_opportunities', 'upset_expected_score_max'];
$$;

-- Versioned thresholds (plan "Concrete insufficient-data defaults"). Returned with every response.
create table public.statistics_config (
  version integer primary key check (version >= 1),
  active boolean not null default false,
  thresholds jsonb not null check (public.statistics_thresholds_valid(thresholds)),
  created_at timestamptz not null default pg_catalog.clock_timestamp()
);
create unique index statistics_config_single_active on public.statistics_config (active) where active;
insert into public.statistics_config (version, active, thresholds) values (1, true, pg_catalog.jsonb_build_object(
  'basic_min_denominator', 1,
  'form_min_resolved', 1,
  'rate_min_opportunities', 3,
  'best_partnership_min_matches', 5,
  'best_opponent_min_meetings', 5,
  'closest_rivalry_min_meetings', 5,
  'community_leader_min_matches', 5,
  'extremum_min_facts', 1,
  'lowest_established_min_states', 1,
  'rank_min_states', 1,
  'upset_expected_score_max', 0.35));

-- Single control row: statistics publication revision (bumped only when business values change)
-- and the committed rating revision the rating-derived fields were last aligned to.
create table public.statistics_projection_control (
  singleton boolean primary key default true check (singleton),
  revision bigint not null default 0 check (revision >= 0),
  rating_revision bigint not null default 0 check (rating_revision >= 0),
  config_version integer not null references public.statistics_config(version) on delete restrict,
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into public.statistics_projection_control (config_version)
  select c.version from public.statistics_config c where c.active;

-- One row per logical Game Group. Teams are the ACTUAL played teams of the exact official version.
create table public.statistics_group_facts (
  game_group_id uuid primary key references public.match_event_result_proposals(id) on delete cascade,
  confirmation_id uuid not null references public.match_event_result_confirmations(id) on delete cascade,
  proposal_version bigint not null check (proposal_version >= 1),
  match_event_id uuid not null references public.match_events(id) on delete cascade,
  group_number bigint not null,
  community_id uuid not null references public.communities(id) on delete cascade,
  match_type text not null check (match_type in ('competitive', 'friendly')),
  league_id uuid,
  league_eligible boolean not null,
  rating_expected boolean not null,
  played_at timestamptz not null,
  played_day date not null,
  classification text not null check (classification in ('team_a', 'team_b', 'draw', 'incomplete')),
  confirmation_source text not null check (confirmation_source in ('MANUAL', 'AUTO_48H')),
  confirmed_at timestamptz not null,
  audit_event_id uuid,
  team_a_players uuid[] not null check (pg_catalog.cardinality(team_a_players) = 2),
  team_b_players uuid[] not null check (pg_catalog.cardinality(team_b_players) = 2),
  quartet_id uuid not null,
  team_a_pair_id uuid not null,
  team_b_pair_id uuid not null,
  matchup_id uuid not null,
  matchup_low_pair_id uuid not null,
  matchup_high_pair_id uuid not null,
  matchup_low_side text not null check (matchup_low_side in ('team_a', 'team_b')),
  sets jsonb not null,
  set_count integer not null check (set_count between 1 and 3),
  sets_a integer not null check (sets_a >= 0),
  sets_b integer not null check (sets_b >= 0),
  games_a integer not null check (games_a >= 0),
  games_b integer not null check (games_b >= 0),
  straight_winner text check (straight_winner in ('team_a', 'team_b')),
  three_set boolean not null,
  incomplete_decider boolean not null,
  deciding_winner text check (deciding_winner in ('team_a', 'team_b')),
  first_set_winner text check (first_set_winner in ('team_a', 'team_b')),
  source_hash text not null,
  rating_revision bigint check (rating_revision >= 0),
  projected_at timestamptz not null default pg_catalog.clock_timestamp(),
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint statistics_group_facts_confirmation_unique unique (confirmation_id),
  constraint statistics_group_facts_league_shape check (not league_eligible or (
    league_id is not null and match_type = 'competitive' and classification <> 'incomplete')),
  constraint statistics_group_facts_day check (played_day = (played_at at time zone 'UTC')::date)
);
create index statistics_group_facts_community_chronology
  on public.statistics_group_facts (community_id, played_at desc, game_group_id desc);
create index statistics_group_facts_league_chronology
  on public.statistics_group_facts (league_id, played_at desc, game_group_id desc) where league_id is not null;
create index statistics_group_facts_matchup
  on public.statistics_group_facts (matchup_low_pair_id, matchup_high_pair_id, played_at desc, game_group_id desc);
create index statistics_group_facts_event on public.statistics_group_facts (match_event_id);

-- Four actual players per group, oriented to the player's own side.
create table public.statistics_participant_facts (
  game_group_id uuid not null references public.statistics_group_facts(game_group_id) on delete cascade,
  user_id uuid not null,
  side text not null check (side in ('team_a', 'team_b')),
  partner_id uuid not null,
  community_id uuid not null,
  match_type text not null check (match_type in ('competitive', 'friendly')),
  league_id uuid,
  league_eligible boolean not null,
  played_at timestamptz not null,
  played_day date not null,
  rating_expected boolean not null,
  rating_calc_revision bigint check (rating_calc_revision >= 1),
  rating_delta numeric,
  expected_score numeric,
  own_team_strength numeric,
  opponent_team_strength numeric,
  before_level numeric,
  after_level numeric,
  before_reliability smallint,
  after_reliability smallint,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (game_group_id, user_id),
  constraint statistics_participant_facts_partner check (partner_id <> user_id),
  constraint statistics_participant_facts_rating_shape check (
    (rating_calc_revision is null) = (rating_delta is null)
    and (rating_calc_revision is null) = (expected_score is null))
);
create index statistics_participant_facts_player_chronology
  on public.statistics_participant_facts (user_id, played_at desc, game_group_id desc);
create index statistics_participant_facts_community_player
  on public.statistics_participant_facts (community_id, user_id, played_at desc);

-- Two canonical teams per group. player_low < player_high; pair_id is the canonical identity.
create table public.statistics_pair_facts (
  game_group_id uuid not null references public.statistics_group_facts(game_group_id) on delete cascade,
  side text not null check (side in ('team_a', 'team_b')),
  player_low uuid not null,
  player_high uuid not null,
  pair_id uuid not null,
  opponent_pair_id uuid not null,
  matchup_id uuid not null,
  community_id uuid not null,
  match_type text not null check (match_type in ('competitive', 'friendly')),
  league_id uuid,
  league_eligible boolean not null,
  played_at timestamptz not null,
  played_day date not null,
  rating_expected boolean not null,
  rating_calc_revision bigint check (rating_calc_revision >= 1),
  expected_score numeric,
  own_team_strength numeric,
  opponent_team_strength numeric,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (game_group_id, side),
  constraint statistics_pair_facts_canonical check (player_low < player_high)
);
create index statistics_pair_facts_low on public.statistics_pair_facts (player_low, player_high, played_at desc, game_group_id desc);
create index statistics_pair_facts_high on public.statistics_pair_facts (player_high, player_low, played_at desc, game_group_id desc);
create index statistics_pair_facts_pair on public.statistics_pair_facts (pair_id, played_at desc, game_group_id desc);

-- Four unordered cross-team relationships per group. The outcome is oriented from player_low via
-- low_side; both players' rating effects are kept so a focal reader never reverses a delta.
create table public.statistics_opponent_facts (
  game_group_id uuid not null references public.statistics_group_facts(game_group_id) on delete cascade,
  player_low uuid not null,
  player_high uuid not null,
  low_side text not null check (low_side in ('team_a', 'team_b')),
  community_id uuid not null,
  match_type text not null check (match_type in ('competitive', 'friendly')),
  league_id uuid,
  league_eligible boolean not null,
  played_at timestamptz not null,
  played_day date not null,
  rating_expected boolean not null,
  low_rating_delta numeric,
  high_rating_delta numeric,
  low_expected_score numeric,
  high_expected_score numeric,
  low_opponent_strength numeric,
  high_opponent_strength numeric,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (game_group_id, player_low, player_high),
  constraint statistics_opponent_facts_canonical check (player_low < player_high)
);
create index statistics_opponent_facts_low on public.statistics_opponent_facts (player_low, player_high, played_at desc, game_group_id desc);
create index statistics_opponent_facts_high on public.statistics_opponent_facts (player_high, player_low, played_at desc, game_group_id desc);

-- Summary columns shared by lifetime summaries and daily buckets (identical business shape so a
-- bucket merge and a lifetime row are directly comparable).
--   subject_kind: player | pair | opponent (directed: subject_a = focal) | matchup | community
--   scope_kind:   all (every community, scope_id = nil) | community | league (eligible bound groups)
--   match_type:   all | competitive | friendly
-- subject_players lists the players a subject involves (empty for community subjects) so targeted
-- refreshes find every affected row with one overlap lookup.
create table public.statistics_scope_summaries (
  subject_kind text not null check (subject_kind in ('player', 'pair', 'opponent', 'matchup', 'community')),
  subject_a uuid not null,
  subject_b uuid not null default '00000000-0000-0000-0000-000000000000',
  scope_kind text not null check (scope_kind in ('all', 'community', 'league')),
  scope_id uuid not null default '00000000-0000-0000-0000-000000000000',
  match_type text not null check (match_type in ('all', 'competitive', 'friendly')),
  subject_players uuid[] not null default '{}',
  confirmed_groups integer not null default 0 check (confirmed_groups >= 0),
  wins integer not null default 0 check (wins >= 0),
  losses integer not null default 0 check (losses >= 0),
  draws integer not null default 0 check (draws >= 0),
  incomplete_groups integer not null default 0 check (incomplete_groups >= 0),
  competitive_groups integer not null default 0 check (competitive_groups >= 0),
  friendly_groups integer not null default 0 check (friendly_groups >= 0),
  sets_won integer not null default 0 check (sets_won >= 0),
  sets_lost integer not null default 0 check (sets_lost >= 0),
  games_won integer not null default 0 check (games_won >= 0),
  games_lost integer not null default 0 check (games_lost >= 0),
  straight_set_wins integer not null default 0 check (straight_set_wins >= 0),
  straight_set_losses integer not null default 0 check (straight_set_losses >= 0),
  three_set_groups integer not null default 0 check (three_set_groups >= 0),
  incomplete_decider_groups integer not null default 0 check (incomplete_decider_groups >= 0),
  deciding_set_wins integer not null default 0 check (deciding_set_wins >= 0),
  deciding_set_losses integer not null default 0 check (deciding_set_losses >= 0),
  first_set_won_groups integer not null default 0 check (first_set_won_groups >= 0),
  first_set_won_converted integer not null default 0 check (first_set_won_converted >= 0),
  first_set_lost_groups integer not null default 0 check (first_set_lost_groups >= 0),
  first_set_lost_converted integer not null default 0 check (first_set_lost_converted >= 0),
  rated_groups integer not null default 0 check (rated_groups >= 0),
  rating_delta_sum numeric not null default 0,
  opponent_strength_sum numeric not null default 0,
  opponent_strength_groups integer not null default 0 check (opponent_strength_groups >= 0),
  upset_wins integer not null default 0 check (upset_wins >= 0),
  first_played_at timestamptz,
  first_game_group_id uuid,
  last_played_at timestamptz,
  last_game_group_id uuid,
  sequence jsonb not null default '{"n":0,"prefix":null,"suffix":null,"best_win":0,"best_loss":0}',
  recent jsonb not null default '[]',
  extrema jsonb not null default '{}',
  relations jsonb not null default '{}',
  activity jsonb not null default '{}',
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type),
  constraint statistics_summary_partition check (
    confirmed_groups = wins + losses + draws + incomplete_groups
    and confirmed_groups = competitive_groups + friendly_groups),
  constraint statistics_summary_scope_shape check ((scope_kind = 'all') = (scope_id = '00000000-0000-0000-0000-000000000000'))
);
create index statistics_scope_summaries_scope
  on public.statistics_scope_summaries (scope_kind, scope_id, subject_kind, match_type);
create index statistics_scope_summaries_second
  on public.statistics_scope_summaries (subject_kind, subject_b, scope_kind, scope_id, match_type);
create index statistics_scope_summaries_players
  on public.statistics_scope_summaries using gin (subject_players);

create table public.statistics_daily_buckets (
  like public.statistics_scope_summaries including defaults,
  played_day date not null,
  primary key (subject_kind, subject_a, subject_b, scope_kind, scope_id, match_type, played_day),
  constraint statistics_bucket_partition check (
    confirmed_groups = wins + losses + draws + incomplete_groups
    and confirmed_groups = competitive_groups + friendly_groups),
  constraint statistics_bucket_scope_shape check ((scope_kind = 'all') = (scope_id = '00000000-0000-0000-0000-000000000000')),
  constraint statistics_bucket_kind check (subject_kind in ('player', 'pair', 'opponent', 'matchup', 'community')),
  constraint statistics_bucket_scope_kind check (scope_kind in ('all', 'community', 'league')),
  constraint statistics_bucket_match_type check (match_type in ('all', 'competitive', 'friendly'))
);
create index statistics_daily_buckets_scope
  on public.statistics_daily_buckets (scope_kind, scope_id, subject_kind, match_type, played_day);
create index statistics_daily_buckets_second
  on public.statistics_daily_buckets (subject_kind, subject_b, scope_kind, scope_id, match_type, played_day);
create index statistics_daily_buckets_players
  on public.statistics_daily_buckets using gin (subject_players);

-- Rating-derived refresh finds changed calculations by revision (additive index; no behavior change).
create index player_rating_event_calculations_revision
  on public.player_rating_event_calculations (projection_revision);

-- Source seam: which confirmation is the official evidence of a Game Group. Today a group has at
-- most one confirmation (unique proposal_id), so the official one is that one. A later amendment
-- workflow replaces ONLY this function; never select an arbitrary MAX(version) here.
create function public.statistics_official_confirmations(p_game_group_ids uuid[] default null)
returns table (game_group_id uuid, confirmation_id uuid, proposal_version bigint)
language sql stable security definer set search_path = '' as $$
  select c.proposal_id, c.id, c.proposal_version
    from public.match_event_result_confirmations c
   where p_game_group_ids is null or c.proposal_id = any (p_game_group_ids);
$$;

-- One effective row per logical Game Group over the official confirmation and its exact immutable
-- version. league_eligible reuses the shared all-four historical Ranked check.
create function public.statistics_official_groups(p_game_group_ids uuid[] default null)
returns table (
  game_group_id uuid, confirmation_id uuid, proposal_version bigint, match_event_id uuid,
  group_number bigint, community_id uuid, match_type text, league_id uuid, league_eligible boolean,
  rating_expected boolean, played_at timestamptz, classification text, confirmation_source text,
  confirmed_at timestamptz, audit_event_id uuid, teams jsonb, sets jsonb)
language sql stable security definer set search_path = '' as $$
  select s.game_group_id, s.confirmation_id, s.proposal_version, c.match_event_id, c.group_number,
      e.community_id, e.event_type::text, e.league_id,
      coalesce(e.league_id is not null and e.event_type = 'competitive' and v.classification <> 'incomplete'
        and public.match_result_ranked_ineligibility(
          c.match_event_id, public.match_result_fact_quartet(v.teams), v.played_at_utc) is null, false),
      c.ratable_eligible and public.rating_v1_is_ratable(c.event_type::text, v.classification, 'confirmed'),
      v.played_at_utc, v.classification::text, c.source, c.confirmed_at,
      (select a.id from public.match_event_audit_log a
        where a.confirmation_id = c.id and a.action = 'result_confirmed' order by a.occurred_at, a.id limit 1),
      v.teams, v.sets
    from public.statistics_official_confirmations(p_game_group_ids) s
    join public.match_event_result_confirmations c on c.id = s.confirmation_id
    join public.match_event_result_proposal_versions v
      on v.proposal_id = s.game_group_id and v.version = s.proposal_version
    join public.match_events e on e.id = c.match_event_id;
$$;

-- Deterministic normal-set reductions (team_a perspective) of one official version.
-- Complete set: games once, set to the greater score. Incomplete set: recorded games, no set.
-- Only recorded normal games exist in the facts; tiebreak points are never games.
create function public.statistics_derive_sets(p_sets jsonb, p_classification text)
returns table (
  set_count integer, sets_a integer, sets_b integer, games_a integer, games_b integer,
  straight_winner text, three_set boolean, incomplete_decider boolean, deciding_winner text,
  first_set_winner text)
language sql immutable set search_path = '' as $$
  with s as (
    select (x ->> 'position')::integer as pos, (x ->> 'team_a_games')::integer as a,
        (x ->> 'team_b_games')::integer as b, (x ->> 'completed')::boolean as done
      from pg_catalog.jsonb_array_elements(p_sets) x
  ), agg as (
    select pg_catalog.count(*)::integer as n,
        (pg_catalog.count(*) filter (where done and a > b))::integer as won_a,
        (pg_catalog.count(*) filter (where done and b > a))::integer as won_b,
        pg_catalog.sum(a)::integer as g_a, pg_catalog.sum(b)::integer as g_b,
        (pg_catalog.count(*) filter (where done))::integer as completed,
        coalesce(pg_catalog.bool_or(pos = 3), false) as has_third,
        coalesce(pg_catalog.bool_or(pos = 3 and not done), false) as third_open,
        (pg_catalog.count(*) filter (where pos in (1, 2) and done and a > b))::integer as early_a,
        (pg_catalog.count(*) filter (where pos in (1, 2) and done and b > a))::integer as early_b,
        (pg_catalog.count(*) filter (where pos = 3 and done and a > b))::integer as third_a,
        (pg_catalog.count(*) filter (where pos = 3 and done and b > a))::integer as third_b,
        (pg_catalog.count(*) filter (where pos = 1 and done and a > b))::integer as first_a,
        (pg_catalog.count(*) filter (where pos = 1 and done and b > a))::integer as first_b
      from s
  )
  select n, won_a, won_b, g_a, g_b,
      case when p_classification in ('team_a', 'team_b') and n = 2 and completed = 2
        and (case when p_classification = 'team_a' then won_a else won_b end) = 2 then p_classification end,
      has_third, third_open,
      case when early_a = 1 and early_b = 1
        then case when third_a = 1 then 'team_a' when third_b = 1 then 'team_b' end end,
      case when first_a = 1 then 'team_a' when first_b = 1 then 'team_b' end
    from agg;
$$;

-- Internal tables: RLS on, no runtime access (same pattern as the League counters and the rating
-- ledger). Helpers and source functions are internal.
alter table public.statistics_config enable row level security;
alter table public.statistics_projection_control enable row level security;
alter table public.statistics_group_facts enable row level security;
alter table public.statistics_participant_facts enable row level security;
alter table public.statistics_pair_facts enable row level security;
alter table public.statistics_opponent_facts enable row level security;
alter table public.statistics_scope_summaries enable row level security;
alter table public.statistics_daily_buckets enable row level security;
revoke all on public.statistics_config, public.statistics_projection_control,
  public.statistics_group_facts, public.statistics_participant_facts, public.statistics_pair_facts,
  public.statistics_opponent_facts, public.statistics_scope_summaries, public.statistics_daily_buckets
  from public, anon, authenticated, service_role;

revoke all on function public.statistics_nil_uuid(), public.statistics_pair_id(uuid, uuid),
  public.statistics_matchup_id(uuid, uuid), public.statistics_quartet_id(uuid[]),
  public.statistics_utc_text(timestamptz), public.statistics_thresholds_valid(jsonb),
  public.statistics_official_confirmations(uuid[]),
  public.statistics_official_groups(uuid[]), public.statistics_derive_sets(jsonb, text)
  from public, anon, authenticated, service_role;

-- Whitelisted reader: applied thresholds, the published statistics revision and whether the
-- rating-derived fields are aligned to the committed rating revision (stale readers must retry).
create function public.get_statistics_config() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  return (select pg_catalog.jsonb_build_object(
      'config_version', c.version,
      'thresholds', c.thresholds,
      'statistics_revision', k.revision,
      'rating_revision', k.rating_revision,
      'rating_aligned', k.rating_revision = (select r.committed_revision from public.player_rating_projection_control r))
    from public.statistics_projection_control k
    join public.statistics_config c on c.version = k.config_version);
end $$;
revoke all on function public.get_statistics_config() from public, anon;
grant execute on function public.get_statistics_config() to authenticated;

commit;
