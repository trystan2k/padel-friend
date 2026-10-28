do $paf_result_fixture$
begin
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at
  ) values
    ('10000000-0000-4000-8000-000000000011', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paf-results-upgrade-creator@test.local', 'x', now(), now(), now()),
    ('10000000-0000-4000-8000-000000000012', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paf-results-upgrade-player-a@test.local', 'x', now(), now(), now()),
    ('10000000-0000-4000-8000-000000000013', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paf-results-upgrade-player-b@test.local', 'x', now(), now(), now()),
    ('10000000-0000-4000-8000-000000000014', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'paf-results-upgrade-player-c@test.local', 'x', now(), now(), now());

  insert into public.communities (id, name, visibility, created_by)
  values (
    '20000000-0000-4000-8000-000000000011',
    'PAF result provenance upgrade fixture',
    'public',
    '10000000-0000-4000-8000-000000000011'
  );
  insert into public.community_members (
    community_id, user_id, role, status, valid_from, activated_at
  ) values (
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000011',
    'admin', 'active', now() - interval '1 day', now() - interval '1 day'
  );

  insert into storage.objects (bucket_id, name, owner_id, metadata) values (
    'match-event-photos',
    '20000000-0000-4000-8000-000000000011/30000000-0000-4000-8000-000000000011/10000000-0000-4000-8000-000000000011/90000000-0000-4000-8000-000000000011.webp',
    '10000000-0000-4000-8000-000000000011',
    '{"size":"1024","mimetype":"image/webp"}'::jsonb
  );
  alter table public.match_events disable trigger match_event_published_notification;
  insert into public.match_events (
    id, community_id, created_by, starts_at, timezone, event_type, visibility,
    team_assignment_mode, venue_name, maps_url, photo_path, registration_cutoff_at
  ) values (
    '30000000-0000-4000-8000-000000000011',
    '20000000-0000-4000-8000-000000000011',
    '10000000-0000-4000-8000-000000000011',
    now() + interval '10 days', 'UTC', 'friendly', 'community_open', 'POST_MATCH_TEAMS',
    'Result Upgrade Court', 'https://maps.google.com/maps/place/upgrade',
    '20000000-0000-4000-8000-000000000011/30000000-0000-4000-8000-000000000011/10000000-0000-4000-8000-000000000011/90000000-0000-4000-8000-000000000011.webp',
    now() + interval '5 days'
  );
  alter table public.match_events enable trigger match_event_published_notification;

  insert into public.match_event_result_proposals (
    id, match_event_id, group_number, status, active_version,
    review_deadline_at, submitted_by, submitted_at
  ) values (
    '60000000-0000-4000-8000-000000000011',
    '30000000-0000-4000-8000-000000000011',
    1, 'pending', 1,
    '2026-10-29 09:15:00+00',
    '10000000-0000-4000-8000-000000000011',
    '2026-10-27 09:15:00+00'
  );
  insert into public.match_event_result_proposal_versions (
    proposal_id, version, teams, sets, classification,
    played_at_utc, played_at_local, played_at_offset_seconds, court_label
  ) values (
    '60000000-0000-4000-8000-000000000011', 1,
    '{"team_a":["10000000-0000-4000-8000-000000000011","10000000-0000-4000-8000-000000000012"],"team_b":["10000000-0000-4000-8000-000000000013","10000000-0000-4000-8000-000000000014"]}'::jsonb,
    '[{"position":1,"team_a_games":6,"team_b_games":4,"completed":true}]'::jsonb,
    'team_a', '2026-10-20 18:30:00+00', '2026-10-20 18:30:00', 0, 'Result Court 2'
  );
end
$paf_result_fixture$;
