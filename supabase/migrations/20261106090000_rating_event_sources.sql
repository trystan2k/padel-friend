begin;

-- T15.3 (1/2): append-only effective rating sources and the correction-aware replay.
--
-- player_rating_events keeps its birth evidence (original confirmation/version/time) forever.
-- Which confirmation currently backs an event, whether the event counts at all, and its
-- played time are decided by player_rating_event_sources: one append-only row per
-- (event, projection revision). The source in force at a committed revision is the latest
-- row at or below it; calculations bind the source revision they were computed for, so a
-- changed source always produces new calculation evidence.
--
-- Lock graph (unchanged): community/event/profile/version FK coverage -> global rating
-- projection -> statistics. Nothing here takes a lock upstream of the rating lock.

-- 1. Source revisions. Logical event identity is shared by game group and user; the
-- composite key keeps a source from pointing at another group's event.
alter table public.player_rating_events
  add constraint player_rating_event_group_identity unique (id, game_group_id);

create table public.player_rating_event_sources (
  rating_event_id uuid not null,
  projection_revision bigint not null check (projection_revision >= 1),
  game_group_id uuid not null,
  is_active boolean not null,
  confirmation_id uuid not null,
  proposal_version bigint not null,
  played_at timestamptz not null,
  reason text not null check (reason in ('birth', 'corrected', 'restored', 'removed', 'invalidated')),
  repair_job_id uuid references public.result_repair_jobs(id) on delete restrict,
  amendment_id uuid references public.result_amendment_requests(id) on delete restrict,
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (rating_event_id, projection_revision),
  constraint player_rating_event_source_event_fk foreign key (rating_event_id, game_group_id)
    references public.player_rating_events(id, game_group_id) on delete restrict,
  constraint player_rating_event_source_confirmation_fk foreign key (confirmation_id, game_group_id, proposal_version)
    references public.match_event_result_confirmations(id, proposal_id, proposal_version) on delete restrict,
  constraint player_rating_event_source_reason_shape check (
    is_active = (reason in ('birth', 'corrected', 'restored')))
);
create index player_rating_event_sources_revision on public.player_rating_event_sources (projection_revision);
create index player_rating_event_sources_group on public.player_rating_event_sources (game_group_id);
comment on table public.player_rating_event_sources is
  'Append-only effective source of each logical rating event: active flag, confirmation/version/played_at in force from the revision on, and the repair/amendment that caused it. Current membership and time come from the latest row at the requested revision, never from the immutable birth fields of player_rating_events.';

-- 2. Backfill: every existing event is active from its first calculation revision.
insert into public.player_rating_event_sources
  (rating_event_id, projection_revision, game_group_id, is_active, confirmation_id, proposal_version, played_at, reason)
select e.id, pg_catalog.min(c.projection_revision), e.game_group_id, true, e.confirmation_id, e.proposal_version,
    e.played_at, 'birth'
  from public.player_rating_events e
  join public.player_rating_event_calculations c on c.rating_event_id = e.id
 group by e.id, e.game_group_id, e.confirmation_id, e.proposal_version, e.played_at;
do $backfill$
begin
  if (select pg_catalog.count(*) from public.player_rating_events)
    <> (select pg_catalog.count(*) from public.player_rating_event_sources) then
    raise exception 'Rating source backfill did not cover every logical event (events without calculations?)'
      using errcode = '23514';
  end if;
end $backfill$;

-- 3. Calculations bind the effective source revision they were computed for.
alter table public.player_rating_event_calculations add column source_revision bigint;
alter table public.player_rating_event_calculations disable trigger player_rating_calculations_immutable;
update public.player_rating_event_calculations c set source_revision = (
  select pg_catalog.min(k.projection_revision) from public.player_rating_event_calculations k
   where k.rating_event_id = c.rating_event_id)
 where c.source_revision is null;
alter table public.player_rating_event_calculations enable trigger player_rating_calculations_immutable;
alter table public.player_rating_event_calculations
  alter column source_revision set not null,
  add constraint player_rating_calculation_source_fk foreign key (rating_event_id, source_revision)
    references public.player_rating_event_sources(rating_event_id, projection_revision) on delete restrict,
  add constraint player_rating_calculation_source_order check (source_revision <= projection_revision);
comment on column public.player_rating_event_calculations.source_revision is
  'Revision of the player_rating_event_sources row (active) this calculation was computed for.';

-- 4. Integrity: revisions only advance; an active source must be the group's current
-- official ratable confirmation with the player in its played quartet; a calculation
-- may only bind an active source.
create function public.guard_player_rating_event_source_revision() returns trigger
language plpgsql set search_path = '' as $$
declare
  v_user uuid; v_ratable boolean; v_teams jsonb; v_played_at timestamptz; v_current uuid;
begin
  if exists (select 1 from public.player_rating_event_sources s
      where s.rating_event_id = new.rating_event_id and s.projection_revision >= new.projection_revision) then
    raise exception using errcode = 'P0001', message = 'RATING_SOURCE_REVISION_NOT_APPENDED';
  end if;
  if new.is_active then
    select e.user_id into v_user from public.player_rating_events e where e.id = new.rating_event_id;
    select c.ratable_eligible, v.teams, v.played_at_utc, s.current_confirmation_id
      into v_ratable, v_teams, v_played_at, v_current
      from public.match_event_result_confirmations c
      join public.match_event_result_proposal_versions v
        on v.proposal_id = c.proposal_id and v.version = c.proposal_version
      join public.match_event_result_official_state s on s.proposal_id = c.proposal_id
     where c.id = new.confirmation_id and c.proposal_id = new.game_group_id
       and c.proposal_version = new.proposal_version;
    if not found or not v_ratable or v_current is distinct from new.confirmation_id
      or not ((v_teams -> 'team_a') ? v_user::text or (v_teams -> 'team_b') ? v_user::text)
      or v_played_at is distinct from new.played_at then
      raise exception using errcode = '23514', message = 'RATING_SOURCE_NOT_OFFICIAL';
    end if;
  end if;
  return new;
end $$;
create trigger player_rating_event_source_revision_guard before insert on public.player_rating_event_sources
  for each row execute function public.guard_player_rating_event_source_revision();

create function public.guard_player_rating_calculation_source() returns trigger
language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from public.player_rating_event_sources s
      where s.rating_event_id = new.rating_event_id and s.projection_revision = new.source_revision
        and s.is_active) then
    raise exception using errcode = '23514', message = 'RATING_CALCULATION_SOURCE_INACTIVE';
  end if;
  return new;
end $$;
create trigger player_rating_calculation_source_guard before insert on public.player_rating_event_calculations
  for each row execute function public.guard_player_rating_calculation_source();

create trigger player_rating_event_sources_immutable before update or delete on public.player_rating_event_sources
  for each row execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_event_sources_no_truncate before truncate on public.player_rating_event_sources
  for each statement execute function public.guard_player_rating_evidence_immutable();
