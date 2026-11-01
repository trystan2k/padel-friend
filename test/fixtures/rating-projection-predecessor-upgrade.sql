-- PAF-10 / U3 populated-upgrade predecessor (schema at 20261031160000).
-- Confirmed in-app groups exist before any ledger or projector: two communities,
-- overlapping players, creator-estimated provisional players on both teams, equal
-- instants across communities, an earliest group confirmed last, plus results that must
-- stay unrated (friendly, incomplete, pending, disputed).
--
-- ids: users 70000000-0000-4000-8000-0000000000NN, communities ...00a1/00b1,
-- events ...0e0N, proposals ...0f0N.
do $paf_rating_fixture$
declare
  v_user constant text := '70000000-0000-4000-8000-0000000000';
  v_event constant text := '70000000-0000-4000-8000-00000000';
  v_proposal constant text := '70000000-0000-4000-8000-00000000';
  v_comm_a constant uuid := '70000000-0000-4000-8000-0000000000a1';
  v_comm_b constant uuid := '70000000-0000-4000-8000-0000000000b1';
  n integer;
  v_community uuid;
  v_creator uuid;
  v_event_id uuid;
  v_path text;
  v_levels numeric[] := array[4.0, 4.0, 3.0, 4.0, 4.5, 5.0, 3.5, 2.5];
  g record;
