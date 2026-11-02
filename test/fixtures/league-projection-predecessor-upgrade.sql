-- PAF-12 / U1 populated-upgrade predecessor (schema at 20261101194000).
-- Confirmed Ranked facts exist before any League counter table or projector: two Leagues in one
-- community, groups bound to each, plus results that must never count (Unranked, Incomplete,
-- pending, a player outside every group).
--
-- ids: users 80000000-0000-4000-8000-0000000000NN, community ...00a1, leagues ...0010/0020,
-- events ...0e0N, proposals ...0f0N.
-- Expected League 1 counters (users 03..06): 03,04 -> 2 matches, 1 win, 1 draw, sets 3-1;
-- 05,06 -> 2 matches, 1 loss, 1 draw, sets 1-3. League 2: 03,07 lost 0-2; 04,08 won 2-0.
do $paf_league_fixture$
declare
  v_user constant text := '80000000-0000-4000-8000-0000000000';
  v_event constant text := '80000000-0000-4000-8000-00000000';
  v_proposal constant text := '80000000-0000-4000-8000-00000000';
  v_comm constant uuid := '80000000-0000-4000-8000-0000000000a1';
  v_league1 constant uuid := '80000000-0000-4000-8000-000000000010';
  v_league2 constant uuid := '80000000-0000-4000-8000-000000000020';
  n integer;
  v_event_id uuid;
  v_path text;
  v_creator uuid := (v_user || '01')::uuid;
  v_since timestamptz := now() - interval '90 days';
  g record;
