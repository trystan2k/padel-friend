begin;

-- PAF-12 / U3: versioned, immutable final League standings across close and late confirmations.
--
-- Contract (docs/plan/Plan PAF-12 T12, "Close + snapshot", U3):
--   * Closing a League (Fixed boundary, expired-Upcoming, Manual) publishes version 1 of its final
--     standings in the SAME transaction as the status change. Failure rolls the whole transition
--     back. Rows are ranked by the one shared rank function (league_rank_counters) over the
--     canonical fact source (league_counter_rows_through), never over mutable pointers.
--   * The first official confirmation of an eligible IN-PERIOD group that arrives after the final
--     was published appends a NEW version (cause late_first_confirmation) with an audit event
--     (standings_revised). Earlier versions are never rewritten. A retry or a group already
--     contained in the latest version creates nothing. Play outside the period stays ineligible
--     (the canonical source rejects it), so it never creates a version.
--   * Manual close samples its clock after the community/League locks and is replay-idempotent for
--     an authorized owner/Admin. The Fixed cutoff stays exactly end_at.
--   * Snapshots hold frozen labels, counters, positions, threshold and award flags. They have no
--     runtime access: members read them only through get_league_standings /
--     list_league_standings_versions; owner/Admin read the lifecycle audit through
--     get_league_standings_audit.
--   * Lock order is unchanged: community -> League; League work finishes before the global rating
--     projector, which keeps the last lock.

-- 1. Audit vocabulary.
alter table public.league_events drop constraint league_events_action_check;
alter table public.league_events add constraint league_events_action_check
  check (action in ('created', 'updated', 'activated', 'activation_blocked', 'closed', 'standings_revised'));
alter table public.league_events drop constraint league_events_system_reason_check;
alter table public.league_events add constraint league_events_system_reason_check
  check (system_reason in ('due_start', 'fixed_end_reached', 'expired_before_activation', 'activation_conflict',
    'late_first_confirmation', 'standings_repair', 'standings_reconstruction'));

-- 2. Snapshot storage.
create table public.league_standings_snapshots (
  league_id uuid not null,
  community_id uuid not null,
  standings_version integer not null check (standings_version >= 1),
  cause text not null check (cause in ('closed', 'late_first_confirmation', 'repair', 'reconstruction')),
  basis text not null check (basis in ('published', 'reconstructed')),
  triggering_confirmation_id uuid references public.match_event_result_confirmations(id) on delete restrict,
  minimum_matches_for_final_award integer not null check (minimum_matches_for_final_award between 1 and 100),
  period_start_at timestamptz not null,
  effective_end_at timestamptz not null,
  included_confirmation_ids uuid[] not null,
  entries jsonb not null check (jsonb_typeof(entries) = 'array'),
  generated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (league_id, standings_version),
  constraint league_standings_snapshots_league_fk foreign key (league_id, community_id)
    references public.leagues (id, community_id) on delete restrict,
  constraint league_standings_snapshots_trigger_cause
    check ((cause = 'late_first_confirmation') = (triggering_confirmation_id is not null))
);
create unique index league_standings_snapshots_trigger_unique
  on public.league_standings_snapshots (league_id, triggering_confirmation_id)
  where triggering_confirmation_id is not null;

create function public.guard_league_standings_snapshots_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'LEAGUE_STANDINGS_SNAPSHOT_IMMUTABLE';
end $$;
create trigger league_standings_snapshots_immutable
  before update or delete on public.league_standings_snapshots
  for each row execute function public.guard_league_standings_snapshots_immutable();

alter table public.league_standings_snapshots enable row level security;
revoke all on public.league_standings_snapshots from public, anon, authenticated, service_role;

