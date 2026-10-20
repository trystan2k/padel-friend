do $paf_fixture$
begin

-- Fixed fixture identities make the accepted_at/id tie-break reproducible.
insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at) values
  ('10000000-0000-4000-8000-000000000001','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf-upgrade-creator@test.local','x',now(),now(),now()),
  ('10000000-0000-4000-8000-000000000002','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf-upgrade-a@test.local','x',now(),now(),now()),
  ('10000000-0000-4000-8000-000000000003','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf-upgrade-b@test.local','x',now(),now(),now()),
  ('10000000-0000-4000-8000-000000000004','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf-upgrade-c@test.local','x',now(),now(),now()),
  ('10000000-0000-4000-8000-000000000005','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf-upgrade-d@test.local','x',now(),now(),now()),
  ('10000000-0000-4000-8000-000000000006','00000000-0000-0000-0000-000000000000','authenticated','authenticated','paf-upgrade-invitee@test.local','x',now(),now(),now());

insert into public.communities (id,name,visibility,created_by)
values ('20000000-0000-4000-8000-000000000001','PAF populated migration fixture','public','10000000-0000-4000-8000-000000000001');
insert into public.community_members (community_id,user_id,role,status,valid_from,activated_at) values
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001','admin','active',now()-interval '1 day',now()-interval '1 day'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002','member','active',now()-interval '1 day',now()-interval '1 day'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003','member','active',now()-interval '1 day',now()-interval '1 day'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004','member','active',now()-interval '1 day',now()-interval '1 day'),
  ('20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005','member','active',now()-interval '1 day',now()-interval '1 day');

-- Only notification side effects are bypassed. Registration creation and photo validation stay enabled.
alter table public.match_events disable trigger match_event_published_notification;
insert into storage.objects (bucket_id, name, owner_id, metadata) values
  ('match-event-photos','20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000001.webp','10000000-0000-4000-8000-000000000001','{"size":"1024","mimetype":"image/webp"}'::jsonb),
  ('match-event-photos','20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000002.webp','10000000-0000-4000-8000-000000000001','{"size":"1024","mimetype":"image/webp"}'::jsonb);
insert into public.match_events (id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,restriction_enabled,min_level,max_level,maximum_registrations,registration_cutoff_at)
values
  ('30000000-0000-4000-8000-000000000001','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Upgrade Court','https://maps.google.com/maps/place/upgrade','20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/10000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000001.webp',false,null,null,null,now()+interval '5 days'),
  ('30000000-0000-4000-8000-000000000002','20000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000001',now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Upgrade Court','https://maps.google.com/maps/place/upgrade','20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/10000000-0000-4000-8000-000000000001/90000000-0000-4000-8000-000000000002.webp',false,null,null,null,now()-interval '1 day');
alter table public.match_events enable trigger match_event_published_notification;

-- Four legacy member rows plus the normally-created creator row = five accepted per event.
-- Two equal member timestamps force ordering by id; creator's timestamp is later.
insert into public.match_event_registrations (id,match_event_id,user_id,accepted_at) values
  ('40000000-0000-4000-8000-000000000002','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000002',now()-interval '4 days'),
  ('40000000-0000-4000-8000-000000000003','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000003',now()-interval '3 days'),
  ('40000000-0000-4000-8000-000000000004','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000004',now()-interval '3 days'),
  ('40000000-0000-4000-8000-000000000005','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000005',now()-interval '2 days'),
  ('40000000-0000-4000-8000-000000000012','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000002',now()-interval '4 days'),
  ('40000000-0000-4000-8000-000000000013','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000003',now()-interval '3 days'),
  ('40000000-0000-4000-8000-000000000014','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000004',now()-interval '3 days'),
  ('40000000-0000-4000-8000-000000000015','30000000-0000-4000-8000-000000000002','10000000-0000-4000-8000-000000000005',now()-interval '2 days');
insert into public.match_event_invites (id,match_event_id,invitee_user_id,invited_by)
values ('50000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000001','10000000-0000-4000-8000-000000000006','10000000-0000-4000-8000-000000000001');

create table public.paf_upgrade_expected (event_id uuid not null, registration_id uuid not null, expected_ordinal integer not null, primary key(event_id,registration_id));
insert into public.paf_upgrade_expected
select r.match_event_id,r.id,row_number() over (partition by r.match_event_id order by (r.user_id=e.created_by) desc,r.accepted_at,r.id)::integer
from public.match_event_registrations r
join public.match_events e on e.id=r.match_event_id
where r.match_event_id in ('30000000-0000-4000-8000-000000000001','30000000-0000-4000-8000-000000000002');
end
$paf_fixture$;
