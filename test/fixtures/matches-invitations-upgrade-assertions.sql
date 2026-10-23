do $$
begin
  if exists(select 1 from public.invitation_upgrade_snapshot s full join public.match_event_invites i using(id)
    where i.id is null or s.id is null or (i.match_event_id,i.invitee_user_id,i.invited_by,i.created_at)
    is distinct from (s.match_event_id,s.invitee_user_id,s.invited_by,s.created_at)) then raise exception 'Invitation identities changed'; end if;
  if (select count(*) from public.match_event_invites where status='accepted' and submission_result->>'accepted_order'='2') <> 2
    or (select count(*) from public.match_event_invites where status='pending') <> 1
    or (select count(*) from public.match_event_invites where status='expired') <> 1 then raise exception 'Incorrect invitation backfill'; end if;
  if (select count(*) from public.notifications) <> (select n from public.invitation_upgrade_notifications)
    then raise exception 'Historical notifications emitted'; end if;
  if exists(select 1 from public.match_event_registrations where accepted_order not in (1,2)) then raise exception 'Ordinal changed'; end if;
  if has_function_privilege('authenticated','public.submit_match_registration_locked(uuid,uuid)','execute')
    or has_function_privilege('anon','public.respond_match_event_invitation(uuid,uuid,text)','execute')
    or has_function_privilege('authenticated','public.expire_match_event_invitations_locked(uuid,timestamptz)','execute')
    then raise exception 'Internal execute exposed'; end if;
end $$;
