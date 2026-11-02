-- PAF-12 / U1 populated-upgrade assertions. Read-only apart from one before-snapshot table, so
-- the harness can run this file after each `migration up` (the second run proves the repeated
-- upgrade left counters, receipts and the global rating ledger byte-identical).
do $paf_league_assertions$
declare
  v_user constant text := '80000000-0000-4000-8000-0000000000';
  v_league1 constant uuid := '80000000-0000-4000-8000-000000000010';
  v_league2 constant uuid := '80000000-0000-4000-8000-000000000020';
  v_players uuid[];
  v_expected jsonb;
  v_fresh jsonb;
  v_snapshot jsonb;
  v_before jsonb;
  v_league uuid;
begin
  select array_agg((v_user || lpad(n::text, 2, '0'))::uuid order by n) into v_players from generate_series(1, 8) n;

  -- 1. Official facts survived: five predecessor confirmations (one Incomplete, unrated), one pending.
  if (select count(*) from public.match_event_result_confirmations c
       where c.proposal_id::text like '80000000-0000-4000-8000-00000000f%') <> 5
    or (select count(*) from public.match_event_result_proposals
         where id::text like '80000000-0000-4000-8000-00000000f%' and status = 'pending') <> 1 then
    raise exception 'League upgrade changed the official result facts';
  end if;

  -- 2. Backfill produced exactly the hand-computed earned counters for both Leagues.
  v_expected := jsonb_build_array(
    jsonb_build_object('l', v_league1, 'u', v_user || '03', 'm', 2, 'w', 1, 'lo', 0, 'd', 1, 'sw', 3, 'sl', 1),
    jsonb_build_object('l', v_league1, 'u', v_user || '04', 'm', 2, 'w', 1, 'lo', 0, 'd', 1, 'sw', 3, 'sl', 1),
    jsonb_build_object('l', v_league1, 'u', v_user || '05', 'm', 2, 'w', 0, 'lo', 1, 'd', 1, 'sw', 1, 'sl', 3),
    jsonb_build_object('l', v_league1, 'u', v_user || '06', 'm', 2, 'w', 0, 'lo', 1, 'd', 1, 'sw', 1, 'sl', 3),
    jsonb_build_object('l', v_league2, 'u', v_user || '03', 'm', 1, 'w', 0, 'lo', 1, 'd', 0, 'sw', 0, 'sl', 2),
    jsonb_build_object('l', v_league2, 'u', v_user || '07', 'm', 1, 'w', 0, 'lo', 1, 'd', 0, 'sw', 0, 'sl', 2),
    jsonb_build_object('l', v_league2, 'u', v_user || '04', 'm', 1, 'w', 1, 'lo', 0, 'd', 0, 'sw', 2, 'sl', 0),
    jsonb_build_object('l', v_league2, 'u', v_user || '08', 'm', 1, 'w', 1, 'lo', 0, 'd', 0, 'sw', 2, 'sl', 0));
  select coalesce(jsonb_agg(jsonb_build_object('l', c.league_id, 'u', c.user_id, 'm', c.matches, 'w', c.wins,
      'lo', c.losses, 'd', c.draws, 'sw', c.sets_won, 'sl', c.sets_lost) order by c.league_id, c.user_id), '[]'::jsonb)
    into v_fresh from public.league_player_counters c where c.league_id in (v_league1, v_league2);
  if v_fresh is distinct from (select jsonb_agg(x order by x ->> 'l', x ->> 'u') from jsonb_array_elements(v_expected) x) then
    raise exception 'Backfilled League counters differ from the expected facts: %', v_fresh;
  end if;

  -- 3. Backfill equals a fresh canonical rebuild, per League (the source is the oracle).
  foreach v_league in array array[v_league1, v_league2] loop
    if (select coalesce(jsonb_agg(to_jsonb(c) - 'updated_at' - 'community_id' - 'set_differential' order by c.user_id), '[]'::jsonb)
          from public.league_player_counters c where c.league_id = v_league)
      is distinct from
       (select coalesce(jsonb_agg(jsonb_build_object('league_id', v_league, 'user_id', r.user_id, 'matches', r.matches,
          'wins', r.wins, 'losses', r.losses, 'draws', r.draws, 'sets_won', r.sets_won, 'sets_lost', r.sets_lost)
          order by r.user_id), '[]'::jsonb) from public.league_counter_rows(v_league) r) then
      raise exception 'Backfilled counters differ from the canonical rebuild for %', v_league;
    end if;
  end loop;

  -- 4. One receipt per eligible confirmation, preserving source timestamps; none for Unranked,
  -- Incomplete or pending groups.
  if (select count(*) from public.league_projection_confirmations where league_id = v_league1) <> 2
    or (select count(*) from public.league_projection_confirmations where league_id = v_league2) <> 1
    or exists (select 1 from public.league_projection_confirmations r
        join public.match_event_result_confirmations c on c.id = r.confirmation_id
       where r.source_confirmed_at <> c.confirmed_at) then
    raise exception 'League receipts are wrong after backfill';
  end if;

  -- 5. Repeated upgrade stability: first run records, later runs must match exactly (counters,
  -- receipts without the projection time, and the global rating ledger / state).
  create table if not exists public.paf_league_upgrade_snapshot_before (
    singleton boolean primary key default true check (singleton),
    snapshot jsonb not null
  );
  select jsonb_build_object(
    'counters', (select coalesce(jsonb_agg(to_jsonb(c) - 'updated_at' order by c.league_id, c.user_id), '[]'::jsonb)
                   from public.league_player_counters c where c.league_id in (v_league1, v_league2)),
    'receipts', (select coalesce(jsonb_agg(to_jsonb(r) - 'projected_at' - 'id' order by r.league_id, r.confirmation_id), '[]'::jsonb)
                   from public.league_projection_confirmations r where r.league_id in (v_league1, v_league2)),
    'ledger', (select coalesce(jsonb_agg(to_jsonb(e) - 'created_at' order by e.game_group_id, e.user_id), '[]'::jsonb)
                 from public.player_rating_events e where e.user_id = any (v_players)),
    'state', (select coalesce(jsonb_agg(to_jsonb(rt) - 'updated_at' order by rt.user_id), '[]'::jsonb)
                from public.global_player_ratings rt where rt.user_id = any (v_players))
  ) into v_snapshot;
  insert into public.paf_league_upgrade_snapshot_before (singleton, snapshot) values (true, v_snapshot)
    on conflict (singleton) do nothing;
  select snapshot into v_before from public.paf_league_upgrade_snapshot_before where singleton;
  if v_before is distinct from v_snapshot then
    raise exception 'Repeated League migration up changed counters, receipts or the rating ledger';
  end if;
end
$paf_league_assertions$;
