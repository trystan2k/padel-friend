begin;

-- PAF-13 / U3: historical community skill rank and best League position materialization.
--
-- Sources (authoritative only, nothing is invented):
--   * Skill rank: rating initializations (player_rating_initializations) + committed ledger revisions
--     (player_rating_event_calculations) + membership intervals (community_members.activated_at ..
--     valid_until). A boundary is any instant at which one of those facts began to apply. At every
--     boundary each ACTIVE, RATED member is ranked by the app-wide level: established members
--     (reliability >= 100, the rating-model.ts isReliabilityEstablished rule) first, then level desc.
--     Equal keys share a position (competition ranking 1, 1, 3), the same convention the League
--     rank function uses; no repository comparator for community skill rank existed to reuse.
--     Only changes of (status, rank, ranked cohort size, established flag, completeness) are stored, one row per player transition, with
--     the boundary's source references (membership rows, initializations, rating revisions).
--   * A boundary is "complete" when every active member had rating evidence. Rank rows before that
--     are kept but never counted as best-rank proof, and the reader exposes the coverage boundary.
--   * League position: every published immutable standings snapshot version of each League is kept
--     (one row per league, player and version), so best position = MIN over all versions with the
--     earliest version achieving it as provenance, and the closed-League position reads the latest
--     version. A position is only ever a published (or explicitly reconstructed) value. Leagues without a snapshot are
--     reported as a coverage boundary, never as a fabricated position.
--
-- Refresh hooks (lock graph preserved: community -> event -> League -> rating -> statistics):
--   * Hooks only MARK work in statistics_rank_dirty (append-only, no unique key, so a mark can never
--     block on another transaction) or call statistics_rank_refresh() AFTER the rating projector.
--   * Finalizer (and rating activation): statistics_rank_refresh() after statistics_publish() — it
--     detects committed rating revisions newer than the last aligned one (rating -> statistics).
--   * Rating initializations: initialize_global_player_rating_locked marks the player's communities.
--   * League standings publication (close, late confirmation, repair, reconstruction) marks the League
--     at the one publication seam, league_publish_standings; the refresh happens after it.
--   * Membership has no single seam, so a marker trigger records the change. A deferred constraint
--     trigger on the dirty table drains in the SAME transaction at commit (community -> statistics);
--     it never projects rating and never runs before the rating projector of a finalizer.
--   * Rebuild/repair (rebuild_statistics) also rebuilds ranks under its rating -> statistics locks.

create table public.statistics_rank_transitions (
  community_id uuid not null references public.communities(id) on delete cascade,
  player_id uuid not null,
  effective_from timestamptz not null,
  status text not null check (status in ('ranked', 'unrated', 'not_member')),
  skill_rank integer check (skill_rank >= 1),
  display_level numeric(4,2) check (display_level between 0 and 7),
  reliability_percent smallint check (reliability_percent between 0 and 100),
  established boolean,
  ranked_members integer check (ranked_members >= 1),
  complete boolean not null,
  rating_revision bigint check (rating_revision >= 1),
  provenance jsonb not null check (pg_catalog.jsonb_typeof(provenance) = 'object'),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (community_id, player_id, effective_from),
  constraint statistics_rank_transitions_shape check (
    (status = 'ranked') = (skill_rank is not null and display_level is not null
      and reliability_percent is not null and established is not null and ranked_members is not null)
    and (status = 'ranked' or (skill_rank is null and display_level is null and ranked_members is null)))
);
create index statistics_rank_transitions_player
  on public.statistics_rank_transitions (player_id, community_id, effective_from desc);

create table public.statistics_league_positions (
  league_id uuid not null,
  community_id uuid not null,
  player_id uuid not null,
  standings_version integer not null check (standings_version >= 1),
  league_position integer not null check (league_position >= 1),
  basis text not null check (basis in ('published', 'reconstructed')),
  period_start_at timestamptz not null,
  effective_end_at timestamptz not null,
  published_at timestamptz not null,
  primary key (league_id, player_id, standings_version),
  constraint statistics_league_positions_league_fk foreign key (league_id, community_id)
    references public.leagues (id, community_id) on delete cascade
);
create index statistics_league_positions_player on public.statistics_league_positions (player_id, community_id);

create table public.statistics_rank_control (
  singleton boolean primary key default true check (singleton),
  rating_revision bigint not null default 0 check (rating_revision >= 0),
  updated_at timestamptz not null default pg_catalog.clock_timestamp()
);
insert into public.statistics_rank_control default values;

