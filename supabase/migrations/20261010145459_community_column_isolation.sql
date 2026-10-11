revoke select on public.communities from public, anon, authenticated;
grant select (id, name, description, logo_path, city_label, visibility, join_policy, created_at, updated_at)
  on public.communities to authenticated;

create function public.get_community_settings(p_community_id uuid)
returns table (id uuid, settings jsonb)
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.is_community_member(p_community_id) then
    raise exception 'Active community membership required' using errcode = 'PG006';
  end if;
  return query select c.id, c.settings from public.communities c where c.id = p_community_id;
end;
$$;
revoke all on function public.get_community_settings(uuid) from public, anon, authenticated;
grant execute on function public.get_community_settings(uuid) to authenticated;

create function public.update_community_settings(p_community_id uuid, p_changes jsonb)
returns table (id uuid, name text, visibility public.community_visibility,
  join_policy public.community_join_policy, description text, city_label text, logo_path text,
  settings jsonb, updated_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_existing public.communities%rowtype;
  v_key text;
  v_count integer;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_changes is null or jsonb_typeof(p_changes) <> 'object' then
    raise exception 'Invalid community patch' using errcode = '22023';
  end if;
  select count(*) into v_count from jsonb_object_keys(p_changes);
  if v_count = 0 then raise exception 'Invalid community patch' using errcode = '22023'; end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('name','visibility','join_policy','description','city_label','logo_path','settings') then
      raise exception 'Invalid community patch' using errcode = '22023';
    end if;
  end loop;
  if (p_changes ? 'name' and (jsonb_typeof(p_changes->'name') <> 'string'
      or char_length(p_changes->>'name') not between 1 and 80
      or (p_changes->>'name') <> btrim(p_changes->>'name', E' \t\n\r\f\v')))
    or (p_changes ? 'visibility' and (jsonb_typeof(p_changes->'visibility') <> 'string'
      or p_changes->>'visibility' not in ('public','private')))
    or (p_changes ? 'join_policy' and (jsonb_typeof(p_changes->'join_policy') <> 'string'
      or p_changes->>'join_policy' not in ('instant','admin_approval')))
    or (p_changes ? 'description' and jsonb_typeof(p_changes->'description') not in ('string','null'))
    or (p_changes ? 'city_label' and jsonb_typeof(p_changes->'city_label') not in ('string','null'))
    or (p_changes ? 'logo_path' and jsonb_typeof(p_changes->'logo_path') not in ('string','null'))
    or (p_changes ? 'settings' and (jsonb_typeof(p_changes->'settings') <> 'object'
      or octet_length((p_changes->'settings')::text) > 4096)) then
    raise exception 'Invalid community patch' using errcode = '22023';
  end if;
  if (p_changes ? 'description' and jsonb_typeof(p_changes->'description') = 'string' and char_length(p_changes->>'description') > 500)
    or (p_changes ? 'city_label' and jsonb_typeof(p_changes->'city_label') = 'string' and char_length(p_changes->>'city_label') > 120)
    or (p_changes ? 'logo_path' and jsonb_typeof(p_changes->'logo_path') = 'string' and char_length(p_changes->>'logo_path') > 256) then
    raise exception 'Invalid community patch' using errcode = '22023';
  end if;
  select c.* into v_existing from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'Community admin required' using errcode = 'PG001';
  end if;
  update public.communities c set
    name = case when p_changes ? 'name' then p_changes->>'name' else v_existing.name end,
    visibility = case when p_changes ? 'visibility' then (p_changes->>'visibility')::public.community_visibility else v_existing.visibility end,
    join_policy = case when p_changes ? 'join_policy' then (p_changes->>'join_policy')::public.community_join_policy else v_existing.join_policy end,
    description = case when p_changes ? 'description' then p_changes->>'description' else v_existing.description end,
    city_label = case when p_changes ? 'city_label' then p_changes->>'city_label' else v_existing.city_label end,
    logo_path = case when p_changes ? 'logo_path' then p_changes->>'logo_path' else v_existing.logo_path end,
    settings = case when p_changes ? 'settings' then p_changes->'settings' else v_existing.settings end
    where c.id = p_community_id;
  return query select c.id,c.name,c.visibility,c.join_policy,c.description,c.city_label,c.logo_path,c.settings,c.updated_at
    from public.communities c where c.id = p_community_id;
end;
$$;
revoke all on function public.update_community_settings(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_community_settings(uuid, jsonb) to authenticated;
