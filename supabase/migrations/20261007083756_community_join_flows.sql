create function public.join_public_community(p_community_id uuid)
returns table (community_id uuid, status public.community_membership_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_policy public.community_join_policy;
  v_constraint text;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  select c.join_policy into v_policy from public.communities c
    where c.id = p_community_id and c.visibility = 'public' for share;
  if not found then
    raise exception 'Community not eligible' using errcode = 'PJ007';
  end if;
  if exists (select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = v_actor and m.valid_until is null) then
    raise exception 'Already member or pending' using errcode = 'PJ006';
  end if;

  begin
    insert into public.community_members (community_id, user_id, role, status)
      values (p_community_id, v_actor, 'member',
        case when v_policy = 'instant' then 'active' else 'pending' end::public.community_membership_status);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'community_members_open' then
      raise exception 'Already member or pending' using errcode = 'PJ006';
    end if;
    raise;
  end;
  return query select p_community_id,
    case when v_policy = 'instant' then 'active' else 'pending' end::public.community_membership_status;
end;
$$;

create function public.accept_community_invitation(p_token text)
returns table (community_id uuid, status public.community_membership_status)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_invitation public.community_invitations%rowtype;
  v_policy public.community_join_policy;
  v_now timestamptz;
  v_constraint text;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception 'Invalid invitation' using errcode = 'PJ001';
  end if;

  select i.* into v_invitation from public.community_invitations i
    where i.token_hash = pg_catalog.encode(extensions.digest(p_token, 'sha256'), 'hex') for update;
  if not found then
    raise exception 'Invalid invitation' using errcode = 'PJ001';
  end if;
  v_now := pg_catalog.clock_timestamp();
  if v_invitation.invitee_user_id <> v_actor then
    raise exception 'Invitation not for user' using errcode = 'PJ005';
  end if;
  if v_invitation.redeemed_at is not null then
    raise exception 'Invitation already used' using errcode = 'PJ003';
  end if;
  if v_invitation.revoked_at is not null then
    raise exception 'Invitation revoked' using errcode = 'PJ004';
  end if;
  if v_invitation.expires_at <= v_now then
    raise exception 'Invitation expired' using errcode = 'PJ002';
  end if;

  select c.join_policy into v_policy from public.communities c
    where c.id = v_invitation.community_id and c.visibility = 'private' for share;
  if not found then
    raise exception 'Community not eligible' using errcode = 'PJ007';
  end if;
  if exists (select 1 from public.community_members m
    where m.community_id = v_invitation.community_id and m.user_id = v_actor
      and m.valid_until is null) then
    raise exception 'Already member or pending' using errcode = 'PJ006';
  end if;

  begin
    insert into public.community_members (community_id, user_id, role, status)
      values (v_invitation.community_id, v_actor, 'member',
        case when v_policy = 'instant' then 'active' else 'pending' end::public.community_membership_status);
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'community_members_open' then
      raise exception 'Already member or pending' using errcode = 'PJ006';
    end if;
    raise;
  end;
  update public.community_invitations i set redeemed_at = v_now where i.id = v_invitation.id;
  return query select v_invitation.community_id,
    case when v_policy = 'instant' then 'active' else 'pending' end::public.community_membership_status;
end;
$$;

revoke all on function public.join_public_community(uuid),
  public.accept_community_invitation(text) from public, anon, authenticated;
grant execute on function public.join_public_community(uuid),
  public.accept_community_invitation(text) to authenticated;