create table public.statistics_rank_dirty (
  id bigint generated always as identity primary key,
  community_id uuid not null,
  player_id uuid,
  league_id uuid,
  cause text not null check (cause in ('membership', 'rating_initialization', 'league_standings')),
  marked_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint statistics_rank_dirty_subject check ((player_id is not null) <> (league_id is not null))
);

alter table public.statistics_rank_transitions enable row level security;
alter table public.statistics_league_positions enable row level security;
alter table public.statistics_rank_control enable row level security;
alter table public.statistics_rank_dirty enable row level security;
revoke all on public.statistics_rank_transitions, public.statistics_league_positions,
  public.statistics_rank_control, public.statistics_rank_dirty
  from public, anon, authenticated, service_role;

-- 1. Skill-rank timeline of one community, computed from authoritative sources only.
create function public.statistics_rank_compute(p_community_id uuid)
returns table (
  player_id uuid, effective_from timestamptz, status text, skill_rank integer, display_level numeric,
  reliability_percent smallint, established boolean, ranked_members integer, complete boolean,
  rating_revision bigint, provenance jsonb)
language sql stable security definer set search_path = '' as $$
  with members as (
    select m.id, m.user_id, m.activated_at as from_at, m.valid_until as until_at
      from public.community_members m
     where m.community_id = p_community_id and m.activated_at is not null
  ), players as (
    select distinct x.user_id from members x
  ), p_revs as (
    select distinct e.user_id, k.projection_revision as revision
      from players p
      join public.player_rating_events e on e.user_id = p.user_id
      join public.player_rating_event_calculations k on k.rating_event_id = e.id
  ), rev_at as (
    select r.revision, (select pg_catalog.max(k.calculated_at)
        from public.player_rating_event_calculations k where k.projection_revision = r.revision) as at
      from (select distinct pr.revision from p_revs pr) r
  ), inits as (
    select i.id, i.user_id, i.sequence, i.recorded_at as at, i.initial_level
      from public.player_rating_initializations i join players p on p.user_id = i.user_id
  ), events as (
    select i.at, 0 as ord, pg_catalog.jsonb_build_object('kind', 'initialization', 'initializationId', i.id) as ref from inits i
    union all
    select x.from_at, 1, pg_catalog.jsonb_build_object('kind', 'membership_start', 'memberId', x.id) from members x
    union all
    select x.until_at, 2, pg_catalog.jsonb_build_object('kind', 'membership_end', 'memberId', x.id) from members x
     where x.until_at is not null
    union all
    select r.at, 3, pg_catalog.jsonb_build_object('kind', 'rating_revision', 'revision', r.revision) from rev_at r
  ), bounds as (
    select e.at, pg_catalog.jsonb_agg(e.ref order by e.ord, e.ref::text) as refs
      from events e group by e.at
  ), p_states as (
    select pr.user_id, pr.revision, l.rating_event_id, l.level, l.reliability
      from p_revs pr
      cross join lateral (
        select e.id as rating_event_id, c.after_display_level as level, c.after_reliability_percent as reliability
          from public.player_rating_events e
          cross join lateral (
            select k.after_display_level, k.after_reliability_percent
              from public.player_rating_event_calculations k
             where k.rating_event_id = e.id and k.projection_revision <= pr.revision
             order by k.projection_revision desc limit 1) c
         where e.user_id = pr.user_id
         order by e.played_at desc, e.game_group_id desc limit 1) l
  ), active as (
    select distinct on (b.at, m.user_id) b.at, m.user_id
      from bounds b
      join members m on m.from_at <= b.at and (m.until_at is null or b.at < m.until_at)
     order by b.at, m.user_id
  ), state as (
    select a.at, a.user_id,
        coalesce(led.level, ini.initial_level) as level,
        case when led.level is not null then led.reliability when ini.initial_level is not null then 10 end as reliability,
        led.revision,
        case when led.level is not null then pg_catalog.jsonb_build_object(
               'source', 'ledger', 'ratingEventId', led.rating_event_id, 'ratingRevision', led.revision)
             when ini.initial_level is not null then pg_catalog.jsonb_build_object(
               'source', 'initialization', 'initializationId', ini.id) end as evidence
      from active a
      left join lateral (
        select s.* from p_states s join rev_at ra on ra.revision = s.revision
         where s.user_id = a.user_id and ra.at <= a.at order by s.revision desc limit 1) led on true
      left join lateral (
        select i.id, i.initial_level from inits i
         where i.user_id = a.user_id and i.at <= a.at order by i.sequence desc limit 1) ini on true
  ), ranked as (
    select s.*, (s.level is not null) as rated, (s.reliability >= 100) as established,
        pg_catalog.rank() over (partition by s.at, (s.level is not null)
          order by (s.reliability >= 100) desc nulls last, s.level desc) as place,
        pg_catalog.count(*) over (partition by s.at, (s.level is not null)) as cohort
      from state s
  ), bound_complete as (
    select s.at, pg_catalog.bool_and(s.level is not null) as complete from state s group by s.at
  ), grid as (
    select b.at, b.refs, p.user_id, coalesce(bc.complete, true) as complete
      from bounds b
      join players p on exists (select 1 from members m where m.user_id = p.user_id and m.from_at <= b.at)
      left join bound_complete bc on bc.at = b.at
  ), joined as (
    select g.at, g.refs, g.user_id, g.complete,
        case when r.user_id is null then 'not_member' when r.rated then 'ranked' else 'unrated' end as status,
        case when r.rated then r.place::integer end as place,
        case when r.rated then r.level end as level,
        case when r.rated then r.reliability::smallint end as reliability,
        case when r.rated then r.established end as established,
        case when r.rated then r.cohort::integer end as cohort,
        case when r.rated then r.revision end as revision,
        r.evidence
      from grid g left join ranked r on r.at = g.at and r.user_id = g.user_id
  ), marked as (
    select j.*,
        pg_catalog.lag(j.status) over w as prev_status,
        pg_catalog.lag(j.place) over w as prev_place,
        pg_catalog.lag(j.cohort) over w as prev_cohort,
        pg_catalog.lag(j.established) over w as prev_established,
        pg_catalog.lag(j.complete) over w as prev_complete
      from joined j window w as (partition by j.user_id order by j.at)
  )
  select m.user_id, m.at, m.status, m.place, m.level, m.reliability, m.established, m.cohort, m.complete,
      m.revision, pg_catalog.jsonb_build_object('boundary', m.refs, 'evidence', m.evidence)
    from marked m
   where m.prev_status is null or m.status is distinct from m.prev_status
      or m.place is distinct from m.prev_place or m.cohort is distinct from m.prev_cohort
      or m.established is distinct from m.prev_established or m.complete is distinct from m.prev_complete;