-- 3. Canonical aggregation with an optional confirmation cutoff (used by reconstruction), and the
-- one rank function shared by live standings and snapshots.
create function public.league_counter_rows_through(p_league_id uuid, p_through timestamptz)
returns table (
  user_id uuid,
  matches integer,
  wins integer,
  losses integer,
  draws integer,
  sets_won integer,
  sets_lost integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with lines as (
    select u.value::uuid as user_id, s.side, g.classification, g.sets
      from public.league_confirmed_groups(p_league_id) g
      cross join lateral (values ('team_a'), ('team_b')) s(side)
      cross join lateral pg_catalog.jsonb_array_elements_text(g.teams -> s.side) u(value)
     where g.eligible and (p_through is null or g.confirmed_at <= p_through)
  )
  select l.user_id,
      pg_catalog.count(*)::integer,
      (pg_catalog.count(*) filter (where l.classification = l.side))::integer,
      (pg_catalog.count(*) filter (where l.classification <> l.side and l.classification <> 'draw'))::integer,
      (pg_catalog.count(*) filter (where l.classification = 'draw'))::integer,
      coalesce(pg_catalog.sum(sc.won), 0)::integer,
      coalesce(pg_catalog.sum(sc.lost), 0)::integer
    from lines l
    cross join lateral (
      select
        pg_catalog.count(*) filter (where (x ->> 'completed')::boolean
          and (case when l.side = 'team_a' then (x ->> 'team_a_games')::integer > (x ->> 'team_b_games')::integer
                    else (x ->> 'team_b_games')::integer > (x ->> 'team_a_games')::integer end)) as won,
        pg_catalog.count(*) filter (where (x ->> 'completed')::boolean
          and (case when l.side = 'team_a' then (x ->> 'team_b_games')::integer > (x ->> 'team_a_games')::integer
                    else (x ->> 'team_a_games')::integer > (x ->> 'team_b_games')::integer end)) as lost
      from pg_catalog.jsonb_array_elements(l.sets) x
    ) sc
   group by l.user_id;
$$;

create or replace function public.league_counter_rows(p_league_id uuid)
returns table (
  user_id uuid,
  matches integer,
  wins integer,
  losses integer,
  draws integer,
  sets_won integer,
  sets_lost integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from public.league_counter_rows_through(p_league_id, null);
$$;

-- Sporting rank, defined once: Wins desc, Losses asc, Set Differential desc, Sets Won desc.
-- Competition ranking (1, 1, 3): rows equal on all four keys share a position.
create function public.league_rank_counters(p_rows jsonb, p_threshold integer)
returns table (
  user_id uuid,
  place integer,
  matches integer,
  wins integer,
  losses integer,
  draws integer,
  sets_won integer,
  sets_lost integer,
  set_differential integer,
  award_eligible boolean,
  matches_remaining integer
)
language sql
immutable
set search_path = ''
as $$
  select r.user_id,
      (pg_catalog.rank() over (
        order by r.wins desc, r.losses asc, (r.sets_won - r.sets_lost) desc, r.sets_won desc))::integer,
      r.matches, r.wins, r.losses, r.draws, r.sets_won, r.sets_lost,
      r.sets_won - r.sets_lost,
      r.matches >= p_threshold,
      greatest(p_threshold - r.matches, 0)
    from pg_catalog.jsonb_to_recordset(p_rows) as r(
      user_id uuid, matches integer, wins integer, losses integer, draws integer,
      sets_won integer, sets_lost integer);
$$;

create or replace function public.league_standings_entries(p_league_id uuid)
returns table (
  user_id uuid,
  place integer,
  matches integer,
  wins integer,
  losses integer,
  draws integer,
  sets_won integer,
  sets_lost integer,
  set_differential integer,
  award_eligible boolean,
  matches_remaining integer
)
language sql
stable
security definer
set search_path = ''
as $$
  with league as (
    select l.id, l.community_id, l.status, l.minimum_matches_for_final_award as threshold
      from public.leagues l where l.id = p_league_id
  ), roster as (
    select c.user_id, c.matches, c.wins, c.losses, c.draws, c.sets_won, c.sets_lost
      from public.league_player_counters c where c.league_id = p_league_id
    union all
    select m.user_id, 0, 0, 0, 0, 0, 0
      from league lg
      join public.community_members m on m.community_id = lg.community_id
     where lg.status <> 'closed' and m.status = 'active'
       and m.valid_until is null and m.activated_at is not null
       and not exists (
         select 1 from public.league_player_counters c
          where c.league_id = p_league_id and c.user_id = m.user_id)
  )
  select k.user_id, k.place, k.matches, k.wins, k.losses, k.draws, k.sets_won, k.sets_lost,
      k.set_differential, k.award_eligible, k.matches_remaining
    from public.league_rank_counters(
      (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb) from roster r),
      (select lg.threshold from league lg)) k;
$$;

-- 4. Publication. The caller holds the community lock and the League row lock.
create function public.league_publish_standings(
  p_league_id uuid, p_cause text, p_confirmation_id uuid, p_through timestamptz, p_basis text)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_version integer;
begin
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found or v_league.status <> 'closed' then
    raise exception using errcode = '55000', message = 'LEAGUE_INVALID_STATE';
  end if;
  select coalesce(pg_catalog.max(s.standings_version), 0) + 1 into v_version
    from public.league_standings_snapshots s where s.league_id = p_league_id;

  insert into public.league_standings_snapshots(
    league_id, community_id, standings_version, cause, basis, triggering_confirmation_id,
    minimum_matches_for_final_award, period_start_at, effective_end_at, included_confirmation_ids, entries)
  values (
    p_league_id, v_league.community_id, v_version, p_cause, p_basis, p_confirmation_id,
    v_league.minimum_matches_for_final_award, v_league.start_at, v_league.closed_at,
    (select coalesce(pg_catalog.array_agg(g.confirmation_id order by g.confirmation_id), '{}'::uuid[])
       from public.league_confirmed_groups(p_league_id) g
      where g.eligible and (p_through is null or g.confirmed_at <= p_through)),
    (select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', k.user_id,
        'display_name', profile.display_name,
        'is_provisional', coalesce(profile.is_provisional, false),
        'position', k.place,
        'matches', k.matches,
        'wins', k.wins,
        'losses', k.losses,
        'draws', k.draws,
        'sets_won', k.sets_won,
        'sets_lost', k.sets_lost,
        'set_differential', k.set_differential,
        'award_eligible', k.award_eligible,
        'matches_remaining', k.matches_remaining
      ) order by k.place, k.user_id), '[]'::jsonb)
       from public.league_rank_counters(
         (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e)), '[]'::jsonb)
            from public.league_counter_rows_through(p_league_id, p_through) e),
         v_league.minimum_matches_for_final_award) k
       left join public.player_profiles profile on profile.user_id = k.user_id)
  );
  return v_version;
