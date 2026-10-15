create function public.get_my_notification_target(p_notification_id uuid)
returns table (target_status text, community_id uuid, community_name text, invitation_id uuid, membership_status text)
language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_notification public.notifications%rowtype;
  v_invitation public.community_invitations%rowtype;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  select n.* into v_notification from public.notifications n
    where n.id = p_notification_id and n.recipient_user_id = v_actor;
  if not found then raise exception 'Notification unavailable' using errcode = '42501'; end if;

  if v_notification.kind = 'community_invitation' and v_notification.target_type = 'community_invitation' then
    select i.* into v_invitation from public.community_invitations i
      where i.id = v_notification.target_id and i.invitee_user_id = v_actor
        and i.community_id = v_notification.community_id;
    if not found then return query select 'unavailable', null::uuid, null::text, null::uuid, null::text; return; end if;
    if v_invitation.redeemed_at is not null then
      return query select 'membership_available', c.id, c.name, null::uuid, m.status::text
        from public.communities c join public.community_members m on m.community_id=c.id
        where c.id=v_invitation.community_id and c.visibility='private' and m.user_id=v_actor
          and m.status='active' and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())
        order by m.valid_from desc limit 1;
      if found then return; end if;
      return query select 'unavailable', null::uuid, null::text, null::uuid, null::text; return;
    end if;
    if v_invitation.revoked_at is not null or v_invitation.expires_at <= now()
      or exists (select 1 from public.communities c where c.id=v_invitation.community_id and c.visibility <> 'private')
      or not exists (select 1 from public.communities c where c.id=v_invitation.community_id and c.visibility='private')
      or exists (select 1 from public.community_members m where m.community_id=v_invitation.community_id and m.user_id=v_actor and (m.valid_until is null or m.status='inactive')) then
      return query select 'unavailable', null::uuid, null::text, null::uuid, null::text; return;
    end if;
    return query select 'invitation_available', c.id, c.name, v_invitation.id, null::text
      from public.communities c where c.id=v_invitation.community_id and c.visibility='private';
    return;
  end if;
  if v_notification.kind in ('community_membership_approved','community_membership_denied','community_membership_removed')
    and v_notification.target_type='community_membership' then
    return query select 'membership_available', c.id, c.name, null::uuid, m.status::text
      from public.community_members m join public.communities c on c.id=m.community_id
      where m.id=v_notification.target_id and m.user_id=v_actor and m.community_id=v_notification.community_id
        and m.status='active' and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now());
    if found then return; end if;
  end if;
  return query select 'unavailable', null::uuid, null::text, null::uuid, null::text;
end; $$;

create function public.accept_my_notification_invitation(p_notification_id uuid)
returns table (community_id uuid, status public.community_membership_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_n public.notifications%rowtype;
  v_i public.community_invitations%rowtype;
  v_policy public.community_join_policy;
  v_now timestamptz;
  v_constraint text;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then raise exception 'Authentication required' using errcode='28000'; end if;
  select n.* into v_n from public.notifications n where n.id=p_notification_id and n.recipient_user_id=v_actor;
  if not found then raise exception 'Notification unavailable' using errcode='42501'; end if;
  if v_n.kind <> 'community_invitation' or v_n.target_type <> 'community_invitation' then raise exception 'Invalid invitation' using errcode='PJ001'; end if;
  select i.* into v_i from public.community_invitations i where i.id=v_n.target_id and i.invitee_user_id=v_actor and i.community_id=v_n.community_id for update;
  if not found then raise exception 'Invalid invitation' using errcode='PJ001'; end if;
  v_now := pg_catalog.clock_timestamp();
  if v_i.redeemed_at is not null then
    return query select m.community_id,m.status from public.community_members m where m.community_id=v_i.community_id and m.user_id=v_actor and m.valid_from <= v_now and (m.valid_until is null or m.valid_until > v_now) order by m.valid_from desc limit 1;
    if found then return; end if;
    raise exception 'Invitation already used' using errcode='PJ003';
  end if;
  if v_i.revoked_at is not null then raise exception 'Invitation revoked' using errcode='PJ004'; end if;
  if v_i.expires_at <= v_now then raise exception 'Invitation expired' using errcode='PJ002'; end if;
  select c.join_policy into v_policy from public.communities c where c.id=v_i.community_id and c.visibility='private' for share;
  if not found then raise exception 'Community not eligible' using errcode='PJ007'; end if;
  if exists(select 1 from public.community_members m where m.community_id=v_i.community_id and m.user_id=v_actor and m.valid_until is null) then raise exception 'Already member or pending' using errcode='PJ006'; end if;
  if exists(select 1 from public.community_members m where m.community_id=v_i.community_id and m.user_id=v_actor and m.status='inactive') then raise exception 'Membership is inactive' using errcode='PJ008'; end if;
  begin
    insert into public.community_members(community_id,user_id,role,status) values(v_i.community_id,v_actor,'member',case when v_policy='instant' then 'active' else 'pending' end::public.community_membership_status);
  exception when unique_violation then get stacked diagnostics v_constraint=constraint_name; if v_constraint='community_members_open' then raise exception 'Already member or pending' using errcode='PJ006'; end if; raise;
  end;
  update public.community_invitations i set redeemed_at=v_now where i.id=v_i.id;
  return query select v_i.community_id,case when v_policy='instant' then 'active' else 'pending' end::public.community_membership_status;
end; $$;
revoke all on function public.get_my_notification_target(uuid), public.accept_my_notification_invitation(uuid) from public, anon, authenticated;
grant execute on function public.get_my_notification_target(uuid), public.accept_my_notification_invitation(uuid) to authenticated;