begin
  -- users 1..2 community admins, 3..8 regular players, 9..10 provisional players
  for n in 1..10 loop
    insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
    values ((v_user || lpad(n::text, 2, '0'))::uuid, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', 'paf-rating-upgrade-' || n || '@test.local', 'x', now(), now(), now());
  end loop;
  for n in 1..8 loop
    insert into public.player_profiles (user_id, display_name, preferred_side)
    values ((v_user || lpad(n::text, 2, '0'))::uuid, 'Upgrade Player ' || n, 'EITHER');
    insert into public.global_player_ratings (user_id, initial_display_level, mu, sigma, display_level,
      reliability_percent, confirmed_competitive_game_groups, highest_display_level, rating_engine, rating_engine_version)
    values ((v_user || lpad(n::text, 2, '0'))::uuid, v_levels[n], v_levels[n], 1.00, v_levels[n], 10, 0, v_levels[n],
      'app-wide-level', '1.0.0');
  end loop;

  insert into public.communities (id, name, visibility, created_by) values
    (v_comm_a, 'PAF rating upgrade A', 'public', (v_user || '01')::uuid),
    (v_comm_b, 'PAF rating upgrade B', 'private', (v_user || '02')::uuid);
  insert into public.community_members (community_id, user_id, role, status, valid_from, activated_at) values
    (v_comm_a, (v_user || '01')::uuid, 'admin', 'active', now() - interval '90 days', now() - interval '90 days'),
    (v_comm_b, (v_user || '02')::uuid, 'admin', 'active', now() - interval '90 days', now() - interval '90 days');

  -- events 1..4 in community A, 5..8 in community B; event 7 is friendly
  alter table public.match_events disable trigger match_event_published_notification;
  alter table public.match_events disable trigger match_event_creator_registration;
  for n in 1..8 loop
    v_event_id := (v_event || lpad(('e' || lpad(n::text, 2, '0')), 4, '0'))::uuid;
    v_community := case when n <= 4 then v_comm_a else v_comm_b end;
    v_creator := case when n <= 4 then (v_user || '01')::uuid else (v_user || '02')::uuid end;
    v_path := v_community::text || '/' || v_event_id::text || '/' || v_creator::text || '/' || ('70000000-0000-4000-8000-00000000d0' || lpad(n::text, 2, '0')) || '.webp';
    insert into storage.objects (bucket_id, name, owner_id, metadata)
    values ('match-event-photos', v_path, v_creator, '{"size":"1024","mimetype":"image/webp"}'::jsonb);
    insert into public.match_events (id, community_id, created_by, starts_at, timezone, event_type, visibility,
      team_assignment_mode, venue_name, maps_url, photo_path, registration_cutoff_at)
    values (v_event_id, v_community, v_creator, now() - interval '30 days', 'UTC',
      case when n = 7 then 'friendly' else 'competitive' end::public.match_event_type, 'community_open',
      'POST_MATCH_TEAMS', 'Upgrade Court', 'https://maps.google.com/maps/place/upgrade', v_path,
      now() - interval '31 days');
  end loop;
  alter table public.match_events enable trigger match_event_creator_registration;
  alter table public.match_events enable trigger match_event_published_notification;

  perform public.provision_provisional_player_locked((v_user || '09')::uuid, 'Provisional Nine', 3.5,
    (v_user || '01')::uuid, (v_event || '0e01')::uuid);
  perform public.provision_provisional_player_locked((v_user || '10')::uuid, 'Provisional Ten', 5.5,
    (v_user || '01')::uuid, (v_event || '0e01')::uuid);

  -- Proposals: (proposal no, event no, classification, played_at, team_a, team_b, state)
  -- players: 03 r1, 04 r2, 05 r3, 06 r4, 07 r5, 08 r6, 09 p1, 10 p2
  for g in select * from (values
    (1, 1, 'team_a', '2026-09-01 10:00:00+00', '03', '04', '05', '06', 'confirm'),
    (2, 5, 'team_b', '2026-09-03 18:00:00+00', '03', '07', '04', '09', 'confirm'),
    (3, 6, 'draw',   '2026-09-03 18:00:00+00', '05', '08', '06', '10', 'confirm'),
    (4, 2, 'team_a', '2026-09-05 09:30:00+00', '09', '10', '03', '08', 'confirm'),
    (5, 3, 'team_b', '2026-08-20 08:00:00+00', '04', '05', '07', '08', 'confirm'),
    (6, 7, 'team_a', '2026-09-06 10:00:00+00', '03', '04', '05', '06', 'confirm'),
    (7, 4, 'incomplete', '2026-09-07 10:00:00+00', '03', '04', '05', '06', 'confirm'),
    (8, 8, 'team_a', '2026-09-08 10:00:00+00', '03', '04', '05', '06', 'pending'),
    (9, 8, 'team_a', '2026-09-09 10:00:00+00', '03', '04', '05', '06', 'disputed')
  ) as t(no, event_no, classification, played_at, a1, a2, b1, b2, state) loop
    v_event_id := (v_event || lpad(('e' || lpad(g.event_no::text, 2, '0')), 4, '0'))::uuid;
    v_creator := case when g.event_no <= 4 then (v_user || '01')::uuid else (v_user || '02')::uuid end;
    insert into public.match_event_result_proposals (id, match_event_id, group_number, status, active_version,
      review_deadline_at, submitted_by, submitted_at)
    values ((v_proposal || lpad(('f' || lpad(g.no::text, 3, '0')), 4, '0'))::uuid, v_event_id,
      case when g.no = 9 then 2 else 1 end,
      case g.state when 'disputed' then 'disputed' else 'pending' end, 1,
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
      case g.classification
        when 'team_a' then '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'
        when 'team_b' then '[{"position":1,"team_a_games":4,"team_b_games":6,"completed":true}]'
        when 'draw' then '[{"position":1,"team_a_games":6,"team_b_games":6,"completed":true}]'
        else '[{"position":1,"team_a_games":3,"team_b_games":2,"completed":false}]' end::jsonb,
      g.classification, g.played_at::timestamptz, (g.played_at::timestamptz at time zone 'UTC'), 0, 'Court 1');
    if g.state = 'disputed' then
      insert into public.match_event_result_reviews (proposal_id, proposal_version, reviewer_user_id, decision,
        reason_code, request_id)
      values ((v_proposal || lpad(('f' || lpad(g.no::text, 3, '0')), 4, '0'))::uuid, 1, (v_user || g.b1)::uuid,
        'reject', 'WRONG_SCORE', gen_random_uuid());
    end if;
  end loop;

  -- Predecessor confirmations through the shared finalizer, deliberately scrambled
  -- (the chronologically earliest group is confirmed last).
  for n in 1..7 loop
    perform public.finalize_match_event_result_locked(
      (v_proposal || lpad(('f' || lpad(n::text, 3, '0')), 4, '0'))::uuid, 1, 'AUTO_48H', null);
  end loop;
end
$paf_rating_fixture$;
