begin;

-- PAF-11 / U4: narrow League counter reader (AC12).
--
-- Contract (docs/plan/Plan PAF-11 T11, "Minimal counters for AC12"; approved Q1):
--   * Read-only aggregation, per permanent user UUID, over IMMUTABLE confirmed facts: official
--     confirmations of ratable Competitive groups whose parent event explicitly references the
--     League and whose actual quartet passes the same historical eligibility used at result time
--     (match_result_ranked_ineligibility). A group that fails the all-four gate is excluded as a
--     whole and counted in excluded_group_count, never partially credited.
--   * Counters: matches, wins, losses, draws, sets won/lost, set differential. Only completed sets
--     count. No mu, global level, reliability or rating delta is read, so the counters can neither
--     be seeded from nor ordered by global skill. Rows are ordered by display name only; standings
--     order, positions, awards and snapshots belong to T12.
--   * Participants are every currently active member of the community (provisional members are
--     ordinary participants, zero-initialised) plus anyone with earned counters (former members
--     stay visible). A closed League lists only earned entries. The provisional marker comes from
--     the profile at read time, so a claim changes the badge only: the key is the same UUID.
--   * No global rating lock is taken: the function is STABLE, reads committed rows, and holds no
--     League, community or event lock, so it cannot join the finalizer's lock graph.
--   * Privacy: community members of the League's community only (same gate as get_league);
--     provisional actors are restricted; the payload carries display name + provisional flag and
--     never email, inviter or sporting facts from other communities.

create or replace function public.get_league_counters(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_participants jsonb;
  v_excluded integer;
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

  with confirmed as (
    select c.match_event_id, v.teams, v.sets, v.classification, v.played_at_utc,
        public.match_result_ranked_ineligibility(
          c.match_event_id, public.match_result_fact_quartet(v.teams), v.played_at_utc) is null as eligible
      from public.match_events e
      join public.match_event_result_confirmations c
        on c.match_event_id = e.id and c.ratable_eligible
      join public.match_event_result_proposal_versions v
        on v.proposal_id = c.proposal_id and v.version = c.proposal_version
     where e.league_id = p_league_id and e.event_type = 'competitive'
       and v.classification <> 'incomplete'
  ), lines as (
    select u.value::uuid as user_id, s.side, g.classification, g.sets
      from confirmed g
      cross join lateral (values ('team_a'), ('team_b')) s(side)
      cross join lateral pg_catalog.jsonb_array_elements_text(g.teams -> s.side) u(value)
     where g.eligible
  ), earned as (
    select l.user_id,
        pg_catalog.count(*)::integer as matches,
        pg_catalog.count(*) filter (where l.classification = l.side)::integer as wins,
        pg_catalog.count(*) filter (where l.classification = 'draw')::integer as draws,
        pg_catalog.count(*) filter (where l.classification <> l.side and l.classification <> 'draw')::integer as losses,
        coalesce(pg_catalog.sum(sc.won), 0)::integer as sets_won,
        coalesce(pg_catalog.sum(sc.lost), 0)::integer as sets_lost
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
     group by l.user_id
  ), roster as (
    select e.user_id from earned e
    union
    select m.user_id from public.community_members m
     where v_league.status <> 'closed'
       and m.community_id = v_league.community_id and m.status = 'active'
       and m.valid_until is null and m.activated_at is not null
  )
  select
    coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'user_id', r.user_id,
      'display_name', profile.display_name,
      'is_provisional', coalesce(profile.is_provisional, false),
      'matches', coalesce(e.matches, 0),
      'wins', coalesce(e.wins, 0),
      'losses', coalesce(e.losses, 0),
      'draws', coalesce(e.draws, 0),
      'sets_won', coalesce(e.sets_won, 0),
      'sets_lost', coalesce(e.sets_lost, 0),
      'set_differential', coalesce(e.sets_won, 0) - coalesce(e.sets_lost, 0)
    ) order by lower(profile.display_name), r.user_id), '[]'::jsonb),
    (select pg_catalog.count(*)::integer from confirmed c2 where not c2.eligible)
  into v_participants, v_excluded
  from roster r
  left join earned e on e.user_id = r.user_id
  left join public.player_profiles profile on profile.user_id = r.user_id;

  return pg_catalog.jsonb_build_object(
    'league_id', v_league.id,
    'participants', v_participants,
    'excluded_group_count', v_excluded
  );
end $$;

revoke all on function public.get_league_counters(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_league_counters(uuid) to authenticated;

commit;