$$;

-- Replaces one community's stored transitions with the computed ones; unchanged rows are not rewritten.
create function public.statistics_rank_rebuild_community(p_community_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  if not exists (select 1 from public.communities c where c.id = p_community_id) then return 0; end if;
  with computed as materialized (
    select * from public.statistics_rank_compute(p_community_id)
  ), removed as (
    delete from public.statistics_rank_transitions t
     where t.community_id = p_community_id
       and not exists (select 1 from computed x where x.player_id = t.player_id and x.effective_from = t.effective_from)
    returning 1
  ), written as (
    insert into public.statistics_rank_transitions as t
      (community_id, player_id, effective_from, status, skill_rank, display_level, reliability_percent,
       established, ranked_members, complete, rating_revision, provenance)
    select p_community_id, x.player_id, x.effective_from, x.status, x.skill_rank, x.display_level,
        x.reliability_percent, x.established, x.ranked_members, x.complete, x.rating_revision, x.provenance
      from computed x
    on conflict (community_id, player_id, effective_from) do update set
      status = excluded.status, skill_rank = excluded.skill_rank, display_level = excluded.display_level,
      reliability_percent = excluded.reliability_percent, established = excluded.established,
      ranked_members = excluded.ranked_members, complete = excluded.complete,
      rating_revision = excluded.rating_revision, provenance = excluded.provenance,
      recorded_at = pg_catalog.clock_timestamp()
     where (t.status, t.skill_rank, t.display_level, t.reliability_percent, t.established, t.ranked_members,
            t.complete, t.rating_revision, t.provenance)
       is distinct from (excluded.status, excluded.skill_rank, excluded.display_level, excluded.reliability_percent,
            excluded.established, excluded.ranked_members, excluded.complete, excluded.rating_revision, excluded.provenance)
    returning 1
  )
  select (select pg_catalog.count(*) from removed) + (select pg_catalog.count(*) from written) into v_changed;
  return v_changed;
end $$;

-- Best-position source: every published immutable standings version of the League.
create function public.statistics_rank_refresh_league(p_league_id uuid) returns integer
language plpgsql security definer set search_path = '' as $$
declare v_changed integer;
begin
  with latest as (
    select s.league_id, s.community_id, s.standings_version, s.basis, s.period_start_at, s.effective_end_at,
        s.generated_at, (x.entry ->> 'user_id')::uuid as player_id, (x.entry ->> 'position')::integer as league_position
      from public.league_standings_snapshots s
      cross join lateral pg_catalog.jsonb_array_elements(s.entries) x(entry)
     where s.league_id = p_league_id
  ), removed as (
    delete from public.statistics_league_positions p
     where p.league_id = p_league_id
       and not exists (select 1 from latest l
                        where l.player_id = p.player_id and l.standings_version = p.standings_version)
    returning 1
  ), written as (
    insert into public.statistics_league_positions as p
      (league_id, community_id, player_id, standings_version, league_position, basis, period_start_at,
       effective_end_at, published_at)
    select l.league_id, l.community_id, l.player_id, l.standings_version, l.league_position, l.basis,
        l.period_start_at, l.effective_end_at, l.generated_at from latest l
    on conflict (league_id, player_id, standings_version) do update set
      league_position = excluded.league_position,
      basis = excluded.basis, period_start_at = excluded.period_start_at,
      effective_end_at = excluded.effective_end_at, published_at = excluded.published_at
     where (p.league_position, p.basis, p.period_start_at, p.effective_end_at, p.published_at)
       is distinct from (excluded.league_position, excluded.basis,
            excluded.period_start_at, excluded.effective_end_at, excluded.published_at)
    returning 1
  )
  select (select pg_catalog.count(*) from removed) + (select pg_catalog.count(*) from written) into v_changed;
  return v_changed;
end $$;

-- 2. Marks (append-only; never conflict with another transaction).
create function public.statistics_rank_mark_player(p_player_id uuid, p_cause text) returns void
language sql security definer set search_path = '' as $$
  insert into public.statistics_rank_dirty (community_id, player_id, cause)
  select distinct m.community_id, p_player_id, p_cause
    from public.community_members m where m.user_id = p_player_id and m.activated_at is not null;
$$;

create function public.statistics_rank_mark_league(p_league_id uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.statistics_rank_dirty (community_id, league_id, cause)
  select l.community_id, l.id, 'league_standings' from public.leagues l where l.id = p_league_id;
$$;

create function public.statistics_rank_membership_mark() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if old.activated_at is not null then
      insert into public.statistics_rank_dirty (community_id, player_id, cause) values (old.community_id, old.user_id, 'membership');
    end if;
  elsif new.activated_at is not null or (tg_op = 'UPDATE' and old.activated_at is not null) then
    if tg_op = 'INSERT' or (old.activated_at, old.valid_until, old.status)
       is distinct from (new.activated_at, new.valid_until, new.status) then
      insert into public.statistics_rank_dirty (community_id, player_id, cause) values (new.community_id, new.user_id, 'membership');
    end if;
  end if;
  return null;
end $$;
create trigger statistics_rank_membership_mark
  after insert or delete or update of status, valid_until, activated_at on public.community_members
  for each row execute function public.statistics_rank_membership_mark();

-- 3. Refresh: drains marks and committed rating revisions newer than the last aligned one. The caller
-- is either a finalizer/activation AFTER the rating projector (rating -> statistics), or the deferred
-- drain trigger of a transaction that holds only community/League locks (-> statistics).
create function public.statistics_rank_refresh() returns integer
language plpgsql security definer set search_path = '' as $$
declare
  v_rating bigint; v_seen bigint; v_ids bigint[]; v_comms uuid[]; v_leagues uuid[];
  v_item uuid; v_changed integer := 0;
begin
  select r.committed_revision into v_rating from public.player_rating_projection_control r;
  select k.rating_revision into v_seen from public.statistics_rank_control k;
  if v_rating = v_seen and not exists (select 1 from public.statistics_rank_dirty) then return 0; end if;
  perform public.statistics_lock();
  select r.committed_revision into v_rating from public.player_rating_projection_control r;
  select k.rating_revision into v_seen from public.statistics_rank_control k where k.singleton for update;
  select coalesce(pg_catalog.array_agg(d.id order by d.id), '{}'::bigint[]),
      coalesce(pg_catalog.array_agg(distinct d.community_id) filter (where d.league_id is null), '{}'::uuid[]),
      coalesce(pg_catalog.array_agg(distinct d.league_id) filter (where d.league_id is not null), '{}'::uuid[])
    into v_ids, v_comms, v_leagues from public.statistics_rank_dirty d;
  if v_rating > v_seen then
    v_comms := v_comms || array(
      select distinct m.community_id
        from public.player_rating_event_calculations k
        join public.player_rating_events e on e.id = k.rating_event_id
        join public.community_members m on m.user_id = e.user_id and m.activated_at is not null
       where k.projection_revision > v_seen and k.projection_revision <= v_rating);
  end if;
  for v_item in select distinct c from pg_catalog.unnest(v_comms) c order by c loop
    v_changed := v_changed + public.statistics_rank_rebuild_community(v_item);
  end loop;
  for v_item in select distinct l from pg_catalog.unnest(v_leagues) l order by l loop
    v_changed := v_changed + public.statistics_rank_refresh_league(v_item);
  end loop;
  delete from public.statistics_rank_dirty d where d.id = any (v_ids);
  update public.statistics_rank_control k
     set rating_revision = v_rating, updated_at = pg_catalog.clock_timestamp()
   where k.singleton and k.rating_revision <> v_rating;
  return v_changed;
end $$;

create function public.statistics_rank_dirty_drain() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.statistics_rank_refresh();
  return null;
end $$;
create constraint trigger statistics_rank_dirty_drain
  after insert on public.statistics_rank_dirty
  deferrable initially deferred
  for each row execute function public.statistics_rank_dirty_drain();

-- Full or per-community repair (also the backfill). Advances the aligned rating revision only on a full pass.
create function public.statistics_rank_rebuild(p_community_id uuid default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_item uuid; v_changed integer := 0; v_rating bigint;
begin
  perform public.statistics_lock();
  for v_item in select c.id from public.communities c where p_community_id is null or c.id = p_community_id order by c.id loop
    v_changed := v_changed + public.statistics_rank_rebuild_community(v_item);
  end loop;
  for v_item in select l.id from public.leagues l where p_community_id is null or l.community_id = p_community_id order by l.id loop
    v_changed := v_changed + public.statistics_rank_refresh_league(v_item);
  end loop;
  if p_community_id is null then
    select r.committed_revision into v_rating from public.player_rating_projection_control r;
    update public.statistics_rank_control k
       set rating_revision = v_rating, updated_at = pg_catalog.clock_timestamp()
     where k.singleton and k.rating_revision <> v_rating;
  end if;
  return pg_catalog.jsonb_build_object('changed', v_changed);
end $$;

-- 4. Reader helpers.
create function public.statistics_rank_value(
  p_position integer, p_provenance text, p_at timestamptz, p_community uuid, p_league uuid,
  p_version integer, p_revision bigint) returns jsonb
language sql immutable set search_path = '' as $$
  select pg_catalog.jsonb_build_object('position', p_position, 'provenance', p_provenance,
    'at', public.statistics_utc_text(p_at), 'communityId', p_community, 'leagueId', p_league,
    'standingsVersion', p_version, 'ratingRevision', p_revision);
$$;

create function public.statistics_rank_metric(
  p_state text, p_value jsonb, p_reason text, p_numerator numeric, p_denominator numeric, p_required integer)
returns jsonb language sql immutable set search_path = '' as $$
  select case p_state
    when 'ready' then pg_catalog.jsonb_build_object('state', 'ready', 'value', p_value,
      'numerator', p_numerator, 'denominator', p_denominator)
    when 'insufficient' then pg_catalog.jsonb_build_object('state', 'insufficient', 'value', null,
      'numerator', null, 'denominator', null, 'observed', 0, 'required', p_required, 'reason', p_reason)
    else pg_catalog.jsonb_build_object('state', 'unavailable', 'value', null, 'reason', p_reason) end;
$$;

-- The four rating-section rank metrics of get_player_statistics. The caller has already authorized
-- the viewer for this player/community/League scope.
create function public.statistics_player_rank_block(p_player_id uuid, p_community_id uuid, p_league_id uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_min integer;
  v_cur public.statistics_rank_transitions%rowtype;
  v_best public.statistics_rank_transitions%rowtype;
  v_pos public.statistics_league_positions%rowtype;
  v_league public.leagues%rowtype;
  v_cov record;
  v_has boolean;
  v_place integer;
  v_pending boolean;
  v_end timestamptz;
  v_from timestamptz;
  v_until timestamptz;
  v_skill_current jsonb;
  v_skill_best jsonb;
  v_league_active jsonb;
  v_league_best jsonb;
begin
  select (c.thresholds ->> 'rank_min_states')::integer into v_min
    from public.statistics_projection_control k join public.statistics_config c on c.version = k.config_version;

  -- Current community skill rank: the latest materialized transition of the selected community.
  if p_community_id is null then
    v_skill_current := public.statistics_rank_metric('unavailable', null, 'unavailable', null, null, v_min);
  else
    select * into v_cur from public.statistics_rank_transitions t
     where t.community_id = p_community_id and t.player_id = p_player_id
     order by t.effective_from desc limit 1;
    v_has := found;
    v_skill_current := case
      when not v_has or v_cur.status = 'not_member'
        then public.statistics_rank_metric('insufficient', null, 'not_ranked', null, null, v_min)
      when v_cur.status = 'unrated'
        then public.statistics_rank_metric('unavailable', null, 'missing_evidence', null, null, v_min)
      else public.statistics_rank_metric('ready', public.statistics_rank_value(
          v_cur.skill_rank, 'reconstructed', v_cur.effective_from, v_cur.community_id, null, null, v_cur.rating_revision),
        null, v_cur.skill_rank, v_cur.ranked_members, v_min) end;
  end if;

  -- Best historical skill rank: complete proof only; incomplete periods are a coverage boundary.
  select * into v_best from public.statistics_rank_transitions t
   where t.player_id = p_player_id and (p_community_id is null or t.community_id = p_community_id)
     and t.status = 'ranked' and t.complete
   order by t.skill_rank, t.effective_from, t.community_id limit 1;
  v_has := found;
  select pg_catalog.min(t.effective_from) filter (where t.status = 'ranked' and t.complete) as from_at,
      coalesce(pg_catalog.bool_or(t.status = 'unrated' or (t.status = 'ranked' and not t.complete)), false) as gap,
      (pg_catalog.count(*) filter (where t.status <> 'not_member'))::integer as evidence_rows
    into v_cov from public.statistics_rank_transitions t
   where t.player_id = p_player_id and (p_community_id is null or t.community_id = p_community_id);
  v_end := null;
  if p_community_id is not null then
    select t.effective_from into v_end from public.statistics_rank_transitions t
     where t.community_id = p_community_id and t.player_id = p_player_id and t.status = 'not_member'
       and not exists (select 1 from public.statistics_rank_transitions n
         where n.community_id = t.community_id and n.player_id = t.player_id and n.effective_from > t.effective_from);
  end if;
  v_skill_best := pg_catalog.jsonb_build_object(
    'best', case
      when v_has then public.statistics_rank_metric('ready', public.statistics_rank_value(
          v_best.skill_rank, 'reconstructed', v_best.effective_from, v_best.community_id, null, null, v_best.rating_revision),
        null, v_best.skill_rank, v_best.ranked_members, v_min)
      when v_cov.evidence_rows > 0
        then public.statistics_rank_metric('unavailable', null, 'rank_coverage_boundary', null, null, v_min)
      else public.statistics_rank_metric('insufficient', null, 'not_ranked', null, null, v_min) end,
    'coverageFrom', public.statistics_utc_text(v_cov.from_at),
    'coverageUntil', public.statistics_utc_text(v_end),
    'coverageComplete', v_cov.evidence_rows > 0 and not v_cov.gap,
    'coverageReason', case when v_cov.evidence_rows = 0 then 'no_history'
      when v_cov.gap then 'missing_rating_evidence' end);

  -- Active League position: live standings for an active League, the latest snapshot for a closed one.
  if p_community_id is null then
    v_league_active := public.statistics_rank_metric('unavailable', null, 'unavailable', null, null, v_min);
  else
    if p_league_id is not null then
      select * into v_league from public.leagues l where l.id = p_league_id;
    else
      select * into v_league from public.leagues l where l.community_id = p_community_id and l.status = 'active' limit 1;
    end if;
    v_has := found;
    if not v_has or v_league.status = 'upcoming' then
      v_league_active := public.statistics_rank_metric('insufficient', null, 'not_in_league', null, null, v_min);
    elsif v_league.status = 'closed' then
      select * into v_pos from public.statistics_league_positions lp
       where lp.league_id = v_league.id and lp.player_id = p_player_id
       order by lp.standings_version desc limit 1;
      v_league_active := case
        when found then public.statistics_rank_metric('ready', public.statistics_rank_value(
            v_pos.league_position, v_pos.basis, v_pos.published_at, v_pos.community_id, v_pos.league_id,
            v_pos.standings_version, null), null, v_pos.league_position, null, v_min)
        when exists (select 1 from public.league_standings_snapshots s where s.league_id = v_league.id)
          then public.statistics_rank_metric('insufficient', null, 'not_in_league', null, null, v_min)
        else public.statistics_rank_metric('unavailable', null, 'rank_coverage_boundary', null, null, v_min) end;
    else
      select e.place into v_place from public.league_standings_entries(v_league.id) e where e.user_id = p_player_id;
      v_league_active := case when v_place is null
        then public.statistics_rank_metric('insufficient', null, 'not_in_league', null, null, v_min)
        else public.statistics_rank_metric('ready', public.statistics_rank_value(
          v_place, 'published', pg_catalog.now(), v_league.community_id, v_league.id, null, null),
          null, v_place, null, v_min) end;
    end if;
  end if;

  -- Best League position over immutable standings versions; unpublished Leagues are a coverage boundary.
  select * into v_pos from public.statistics_league_positions lp
   where lp.player_id = p_player_id and (p_league_id is null or lp.league_id = p_league_id)
     and (p_community_id is null or lp.community_id = p_community_id)
   order by lp.league_position, lp.published_at, lp.standings_version, lp.league_id limit 1;
  v_has := found;
  select pg_catalog.min(lp.period_start_at), pg_catalog.max(lp.effective_end_at) into v_from, v_until
    from public.statistics_league_positions lp
   where lp.player_id = p_player_id and (p_league_id is null or lp.league_id = p_league_id)
     and (p_community_id is null or lp.community_id = p_community_id);
  select coalesce(pg_catalog.bool_or(l.status = 'active' or (l.status = 'closed' and not exists (
      select 1 from public.league_standings_snapshots s where s.league_id = l.id))), false) into v_pending
    from public.leagues l
   where (p_league_id is null or l.id = p_league_id) and (p_community_id is null or l.community_id = p_community_id)
     and exists (select 1 from public.community_members m
       where m.community_id = l.community_id and m.user_id = p_player_id and m.activated_at is not null);
  v_league_best := pg_catalog.jsonb_build_object(
    'best', case
      when v_has then public.statistics_rank_metric('ready', public.statistics_rank_value(
          v_pos.league_position, v_pos.basis, v_pos.published_at, v_pos.community_id, v_pos.league_id,
          v_pos.standings_version, null), null, v_pos.league_position, null, v_min)
      when v_pending then public.statistics_rank_metric('unavailable', null, 'rank_coverage_boundary', null, null, v_min)
      else public.statistics_rank_metric('insufficient', null, 'not_in_league', null, null, v_min) end,
    'coverageFrom', public.statistics_utc_text(v_from),
    'coverageUntil', public.statistics_utc_text(v_until),
    'coverageComplete', not v_pending,
    'coverageReason', case when v_pending then 'unpublished_league' end);

  return pg_catalog.jsonb_build_object('communitySkillRank', v_skill_current,
    'activeLeaguePosition', v_league_active, 'bestCommunitySkillRank', v_skill_best,
    'bestLeaguePosition', v_league_best);
end $$;

-- Rank history reader: skill-rank transitions (newest first) and final League positions.
create function public.get_player_statistics_rank_history(
  p_player_id uuid, p_community_id uuid default null, p_limit integer default 50
) returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid;
begin
  perform public.assert_actor_not_provisional();
  v_actor := public.statistics_read_actor();
  if p_player_id is null or p_limit is null or p_limit < 1 or p_limit > 200 then
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
  return pg_catalog.jsonb_build_object(
    'player_id', p_player_id, 'communityId', p_community_id,
    'transitions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'communityId', t.community_id, 'effectiveFrom', public.statistics_utc_text(t.effective_from),
        'status', t.status, 'position', t.skill_rank, 'level', t.display_level,
        'reliability', t.reliability_percent, 'established', t.established,
        'rankedMembers', t.ranked_members, 'complete', t.complete, 'ratingRevision', t.rating_revision,
        'source', t.provenance #>> '{evidence,source}') order by t.effective_from desc, t.community_id)
      from (select * from public.statistics_rank_transitions x
             where x.player_id = p_player_id and (p_community_id is null or x.community_id = p_community_id)
             order by x.effective_from desc, x.community_id limit p_limit) t), '[]'::jsonb),
    'truncated', (select pg_catalog.count(*) from public.statistics_rank_transitions x
        where x.player_id = p_player_id and (p_community_id is null or x.community_id = p_community_id)) > p_limit,
    'leaguePositions', coalesce((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'communityId', lp.community_id, 'leagueId', lp.league_id, 'standingsVersion', lp.standings_version,
        'position', lp.league_position, 'provenance', lp.basis,
        'publishedAt', public.statistics_utc_text(lp.published_at)) order by lp.published_at desc, lp.league_id)
      from public.statistics_league_positions lp
     where lp.player_id = p_player_id and (p_community_id is null or lp.community_id = p_community_id)), '[]'::jsonb));