end $$;

-- Appends a revised final for one newly included eligible confirmation. Returns the new version, or
-- null when nothing is to be published (no final yet, or the latest version already contains it).
create function public.league_publish_late_confirmation(
  p_league_id uuid, p_confirmation_id uuid,
  p_through timestamptz default null, p_basis text default 'published')
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_latest public.league_standings_snapshots;
  v_league public.leagues;
  v_confirmation public.match_event_result_confirmations;
  v_fact public.match_event_result_proposal_versions;
  v_version integer;
begin
  select * into v_latest from public.league_standings_snapshots s
   where s.league_id = p_league_id order by s.standings_version desc limit 1;
  if not found or p_confirmation_id = any (v_latest.included_confirmation_ids) then
    return null;
  end if;
  select * into v_league from public.leagues l where l.id = p_league_id;
  select * into v_confirmation from public.match_event_result_confirmations c where c.id = p_confirmation_id;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = v_confirmation.proposal_id and v.version = v_confirmation.proposal_version;

  v_version := public.league_publish_standings(
    p_league_id, 'late_first_confirmation', p_confirmation_id, p_through, p_basis);
  insert into public.league_events(league_id, community_id, action, actor_id, system_reason, details)
    values (p_league_id, v_league.community_id, 'standings_revised',
      case when p_basis = 'published' then v_confirmation.actor_id end,
      case when p_basis <> 'published' then 'standings_reconstruction'
        when v_confirmation.actor_id is null then 'late_first_confirmation' end,
      pg_catalog.jsonb_build_object(
        'old_standings_version', v_latest.standings_version,
        'standings_version', v_version,
        'confirmation_id', v_confirmation.id,
        'proposal_id', v_confirmation.proposal_id,
        'proposal_version', v_confirmation.proposal_version,
        'match_event_id', v_confirmation.match_event_id,
        'group_number', v_confirmation.group_number,
        'source', v_confirmation.source,
        'played_at', public.league_utc_text(v_fact.played_at_utc),
        'confirmed_at', public.league_utc_text(v_confirmation.confirmed_at),
        'effective_cutoff', public.league_utc_text(v_league.closed_at)));
  return v_version;
