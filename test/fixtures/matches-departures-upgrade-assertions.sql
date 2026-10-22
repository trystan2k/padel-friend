do $$
declare v_event uuid := '73000000-0000-4000-8000-000000000001';
begin
  if (select count(*) from public.match_event_registrations where match_event_id=v_event and current_attempt_id is not null) <> 7 then raise exception 'Missing current projections'; end if;
  if (select count(*) from public.match_event_registration_attempts where match_event_id=v_event) <> 9 then raise exception 'Wrong synthesis count'; end if;
  if (select count(*) from public.match_event_registration_attempts where match_event_id=v_event and end_kind='superseded') <> 2 then raise exception 'Wrong superseded count'; end if;
  if not exists(select 1 from public.match_event_registration_attempts where id='74000000-0000-4000-8000-000000000040' and outcome='expired' and decided_at=ended_at and ended_at='2026-10-02T00:00:00Z' and actor_id is null and end_reason='superseded by later registration attempt') then raise exception 'Pending supersession not deterministic'; end if;
  if not exists(select 1 from public.match_event_registration_attempts where id='74000000-0000-4000-8000-000000000070' and outcome='rejected' and decided_at='2026-10-01T01:00:00Z' and ended_at='2026-10-03T00:00:00Z' and actor_id='71000000-0000-4000-8000-000000000001') then raise exception 'Historical decision changed'; end if;
  if not exists(select 1 from public.match_event_registration_attempts where id='74000000-0000-4000-8000-000000000002' and decided_at='2026-09-02T00:00:00Z' and accepted_at='2026-10-01T12:00:00Z' and accepted_order=2) then raise exception 'Canonical anchors or historical decision changed'; end if;
  if exists(select 1 from public.match_event_registrations r join public.match_event_registration_attempts a on a.id=r.current_attempt_id where r.match_event_id=v_event and (r.id<>a.registration_id or r.lifecycle<>a.outcome or r.registration_source<>a.registration_source or (r.accepted_at,r.approved_at,r.accepted_order) is distinct from (a.accepted_at,a.approved_at,a.accepted_order))) then raise exception 'Current snapshots disagree'; end if;
  if exists(select 1 from public.notifications where target_id=v_event) or exists(select 1 from public.match_event_audit_log where match_event_id=v_event) then raise exception 'Historical alert storm'; end if;
  set constraints all immediate;
  raise notice 'Departure upgrade verified: 7 identities, 9 attempts, 4 synthesized projections, 2 superseded, 0 historical effects';
end $$;
