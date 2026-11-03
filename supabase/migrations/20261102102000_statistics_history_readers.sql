begin;

-- PAF-13 / U2: statistics history and confirmed-group detail readers.
--
-- Contract (docs/plan/Plan PAF-13 T13, U2 + "Filter and authorization matrix"):
--   * list_statistics_history serves the CALLER's own history, newest first by a deterministic
--     keyset (sort instant, stable key). Confirmed groups come from the projected participant facts
--     (indexed by player and played_at); unresolved lifecycle entries (pending/disputed proposal,
--     awaiting result, canceled event, Reserve Not Playing) come from bounded, viewer-scoped reads of
--     the existing event/registration/proposal projections. A group appears exactly once: a proposal
--     key (g:<proposal id>) or an event key (e:<event id>:<group number>, 0 = event level).
--   * Lifecycle status (played, incomplete, disputed, pending, awaiting_result, canceled,
--     reserve_not_playing) is separate from match type (friendly, competitive). Pending/disputed
--     entries expose no score and no rating, so they are never presented as played.
--   * get_statistics_group_detail serves one CONFIRMED group from the projection. Visibility is a new
--     explicit helper (statistics_can_view_event): the event creator, a current community member or
--     admin, an accepted registrant, or a participant of the group. Everyone else, and unknown ids,
--     fail identically (STATISTICS_NOT_FOUND). It never widens the raw proposal/review/audit readers
--     and exposes no dispute note, rejection reason or email: the timeline is submission, correction,
--     approval and confirmation facts only.
--   * Readers never call the official-source or rebuild functions. Rating-derived fields come from
--     the participant facts of one committed revision; a lagging projection fails retryably with
--     STATISTICS_STALE_REVISION instead of mixing snapshots, and a cursor from another statistics
--     revision fails with STATISTICS_REVISION_STALE.

create function public.statistics_read_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'true' then
    raise exception using errcode = '28000', message = 'STATISTICS_UNAUTHENTICATED';
  end if;
  return v_uid;
end $$;

create function public.statistics_assert_rating_aligned() returns void
language plpgsql stable security definer set search_path = '' as $$
begin
  if exists (select 1 from public.statistics_projection_control k, public.player_rating_projection_control r
              where k.rating_revision <> r.committed_revision) then
    raise exception using errcode = 'P0001', message = 'STATISTICS_STALE_REVISION';
  end if;
end $$;

-- Sporting visibility of an event's confirmed facts. Deliberately separate from result review and
-- audit rights: seeing a history/detail entry grants neither.
create function public.statistics_can_view_event(p_event_id uuid, p_viewer uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.match_events e
     where e.id = p_event_id
       and (e.created_by = p_viewer
         or exists (select 1 from public.community_members m
              where m.community_id = e.community_id and m.user_id = p_viewer and m.status = 'active'
                and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now()))
         or exists (select 1 from public.match_event_registrations r
              where r.match_event_id = e.id and r.user_id = p_viewer and r.lifecycle = 'accepted')
         or exists (select 1 from public.statistics_group_facts f
              join public.statistics_participant_facts pf on pf.game_group_id = f.game_group_id
             where f.match_event_id = e.id and pf.user_id = p_viewer)));
$$;

create function public.list_statistics_history(
  p_community_id uuid default null,
  p_league_id uuid default null,
  p_type text default 'all',
  p_from date default null,
  p_through date default null,
  p_limit integer default 20,
  p_cursor_at timestamptz default null,
  p_cursor_key text default null,
  p_revision bigint default null,
  p_subject_player_id uuid default null
) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid;
  v_subject uuid;
  v_revision bigint;
  v_from timestamptz;
  v_until timestamptz;
  v_count integer;
  v_limit integer;
  v_items jsonb;
  v_next jsonb;