end $$;

-- Internal repair: if the eligible evidence of a closed League differs from what its latest final
-- contains (e.g. a trusted retroactive membership change), appends a truthful repair version.
-- Same-input calls are no-ops. Takes community -> League locks itself.
create function public.league_repair_closed_standings(p_league_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_league public.leagues;
  v_latest public.league_standings_snapshots;
  v_eligible uuid[];
  v_version integer;
begin
  select l.community_id into v_community from public.leagues l where l.id = p_league_id;
  if v_community is null then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_community for update;
  select * into v_league from public.leagues l where l.id = p_league_id for no key update;
  if v_league.status <> 'closed' then return null; end if;
  perform public.rebuild_league_counters(p_league_id);

  select * into v_latest from public.league_standings_snapshots s
   where s.league_id = p_league_id order by s.standings_version desc limit 1;
  select coalesce(pg_catalog.array_agg(g.confirmation_id order by g.confirmation_id), '{}'::uuid[])
    into v_eligible from public.league_confirmed_groups(p_league_id) g where g.eligible;
  if v_latest.standings_version is not null and v_latest.included_confirmation_ids = v_eligible then
    return null;
  end if;

  v_version := public.league_publish_standings(p_league_id, 'repair', null, null, 'published');
  insert into public.league_events(league_id, community_id, action, system_reason, details)
    values (p_league_id, v_community, 'standings_revised', 'standings_repair',
      pg_catalog.jsonb_build_object(
        'old_standings_version', v_latest.standings_version,
        'standings_version', v_version,
        'added_confirmations', (select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb)
          from pg_catalog.unnest(v_eligible) x
          where v_latest.included_confirmation_ids is null or x <> all (v_latest.included_confirmation_ids)),
        'removed_confirmations', (select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb)
          from pg_catalog.unnest(coalesce(v_latest.included_confirmation_ids, '{}'::uuid[])) x
          where x <> all (v_eligible))));
  return v_version;
end $$;

