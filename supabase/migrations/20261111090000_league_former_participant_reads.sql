begin;

-- PAF-173: read-only League access for former participants.
--
-- Contract:
--   * A caller who is no longer an active community member may still READ a League they actually
--     played in: get_league, get_league_standings, list_league_standings_versions and
--     get_league_counters. Nothing else changes: list_leagues, the audit reader, every command,
--     membership authority (is_community_member, league_actor_can_manage) and every table grant
--     and RLS policy stay exactly as they were, so the community itself stays closed.
--   * Participation is derived from immutable sporting facts ONLY, never from membership, a
--     profile, a registration, ownership or an app-wide identifier:
--       - an earned league_player_counters row with matches > 0 for that League, or
--       - the caller's uuid in the teams of an immutable, confirmed proposal version of a match
--         event bound to that League (any classification, eligible or not, so a confirmed
--         Incomplete or historically League-ineligible group still counts; pending, disputed or
--         rejected proposals never do).
--   * Denial keeps the existing contract: unknown, unreadable and non-participating all raise
--     P0002 LEAGUE_NOT_FOUND after the unchanged authentication and provisional-actor checks.
--   * get_league now returns an explicit server-derived access_mode ('member' wins whenever the
--     membership is still active) and a minimal community context (id, name, timezone): the
--     community creation settings are not needed by the detail view and are not exposed to a
--     former participant.

create function public.league_actor_has_participation(p_league_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') <> 'true'
    and p_league_id is not null
    and (
      exists (
        select 1 from public.league_player_counters c
         where c.league_id = p_league_id and c.user_id = (select auth.uid()) and c.matches > 0)
      or exists (
        select 1
          from public.match_events e
          join public.match_event_result_confirmations c on c.match_event_id = e.id
          join public.match_event_result_proposal_versions v
            on v.proposal_id = c.proposal_id and v.version = c.proposal_version
         where e.league_id = p_league_id
           and (v.teams -> 'team_a' @> pg_catalog.to_jsonb(((select auth.uid())::text))
             or v.teams -> 'team_b' @> pg_catalog.to_jsonb(((select auth.uid())::text))))
    );
$$;

revoke all on function public.league_actor_has_participation(uuid)
  from public, anon, authenticated, service_role;

create or replace function public.get_league(p_league_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_row public.leagues;
  v_mode text;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_row from public.leagues l where l.id = p_league_id;
  -- Unknown and unreadable Leagues fail identically.
  if found and public.is_community_member(v_row.community_id) then
    v_mode := 'member';
  elsif found and public.league_actor_has_participation(v_row.id) then
    v_mode := 'former_participant';
  else
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  return pg_catalog.jsonb_build_object(
    'access_mode', v_mode,
    'community', (select pg_catalog.jsonb_build_object(
        'id', c.id, 'name', c.name,
        'timezone', public.get_effective_community_admin_defaults(c.settings) ->> 'timezone')
      from public.communities c where c.id = v_row.community_id),
    'league', public.league_dto(v_row));
end $$;

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
  if not found or not (public.is_community_member(v_league.community_id)
      or public.league_actor_has_participation(v_league.id)) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;

  with earned as (
    select * from public.league_counter_rows(p_league_id)
  ), roster as (
    select e.user_id from earned e
    union
    select m.user_id from public.community_members m
     where v_league.status <> 'closed'
       -- The roster overlay is a member-only view: a former participant reads earned facts only.
       and public.is_community_member(v_league.community_id)
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
    (select pg_catalog.count(*)::integer from public.league_confirmed_groups(p_league_id) g where not g.eligible)
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

create or replace function public.get_league_standings(p_league_id uuid, p_standings_version integer default null)
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
  v_member boolean;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_league from public.leagues l where l.id = p_league_id;
  -- Unknown and unreadable Leagues fail identically.
  if not found or not (public.is_community_member(v_league.community_id)
      or public.league_actor_has_participation(v_league.id)) then
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
    v_member := public.is_community_member(v_league.community_id);
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
      from (
        -- Members read the live table with its zero-match roster overlay. A former participant
        -- reads earned facts only: the same sporting rank, over the earned counter rows alone.
        select e.* from public.league_standings_entries(p_league_id) e where v_member
        union all
        select k.* from public.league_rank_counters(
          (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c)), '[]'::jsonb)
             from public.league_player_counters c
            where c.league_id = p_league_id and c.matches > 0),
          v_league.minimum_matches_for_final_award) k
         where not v_member
      ) s
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

create or replace function public.list_league_standings_versions(p_league_id uuid, p_before_version integer default null)
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
  if not found or not (public.is_community_member(v_league.community_id)
      or public.league_actor_has_participation(v_league.id)) then
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

revoke all on function public.get_league(uuid), public.get_league_counters(uuid),
  public.get_league_standings(uuid, integer), public.list_league_standings_versions(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.get_league(uuid), public.get_league_counters(uuid),
  public.get_league_standings(uuid, integer), public.list_league_standings_versions(uuid, integer)
  to authenticated;

commit;
