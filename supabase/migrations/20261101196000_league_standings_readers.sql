begin;

-- PAF-12 / U2: deterministic League standings and minimum-match award eligibility.
--
-- Contract (docs/plan/Plan PAF-12 T12, "Read contract", U2):
--   * Sporting rank is defined once, here, in league_standings_entries(): Wins desc, Losses asc,
--     Set Differential desc, Sets Won desc. Competition ranking (rank(), e.g. 1,1,3): rows equal on
--     all four keys share a position. Draws, Matches, name, level, reliability and rating deltas
--     never enter the window. Within a shared position rows are presented by UUID, which is
--     presentation only. A future snapshot builder reuses this function.
--   * Source is the U1 materialized league_player_counters (earned rows, never discarded on leave)
--     plus a read-time zero overlay of every currently active member while the League is not
--     closed. No rating, level, reliability or delta is read.
--   * Award state is threshold-only: award_eligible = matches >= the League's
--     minimum_matches_for_final_award and matches_remaining = max(threshold - matches, 0).
--     The threshold never filters or reorders rows; changing it is reflected immediately.
--   * get_league_standings() is the live contract. It is STABLE, reads committed rows in one
--     statement snapshot and never reconciles lifecycle. Closed Leagues return earned rows only and
--     are NOT an immutable final (versioned snapshots arrive with the close publication unit).
--   * Privacy: same gate as get_league_counters (authenticated, non-anonymous, non-provisional
--     actor, active community member; unknown and unreadable Leagues fail identically). The payload
--     carries display name + provisional flag only, never email or skill data.

create function public.league_standings_entries(p_league_id uuid)
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
  select r.user_id,
      (pg_catalog.rank() over (
        order by r.wins desc, r.losses asc, (r.sets_won - r.sets_lost) desc, r.sets_won desc))::integer,
      r.matches, r.wins, r.losses, r.draws, r.sets_won, r.sets_lost,
      r.sets_won - r.sets_lost,
      r.matches >= lg.threshold,
      greatest(lg.threshold - r.matches, 0)
    from roster r cross join league lg;
$$;

create function public.get_league_standings(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_entries jsonb;
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
    'entries', v_entries
  );
end $$;

revoke all on function public.league_standings_entries(uuid) from public, anon, authenticated, service_role;
revoke all on function public.get_league_standings(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_league_standings(uuid) to authenticated;

commit;