-- Finalizer hook (replaces 20261101195000): after the counters are rebuilt, a first inclusion into
-- an already closed League appends the revised final.
create or replace function public.project_league_confirmation(p_confirmation_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmation public.match_event_result_confirmations%rowtype;
  v_league_id uuid;
  v_fact public.match_event_result_proposal_versions%rowtype;
begin
  select * into v_confirmation from public.match_event_result_confirmations c where c.id = p_confirmation_id;
  if not found or not v_confirmation.ratable_eligible or v_confirmation.event_type <> 'competitive' then
    return false;
  end if;
  select e.league_id into v_league_id from public.match_events e where e.id = v_confirmation.match_event_id;
  if v_league_id is null then return false; end if;
  if exists (
    select 1 from public.league_projection_confirmations r
     where r.league_id = v_league_id and r.confirmation_id = p_confirmation_id
  ) then return false; end if;

  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = v_confirmation.proposal_id and v.version = v_confirmation.proposal_version;
  if not found or v_fact.classification = 'incomplete'
    or public.match_result_ranked_ineligibility(
      v_confirmation.match_event_id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc) is not null
  then return false; end if;

  perform public.rebuild_league_counters(v_league_id);
  if (select l.status from public.leagues l where l.id = v_league_id) = 'closed' then
    perform public.league_publish_late_confirmation(v_league_id, p_confirmation_id);
  end if;
  return true;
end $$;

-- 5. Lifecycle: every path that closes a League publishes version 1 atomically.
create or replace function public.league_process_community_locked(p_community_id uuid, p_as_of timestamptz default pg_catalog.clock_timestamp())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.leagues;
  v_closed integer := 0;
  v_activated integer := 0;
  v_blocked integer := 0;
  v_expired_until timestamptz;
  v_slot_taken boolean;
  v_candidates uuid[];
  v_candidate_start timestamptz;
  v_version integer;
begin
  -- 1. An Active Fixed League stays Active through its inclusive end instant, then closes.
  for v_row in select * from public.leagues l
      where l.community_id = p_community_id and l.status = 'active' and l.end_mode = 'fixed_date'
        and l.end_at < p_as_of order by l.id for update loop
    update public.leagues set status = 'closed', closed_at = v_row.end_at, closed_reason = 'fixed_end_reached',
        version = v_row.version + 1 where id = v_row.id;
    v_version := public.league_publish_standings(v_row.id, 'closed', null, null, 'published');
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'closed', 'fixed_end_reached',
        pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_row.end_at),
          'standings_version', v_version));
    v_closed := v_closed + 1;
    v_expired_until := greatest(v_expired_until, v_row.end_at);
  end loop;

  -- 2. An Upcoming Fixed League whose whole window passed without ever starting closes unused.
  for v_row in select * from public.leagues l
      where l.community_id = p_community_id and l.status = 'upcoming' and l.end_mode = 'fixed_date'
        and l.end_at < p_as_of order by l.id for update loop
    update public.leagues set status = 'closed', closed_at = v_row.end_at, activation_blocked_at = null,
        closed_reason = 'expired_before_activation', version = v_row.version + 1 where id = v_row.id;
    v_version := public.league_publish_standings(v_row.id, 'closed', null, null, 'published');
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'closed', 'expired_before_activation',
        pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_row.end_at),
          'standings_version', v_version));
    v_closed := v_closed + 1;
  end loop;

  -- 3. Due Upcoming Leagues not yet evaluated (unchanged from 20261101161000).
  select pg_catalog.array_agg(l.id order by l.start_at, l.id), pg_catalog.min(l.start_at)
    into v_candidates, v_candidate_start
    from public.leagues l
    where l.community_id = p_community_id and l.status = 'upcoming'
      and l.start_at <= p_as_of and l.activation_blocked_at is null;
  if v_candidates is null then
    return pg_catalog.jsonb_build_object('closed', v_closed, 'activated', 0, 'blocked', 0);
  end if;
  v_slot_taken := exists (select 1 from public.leagues a where a.community_id = p_community_id and a.status = 'active');
  if not v_slot_taken and pg_catalog.cardinality(v_candidates) = 1
    and (v_expired_until is null or v_candidate_start > v_expired_until) then
    select * into v_row from public.leagues l where l.id = v_candidates[1] for update;
    update public.leagues set status = 'active', activated_at = p_as_of, version = v_row.version + 1
      where id = v_row.id;
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'activated', 'due_start', '{}'::jsonb);
    v_activated := 1;
  else
    for v_row in select * from public.leagues l where l.id = any (v_candidates) order by l.id for update loop
      update public.leagues set activation_blocked_at = p_as_of, version = v_row.version + 1 where id = v_row.id;
      insert into public.league_events (league_id, community_id, action, system_reason, details)
        values (v_row.id, v_row.community_id, 'activation_blocked', 'activation_conflict',
          pg_catalog.jsonb_build_object('reason',
            case when v_slot_taken or v_expired_until is not null then 'active_league_exists'
              else 'explicit_activation_required' end));
      v_blocked := v_blocked + 1;
    end loop;
  end if;
  return pg_catalog.jsonb_build_object('closed', v_closed, 'activated', v_activated, 'blocked', v_blocked);
end $$;