begin
  perform public.assert_actor_not_provisional();
  v_viewer := public.statistics_read_actor();
  v_subject := coalesce(p_subject_player_id, v_viewer);
  if v_subject <> v_viewer and (p_community_id is null or not exists (
    select 1 from public.community_members a join public.community_members b on a.community_id = b.community_id
     where a.community_id = p_community_id and a.user_id = v_viewer and b.user_id = v_subject
       and a.status = 'active' and b.status = 'active'
       and a.valid_from <= now() and (a.valid_until is null or a.valid_until > now())
       and b.valid_from <= now() and (b.valid_until is null or b.valid_until > now()))) then
    raise exception using errcode = 'P0002', message = 'STATISTICS_NOT_FOUND';
  end if;
  if p_type not in ('all', 'competitive', 'friendly')
    or p_limit is null or p_limit < 1
    or (p_cursor_at is null) <> (p_cursor_key is null)
    or (p_from is not null and p_through is not null and p_through < p_from)
    or (p_league_id is not null and p_community_id is null) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  if p_league_id is not null and not exists (
    select 1 from public.leagues l where l.id = p_league_id and l.community_id = p_community_id) then
    raise exception using errcode = '22023', message = 'STATISTICS_INVALID_INPUT';
  end if;
  select k.revision into v_revision from public.statistics_projection_control k;
  if p_revision is not null and p_revision <> v_revision then
    raise exception using errcode = 'P0001', message = 'STATISTICS_REVISION_STALE';
  end if;
  perform public.statistics_assert_rating_aligned();
  v_limit := least(p_limit, 100);
  v_from := p_from::timestamp at time zone 'UTC';
  v_until := (p_through + 1)::timestamp at time zone 'UTC';

  with a as materialized (
    select 'g:' || g.game_group_id::text as key, g.game_group_id as stable_id,
        'group'::text as kind, g.match_event_id as event_id, g.group_number, g.game_group_id as gid,
        case when g.classification = 'incomplete' then 'incomplete' else 'played' end as status,
        g.match_type, g.community_id, g.league_id, g.played_at as sort_at, g.played_at, pf.side as viewer_side,
        g.classification, g.sets, g.sets_a, g.sets_b, g.games_a, g.games_b, pf.rating_delta
      from public.statistics_participant_facts pf
      join public.statistics_group_facts g on g.game_group_id = pf.game_group_id
     where pf.user_id = v_subject
       and (p_community_id is null or g.community_id = p_community_id)
       and (p_type = 'all' or g.match_type = p_type)
       and (p_league_id is null or (g.league_id = p_league_id and g.league_eligible))
       and (v_from is null or g.played_at >= v_from) and (v_until is null or g.played_at < v_until)
       and (p_cursor_at is null or (g.played_at, g.game_group_id) < (p_cursor_at, p_cursor_key::uuid))
     order by g.played_at desc, g.game_group_id desc
     limit v_limit
  ), lifecycle as materialized (
    select case when l.entry_kind = 'group' then 'g:' || l.stable_id::text
                else 'e:' || l.event_id::text || ':' || coalesce(l.group_number, 0)::text end as key,
      l.stable_id, l.entry_kind as kind, l.event_id, l.group_number,
      case when l.entry_kind = 'group' then l.stable_id end as gid,
      l.lifecycle_status as status, l.match_type, l.community_id, l.league_id,
      l.sort_at, l.played_at, l.viewer_side, null::text as classification, null::jsonb as sets,
      null::integer as sets_a, null::integer as sets_b, null::integer as games_a,
      null::integer as games_b, null::numeric as rating_delta
    from public.statistics_participant_lifecycle l
    where l.user_id = v_subject and p_league_id is null
      and (p_community_id is null or l.community_id = p_community_id)
      and (p_type = 'all' or l.match_type = p_type)
      and (v_from is null or l.sort_at >= v_from) and (v_until is null or l.sort_at < v_until)
      and (l.lifecycle_status not in ('awaiting_result', 'reserve_not_playing') or l.sort_at <= now())
      and (p_cursor_at is null or (l.sort_at, l.stable_id) < (p_cursor_at, p_cursor_key::uuid))
    order by l.sort_at desc, l.stable_id desc
    limit v_limit
  ), paged as (
    select x.*, pg_catalog.row_number() over (order by x.sort_at desc, x.stable_id desc) as rn
      from (select * from a union all select * from lifecycle) x
     order by x.sort_at desc, x.stable_id desc
     limit v_limit
  )
  select pg_catalog.count(*)::integer,
      coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'key', q.key, 'kind', q.kind, 'event_id', q.event_id, 'group_number', q.group_number,
        'game_group_id', q.gid, 'status', q.status, 'match_type', q.match_type,
        'community_id', q.community_id, 'community_name', co.name,
        'league_id', q.league_id, 'league_name', le.name, 'venue_name', ev.venue_name, 'timezone', ev.timezone,
        'sort_at', public.statistics_utc_text(q.sort_at),
        'played_at', case when q.played_at is null then null else public.statistics_utc_text(q.played_at) end,
        'viewer_side', q.viewer_side,
        'opponents', coalesce((select pg_catalog.jsonb_agg(pr.display_name order by u.ordinality)
          from public.statistics_group_facts gf
          cross join lateral pg_catalog.unnest(case when q.viewer_side = 'team_a' then gf.team_b_players else gf.team_a_players end) with ordinality as u(id, ordinality)
          left join public.player_profiles pr on pr.user_id = u.id
          where gf.game_group_id = q.gid and q.status in ('played', 'incomplete')), '[]'::jsonb),
        'outcome', case when q.classification in ('team_a', 'team_b')
                        then case when q.classification = q.viewer_side then 'win' else 'loss' end
                        when q.classification = 'draw' then 'draw' end,
        'classification', q.classification, 'sets', q.sets,
        'sets_a', q.sets_a, 'sets_b', q.sets_b, 'games_a', q.games_a, 'games_b', q.games_b,
        'rating_delta', q.rating_delta) order by q.rn) filter (where q.rn <= v_limit), '[]'::jsonb),
      (pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('at', public.statistics_utc_text(q.sort_at), 'key', q.stable_id::text)
        order by q.rn) filter (where q.rn = v_limit)) -> 0
    into v_count, v_items, v_next
    from paged q
    join public.match_events ev on ev.id = q.event_id
    join public.communities co on co.id = q.community_id
    left join public.leagues le on le.id = q.league_id;

  return pg_catalog.jsonb_build_object(
    'items', v_items,
    'next_cursor', case when v_count = v_limit then v_next end,
    'statistics_revision', v_revision,
    'limit', v_limit);