end $$;

revoke all on function public.statistics_rank_compute(uuid), public.statistics_rank_rebuild_community(uuid),
  public.statistics_rank_refresh_league(uuid), public.statistics_rank_mark_player(uuid, text),
  public.statistics_rank_mark_league(uuid), public.statistics_rank_membership_mark(),
  public.statistics_rank_refresh(), public.statistics_rank_dirty_drain(), public.statistics_rank_rebuild(uuid),
  public.statistics_rank_value(integer, text, timestamptz, uuid, uuid, integer, bigint),
  public.statistics_rank_metric(text, jsonb, text, numeric, numeric, integer),
  public.statistics_player_rank_block(uuid, uuid, uuid)
  from public, anon, authenticated, service_role;
revoke all on function public.get_player_statistics_rank_history(uuid, uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_player_statistics_rank_history(uuid, uuid, integer) to authenticated;

-- 5. get_player_statistics: the rank placeholders become the materialized metrics.
-- Player reads use published summaries for lifetime and indexed daily buckets for date filters.
-- Merge ordered bucket reductions chronologically; never replay raw result history.
-- Never disclose an all-communities aggregate belonging to another player.
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
    'filteredDelta', v_result -> 'filteredDelta') || public.statistics_player_rank_block(p_player_id, p_community_id, p_league_id));
  return v_result;