-- The command clock is sampled only after the community and League locks are held, so a command
-- that waited cannot stamp an instant earlier than work that committed while it waited.
create or replace function public.league_lock_for_command(p_league_id uuid, p_expected_version integer)
returns public.leagues language plpgsql security definer set search_path = '' as $$
declare v_community uuid; v_row public.leagues; v_now timestamptz;
begin
  if p_league_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'LEAGUE_INVALID_INPUT';
  end if;
  select l.community_id into v_community from public.leagues l where l.id = p_league_id;
  if not found or not public.is_community_member(v_community) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_community for update;
  select * into v_row from public.leagues l where l.id = p_league_id for update;
  if not public.is_community_member(v_community)
    or not public.league_actor_can_manage(v_community, v_row.owner_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  -- The caller's version is compared with what the caller saw, before reconciliation moves it.
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'LEAGUE_VERSION_CONFLICT';
  end if;
  v_now := pg_catalog.clock_timestamp();
  perform public.league_process_community_locked(v_community, v_now);
  select * into v_row from public.leagues l where l.id = p_league_id;
  return v_row;
end $$;

-- Manual close: owner/Admin only (checked before and under the lock), cutoff stamped under the
-- lock, publishes version 1 atomically, replay-idempotent. A retry of the same request (the League
-- is already Manually closed at the version the request would have produced, or at the version the
-- caller already saw) returns the existing closed League with no new audit or version.
create or replace function public.close_league(p_league_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz;
  v_community uuid;
  v_row public.leagues;
  v_version integer;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  if p_league_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'LEAGUE_INVALID_INPUT';
  end if;
  select l.community_id into v_community from public.leagues l where l.id = p_league_id;
  if not found or not public.is_community_member(v_community) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_community for update;
  select * into v_row from public.leagues l where l.id = p_league_id for update;
  if not public.is_community_member(v_community)
    or not public.league_actor_can_manage(v_community, v_row.owner_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;

  if v_row.status = 'closed' and v_row.closed_reason = 'manual'
    and v_row.version in (p_expected_version, p_expected_version + 1) then
    return public.league_dto(v_row);
  end if;
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'LEAGUE_VERSION_CONFLICT';
  end if;

  v_now := pg_catalog.clock_timestamp();
  perform public.league_process_community_locked(v_community, v_now);
  select * into v_row from public.leagues l where l.id = p_league_id;
  if v_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'LEAGUE_INVALID_STATE';
  end if;
  -- A Fixed League ends by its own end date; closing it early would be a covert date edit.
  if v_row.end_mode <> 'manual' then
    raise exception using errcode = '55000', message = 'LEAGUE_CLOSE_NOT_MANUAL';
  end if;
  update public.leagues set status = 'closed', closed_at = v_now, closed_by = v_actor,
      closed_reason = 'manual', version = version + 1 where id = v_row.id returning * into v_row;
  v_version := public.league_publish_standings(v_row.id, 'closed', null, null, 'published');
  insert into public.league_events (league_id, community_id, action, actor_id, details)
    values (v_row.id, v_row.community_id, 'closed', v_actor,
      pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_now),
        'standings_version', v_version));
  return public.league_dto(v_row);
end $$;

-- 6. Readers.
drop function public.get_league_standings(uuid);
create function public.get_league_standings(p_league_id uuid, p_standings_version integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_entries jsonb;
  v_latest integer;
  v_snapshot public.league_standings_snapshots;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_league from public.leagues l where l.id = p_league_id;
  -- Unknown and unreadable Leagues fail identically.
  if not found or not public.is_community_member(v_league.community_id) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  if p_standings_version is not null and p_standings_version < 1 then
    raise exception using errcode = '22023', message = 'LEAGUE_STANDINGS_VERSION_INVALID';
  end if;

  if v_league.status <> 'closed' then
    -- Only a closed League has versions; a live table is never addressed by version.
    if p_standings_version is not null then
      raise exception using errcode = '22023', message = 'LEAGUE_STANDINGS_VERSION_INVALID';
    end if;
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', s.user_id,
        'display_name', profile.display_name,
        'is_provisional', coalesce(profile.is_provisional, false),
        'position', s.place,
        'matches', s.matches,
        'wins', s.wins,
        'losses', s.losses,
        'draws', s.draws,
        'sets_won', s.sets_won,
        'sets_lost', s.sets_lost,
        'set_differential', s.set_differential,
        'award_eligible', s.award_eligible,
        'matches_remaining', s.matches_remaining
      ) order by s.place, s.user_id), '[]'::jsonb)
      into v_entries
      from public.league_standings_entries(p_league_id) s
      left join public.player_profiles profile on profile.user_id = s.user_id;
    return pg_catalog.jsonb_build_object(
      'league_id', v_league.id,
      'status', v_league.status,
      'minimum_matches_for_final_award', v_league.minimum_matches_for_final_award,
      'source', 'live',
      'standings_version', null,
      'latest_standings_version', null,
      'generated_at', null,
      'cause', null,
      'entries', v_entries);
  end if;

  select pg_catalog.max(s.standings_version) into v_latest
    from public.league_standings_snapshots s where s.league_id = p_league_id;
  select * into v_snapshot from public.league_standings_snapshots s
   where s.league_id = p_league_id and s.standings_version = coalesce(p_standings_version, v_latest);
  if not found then
    raise exception using errcode = 'P0002', message = 'LEAGUE_STANDINGS_VERSION_NOT_FOUND';
  end if;
  return pg_catalog.jsonb_build_object(
    'league_id', v_league.id,
    'status', v_league.status,
    'minimum_matches_for_final_award', v_snapshot.minimum_matches_for_final_award,
    'source', 'final',
    'standings_version', v_snapshot.standings_version,
    'latest_standings_version', v_latest,
    'generated_at', public.league_utc_text(v_snapshot.generated_at),
    'cause', v_snapshot.cause,
    'entries', v_snapshot.entries);
