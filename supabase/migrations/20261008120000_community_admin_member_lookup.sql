create function public.get_community_member_by_id(p_community_id uuid, p_membership_id uuid)
returns table (
  membership_id uuid,
  user_id uuid,
  display_name text,
  role public.community_member_role,
  status public.community_membership_status,
  valid_from timestamptz,
  valid_until timestamptz,
  activated_at timestamptz,
  display_level numeric,
  reliability_percent smallint
)
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_community_admin(p_community_id) then
    raise exception 'Not community admin' using errcode = 'PG001';
  end if;
  return query
    select m.id, m.user_id, p.display_name, m.role, m.status,
      m.valid_from, m.valid_until, m.activated_at, r.display_level, r.reliability_percent
    from public.community_members m
    join public.player_profiles p on p.user_id = m.user_id
    left join public.global_player_ratings r on r.user_id = m.user_id
    where m.community_id = p_community_id and m.id = p_membership_id;
end;
$$;
revoke all on function public.get_community_member_by_id(uuid, uuid) from public, anon, authenticated;
grant execute on function public.get_community_member_by_id(uuid, uuid) to authenticated;
