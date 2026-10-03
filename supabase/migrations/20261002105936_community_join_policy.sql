create type public.community_join_policy as enum ('instant', 'admin_approval');

alter table public.communities
  add column join_policy public.community_join_policy not null
  default 'admin_approval'::public.community_join_policy;
grant update (join_policy) on public.communities to authenticated;

drop function public.create_community(text, public.community_visibility, text, text);
create function public.create_community(p_name text, p_visibility public.community_visibility,
  p_join_policy public.community_join_policy, p_description text default null,
  p_city_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid := (select auth.uid());
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  insert into public.communities (name, visibility, join_policy, description, city_label, created_by)
    values (p_name, p_visibility, p_join_policy, p_description, p_city_label, v_actor)
    returning id into v_id;
  insert into public.community_members (community_id, user_id, role, status)
    values (v_id, v_actor, 'admin', 'active');
  return v_id;
end;
$$;
revoke all on function public.create_community(text, public.community_visibility,
  public.community_join_policy, text, text) from public, anon, authenticated;
grant execute on function public.create_community(text, public.community_visibility,
  public.community_join_policy, text, text) to authenticated;