end $$;

-- Member-safe publication history: newest first, bounded keyset by version. Carries the safe
-- cause, timing and (for a late first confirmation) the source kind of the confirmation, never an
-- actor, an account or match evidence identifier.
create function public.list_league_standings_versions(p_league_id uuid, p_before_version integer default null)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_page integer[];
  v_more boolean;
  v_versions jsonb;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found or not public.is_community_member(v_league.community_id) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  if p_before_version is not null and p_before_version < 1 then
    raise exception using errcode = '22023', message = 'LEAGUE_STANDINGS_VERSION_INVALID';
  end if;

  select pg_catalog.array_agg(x.standings_version order by x.standings_version desc) into v_page
    from (select s.standings_version from public.league_standings_snapshots s
        where s.league_id = p_league_id
          and (p_before_version is null or s.standings_version < p_before_version)
        order by s.standings_version desc limit 51) x;
  v_page := coalesce(v_page, '{}');
  v_more := pg_catalog.cardinality(v_page) > 50;
  v_page := v_page[1:50];

  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'standings_version', s.standings_version,
      'cause', s.cause,
      'basis', s.basis,
      'generated_at', public.league_utc_text(s.generated_at),
      'effective_end_at', public.league_utc_text(s.effective_end_at),
      'minimum_matches_for_final_award', s.minimum_matches_for_final_award,
      'entry_count', pg_catalog.jsonb_array_length(s.entries),
      'confirmation', case when c.id is null then null else pg_catalog.jsonb_build_object(
        'source', c.source,
        'confirmed_at', public.league_utc_text(c.confirmed_at),
        'played_at', public.league_utc_text(v.played_at_utc)) end
    ) order by s.standings_version desc), '[]'::jsonb)
    into v_versions
    from public.league_standings_snapshots s
    left join public.match_event_result_confirmations c on c.id = s.triggering_confirmation_id
    left join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
   where s.league_id = p_league_id and s.standings_version = any (v_page);

  return pg_catalog.jsonb_build_object(
    'league_id', v_league.id,
    'status', v_league.status,
    'versions', v_versions,
    'next_before_version', case when v_more then v_page[pg_catalog.cardinality(v_page)] end);
end $$;

-- Owner/Admin lifecycle audit: the close and every standings revision with actor or system reason.
create function public.get_league_standings_audit(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found or not public.is_community_member(v_league.community_id) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  if not public.league_actor_can_manage(v_league.community_id, v_league.owner_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'league_id', v_league.id,
    'events', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'action', e.action,
        'actor_id', e.actor_id,
        'system_reason', e.system_reason,
        'occurred_at', public.league_utc_text(e.occurred_at),
        'details', e.details) order by e.occurred_at desc, e.id desc)
      from (select * from public.league_events x
          where x.league_id = p_league_id and x.action in ('closed', 'standings_revised')
          order by x.occurred_at desc, x.id desc limit 100) e), '[]'::jsonb));
