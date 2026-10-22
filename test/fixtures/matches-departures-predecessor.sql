do $$
declare v_event uuid := '73000000-0000-4000-8000-000000000001';
  v_community uuid := '72000000-0000-4000-8000-000000000001';
  v_creator uuid := '71000000-0000-4000-8000-000000000001';
  v_user uuid; v_path text; i integer;
begin
  for i in 1..7 loop
    v_user := ('71000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
    insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
      values(v_user,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','departure-up-'||i||'@test.local','x',now(),now(),now());
  end loop;
  insert into public.communities(id,name,visibility,created_by) values(v_community,'Departure upgrade','public',v_creator);
  insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
    values(v_community,v_creator,'admin','active',now()-interval '1 day',now()-interval '1 day');
  v_path := v_community||'/'||v_event||'/'||v_creator||'/79000000-0000-4000-8000-000000000001.webp';
  insert into storage.objects(bucket_id,name,owner_id,metadata)
    values('match-event-photos',v_path,v_creator,'{"size":"1024","mimetype":"image/webp"}');
  insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at)
    values(v_event,v_community,v_creator,now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Upgrade court','https://maps.google.com/maps/place/upgrade',v_path,now()+interval '9 days');
  insert into public.match_event_registrations(match_event_id,user_id,lifecycle,accepted_at,accepted_order,participation_status,registration_source)
    values(v_event,'71000000-0000-4000-8000-000000000002','accepted','2026-10-01T12:00:00Z',2,'reserve','member');
  update public.match_event_registration_state set next_accepted_ordinal=3 where match_event_id=v_event;
  insert into public.match_event_registration_attempts(id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id)
    values('74000000-0000-4000-8000-000000000002',v_event,'71000000-0000-4000-8000-000000000002','2026-09-01T00:00:00Z','2026-09-02T00:00:00Z','accepted',v_creator);
  for i in 3..7 loop
    v_user := ('71000000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid;
    insert into public.match_event_registrations(match_event_id,user_id,lifecycle,requested_at,resolved_at,resolved_by,registration_source)
      values(v_event,v_user,case when i in (3,4) then 'pending'::public.match_registration_lifecycle when i=6 then 'expired'::public.match_registration_lifecycle else 'rejected'::public.match_registration_lifecycle end,
        '2026-10-02T00:00:00Z',case when i>=5 then '2026-10-03T00:00:00Z'::timestamptz end,case when i>=5 then v_creator end,'guest');
    if i in (4,7) then
      insert into public.match_event_registration_attempts(id,match_event_id,user_id,requested_at,decided_at,outcome,actor_id)
        values(('74000000-0000-4000-8000-'||lpad((i*10)::text,12,'0'))::uuid,v_event,v_user,'2026-10-01T00:00:00Z',case when i=7 then '2026-10-01T01:00:00Z'::timestamptz end,case when i=4 then 'pending'::public.match_registration_lifecycle else 'rejected'::public.match_registration_lifecycle end,case when i=7 then v_creator end),
        (('74000000-0000-4000-8000-'||lpad((i*10+1)::text,12,'0'))::uuid,v_event,v_user,'2026-10-02T00:00:00Z',case when i=7 then '2026-10-02T01:00:00Z'::timestamptz end,case when i=4 then 'pending'::public.match_registration_lifecycle else 'rejected'::public.match_registration_lifecycle end,case when i=7 then v_creator end);
    end if;
  end loop;
  delete from public.notifications where target_id=v_event;
end $$;
