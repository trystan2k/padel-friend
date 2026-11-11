begin;

-- PAF-173 follow-up: the live League position returned by get_player_statistics must not carry
-- roster information to a caller who is no longer a community member.
--
-- statistics_player_rank_block (reached only through get_player_statistics, whose self-read path a
-- former participant may use) took the live League place from league_standings_entries(), which
-- ranks the active-member zero-match roster overlay together with the earned rows. Position gaps
-- therefore disclosed the size of the current roster. Active members keep exactly that behavior;
-- every other caller gets the identical sporting rank over earned rows (matches > 0) only.
--
-- Additive CREATE OR REPLACE: signature, security attributes and grants are unchanged, and the
-- merged 20261102105000 migration is not edited. Every other branch is reproduced verbatim.

create or replace function public.statistics_player_rank_block(p_player_id uuid, p_community_id uuid, p_league_id uuid)
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
         and lp.standings_version = (select pg_catalog.max(s.standings_version)
           from public.league_standings_snapshots s where s.league_id = v_league.id)
       limit 1;
      v_league_active := case
        when found then public.statistics_rank_metric('ready', public.statistics_rank_value(
            v_pos.league_position, v_pos.basis, v_pos.published_at, v_pos.community_id, v_pos.league_id,
            v_pos.standings_version, null), null, v_pos.league_position, null, v_min)
        when exists (select 1 from public.league_standings_snapshots s where s.league_id = v_league.id)
          then public.statistics_rank_metric('insufficient', null, 'not_in_league', null, null, v_min)
        else public.statistics_rank_metric('unavailable', null, 'rank_coverage_boundary', null, null, v_min) end;
    else
      -- Active members read the live table with its zero-match roster overlay. A caller who is no
      -- longer a member (a former participant reading their own scope) gets the same sporting rank
      -- over the earned counter rows alone, so positions carry no information about the roster.
      if public.is_community_member(v_league.community_id) then
        select e.place into v_place from public.league_standings_entries(v_league.id) e where e.user_id = p_player_id;
      else
        select k.place into v_place
          from public.league_rank_counters(
            (select coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(c)), '[]'::jsonb)
               from public.league_player_counters c
              where c.league_id = v_league.id and c.matches > 0),
            v_league.minimum_matches_for_final_award) k
         where k.user_id = p_player_id;
      end if;
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


commit;