end $$;

-- 7. Grants.
revoke all on function
  public.guard_league_standings_snapshots_immutable(), public.league_counter_rows_through(uuid, timestamptz),
  public.league_rank_counters(jsonb, integer), public.league_publish_standings(uuid, text, uuid, timestamptz, text),
  public.league_publish_late_confirmation(uuid, uuid, timestamptz, text),
  public.league_repair_closed_standings(uuid), public.project_league_confirmation(uuid),
  public.league_process_community_locked(uuid, timestamptz), public.league_lock_for_command(uuid, integer),
  public.league_counter_rows(uuid), public.league_standings_entries(uuid),
  public.close_league(uuid, integer),
  public.get_league_standings(uuid, integer), public.list_league_standings_versions(uuid, integer),
  public.get_league_standings_audit(uuid)
  from public, anon, authenticated, service_role;
grant execute on function
  public.close_league(uuid, integer),
  public.get_league_standings(uuid, integer), public.list_league_standings_versions(uuid, integer),
  public.get_league_standings_audit(uuid)
  to authenticated;

-- 8. Backfill: League that closed before this migration have no snapshot. Reconstruct honestly
-- from retained facts, one League at a time (community -> League locks). The original close
-- event time (not the Fixed period cutoff) is the publication cutoff: confirmations made up to it
-- form version 1 (cause reconstruction); eligible confirmations made later become one late version
-- each, in confirmation order. With no close event the League gets a single baseline over all
-- eligible evidence, because no original publication moment is recoverable. Generated timestamps
-- are migration time; source times are retained in the audit details. Rerunnable.
create function public.league_reconstruct_standings(p_league_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_close_at timestamptz;
  v_confirmation uuid;
  v_version integer;
  v_created integer := 1;
begin
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_league.community_id for update;
  select * into v_league from public.leagues l where l.id = p_league_id for no key update;
  if v_league.status <> 'closed'
    or exists (select 1 from public.league_standings_snapshots s where s.league_id = p_league_id) then
    return 0;
  end if;
  select e.occurred_at into v_close_at from public.league_events e
   where e.league_id = p_league_id and e.action = 'closed'
   order by e.occurred_at, e.id limit 1;

  v_version := public.league_publish_standings(p_league_id, 'reconstruction', null, v_close_at, 'reconstructed');
  insert into public.league_events(league_id, community_id, action, system_reason, details)
    values (p_league_id, v_league.community_id, 'standings_revised', 'standings_reconstruction',
      pg_catalog.jsonb_build_object(
        'standings_version', v_version,
        'provenance', case when v_close_at is null then 'close_event_unavailable' else 'close_event' end,
        'publication_cutoff', public.league_utc_text(v_close_at),
        'effective_cutoff', public.league_utc_text(v_league.closed_at)));

  if v_close_at is not null then
    for v_confirmation in
      select g.confirmation_id from public.league_confirmed_groups(p_league_id) g
       where g.eligible and g.confirmed_at > v_close_at
       order by g.confirmed_at, g.confirmation_id
    loop
      if public.league_publish_late_confirmation(
        p_league_id, v_confirmation,
        (select g.confirmed_at from public.league_confirmed_groups(p_league_id) g
          where g.confirmation_id = v_confirmation),
        'reconstructed') is not null then
        v_created := v_created + 1;
      end if;
    end loop;
  end if;
  return v_created;
end $$;
revoke all on function public.league_reconstruct_standings(uuid) from public, anon, authenticated, service_role;

do $$
declare v_league uuid;
begin
  for v_league in
    select l.id from public.leagues l
     where l.status = 'closed'
       and not exists (select 1 from public.league_standings_snapshots s where s.league_id = l.id)
     order by l.id
  loop
    perform public.league_reconstruct_standings(v_league);
  end loop;
end $$;

commit;