end $$;
revoke all on function public.get_player_statistics(uuid, uuid, uuid, text, date, date)
  from public, anon, authenticated, service_role;
grant execute on function public.get_player_statistics(uuid, uuid, uuid, text, date, date) to authenticated;


-- 6. Hooks into existing seams (the same pg_get_functiondef patch technique earlier migrations use).
do $patch$
declare v_target record; v_definition text;
begin
  for v_target in select * from (values
    ('public.finalize_match_event_result_locked(uuid, bigint, text, uuid)',
     'perform public.statistics_publish();',
     E'perform public.statistics_publish();\n  perform public.statistics_rank_refresh();'),
    ('public.initialize_global_player_rating_locked(uuid, numeric, text)',
     'perform public.lock_global_rating_projection();',
     E'perform public.lock_global_rating_projection();\n  perform public.statistics_rank_mark_player(p_user_id, ''rating_initialization'');'),
    ('public.activate_global_rating_projection()',
     'return pg_catalog.jsonb_build_object(',
     E'perform public.statistics_rank_refresh();\n  return pg_catalog.jsonb_build_object('),
    ('public.league_publish_standings(uuid, text, uuid, timestamp with time zone, text)',
     'return v_version;',
     E'perform public.statistics_rank_mark_league(p_league_id);\n  return v_version;'),
    ('public.rebuild_statistics(uuid)',
     'perform public.statistics_assert_consistent(p_community_id);',
     E'perform public.statistics_assert_consistent(p_community_id);\n  perform public.statistics_rank_rebuild(p_community_id);')
  ) t(signature, needle, replacement) loop
    v_definition := pg_catalog.pg_get_functiondef(v_target.signature::regprocedure);
    if pg_catalog.strpos(v_definition, v_target.needle) = 0 then
      raise exception 'Unexpected % definition; missing %', v_target.signature, v_target.needle;
    end if;
    execute pg_catalog.replace(v_definition, v_target.needle, v_target.replacement);
  end loop;
end $patch$;

-- Backfill from the authoritative history.
select public.statistics_rank_rebuild(null);

commit;
