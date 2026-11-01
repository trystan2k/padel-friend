-- PAF-10 / U3 populated-upgrade assertions. Read-only apart from one before-snapshot
-- table, so the harness can run this file after each `migration up` (the second run
-- proves repeated upgrade left the ledger and current state byte-identical).
do $paf_rating_assertions$
declare
  v_user constant text := '70000000-0000-4000-8000-0000000000';
  v_players uuid[];
  v_states jsonb := '{}'::jsonb;
  v_meta record;
  g record;
  r record;
  v_inputs jsonb;
  v_expected integer := 0;
  v_snapshot jsonb;
  v_before jsonb;
begin
  select array_agg((v_user || lpad(n::text, 2, '0'))::uuid order by n) into v_players from generate_series(3, 10) n;

  -- 1. Source facts survived untouched and nothing was resubmitted.
  if (select count(*) from public.match_event_result_proposals where id::text like '70000000-0000-4000-8000-00000000f%') <> 9
    or (select count(*) from public.match_event_result_confirmations c
         where c.proposal_id::text like '70000000-0000-4000-8000-00000000f%') <> 7
    or (select count(*) from public.match_event_result_proposals
         where id::text like '70000000-0000-4000-8000-00000000f%' and status = 'confirmed') <> 7 then
    raise exception 'Rating upgrade changed the official result facts';
  end if;

  -- 2. Activation committed: one backfill revision and the latest sorted key as watermark.
  select * into v_meta from public.player_rating_projection_control;
  if not v_meta.activation_enabled or v_meta.committed_revision <> 1
    or v_meta.last_processed_played_at <> '2026-09-05 09:30:00+00'::timestamptz
    or v_meta.last_processed_game_group_id <> '70000000-0000-4000-8000-00000000f004' then
    raise exception 'Rating activation control state is wrong: %', to_jsonb(v_meta);
  end if;

  -- 3. Exactly four logical events and one calculation per rated group; none for
  -- friendly, incomplete, pending or disputed results.
  if (select count(*) from public.player_rating_events where game_group_id::text like '70000000-0000-4000-8000-00000000f%') <> 20
    or exists (select 1 from public.player_rating_events e
        where e.game_group_id::text like '70000000-0000-4000-8000-00000000f%'
        group by e.game_group_id having count(*) <> 4)
    or exists (select 1 from public.player_rating_events e
        where e.game_group_id::text in ('70000000-0000-4000-8000-00000000f006', '70000000-0000-4000-8000-00000000f007',
          '70000000-0000-4000-8000-00000000f008', '70000000-0000-4000-8000-00000000f009'))
    or (select count(*) from public.player_rating_event_calculations c
         join public.player_rating_events e on e.id = c.rating_event_id
        where e.game_group_id::text like '70000000-0000-4000-8000-00000000f%') <> 20
    or exists (select 1 from public.player_rating_event_calculations c where c.projection_revision <> 1) then
    raise exception 'Rating upgrade ledger event/calculation counts are wrong';
  end if;

  -- 4. Initialization audit: migration snapshot per player, creator estimates preserved.
  if (select count(*) from public.player_rating_initializations i
       where i.user_id = any (v_players) and i.sequence = 1 and i.reason = 'migration_snapshot') <> 8
    or (select count(*) from public.player_rating_initializations where user_id = any (v_players)) <> 8
    or not exists (select 1 from public.player_rating_initializations i
        where i.user_id = (v_user || '09')::uuid and i.provenance = 'creator_estimated'
          and i.original_estimate_level = 3.5 and i.initial_level = 3.5)
    or not exists (select 1 from public.player_rating_initializations i
        where i.user_id = (v_user || '10')::uuid and i.provenance = 'creator_estimated'
          and i.original_estimate_level = 5.5 and i.initial_level = 5.5)
    or (select count(*) from public.player_profiles
         where user_id in ((v_user || '09')::uuid, (v_user || '10')::uuid) and is_provisional
           and invited_by = (v_user || '01')::uuid) <> 2 then
    raise exception 'Rating upgrade initialization audit or provisional provenance is wrong';
  end if;

  -- 5. Independent clean sorted replay (own loop, own state map) against migrated state
  -- and every event's current calculation.
  select jsonb_object_agg(rt.user_id::text, jsonb_build_object('mu', rt.initial_display_level, 'sigma', 1.00,
      'display_level', rt.initial_display_level, 'reliability_percent', 10, 'confirmed_competitive_game_groups', 0,
      'highest_display_level', rt.initial_display_level))
    into v_states from public.global_player_ratings rt where rt.user_id = any (v_players);
  for g in
    select c.proposal_id, v.played_at_utc, v.classification, v.teams
      from public.match_event_result_confirmations c
      join public.match_event_result_proposal_versions v on v.proposal_id = c.proposal_id and v.version = c.proposal_version
     where c.ratable_eligible and c.proposal_id::text like '70000000-0000-4000-8000-00000000f%'
     order by v.played_at_utc, c.proposal_id
  loop
    v_expected := v_expected + 1;
    v_inputs := jsonb_build_object('classification', g.classification,
      'played_at', to_char(g.played_at_utc at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
      'teams', jsonb_build_object('team_a', g.teams -> 'team_a', 'team_b', g.teams -> 'team_b'),
      'states', (select jsonb_object_agg(m, v_states -> m)
                   from (select distinct jsonb_array_elements_text((g.teams -> 'team_a') || (g.teams -> 'team_b')) m) mm));
    for r in select * from public.rating_v1_calculate_group('app-wide-level', '1.0.0', 1, v_inputs) loop
      if not exists (
        select 1 from public.player_rating_events e
          join public.player_rating_event_calculations calc on calc.rating_event_id = e.id
         where e.game_group_id = g.proposal_id and e.user_id = r.user_id
           and calc.before_mu = r.before_mu and calc.after_mu = r.after_mu
           and calc.after_confirmed_groups = r.after_confirmed_groups
           and calc.after_reliability_percent = r.after_reliability_percent
           and calc.after_highest_display_level = r.after_highest_display_level
           and calc.last_rating_at = g.played_at_utc) then
        raise exception 'Migrated calculation differs from the clean sorted replay (group %, player %)', g.proposal_id, r.user_id;
      end if;
      v_states := jsonb_set(v_states, array[r.user_id::text], jsonb_build_object('mu', r.after_mu, 'sigma', r.after_sigma,
        'display_level', r.after_display_level, 'reliability_percent', r.after_reliability_percent,
        'confirmed_competitive_game_groups', r.after_confirmed_groups, 'highest_display_level', r.after_highest_display_level));
    end loop;
  end loop;
  if v_expected <> 5 then
    raise exception 'Expected five rated predecessor groups, replayed %', v_expected;
  end if;
  for r in select rt.* from public.global_player_ratings rt where rt.user_id = any (v_players) loop
    if r.mu <> (v_states -> r.user_id::text ->> 'mu')::numeric
      or r.display_level <> (v_states -> r.user_id::text ->> 'display_level')::numeric
      or r.highest_display_level <> (v_states -> r.user_id::text ->> 'highest_display_level')::numeric
      or r.confirmed_competitive_game_groups <> (v_states -> r.user_id::text ->> 'confirmed_competitive_game_groups')::integer
      or r.reliability_percent <> (v_states -> r.user_id::text ->> 'reliability_percent')::integer
      or r.projection_revision <> 1 or r.initial_display_level is null then
      raise exception 'Migrated current state differs from the clean sorted replay for %', r.user_id;
    end if;
  end loop;
  -- Players outside every rated group (admins) stay untouched.
  if exists (select 1 from public.global_player_ratings rt
      where rt.user_id not in (select unnest(v_players)) and rt.user_id::text like '70000000-0000-4000-8000-0000000000%'
        and (rt.confirmed_competitive_game_groups <> 0 or rt.projection_revision <> 0 or rt.last_rating_at is not null)) then
    raise exception 'Rating upgrade touched a player outside every rated group';
  end if;

  -- 6. Repeated upgrade stability: first run records, later runs must match exactly.
  create table if not exists public.paf_rating_upgrade_snapshot_before (
    singleton boolean primary key default true check (singleton),
    snapshot jsonb not null
  );
  select jsonb_build_object(
    'ledger', (select coalesce(jsonb_agg(to_jsonb(x) order by x.game_group_id, x.user_id, x.projection_revision), '[]'::jsonb)
                from (select e.id event_id, e.game_group_id, e.user_id, e.created_at, c.*
                        from public.player_rating_events e join public.player_rating_event_calculations c on c.rating_event_id = e.id
                       where e.game_group_id::text like '70000000-0000-4000-8000-00000000f%') x),
    'state', (select coalesce(jsonb_agg(to_jsonb(rt) - 'updated_at' order by rt.user_id), '[]'::jsonb)
                from public.global_player_ratings rt where rt.user_id = any (v_players)),
    'control', (select to_jsonb(c) - 'updated_at' from public.player_rating_projection_control c),
    'initializations', (select coalesce(jsonb_agg(to_jsonb(i) order by i.user_id, i.sequence), '[]'::jsonb)
                          from public.player_rating_initializations i where i.user_id = any (v_players))
  ) into v_snapshot;
  insert into public.paf_rating_upgrade_snapshot_before (singleton, snapshot) values (true, v_snapshot) on conflict (singleton) do nothing;
  select snapshot into v_before from public.paf_rating_upgrade_snapshot_before where singleton;
  if v_before is distinct from v_snapshot then
    raise exception 'Repeated rating migration up changed the ledger or current state';
  end if;
end
$paf_rating_assertions$;