revoke all on function public.guard_player_rating_event_source_revision(),
  public.guard_player_rating_calculation_source() from public, anon, authenticated, service_role;

alter table public.player_rating_event_sources enable row level security;
revoke all on public.player_rating_event_sources from public, anon, authenticated, service_role;
create policy "provisional actor restricted" on public.player_rating_event_sources
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

-- 5. Effective-source readers. The source in force at a revision is the latest row at or
-- below it; events born after the revision do not exist for it.
create function public.rating_event_sources_at(p_revision bigint)
returns table (rating_event_id uuid, game_group_id uuid, user_id uuid, match_event_id uuid,
  game_group_number bigint, source_revision bigint, is_active boolean, confirmation_id uuid,
  proposal_version bigint, played_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select e.id, e.game_group_id, e.user_id, e.match_event_id, e.game_group_number,
      s.projection_revision, s.is_active, s.confirmation_id, s.proposal_version, s.played_at
    from public.player_rating_events e
    cross join lateral (select k.* from public.player_rating_event_sources k
        where k.rating_event_id = e.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) s;
$$;

-- Latest rows including those appended by the running transaction.
create function public.rating_event_sources_latest()
returns table (rating_event_id uuid, game_group_id uuid, user_id uuid, match_event_id uuid,
  game_group_number bigint, source_revision bigint, is_active boolean, confirmation_id uuid,
  proposal_version bigint, played_at timestamptz)
language sql stable security definer set search_path = '' as $$
  select * from public.rating_event_sources_at(9223372036854775807::bigint);
$$;

-- True when exactly the four quartet events of the group are active under the given confirmation.
create function public.rating_group_ledgered_at(p_game_group_id uuid, p_confirmation_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select (select pg_catalog.count(*) from public.player_rating_events e
      cross join lateral (select k.* from public.player_rating_event_sources k
          where k.rating_event_id = e.id order by k.projection_revision desc limit 1) s
     where e.game_group_id = p_game_group_id and s.is_active
       and (p_confirmation_id is null or s.confirmation_id = p_confirmation_id)) = 4;
$$;
revoke all on function public.rating_event_sources_at(bigint), public.rating_event_sources_latest(),
  public.rating_group_ledgered_at(uuid, uuid) from public, anon, authenticated, service_role;

-- 6. One group. The recorded engine/config stamp of the group is inherited (never the
-- current default) by every event, including a player added by a correction; a group
-- with no event yet takes the explicitly frozen stamp of the caller context. The
-- exception-capable kernel is selected from the replayed prefix, so a version recorded
-- only because of an exception is not retained when a correction moves the group before it.
drop function public.rating_projection_apply_group(uuid, uuid, uuid, bigint, bigint, timestamptz, text, jsonb, jsonb, bigint);
create function public.rating_projection_apply_group(
  p_game_group_id uuid, p_confirmation_id uuid, p_match_event_id uuid, p_group_number bigint,
  p_proposal_version bigint, p_played_at timestamptz, p_classification text, p_teams jsonb,
  p_states jsonb, p_revision bigint, p_context jsonb default null,
  out o_states jsonb, out o_meta jsonb, out o_changed boolean, out o_new_events integer)
language plpgsql security definer set search_path = '' as $$
declare
  v_members text[]; v_member_ids uuid[]; v_inputs jsonb; v_group_states jsonb; v_exception boolean;
  v_existing integer;
  v_engine text; v_version text; v_config integer;
  r record; v_event_id uuid; v_last public.player_rating_event_calculations%rowtype;
  v_src public.player_rating_event_sources%rowtype; v_src_revision bigint;
  v_explanation jsonb; v_write boolean;
  v_job uuid := nullif(p_context ->> 'repair_job_id', '')::uuid;
  v_amendment uuid := nullif(p_context ->> 'amendment_id', '')::uuid;
begin
  v_members := array[p_teams -> 'team_a' ->> 0, p_teams -> 'team_a' ->> 1,
    p_teams -> 'team_b' ->> 0, p_teams -> 'team_b' ->> 1];
  if exists (select 1 from pg_catalog.unnest(v_members) m where m is null)
    or (select pg_catalog.count(distinct m) from pg_catalog.unnest(v_members) m) <> 4 then
    raise exception using errcode = '22023', message = 'RATING_INPUT_INVALID';
  end if;
  v_member_ids := v_members::uuid[];
  select pg_catalog.jsonb_object_agg(m, (p_states -> m) - 'exception' - 'last_at'),
      coalesce(pg_catalog.bool_or(coalesce((p_states -> m ->> 'exception')::boolean, false)), false)
    into v_group_states, v_exception
    from (select distinct m from pg_catalog.unnest(v_members) m) d;
  v_inputs := pg_catalog.jsonb_build_object(
    'classification', p_classification,
    'played_at', pg_catalog.to_char(p_played_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
    'teams', pg_catalog.jsonb_build_object('team_a', p_teams -> 'team_a', 'team_b', p_teams -> 'team_b'),
    'states', v_group_states);

  select pg_catalog.count(*) into v_existing from public.player_rating_events e
   where e.game_group_id = p_game_group_id;
  if v_existing > 0 then
    -- Recorded engine/config of the group's events, never the current default.
    select c.rating_engine, c.rating_engine_version, c.rating_config_version
      into v_engine, v_version, v_config
      from public.player_rating_event_calculations c
      join public.player_rating_events e on e.id = c.rating_event_id
     where e.game_group_id = p_game_group_id
     order by c.projection_revision desc, e.user_id limit 1;
    if not found then
      raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
    end if;
  else
    v_engine := coalesce(p_context ->> 'engine', 'app-wide-level');
    v_version := coalesce(p_context ->> 'engine_version', '1.0.0');
    v_config := coalesce((p_context ->> 'config_version')::integer, 1);
  end if;
  -- 1.1.0 is a replay-derived stamp (any exception in the prefix), not recorded calibration.
  if public.rating_v1_exception_supports(v_engine, v_version, v_config) then v_version := '1.0.0'; end if;
  if v_exception then v_version := '1.1.0'; end if;

  o_states := p_states;
  o_meta := '{}'::jsonb;
  o_changed := false;
  o_new_events := 0;
  for r in select * from public.rating_v1_calculate_group(v_engine, v_version, v_config, v_inputs) loop
    v_explanation := pg_catalog.jsonb_build_object(
      'engine', r.rating_engine, 'engine_version', r.rating_engine_version, 'config_version', r.rating_config_version,
      'classification', p_classification, 'ordinal', r.ordinal, 'team', r.team,
      'own_team_strength', r.own_team_strength, 'opponent_team_strength', r.opponent_team_strength,
      'expected_score', r.expected_score, 'outcome_value', r.outcome_value,
      'reliability_factor', r.reliability_factor, 'raw_delta', r.raw_delta,
      'rounded_delta', r.rounded_delta, 'applied_delta', r.applied_delta, 'clamped', r.clamped);
    select e.id into v_event_id from public.player_rating_events e
     where e.game_group_id = p_game_group_id and e.user_id = r.user_id;
    if not found then
      -- New logical event (first confirmation, or a player added by a correction).
      insert into public.player_rating_events
        (game_group_id, user_id, match_event_id, game_group_number, confirmation_id, proposal_version, played_at)
        values (p_game_group_id, r.user_id, p_match_event_id, p_group_number, p_confirmation_id,
          p_proposal_version, p_played_at)
        returning id into v_event_id;
      insert into public.player_rating_event_sources
        (rating_event_id, projection_revision, game_group_id, is_active, confirmation_id, proposal_version,
         played_at, reason, repair_job_id, amendment_id)
        values (v_event_id, p_revision, p_game_group_id, true, p_confirmation_id, p_proposal_version,
          p_played_at, 'birth', v_job, v_amendment);
      v_src_revision := p_revision;
      o_new_events := o_new_events + 1;
      v_write := true;
    else
      select * into v_src from public.player_rating_event_sources k
       where k.rating_event_id = v_event_id order by k.projection_revision desc limit 1;
      if not found then
        raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
      end if;
      if (v_src.is_active, v_src.confirmation_id, v_src.proposal_version, v_src.played_at)
        is distinct from (true, p_confirmation_id, p_proposal_version, p_played_at) then
        insert into public.player_rating_event_sources
          (rating_event_id, projection_revision, game_group_id, is_active, confirmation_id, proposal_version,
           played_at, reason, repair_job_id, amendment_id)
          values (v_event_id, p_revision, p_game_group_id, true, p_confirmation_id, p_proposal_version,
            p_played_at, case when v_src.is_active then 'corrected' else 'restored' end, v_job, v_amendment);
        v_src_revision := p_revision;
        v_write := true;
      else
        v_src_revision := v_src.projection_revision;
        select * into v_last from public.player_rating_event_calculations c
         where c.rating_event_id = v_event_id order by c.projection_revision desc limit 1;
        if not found then
          raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
        end if;
        -- A changed effective source forces new evidence even when the numbers match.
        v_write := (v_last.inputs, v_last.explanation, v_last.rating_engine, v_last.rating_engine_version,
            v_last.rating_config_version, v_last.source_revision)
          is distinct from (v_inputs, v_explanation, r.rating_engine, r.rating_engine_version,
            r.rating_config_version, v_src_revision);
      end if;
    end if;
    if v_write then
      insert into public.player_rating_event_calculations
        (rating_event_id, projection_revision, rating_engine, rating_engine_version, rating_config_version,
         before_mu, before_sigma, before_display_level, before_reliability_percent, before_confirmed_groups,
         before_highest_display_level, after_mu, after_sigma, after_display_level, after_reliability_percent,
         after_confirmed_groups, after_highest_display_level, last_rating_at, inputs, explanation, source_revision)
        values (v_event_id, p_revision, r.rating_engine, r.rating_engine_version, r.rating_config_version,
          r.before_mu, r.before_sigma, r.before_display_level, r.before_reliability_percent,
          r.before_confirmed_groups, r.before_highest_display_level, r.after_mu, r.after_sigma,
          r.after_display_level, r.after_reliability_percent, r.after_confirmed_groups,
          r.after_highest_display_level, r.last_rating_at, v_inputs, v_explanation, v_src_revision);
      o_changed := true;
    end if;
    o_states := pg_catalog.jsonb_set(o_states, array[r.user_id::text], pg_catalog.jsonb_build_object(
      'mu', r.after_mu, 'sigma', r.after_sigma, 'display_level', r.after_display_level,
      'reliability_percent', r.after_reliability_percent,
      'confirmed_competitive_game_groups', r.after_confirmed_groups,
      'highest_display_level', r.after_highest_display_level,
      'exception', coalesce((p_states -> r.user_id::text ->> 'exception')::boolean, false),
      'last_at', r.last_rating_at));
    o_meta := o_meta || pg_catalog.jsonb_build_object(r.user_id::text, pg_catalog.jsonb_build_object(
      'engine', r.rating_engine, 'engine_version', r.rating_engine_version, 'config_version', r.rating_config_version));
  end loop;

  -- A player no longer in the corrected quartet stays a logical event but stops counting.
  for v_src in
    select k.* from public.player_rating_events e
      cross join lateral (select s.* from public.player_rating_event_sources s
          where s.rating_event_id = e.id order by s.projection_revision desc limit 1) k
     where e.game_group_id = p_game_group_id and e.user_id <> all (v_member_ids) and k.is_active
  loop
    insert into public.player_rating_event_sources
      (rating_event_id, projection_revision, game_group_id, is_active, confirmation_id, proposal_version,
       played_at, reason, repair_job_id, amendment_id)
      values (v_src.rating_event_id, p_revision, p_game_group_id, false, v_src.confirmation_id,
        v_src.proposal_version, v_src.played_at, 'removed', v_job, v_amendment);
    o_changed := true;
  end loop;
end $$;

revoke all on function
  public.rating_projection_apply_group(uuid, uuid, uuid, bigint, bigint, timestamptz, text, jsonb, jsonb, bigint, jsonb)
  from public, anon, authenticated, service_role;

-- 7. Materialize the projected states. last_rating_at is the latest ACTIVE ledgered
-- played_at, never the wall clock; a player without active events has none.
create or replace function public.rating_projection_write_states(p_states jsonb, p_meta jsonb, p_revision bigint)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_updated integer;
begin
  perform 1 from public.global_player_ratings r
   where r.user_id in (select k::uuid from pg_catalog.jsonb_object_keys(p_states) k)
   order by r.user_id for update;
  with s as (
    select e.key::uuid as user_id, e.value as st, p_meta -> e.key as meta from pg_catalog.jsonb_each(p_states) e
  ), last_event as (
    select ev.user_id, pg_catalog.max(ev.played_at) as played_at from public.rating_event_sources_latest() ev
     where ev.is_active and ev.user_id in (select s.user_id from s) group by ev.user_id
  )
  update public.global_player_ratings r set
      mu = (s.st ->> 'mu')::numeric, sigma = (s.st ->> 'sigma')::numeric,
      display_level = (s.st ->> 'display_level')::numeric,
      reliability_percent = (s.st ->> 'reliability_percent')::smallint,
      confirmed_competitive_game_groups = (s.st ->> 'confirmed_competitive_game_groups')::integer,
      highest_display_level = (s.st ->> 'highest_display_level')::numeric,
      last_rating_at = l.played_at,
      rating_engine = coalesce(s.meta ->> 'engine', r.rating_engine),
      rating_engine_version = coalesce(s.meta ->> 'engine_version', r.rating_engine_version),
      rating_config_version = coalesce((s.meta ->> 'config_version')::integer, r.rating_config_version),
      projection_revision = p_revision
    from s left join last_event l on l.user_id = s.user_id
   where r.user_id = s.user_id
     and (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
          r.highest_display_level, r.last_rating_at, r.rating_engine, r.rating_engine_version, r.rating_config_version)
       is distinct from ((s.st ->> 'mu')::numeric, (s.st ->> 'sigma')::numeric, (s.st ->> 'display_level')::numeric,
          (s.st ->> 'reliability_percent')::integer, (s.st ->> 'confirmed_competitive_game_groups')::integer,
          (s.st ->> 'highest_display_level')::numeric, l.played_at,
          coalesce(s.meta ->> 'engine', r.rating_engine), coalesce(s.meta ->> 'engine_version', r.rating_engine_version),
          coalesce((s.meta ->> 'config_version')::integer, r.rating_config_version));
  get diagnostics v_updated = row_count;
  return v_updated;
end $$;

-- 8. Consistency gate over ACTIVE events: every listed player's state equals the latest
-- calculation of the chronologically last active event (or the latest checkpoint after it)
-- and the counted groups equal the active events.
create or replace function public.rating_projection_assert_consistent(p_user_ids uuid[]) returns void
language plpgsql security definer set search_path = '' as $$
declare v_bad bigint;
begin
  with act as materialized (
    select s.* from public.rating_event_sources_latest() s where s.is_active and s.user_id = any (p_user_ids)
  )
  select pg_catalog.count(*) into v_bad
    from public.global_player_ratings r
    left join lateral (select e.rating_event_id as id, e.played_at, e.game_group_id from act e
        where e.user_id = r.user_id order by e.played_at desc, e.game_group_id desc limit 1) le on true
    left join lateral (select c.* from public.player_rating_event_calculations c
        where c.rating_event_id = le.id order by c.projection_revision desc limit 1) lc on true
    left join lateral (select a.id, a.boundary_played_at, a.boundary_group_id
        from public.player_rating_admin_adjustments a where a.user_id = r.user_id
        order by a.boundary_played_at desc, a.boundary_group_id desc, a.projection_revision desc limit 1) la on true
    left join lateral (select s.* from public.player_rating_adjustment_states s
        where s.adjustment_id = la.id order by s.projection_revision desc limit 1) ls on true
   where r.user_id = any (p_user_ids)
     and (r.confirmed_competitive_game_groups <>
          (select pg_catalog.count(*) from act e2 where e2.user_id = r.user_id)
       or (le.id is null and la.id is null
           and (r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level
             or r.highest_display_level <> r.initial_display_level or r.last_rating_at is not null))
       or (la.id is not null
           and (le.id is null or (la.boundary_played_at, la.boundary_group_id) >= (le.played_at, le.game_group_id))
           and (ls.adjustment_id is null
             or (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
                 r.highest_display_level, r.last_rating_at)
               is distinct from (ls.mu, ls.sigma, ls.display_level, ls.reliability_percent::integer,
                 ls.confirmed_groups, ls.highest_display_level, ls.last_rating_at)))
       or (le.id is not null
           and (la.id is null or (la.boundary_played_at, la.boundary_group_id) < (le.played_at, le.game_group_id))
           and (lc.rating_event_id is null
             or (r.mu, r.sigma, r.display_level, r.reliability_percent::integer, r.confirmed_competitive_game_groups,
                 r.highest_display_level, r.last_rating_at)
               is distinct from (lc.after_mu, lc.after_sigma, lc.after_display_level,
                 lc.after_reliability_percent::integer, lc.after_confirmed_groups,
                 lc.after_highest_display_level, lc.last_rating_at)))
       or (r.reliability_percent <> least(100, 10 + 6 * r.confirmed_competitive_game_groups)
           and not (r.rating_engine_version = '1.1.0' and exists (select 1
             from public.player_rating_admin_adjustments x
            where x.user_id = r.user_id and x.reliability_mode <> 'preserve'))));
  if v_bad > 0 then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
  if exists (select 1 from public.player_rating_admin_adjustments a1
      join public.player_rating_admin_adjustments a2 on a1.projection_revision < a2.projection_revision
     where a1.user_id = any (p_user_ids)
       and (a1.boundary_played_at, a1.boundary_group_id) > (a2.boundary_played_at, a2.boundary_group_id)) then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
end $$;

-- 9. Merged full replay (match order: played_at, group UUID, kind 0; checkpoint order: stored
-- boundary, kind 1, original revision). Starting states are the ledgered effective starting
-- levels. Players whose events are all inactive are reconstructed too (initialization plus
-- surviving checkpoints). Events of groups that are no longer eligible are deactivated first.
drop function public.rating_projection_replay(bigint);
create function public.rating_projection_replay(p_revision bigint, p_context jsonb default null,
  out o_changed boolean, out o_groups integer, out o_last_played_at timestamptz, out o_last_group_id uuid)
language plpgsql security definer set search_path = '' as $$
declare
  v_states jsonb; v_meta jsonb; v_users uuid[]; v_expected integer; v_found integer; v_eligible uuid[];
  v_item record; v_apply record; v_written integer; v_state jsonb; v_prev record; v_last_rating_at timestamptz;
  v_job uuid := nullif(p_context ->> 'repair_job_id', '')::uuid;
  v_amendment uuid := nullif(p_context ->> 'amendment_id', '')::uuid;
  v_invalidated integer;
begin
  o_changed := false;
  o_groups := 0;
  select pg_catalog.array_agg(distinct q.u) into v_users from (
      select m.value::uuid as u
        from public.rating_projection_eligible_groups() g,
          pg_catalog.jsonb_array_elements_text((g.teams -> 'team_a') || (g.teams -> 'team_b')) m(value)
      union
      select a.user_id from public.player_rating_admin_adjustments a
      union
      select e.user_id from public.player_rating_events e) q;
  if v_users is null then return; end if;
  v_expected := pg_catalog.cardinality(v_users);
  select coalesce(pg_catalog.array_agg(g.game_group_id), '{}'::uuid[]) into v_eligible
    from public.rating_projection_eligible_groups() g;

  -- Friendly / incomplete / void or otherwise no-longer-official groups create no competitive effects.
  insert into public.player_rating_event_sources
    (rating_event_id, projection_revision, game_group_id, is_active, confirmation_id, proposal_version,
     played_at, reason, repair_job_id, amendment_id)
  select s.rating_event_id, p_revision, s.game_group_id, false, s.confirmation_id, s.proposal_version,
      s.played_at, 'invalidated', v_job, v_amendment
    from public.rating_event_sources_latest() s
   where s.is_active and s.game_group_id <> all (v_eligible);
  get diagnostics v_invalidated = row_count;
  if v_invalidated > 0 then o_changed := true; end if;

  -- See 20261101120000: fresh statistics keep the per-event lookups on index scans.
  analyze public.player_rating_events, public.player_rating_event_calculations, public.player_rating_event_sources;
  select pg_catalog.jsonb_object_agg(i.user_id::text,
        public.rating_projection_initial_state(i.initial_level) || pg_catalog.jsonb_build_object('exception', false)),
      pg_catalog.jsonb_object_agg(i.user_id::text, pg_catalog.jsonb_build_object(
        'engine', i.rating_engine, 'engine_version', i.rating_engine_version, 'config_version', i.rating_config_version)),
      pg_catalog.count(*)
    into v_states, v_meta, v_found
    from (select distinct on (a.user_id) a.user_id, a.initial_level, a.rating_engine, a.rating_engine_version,
              a.rating_config_version
            from public.player_rating_initializations a
           where a.user_id = any (v_users)
           order by a.user_id, a.sequence desc) i
    join public.global_player_ratings r on r.user_id = i.user_id and r.initial_display_level = i.initial_level;
  if v_found is distinct from v_expected then
    raise exception 'Incomplete player state' using errcode = '23514';
  end if;

  for v_item in
    select 0 as kind, g.played_at as item_at, g.game_group_id as gid, 0::bigint as rev,
        g.confirmation_id, g.match_event_id, g.game_group_number, g.proposal_version, g.classification, g.teams,
        null::uuid as adjustment_id, null::uuid as user_id, null::text as mode, null::smallint as target,
        null::numeric as after_level
      from public.rating_projection_eligible_groups() g
    union all
    select 1, a.boundary_played_at, a.boundary_group_id, a.projection_revision,
        null, null, null, null, null, null,
        a.id, a.user_id, a.reliability_mode, a.reliability_target, a.after_display_level
      from public.player_rating_admin_adjustments a
    order by item_at, gid, kind, rev loop
    if v_item.kind = 0 then
      select * into v_apply from public.rating_projection_apply_group(
        v_item.gid, v_item.confirmation_id, v_item.match_event_id, v_item.game_group_number,
        v_item.proposal_version, v_item.item_at, v_item.classification, v_item.teams, v_states, p_revision,
        p_context);
      v_states := v_apply.o_states;
      v_meta := v_meta || v_apply.o_meta;
      if v_apply.o_changed then o_changed := true; end if;
      o_groups := o_groups + 1;
      o_last_played_at := v_item.item_at;
      o_last_group_id := v_item.gid;
    else
      v_state := v_states -> v_item.user_id::text;
      v_state := v_state || pg_catalog.jsonb_build_object(
        'mu', v_item.after_level, 'display_level', v_item.after_level,
        'highest_display_level', greatest((v_state ->> 'highest_display_level')::numeric, v_item.after_level));
      if v_item.mode <> 'preserve' then
        v_state := v_state || pg_catalog.jsonb_build_object('reliability_percent', v_item.target, 'exception', true);
        v_meta := v_meta || pg_catalog.jsonb_build_object(v_item.user_id::text, pg_catalog.jsonb_build_object(
          'engine', 'app-wide-level', 'engine_version', '1.1.0', 'config_version', 1));
      end if;
      v_states := pg_catalog.jsonb_set(v_states, array[v_item.user_id::text], v_state);
      -- Reconstructed prefix: the player's last counted match played before this stored boundary.
      v_last_rating_at := (v_state ->> 'last_at')::timestamptz;
      select s.* into v_prev from public.player_rating_adjustment_states s
       where s.adjustment_id = v_item.adjustment_id order by s.projection_revision desc limit 1;
      if not found or (v_prev.mu, v_prev.sigma, v_prev.display_level, v_prev.reliability_percent::integer,
          v_prev.confirmed_groups, v_prev.highest_display_level, v_prev.last_rating_at)
        is distinct from ((v_state ->> 'mu')::numeric, (v_state ->> 'sigma')::numeric,
          (v_state ->> 'display_level')::numeric, (v_state ->> 'reliability_percent')::integer,
          (v_state ->> 'confirmed_competitive_game_groups')::integer,
          (v_state ->> 'highest_display_level')::numeric, v_last_rating_at) then
        insert into public.player_rating_adjustment_states
          (adjustment_id, projection_revision, rating_engine, rating_engine_version, rating_config_version,
           mu, sigma, display_level, reliability_percent, confirmed_groups, highest_display_level, last_rating_at)
          values (v_item.adjustment_id, p_revision, 'app-wide-level',
            coalesce(v_meta -> v_item.user_id::text ->> 'engine_version', '1.0.0'),
            1, (v_state ->> 'mu')::numeric, (v_state ->> 'sigma')::numeric, (v_state ->> 'display_level')::numeric,
            (v_state ->> 'reliability_percent')::integer, (v_state ->> 'confirmed_competitive_game_groups')::integer,
            (v_state ->> 'highest_display_level')::numeric, v_last_rating_at);
        o_changed := true;
      end if;
    end if;
  end loop;

  v_written := public.rating_projection_write_states(v_states, v_meta, p_revision);
  if v_written > 0 then o_changed := true; end if;
  -- Exactly four ACTIVE sources per eligible group, under that group's official confirmation.
  if exists (select 1 from public.rating_event_sources_latest() s where s.is_active
      group by s.game_group_id having pg_catalog.count(*) <> 4)
    or exists (select 1 from public.rating_projection_eligible_groups() g
      where not public.rating_group_ledgered_at(g.game_group_id, g.confirmation_id))
    or (select pg_catalog.count(distinct s.game_group_id) from public.rating_event_sources_latest() s
        where s.is_active) <> o_groups then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
  end if;
  perform public.rating_projection_assert_consistent(v_users);
end $$;

revoke all on function public.rating_projection_replay(bigint, jsonb)
  from public, anon, authenticated, service_role;

-- 10. Projector entry point (first confirmation): idempotent for a group that already has
-- four active sources; an ineligible group changes nothing.
create or replace function public.project_confirmed_rating_group(p_proposal_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_control public.player_rating_projection_control%rowtype;
  v_group record; v_existing integer; v_revision bigint; v_member_ids uuid[];
  v_states jsonb; v_loaded integer; v_apply record; v_replay record;
begin
  if (select c.activation_enabled from public.player_rating_projection_control c) then
    perform public.rating_projection_lock_covered();
  else
    perform public.lock_global_rating_projection();
  end if;
  -- Everything below is read after the lock: the stream, ledger and states are current.
  select * into v_control from public.player_rating_projection_control c for update;
  if not found then
    raise exception 'Rating projection control is missing' using errcode = '23514';
  end if;
  if not v_control.activation_enabled then return; end if;
  select * into v_group from public.rating_projection_eligible_groups() g where g.game_group_id = p_proposal_id;
  if not found then return; end if;

  select pg_catalog.count(*) into v_existing from public.player_rating_events e
   where e.game_group_id = p_proposal_id;
  if v_existing > 0 then
    if public.rating_group_ledgered_at(p_proposal_id, null)
      and not exists (select 1 from public.player_rating_events e where e.game_group_id = p_proposal_id
        and not exists (select 1 from public.player_rating_event_calculations c where c.rating_event_id = e.id)) then
      return;
    end if;
    raise exception using errcode = '23514', message = 'RATING_EVIDENCE_INCOMPLETE';
  end if;

  v_revision := v_control.committed_revision + 1;
  if (v_control.last_processed_game_group_id is null
      or (v_group.played_at, v_group.game_group_id)
        > (v_control.last_processed_played_at, v_control.last_processed_game_group_id))
    and not exists (select 1 from public.player_rating_admin_adjustments a
      where (a.boundary_played_at, a.boundary_group_id) >= (v_group.played_at, v_group.game_group_id))
    and not exists (select 1 from public.rating_projection_eligible_groups() g
      where g.game_group_id <> p_proposal_id and not public.rating_group_ledgered_at(g.game_group_id, g.confirmation_id)) then
    -- Tail fast path: the four current states already include every earlier group and checkpoint.
    v_member_ids := array[(v_group.teams -> 'team_a' ->> 0)::uuid, (v_group.teams -> 'team_a' ->> 1)::uuid,
      (v_group.teams -> 'team_b' ->> 0)::uuid, (v_group.teams -> 'team_b' ->> 1)::uuid];
    select pg_catalog.jsonb_object_agg(r.user_id::text, pg_catalog.jsonb_build_object(
        'mu', r.mu, 'sigma', r.sigma, 'display_level', r.display_level,
        'reliability_percent', r.reliability_percent,
        'confirmed_competitive_game_groups', r.confirmed_competitive_game_groups,
        'highest_display_level', r.highest_display_level,
        'exception', exists (select 1 from public.player_rating_admin_adjustments a
          where a.user_id = r.user_id and a.reliability_mode <> 'preserve'))), pg_catalog.count(*)
      into v_states, v_loaded
      from (select * from public.global_player_ratings gr where gr.user_id = any (v_member_ids)
              order by gr.user_id for update) r;
    if v_loaded is distinct from 4 then
      raise exception 'Incomplete player state' using errcode = '23514';
    end if;
    select * into v_apply from public.rating_projection_apply_group(
      v_group.game_group_id, v_group.confirmation_id, v_group.match_event_id, v_group.game_group_number,
      v_group.proposal_version, v_group.played_at, v_group.classification, v_group.teams, v_states, v_revision);
    if v_apply.o_new_events <> 4 then
      raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_INCONSISTENT';
    end if;
    perform public.rating_projection_write_states(v_apply.o_states, v_apply.o_meta, v_revision);
    perform public.rating_projection_assert_consistent(v_member_ids);
    update public.player_rating_projection_control set committed_revision = v_revision,
      last_processed_played_at = v_group.played_at, last_processed_game_group_id = v_group.game_group_id
     where singleton;
  else
    -- Late insertion, insertion before a checkpoint (or self-heal): replay the merged stream.
    select * into v_replay from public.rating_projection_replay(v_revision);
    update public.player_rating_projection_control set
      committed_revision = case when v_replay.o_changed then v_revision else committed_revision end,
      last_processed_played_at = v_replay.o_last_played_at, last_processed_game_group_id = v_replay.o_last_group_id
     where singleton;
  end if;
end $$;

-- 11. Prelock coverage extended to effective sources: a group is "uncovered" while its
-- official confirmation is not the one its four active sources are bound to, including a
-- replacement whose group already has a ledger identity. Source/FK rows are locked before
-- the rating lock; the coverage is re-read after it (bounded retry).
create or replace function public.rating_projection_prelock_sources() returns void
language plpgsql security definer set search_path = '' as $$
begin
  create temporary table if not exists pg_temp.rating_prelock_groups (
    game_group_id uuid, confirmation_id uuid, match_event_id uuid, proposal_version bigint, teams jsonb
  ) on commit drop;
  truncate pg_temp.rating_prelock_groups;
  insert into pg_temp.rating_prelock_groups
    select g.game_group_id, g.confirmation_id, g.match_event_id, g.proposal_version, g.teams
      from public.rating_projection_eligible_groups() g
     where not public.rating_group_ledgered_at(g.game_group_id, g.confirmation_id);

  perform 1 from public.match_events e
   where e.id in (select t.match_event_id from pg_temp.rating_prelock_groups t) order by e.id for key share;
  perform 1 from public.match_event_result_proposals p
   where p.id in (select t.game_group_id from pg_temp.rating_prelock_groups t) order by p.id for key share;
  perform 1 from public.match_event_result_proposal_versions v
   where (v.proposal_id, v.version) in (select t.game_group_id, t.proposal_version from pg_temp.rating_prelock_groups t)
   order by v.proposal_id, v.version for key share;
  perform 1 from public.match_event_result_confirmations c
   where c.id in (select t.confirmation_id from pg_temp.rating_prelock_groups t) order by c.id for key share;
  perform 1 from public.player_profiles pr
   where pr.user_id in (select m.value::uuid from pg_temp.rating_prelock_groups t,
       pg_catalog.jsonb_array_elements_text((t.teams -> 'team_a') || (t.teams -> 'team_b')) m(value))
   order by pr.user_id for key share;
end $$;

create or replace function public.rating_projection_lock_covered() returns void
language plpgsql security definer set search_path = '' as $$
declare
  c_max_attempts constant integer := 8;
  v_attempt integer := 0;
begin
  loop
    v_attempt := v_attempt + 1;
    perform public.rating_projection_prelock_sources();
    -- Default-off test barrier: expose the otherwise millisecond-wide coverage window.
    -- Outside the retry subtransaction so its attempt counter survives a coverage gap.
    if pg_catalog.current_setting('app.test_pause', true) = 'before_rating_lock' then
      perform pg_catalog.set_config('app.test_rating_prelock_attempt', v_attempt::text, true);
      perform pg_catalog.pg_advisory_xact_lock(
        pg_catalog.hashtextextended('padel-friend:test-rating-prelock', 0));
    end if;
    begin
      perform public.lock_global_rating_projection();
      if not exists (
        select 1 from public.rating_projection_eligible_groups() g
         where not public.rating_group_ledgered_at(g.game_group_id, g.confirmation_id)
           and not exists (select 1 from pg_temp.rating_prelock_groups t
             where t.game_group_id = g.game_group_id and t.confirmation_id = g.confirmation_id
               and t.proposal_version = g.proposal_version and t.teams = g.teams)
      ) then
        return;
      end if;
      raise exception using errcode = 'RT001', message = 'RATING_PRELOCK_GAP';
    exception when sqlstate 'RT001' then
      -- Subtransaction rolled back: the rating lock is released. Re-snapshot and retry.
      if v_attempt >= c_max_attempts then
        raise exception using errcode = '55P03', message = 'RATING_ACTIVATION_CONTENDED';
      end if;
    end;
  end loop;
end $$;

-- 12. Readers resolve source and calculation at the same committed revision.
drop function public.rating_current_calculations(uuid, bigint);
create function public.rating_current_calculations(p_user_id uuid, p_revision bigint)
returns table (rating_event_id uuid, game_group_id uuid, match_event_id uuid, game_group_number bigint,
  played_at timestamptz, calculation_revision bigint, revision_count bigint, rating_engine text,
  rating_engine_version text, rating_config_version integer, before_display_level numeric,
  after_display_level numeric, before_reliability_percent smallint, after_reliability_percent smallint,
  before_confirmed_groups integer, after_confirmed_groups integer, before_highest_display_level numeric,
  after_highest_display_level numeric, last_rating_at timestamptz, inputs jsonb, explanation jsonb,
  source_revision bigint, source_confirmation_id uuid, source_proposal_version bigint)
language sql stable security definer set search_path = '' as $$
  select e.id, e.game_group_id, e.match_event_id, e.game_group_number, s.played_at,
      c.projection_revision,
      (select pg_catalog.count(*) from public.player_rating_event_calculations a
        where a.rating_event_id = e.id and a.projection_revision <= p_revision),
      c.rating_engine, c.rating_engine_version, c.rating_config_version,
      c.before_display_level, c.after_display_level,
      c.before_reliability_percent, c.after_reliability_percent,
      c.before_confirmed_groups, c.after_confirmed_groups,
      c.before_highest_display_level, c.after_highest_display_level,
      c.last_rating_at, c.inputs, c.explanation,
      s.projection_revision, s.confirmation_id, s.proposal_version
    from public.player_rating_events e
    cross join lateral (select k.* from public.player_rating_event_sources k
        where k.rating_event_id = e.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) s
    cross join lateral (select k.* from public.player_rating_event_calculations k
        where k.rating_event_id = e.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) c
   where e.user_id = p_user_id and s.is_active;
$$;
revoke all on function public.rating_current_calculations(uuid, bigint) from public, anon, authenticated, service_role;

create or replace function public.get_rating_group_explanation(p_game_group_id uuid, p_revision bigint default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.rating_read_actor(); v_revision bigint; v_event_id uuid; v_players jsonb;
  v_count integer; v_head record;
begin
  perform public.assert_actor_not_provisional();
  if p_game_group_id is null then
    raise exception using errcode = '22023', message = 'RATING_EXPLANATION_INVALID_ARGUMENT';
  end if;
  v_revision := public.rating_committed_revision();
  select e.match_event_id into v_event_id from public.player_rating_events e
   where e.game_group_id = p_game_group_id limit 1;
  if v_event_id is null or not (public.rating_can_view_match_event(v_event_id, v_uid)
      or exists (select 1 from public.rating_event_sources_at(v_revision) pe
        where pe.game_group_id = p_game_group_id and pe.user_id = v_uid and pe.is_active)) then
    raise exception using errcode = '42501', message = 'RATING_EXPLANATION_FORBIDDEN';
  end if;
  perform public.rating_read_assert_revision(p_revision, v_revision);

  with calc as (
    select e.user_id, c.*
      from public.rating_event_sources_at(v_revision) e
      cross join lateral (select k.* from public.player_rating_event_calculations k
          where k.rating_event_id = e.rating_event_id and k.projection_revision <= v_revision
          order by k.projection_revision desc limit 1) c
     where e.game_group_id = p_game_group_id and e.is_active
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

  select s.match_event_id, s.game_group_number, s.played_at into v_head
    from public.rating_event_sources_at(v_revision) s
   where s.game_group_id = p_game_group_id and s.is_active limit 1;
  return pg_catalog.jsonb_build_object(
    'revision', v_revision,
    'game_group_id', p_game_group_id,
    'match_event_id', v_head.match_event_id,
    'game_group_number', v_head.game_group_number,
    'played_at', public.rating_utc_text(v_head.played_at),
    'players', v_players);
end $$;

create or replace function public.get_match_event_rating_changes(p_match_event_id uuid) returns jsonb
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
        from public.rating_event_sources_at(v_revision) e
        join public.player_profiles p on p.user_id = e.user_id
        cross join lateral (select k.* from public.player_rating_event_calculations k
            where k.rating_event_id = e.rating_event_id and k.projection_revision <= v_revision
            order by k.projection_revision desc limit 1) c
       where e.match_event_id = p_match_event_id and e.is_active
       group by e.game_group_id, e.game_group_number
      having pg_catalog.count(*) = 4
    ) g;
  return pg_catalog.jsonb_build_object('revision', v_revision, 'match_event_id', p_match_event_id,
    'groups', v_groups);
end $$;

-- Timeline: a match item also names the confirmation/revision of the source it reflects.
create or replace function public.rating_timeline_items(p_user_id uuid, p_revision bigint)
returns table (kind text, sort_at timestamptz, sort_id uuid, sort_rank smallint, sort_rev bigint,
  item_id uuid, display_level numeric, effective_at timestamptz, dto jsonb)
language sql stable security definer set search_path = '' as $$
  select 'match'::text, c.played_at, c.game_group_id, 0::smallint, 0::bigint, c.game_group_id,
      c.after_display_level, c.played_at,
      pg_catalog.jsonb_build_object(
        'kind', 'match',
        'game_group_id', c.game_group_id, 'match_event_id', c.match_event_id,
        'game_group_number', c.game_group_number, 'played_at', public.rating_utc_text(c.played_at),
        'classification', c.inputs ->> 'classification', 'team', c.explanation ->> 'team',
        'outcome_value', c.explanation -> 'outcome_value', 'expected_score', c.explanation -> 'expected_score',
        'before_display_level', c.before_display_level, 'after_display_level', c.after_display_level,
        'applied_delta', c.explanation -> 'applied_delta', 'clamped', c.explanation -> 'clamped',
        'before_reliability_percent', c.before_reliability_percent,
        'after_reliability_percent', c.after_reliability_percent,
        'after_confirmed_groups', c.after_confirmed_groups,
        'calculation_revision', c.calculation_revision, 'recalculated', c.revision_count > 1,
        'source_revision', c.source_revision, 'source_confirmation_id', c.source_confirmation_id)
    from public.rating_current_calculations(p_user_id, p_revision) c
  union all
  select 'adjustment'::text, a.boundary_played_at, a.boundary_group_id, 1::smallint, a.projection_revision, a.id,
      s.display_level, a.effective_at,
      pg_catalog.jsonb_build_object(
        'kind', 'adjustment',
        'adjustment_id', a.id, 'level_review_request_id', a.level_review_request_id,
        'event_type', a.event_type, 'effective_at', public.rating_utc_text(a.effective_at),
        'reason', a.reason, 'outcome', 'approved',
        'before_display_level', b.display_level, 'after_display_level', s.display_level,
        'before_reliability_percent', b.reliability_percent,
        'after_reliability_percent', s.reliability_percent,
        'reliability_changed', b.reliability_percent <> s.reliability_percent,
        'after_confirmed_groups', s.confirmed_groups,
        'calculation_revision', s.projection_revision)
    from public.player_rating_admin_adjustments a
    cross join lateral (select k.* from public.player_rating_adjustment_states k
        where k.adjustment_id = a.id and k.projection_revision <= p_revision
        order by k.projection_revision desc limit 1) s
    cross join lateral public.rating_checkpoint_incoming(p_user_id, p_revision, a.boundary_played_at,
        a.boundary_group_id, a.projection_revision) b
   where a.user_id = p_user_id and a.projection_revision <= p_revision;
$$;

create or replace function public.statistics_rating_rows(p_game_group_ids uuid[], p_revision bigint)
returns table (game_group_id uuid, user_id uuid, calc_revision bigint, delta numeric, expected numeric,
  own_strength numeric, opp_strength numeric, before_level numeric, after_level numeric,
  before_rel smallint, after_rel smallint)
language sql stable security definer set search_path = '' as $$
  select distinct on (e.game_group_id, e.user_id) e.game_group_id, e.user_id, c.projection_revision,
      (c.explanation ->> 'applied_delta')::numeric, (c.explanation ->> 'expected_score')::numeric,
      (c.explanation ->> 'own_team_strength')::numeric, (c.explanation ->> 'opponent_team_strength')::numeric,
      c.before_display_level, c.after_display_level, c.before_reliability_percent, c.after_reliability_percent
    from public.rating_event_sources_at(p_revision) e
    join public.player_rating_event_calculations c
      on c.rating_event_id = e.rating_event_id and c.projection_revision <= p_revision
   where e.game_group_id = any (p_game_group_ids) and e.is_active
   order by e.game_group_id, e.user_id, c.projection_revision desc;
$$;

-- 13. Statistics consumers of the ledger follow the effective sources (a deactivated event
-- appends a source revision without a calculation, which must still refresh the group).
do $patch$
declare
  v_patch record; v_original text;
begin
  for v_patch in select * from (values
    ('public.statistics_publish(uuid[],uuid[],uuid[],boolean)'::regprocedure,
      E'       where c.projection_revision > v_control.rating_revision and c.projection_revision <= v_rating\n'::text,
      E'       where c.projection_revision > v_control.rating_revision and c.projection_revision <= v_rating\n'
      || E'      union\n'
      || E'      select s.game_group_id from public.player_rating_event_sources s\n'
      || E'       where s.projection_revision > v_control.rating_revision and s.projection_revision <= v_rating\n'),
    ('public.statistics_rank_compute(uuid)'::regprocedure,
      E'      join public.player_rating_event_calculations k on k.rating_event_id = e.id\n  ), rev_at as (',
      E'      join public.player_rating_event_calculations k on k.rating_event_id = e.id\n'
      || E'    union\n'
      || E'    select e.user_id, s.projection_revision\n'
      || E'      from players p\n'
      || E'      join public.player_rating_events e on e.user_id = p.user_id\n'
      || E'      join public.player_rating_event_sources s on s.rating_event_id = e.id\n  ), rev_at as ('),
    ('public.statistics_rank_compute(uuid)'::regprocedure,
      E'    select r.revision, (select pg_catalog.max(k.calculated_at)\n        from public.player_rating_event_calculations k where k.projection_revision = r.revision) as at',
      E'    select r.revision, (select pg_catalog.max(t.at) from (\n'
      || E'        select k.calculated_at as at from public.player_rating_event_calculations k where k.projection_revision = r.revision\n'
      || E'        union all\n'
      || E'        select s.recorded_at from public.player_rating_event_sources s where s.projection_revision = r.revision) t) as at'),
    ('public.statistics_rank_compute(uuid)'::regprocedure,
      E'      from p_revs pr\n      cross join lateral (\n        select e.id as rating_event_id, c.after_display_level as level, c.after_reliability_percent as reliability\n          from public.player_rating_events e\n          cross join lateral (\n            select k.after_display_level, k.after_reliability_percent\n              from public.player_rating_event_calculations k\n             where k.rating_event_id = e.id and k.projection_revision <= pr.revision\n             order by k.projection_revision desc limit 1) c\n         where e.user_id = pr.user_id\n         order by e.played_at desc, e.game_group_id desc limit 1) l',
      E'      from p_revs pr\n      left join lateral (\n        select e.id as rating_event_id, c.after_display_level as level, c.after_reliability_percent as reliability\n          from public.player_rating_events e\n'
      || E'          cross join lateral (select src.* from public.player_rating_event_sources src\n'
      || E'              where src.rating_event_id = e.id and src.projection_revision <= pr.revision\n'
      || E'              order by src.projection_revision desc limit 1) es\n'
      || E'          cross join lateral (\n            select k.after_display_level, k.after_reliability_percent\n              from public.player_rating_event_calculations k\n             where k.rating_event_id = e.id and k.projection_revision <= pr.revision\n             order by k.projection_revision desc limit 1) c\n'
      || E'         where e.user_id = pr.user_id and es.is_active\n         order by es.played_at desc, e.game_group_id desc limit 1) l on true'),
    ('public.statistics_rank_refresh()'::regprocedure,
      E'       where k.projection_revision > v_seen and k.projection_revision <= v_rating);',
      E'       where k.projection_revision > v_seen and k.projection_revision <= v_rating\n'
      || E'      union\n'
      || E'      select distinct m2.community_id\n'
      || E'        from public.player_rating_event_sources s2\n'
      || E'        join public.player_rating_events e2 on e2.id = s2.rating_event_id\n'
      || E'        join public.community_members m2 on m2.user_id = e2.user_id and m2.activated_at is not null\n'
      || E'       where s2.projection_revision > v_seen and s2.projection_revision <= v_rating);')
  ) as t(signature, needle, replacement) loop
    v_original := pg_get_functiondef(v_patch.signature);
    if (length(v_original) - length(replace(v_original, v_patch.needle, '')))
      <> length(v_patch.needle) then
      raise exception 'Unexpected % definition; refusing to patch (%)', v_patch.signature,
        left(v_patch.needle, 60);
    end if;
    execute replace(v_original, v_patch.needle, v_patch.replacement);
  end loop;
end $patch$;

commit;