end $$;

create function public.get_statistics_group_detail(p_event_id uuid, p_game_group_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_viewer uuid;
  g public.statistics_group_facts%rowtype;
  v_event public.match_events%rowtype;
  v_conf public.match_event_result_confirmations%rowtype;
  v_ver public.match_event_result_proposal_versions%rowtype;
  v_team jsonb;
  v_teams jsonb := '{}'::jsonb;
  v_side text;
  v_rating_state text;
  v_matchup jsonb;
  v_timeline jsonb;
  v_actor jsonb;
begin
  perform public.assert_actor_not_provisional();
  v_viewer := public.statistics_read_actor();
  select * into g from public.statistics_group_facts f
   where f.game_group_id = p_game_group_id and f.match_event_id = p_event_id;
  if not found or not public.statistics_can_view_event(p_event_id, v_viewer) then
    raise exception using errcode = 'P0002', message = 'STATISTICS_NOT_FOUND';
  end if;
  perform public.statistics_assert_rating_aligned();
  select * into v_event from public.match_events e where e.id = g.match_event_id;
  select * into v_conf from public.match_event_result_confirmations c where c.id = g.confirmation_id;
  select * into v_ver from public.match_event_result_proposal_versions v
   where v.proposal_id = g.game_group_id and v.version = g.proposal_version;

  foreach v_side in array array['team_a', 'team_b'] loop
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'user_id', u.id, 'display_name', pr.display_name, 'is_provisional', coalesce(pr.is_provisional, false),
        'rating', pg_catalog.jsonb_build_object(
          'state', case when pf.rating_calc_revision is not null then 'applied'
                        when pf.rating_expected then 'unavailable' else 'not_applied' end,
          'reason', case when pf.rating_calc_revision is not null then null
                         when g.match_type = 'friendly' then 'friendly'
                         when g.classification = 'incomplete' then 'incomplete'
                         when pf.rating_expected then 'missing_evidence' else 'not_rated' end,
          'before_level', pf.before_level, 'after_level', pf.after_level, 'delta', pf.rating_delta,
          'before_reliability', pf.before_reliability, 'after_reliability', pf.after_reliability,
          'expected_score', pf.expected_score)) order by u.ord), '[]'::jsonb)
      into v_team
      from pg_catalog.unnest(case when v_side = 'team_a' then g.team_a_players else g.team_b_players end)
           with ordinality u(id, ord)
      left join public.player_profiles pr on pr.user_id = u.id
      left join public.statistics_participant_facts pf on pf.game_group_id = g.game_group_id and pf.user_id = u.id;
    v_teams := v_teams || pg_catalog.jsonb_build_object(v_side, v_team);
  end loop;

  select case when g.match_type = 'friendly' then 'friendly'
              when g.classification = 'incomplete' then 'incomplete'
              when pg_catalog.count(*) filter (where pf.rating_calc_revision is not null) = 4 then 'applied'
              else 'unavailable' end
    into v_rating_state
    from public.statistics_participant_facts pf where pf.game_group_id = g.game_group_id;

  select pg_catalog.jsonb_build_object(
      'team_a_strength', case when v_rating_state = 'applied' then a.own_team_strength end,
      'team_b_strength', case when v_rating_state = 'applied' then b.own_team_strength end,
      'team_a_expected', case when v_rating_state = 'applied' then a.expected_score end,
      'team_b_expected', case when v_rating_state = 'applied' then b.expected_score end,
      'upset', case when v_rating_state = 'applied' and a.expected_score is not null and b.expected_score is not null
                    and a.own_team_strength is not null and b.own_team_strength is not null
                    then case g.classification when 'team_a' then a.expected_score <= (c.thresholds ->> 'upset_expected_score_max')::numeric
                         when 'team_b' then b.expected_score <= (c.thresholds ->> 'upset_expected_score_max')::numeric
                         else false end end,
      'reason', case when g.match_type = 'friendly' then 'friendly' when g.classification = 'incomplete' then 'incomplete'
                     when v_rating_state <> 'applied' or a.expected_score is null or b.expected_score is null
                       or a.own_team_strength is null or b.own_team_strength is null then 'missing_evidence' end)
    into v_matchup
    from public.statistics_projection_control k
    join public.statistics_config c on c.version = k.config_version
    left join public.statistics_pair_facts a on a.game_group_id = g.game_group_id and a.side = 'team_a'
    left join public.statistics_pair_facts b on b.game_group_id = g.game_group_id and b.side = 'team_b';
  if v_matchup ->> 'reason' is not null then
    v_matchup := v_matchup || pg_catalog.jsonb_build_object('team_a_strength', null, 'team_b_strength', null,
      'team_a_expected', null, 'team_b_expected', null, 'upset', null);
  end if;

  select coalesce(pg_catalog.jsonb_agg(t.item order by t.at, t.rank), '[]'::jsonb) into v_timeline from (
    select vv.submitted_at as at, 0 as rank, pg_catalog.jsonb_build_object(
        'kind', case when vv.version = 1 then 'submitted' else 'corrected' end, 'version', vv.version,
        'occurred_at', public.statistics_utc_text(vv.submitted_at),
        'actor', pg_catalog.jsonb_build_object('user_id', vv.submitted_by, 'display_name', pr.display_name),
        'source', null) as item
      from public.match_event_result_proposal_versions vv
      left join public.player_profiles pr on pr.user_id = vv.submitted_by
     where vv.proposal_id = g.game_group_id and vv.version <= g.proposal_version
    union all
    select rv.decided_at, 1, pg_catalog.jsonb_build_object('kind', 'approved', 'version', rv.proposal_version,
        'occurred_at', public.statistics_utc_text(rv.decided_at),
        'actor', pg_catalog.jsonb_build_object('user_id', rv.reviewer_user_id, 'display_name', pr.display_name),
        'source', null)
      from public.match_event_result_reviews rv
      left join public.player_profiles pr on pr.user_id = rv.reviewer_user_id
     where rv.proposal_id = g.game_group_id and rv.proposal_version = g.proposal_version and rv.decision = 'approve'
    union all
    select v_conf.confirmed_at, 2, pg_catalog.jsonb_build_object('kind', 'confirmed', 'version', v_conf.proposal_version,
        'occurred_at', public.statistics_utc_text(v_conf.confirmed_at),
        'actor', case when v_conf.actor_id is null then null else pg_catalog.jsonb_build_object(
          'user_id', v_conf.actor_id, 'display_name', (select p2.display_name from public.player_profiles p2 where p2.user_id = v_conf.actor_id)) end,
        'source', v_conf.source)
  ) t;

  v_actor := case when v_conf.actor_id is null then null else pg_catalog.jsonb_build_object(
    'user_id', v_conf.actor_id,
    'display_name', (select p3.display_name from public.player_profiles p3 where p3.user_id = v_conf.actor_id)) end;

  return pg_catalog.jsonb_build_object(
    'event_id', g.match_event_id,
    'game_group_id', g.game_group_id,
    'group_number', g.group_number,
    'statistics_revision', (select k.revision from public.statistics_projection_control k),
    'community', (select pg_catalog.jsonb_build_object('id', c.id, 'name', c.name) from public.communities c where c.id = g.community_id),
    'venue_name', v_event.venue_name,
    'court_label', v_ver.court_label,
    'timezone', v_event.timezone,
    'starts_at', public.statistics_utc_text(v_event.starts_at),
    'played_at', public.statistics_utc_text(g.played_at),
    'played_at_local', pg_catalog.to_char(v_ver.played_at_local, 'YYYY-MM-DD"T"HH24:MI:SS'),
    'played_at_offset_seconds', v_ver.played_at_offset_seconds,
    'match_type', g.match_type,
    'league', case when g.league_id is null then null else (
      select pg_catalog.jsonb_build_object('id', l.id, 'name', l.name, 'eligible', g.league_eligible)
        from public.leagues l where l.id = g.league_id) end,
    'result', pg_catalog.jsonb_build_object(
      'classification', g.classification,
      'winner', case g.classification when 'team_a' then 'team_a' when 'team_b' then 'team_b'
                  when 'draw' then 'draw' else null end,
      'sets', g.sets, 'sets_a', g.sets_a, 'sets_b', g.sets_b, 'games_a', g.games_a, 'games_b', g.games_b),
    'teams', v_teams,
    'rating_state', v_rating_state,
    'matchup', v_matchup,
    'confirmation', pg_catalog.jsonb_build_object(
      'source', v_conf.source, 'automatic', v_conf.source = 'AUTO_48H',
      'confirmed_at', public.statistics_utc_text(v_conf.confirmed_at),
      'effective_at', public.statistics_utc_text(v_conf.effective_at),
      'approver', v_actor),
    'submitter', pg_catalog.jsonb_build_object(
      'user_id', v_ver.submitted_by,
      'display_name', (select p4.display_name from public.player_profiles p4 where p4.user_id = v_ver.submitted_by),
      'submitted_at', public.statistics_utc_text(v_ver.submitted_at)),
    'correction', pg_catalog.jsonb_build_object('corrected', g.proposal_version > 1, 'version', g.proposal_version),
    'timeline', v_timeline);
end $$;

revoke all on function public.statistics_read_actor(), public.statistics_assert_rating_aligned(),
  public.statistics_can_view_event(uuid, uuid) from public, anon, authenticated, service_role;
revoke all on function public.list_statistics_history(uuid, uuid, text, date, date, integer, timestamptz, text, bigint, uuid),
  public.get_statistics_group_detail(uuid, uuid) from public, anon, service_role;
grant execute on function public.list_statistics_history(uuid, uuid, text, date, date, integer, timestamptz, text, bigint, uuid),
  public.get_statistics_group_detail(uuid, uuid) to authenticated;

commit;
