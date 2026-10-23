do $$
declare c uuid:='72000000-0000-4000-8000-000000000100';
  e uuid:='73000000-0000-4000-8000-000000000100';
  u uuid:='71000000-0000-4000-8000-000000000100'; p text;
begin
  insert into auth.users(id,instance_id,aud,role,email,encrypted_password,email_confirmed_at,created_at,updated_at)
    values(u,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','edits-up@test.local','x',now(),now(),now());
  insert into public.communities(id,name,visibility,created_by) values(c,'Edits upgrade','public',u);
  insert into public.community_members(community_id,user_id,role,status,valid_from,activated_at)
    values(c,u,'admin','active',now()-interval '1 day',now()-interval '1 day');
  p:=c||'/'||e||'/'||u||'/79000000-0000-4000-8000-000000000100.webp';
  insert into storage.objects(bucket_id,name,owner_id,metadata)
    values('match-event-photos',p,u,'{"size":"1024","mimetype":"image/webp"}');
  insert into public.match_events(id,community_id,created_by,starts_at,timezone,event_type,visibility,team_assignment_mode,venue_name,maps_url,photo_path,registration_cutoff_at,price_minor,currency,notes)
    values(e,c,u,now()+interval '10 days','UTC','friendly','community_open','POST_MATCH_TEAMS','Upgrade court','https://maps.google.com/maps/place/upgrade',p,now()+interval '9 days',1250,'EUR','Original notes');
  delete from public.notifications where target_id=e;
create table public.paf_minor_edit_upgrade_snapshot as
select to_jsonb(ev) as event,to_jsonb(s) as state,
  (select jsonb_agg(to_jsonb(r) order by id) from public.match_event_registrations r where match_event_id=ev.id) as registrations,
  (select jsonb_agg(to_jsonb(a) order by id) from public.match_event_registration_attempts a where match_event_id=ev.id) as attempts
from public.match_events ev join public.match_event_registration_state s on s.match_event_id=ev.id
where ev.id='73000000-0000-4000-8000-000000000100';
revoke all on public.paf_minor_edit_upgrade_snapshot from public,anon,authenticated;
end $$;
