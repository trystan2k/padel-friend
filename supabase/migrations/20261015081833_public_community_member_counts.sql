create or replace function public.public_community_discovery()
returns table (
  id uuid, name text, description text, logo_path text, city_label text,
  visibility public.community_visibility, join_policy public.community_join_policy,
  created_at timestamptz, updated_at timestamptz, member_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;

  return query
  select c.id, c.name, c.description, c.logo_path, c.city_label,
         c.visibility, c.join_policy, c.created_at, c.updated_at,
         coalesce(count(m.id), 0)::bigint
  from public.communities as c
  left join public.community_members as m
    on m.community_id = c.id and m.status = 'active' and m.valid_until is null
  where c.visibility = 'public'
  group by c.id;
end;
$$;

revoke all on function public.public_community_discovery() from public, anon, authenticated;
grant execute on function public.public_community_discovery() to authenticated;
