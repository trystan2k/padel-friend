create function public.govern_community_member(p_community_id uuid, p_membership_id uuid, p_action text)
returns table (membership_id uuid, status public.community_membership_status, role public.community_member_role)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_member public.community_members%rowtype;
  v_constraint text;
  v_message text;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_action is null or p_action not in ('approve','deny','remove','reactivate','promote','demote') then
    raise exception 'Invalid membership transition' using errcode = 'PG004';
  end if;

  -- Serialize all governance transitions in this community before locking a member row.
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not exists (select 1 from public.community_members a where a.community_id = p_community_id
    and a.user_id = v_actor and a.status = 'active' and a.role = 'admin'
    and a.valid_from <= now() and (a.valid_until is null or a.valid_until > now())) then
    raise exception 'Not community admin' using errcode = 'PG001';
  end if;
  select m.* into v_member from public.community_members m
    where m.community_id = p_community_id and m.id = p_membership_id for update;
  if not found then
    raise exception 'Community member not found' using errcode = 'PG003';
  end if;
  if (p_action in ('approve','deny') and v_member.status <> 'pending')
    or (p_action in ('remove','promote','demote') and v_member.status <> 'active')
    or (p_action = 'reactivate' and v_member.status <> 'inactive')
    or (p_action = 'promote' and v_member.role <> 'member')
    or (p_action = 'demote' and v_member.role <> 'admin') then
    raise exception 'Invalid membership transition' using errcode = 'PG004';
  end if;
  if p_action in ('remove','demote') and v_member.role = 'admin'
    and not exists (select 1 from public.community_members a where a.community_id = p_community_id
      and a.id <> v_member.id and a.role = 'admin' and a.status = 'active'
      and a.valid_from <= now() and (a.valid_until is null or a.valid_until > now())) then
    raise exception 'Community requires an active admin' using errcode = 'PG002';
  end if;

  begin
    if p_action = 'reactivate' then
      insert into public.community_members (community_id, user_id, role, status)
        values (p_community_id, v_member.user_id, 'member', 'active')
        returning id into membership_id;
    else
      update public.community_members m set
        status = case when p_action = 'approve' then 'active'::public.community_membership_status
          when p_action in ('deny','remove') then 'inactive'::public.community_membership_status
          else m.status end,
        role = case when p_action = 'promote' then 'admin'::public.community_member_role
          when p_action = 'demote' then 'member'::public.community_member_role else m.role end,
        valid_until = case when p_action in ('deny','remove') then
          greatest(pg_catalog.clock_timestamp(), m.valid_from + interval '1 microsecond',
            coalesce(m.activated_at, m.valid_from)) else m.valid_until end
        where m.id = v_member.id returning m.id into membership_id;
    end if;
  exception when unique_violation then
    get stacked diagnostics v_constraint = constraint_name;
    if v_constraint = 'community_members_open' then
      raise exception 'Already member or pending' using errcode = 'PG005';
    end if;
    raise;
  when check_violation then
    get stacked diagnostics v_message = message_text;
    if v_message = 'Community requires an active admin' then
      raise exception 'Community requires an active admin' using errcode = 'PG002';
    end if;
    raise;
  end;
  return query select m.id, m.status, m.role from public.community_members m where m.id = membership_id;
end;
$$;
revoke all on function public.govern_community_member(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.govern_community_member(uuid,uuid,text) to authenticated;

create function public.search_community_members(p_community_id uuid, p_query text default '',
  p_status public.community_membership_status default null, p_offset integer default 0, p_limit integer default 20)
returns table (membership_id uuid, user_id uuid, display_name text, role public.community_member_role,
  status public.community_membership_status, valid_from timestamptz, valid_until timestamptz,
  activated_at timestamptz, display_level numeric, reliability_percent smallint)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_community_admin(p_community_id) then
    raise exception 'Not community admin' using errcode = 'PG001';
  end if;
  if p_query is null or pg_catalog.char_length(p_query) > 80 or p_offset is null
    or p_offset not between 0 and 10000 or p_limit is null or p_limit not between 1 and 50 then
    raise exception 'Invalid member search' using errcode = '22023';
  end if;
  return query select m.id, m.user_id, p.display_name, m.role, m.status,
    m.valid_from, m.valid_until, m.activated_at, r.display_level, r.reliability_percent
    from public.community_members m
    join public.player_profiles p on p.user_id = m.user_id
    left join public.global_player_ratings r on r.user_id = m.user_id
    where m.community_id = p_community_id and (p_status is null or m.status = p_status)
      and pg_catalog.strpos(pg_catalog.lower(p.display_name), pg_catalog.lower(p_query)) > 0
      and (m.valid_until is null or not exists (select 1 from public.community_members newer
        where newer.community_id = m.community_id and newer.user_id = m.user_id
          and (newer.valid_from, newer.id) > (m.valid_from, m.id)))
    order by p.display_name, m.id limit p_limit offset p_offset;
end;
$$;
revoke all on function public.search_community_members(uuid,text,public.community_membership_status,integer,integer)
  from public, anon, authenticated;
grant execute on function public.search_community_members(uuid,text,public.community_membership_status,integer,integer)
  to authenticated;

alter table public.community_venues add column archived_at timestamptz;
grant update (archived_at) on public.community_venues to authenticated;

-- Use database time for revocation: a Worker clock may be behind created_at.
create function public.stamp_invitation_revocation() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.revoked_at is null and new.revoked_at is not null then
    new.revoked_at := greatest(pg_catalog.clock_timestamp(), old.created_at);
  end if;
  return new;
end;
$$;
create trigger a_invitation_revocation_stamp before update on public.community_invitations
  for each row execute function public.stamp_invitation_revocation();
revoke all on function public.stamp_invitation_revocation() from public, anon, authenticated;
