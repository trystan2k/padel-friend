create or replace function public.govern_community_member(p_community_id uuid, p_membership_id uuid, p_action text)
returns table (membership_id uuid, status public.community_membership_status, role public.community_member_role)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_member public.community_members%rowtype;
  v_constraint text;
  v_message text;
  v_valid_from timestamptz;
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
      select greatest(
        pg_catalog.clock_timestamp(),
        coalesce(
          (select max(m.valid_until) from public.community_members m
            where m.community_id = p_community_id and m.user_id = v_member.user_id
              and m.status = 'inactive' and m.valid_until is not null),
          pg_catalog.clock_timestamp()
        )
      ) into v_valid_from;
      insert into public.community_members (community_id, user_id, role, status, valid_from)
        values (p_community_id, v_member.user_id, 'member', 'active', v_valid_from)
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

create or replace function public.guard_community_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Membership history cannot be deleted' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- Activation, not request creation, starts League eligibility (activated_at..valid_until).
    new.activated_at := case when new.status = 'active'
      then greatest(new.valid_from, pg_catalog.clock_timestamp()) else null end;
    return new;
  end if;
  if old.community_id is distinct from new.community_id or old.user_id is distinct from new.user_id
    or old.valid_from is distinct from new.valid_from or old.created_at is distinct from new.created_at
    or old.id is distinct from new.id or old.activated_at is distinct from new.activated_at
    or old.status = 'inactive'
    or (old.status = 'active' and new.status = 'pending')
    or (old.status = 'pending' and new.role is distinct from old.role) then
    raise exception 'Invalid membership transition' using errcode = '23514';
  end if;
  if old.status = 'pending' and new.status = 'active' then
    new.activated_at := now();
  end if;
  if old.status = 'active' and old.role = 'admin'
    and (new.status <> 'active' or new.role <> 'admin' or new.valid_until is not null) then
    perform 1 from public.communities where id = old.community_id for update;
    if not exists (select 1 from public.community_members m where m.community_id = old.community_id
      and m.id <> old.id and m.role = 'admin' and m.status = 'active'
      and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now())) then
      raise exception 'Community requires an active admin' using errcode = '23514';
    end if;
  end if;
  return new;
end;
$$;
revoke all on function public.guard_community_member() from public, anon, authenticated;