begin
  for n in 1..8 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ((v_user || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'paf-league-upgrade-' || n || '@test.local', 'x', now(), now(), now());
    insert into public.player_profiles (user_id, display_name, preferred_side)
    values ((v_user || lpad(n::text, 2, '0'))::uuid, 'League Upgrade ' || n, 'EITHER');
    -- Different app-wide strengths: League counters must not care.
    perform public.initialize_global_player_rating_locked(
      (v_user || lpad(n::text, 2, '0'))::uuid, case when n % 2 = 0 then 6.0 else 2.0 end, 'onboarding');
  end loop;

  insert into public.communities (id, name, visibility, created_by) values
    (v_comm, 'PAF league upgrade', 'public', v_creator);
  -- Backdated membership intervals need the member guard out of the way for this insert only.
  alter table public.community_members disable trigger community_member_guard;
  insert into public.community_members (community_id, user_id, role, status, valid_from, activated_at)
  select v_comm, (v_user || lpad(i::text, 2, '0'))::uuid,
      case when i = 1 then 'admin' else 'member' end::public.community_member_role,
      'active', v_since, v_since
    from generate_series(1, 8) i;
  alter table public.community_members enable trigger community_member_guard;

  -- Leagues first, so each is older than the events published into it.
  insert into public.leagues (id, community_id, owner_id, name, timezone, start_at, end_mode, end_at, status,
      minimum_matches_for_final_award, create_request_id, create_input)
  values
    (v_league1, v_comm, v_creator, 'Upgrade League 1', 'UTC', now() - interval '60 days', 'fixed_date',
      now() + interval '60 days', 'upcoming', 1, gen_random_uuid(), '{}'::jsonb),
    (v_league2, v_comm, v_creator, 'Upgrade League 2', 'UTC', now() - interval '60 days', 'fixed_date',
      now() + interval '60 days', 'upcoming', 1, gen_random_uuid(), '{}'::jsonb);

  alter table public.match_events disable trigger match_event_published_notification;
  alter table public.match_events disable trigger match_event_creator_registration;
  alter table public.match_events disable trigger match_event_league_binding;
  for n in 1..7 loop
    v_event_id := (v_event || lpad(('e' || lpad(n::text, 2, '0')), 4, '0'))::uuid;
    v_path := v_comm::text || '/' || v_event_id::text || '/' || v_creator::text || '/' || ('80000000-0000-4000-8000-00000000d0' || lpad(n::text, 2, '0')) || '.webp';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('match-event-photos', v_path, v_creator, '{"size":"1024","mimetype":"image/webp"}'::jsonb);
    insert into public.match_events (id, community_id, created_by, starts_at, timezone, event_type, visibility,
      team_assignment_mode, venue_name, maps_url, photo_path, registration_cutoff_at, league_id)
    values (v_event_id, v_comm, v_creator, now() - interval '30 days', 'UTC', 'competitive', 'community_open',
      'POST_MATCH_TEAMS', 'Upgrade Court', 'https://maps.google.com/maps/place/upgrade', v_path,
      now() - interval '31 days',
      case when n in (1, 2, 4, 6) then v_league1 when n = 7 then v_league2 else null end);
  end loop;
  alter table public.match_events enable trigger match_event_league_binding;
  alter table public.match_events enable trigger match_event_creator_registration;
  alter table public.match_events enable trigger match_event_published_notification;

  -- (proposal no, event no, classification, sets, team_a, team_b, state); events 3 Unranked, 4 Incomplete.
  for g in select * from (values
    (1, 1, 'team_a', '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true},{"position":2,"team_a_games":6,"team_b_games":3,"completed":true}]', '03', '04', '05', '06', 'confirm'),
    (2, 2, 'draw',   '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true},{"position":2,"team_a_games":4,"team_b_games":6,"completed":true}]', '03', '05', '04', '06', 'confirm'),
    (3, 3, 'team_a', '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true},{"position":2,"team_a_games":6,"team_b_games":3,"completed":true}]', '03', '04', '05', '06', 'confirm'),
    (4, 4, 'incomplete', '[{"position":1,"team_a_games":3,"team_b_games":2,"completed":false}]', '03', '04', '05', '06', 'confirm'),
    (5, 6, 'team_a', '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true},{"position":2,"team_a_games":6,"team_b_games":3,"completed":true}]', '03', '04', '05', '06', 'pending'),
    (6, 7, 'team_b', '[{"position":1,"team_a_games":4,"team_b_games":6,"completed":true},{"position":2,"team_a_games":3,"team_b_games":6,"completed":true}]', '03', '07', '04', '08', 'confirm')
  ) as t(no, event_no, classification, sets, a1, a2, b1, b2, state) loop
    v_event_id := (v_event || lpad(('e' || lpad(g.event_no::text, 2, '0')), 4, '0'))::uuid;
    insert into public.match_event_result_proposals (id, match_event_id, group_number, status, active_version,
      review_deadline_at, submitted_by, submitted_at)
    values ((v_proposal || lpad(('f' || lpad(g.no::text, 3, '0')), 4, '0'))::uuid, v_event_id, 1, 'pending', 1,
      case g.state when 'pending' then now() + interval '47 hours' else now() - interval '58 days' end,
      v_creator,
      case g.state when 'pending' then now() - interval '1 hour' else now() - interval '60 days' end);
    insert into public.match_event_result_proposal_versions (proposal_id, version, submitted_by, submitted_at,
      review_deadline_at, teams, sets, classification, played_at_utc, played_at_local, played_at_offset_seconds, court_label)
    values ((v_proposal || lpad(('f' || lpad(g.no::text, 3, '0')), 4, '0'))::uuid, 1, v_creator,
      case g.state when 'pending' then now() - interval '1 hour' else now() - interval '60 days' end,
      case g.state when 'pending' then now() + interval '47 hours' else now() - interval '58 days' end,
      jsonb_build_object('team_a', jsonb_build_array((v_user || g.a1)::uuid, (v_user || g.a2)::uuid),
        'team_b', jsonb_build_array((v_user || g.b1)::uuid, (v_user || g.b2)::uuid)),
      g.sets::jsonb, g.classification,
      date_trunc('second', now() - interval '40 days' + g.no * interval '1 hour'),
      date_trunc('second', (now() - interval '40 days' + g.no * interval '1 hour') at time zone 'UTC'), 0, 'Court 1');
  end loop;

  -- Predecessor confirmations through the shared finalizer, in scrambled order.
  foreach n in array array[6, 2, 4, 3, 1] loop
    perform public.finalize_match_event_result_locked(
      (v_proposal || lpad(('f' || lpad(n::text, 3, '0')), 4, '0'))::uuid, 1, 'AUTO_48H', null);
  end loop;
end
$paf_league_fixture$;
