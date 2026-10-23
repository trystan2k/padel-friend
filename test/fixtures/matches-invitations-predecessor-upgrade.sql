do $$
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
    select ('a1000000-0000-4000-8000-' || lpad(n::text,12,'0'))::uuid,
      '00000000-0000-0000-0000-000000000000','authenticated','authenticated',
      'invitation-upgrade-' || n || '@test.local','x',now(),now(),now() from generate_series(1,3) n;
  insert into public.communities(id,name,visibility,created_by)
    values ('a2000000-0000-4000-8000-000000000001','Invitation upgrade','public','a1000000-0000-4000-8000-000000000001');
  insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
    select 'a2000000-0000-4000-8000-000000000001', id,'member','active',now()-interval '1 day',now()-interval '1 day'
    from auth.users where email like 'invitation-upgrade-%@test.local';
  for n in 1..2 loop
    insert into storage.objects(bucket_id,name,owner_id,metadata) values ('match-event-photos',
      'a2000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-00000000000' || n || '/a1000000-0000-4000-8000-000000000001/a9000000-0000-4000-8000-000000000001.webp',
      'a1000000-0000-4000-8000-000000000001','{"size":"1024","mimetype":"image/webp"}');
    insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,restriction_enabled,registration_cutoff_at)
      values (('a3000000-0000-4000-8000-00000000000' || n)::uuid,'a2000000-0000-4000-8000-000000000001',
      'a1000000-0000-4000-8000-000000000001',now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS',
      'Invitation upgrade court','https://maps.google.com/maps/place/upgrade',
      'a2000000-0000-4000-8000-000000000001/a3000000-0000-4000-8000-00000000000' || n || '/a1000000-0000-4000-8000-000000000001/a9000000-0000-4000-8000-000000000001.webp',
      false,case when n=1 then now()+interval '9 days' else now()-interval '1 day' end);
    insert into public.match_event_invites(match_event_id,invitee_user_id,invited_by)
      select ('a3000000-0000-4000-8000-00000000000' || n)::uuid,id,'a1000000-0000-4000-8000-000000000001'
      from auth.users where email like 'invitation-upgrade-%@test.local' and email not like 'invitation-upgrade-1@%';
    insert into public.match_event_registrations(match_event_id,user_id,lifecycle,accepted_at,accepted_order,participation_status,registration_source)
      values (('a3000000-0000-4000-8000-00000000000' || n)::uuid,'a1000000-0000-4000-8000-000000000002','accepted',now()-interval '2 days',2,'reserve','member');
  end loop;
  create table public.invitation_upgrade_snapshot as select id,match_event_id,invitee_user_id,invited_by,created_at from public.match_event_invites;
  create table public.invitation_upgrade_notifications as select count(*) n from public.notifications;
end $$;
