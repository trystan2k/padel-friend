create or replace function public.valid_community_admin_defaults(p_defaults jsonb)
returns boolean language plpgsql immutable security definer set search_path = '' as $$
declare v_timezone text;
begin
  if jsonb_typeof(p_defaults) <> 'object'
    or (select count(*) from jsonb_object_keys(p_defaults)) <> 3
    or not (p_defaults ?& array['timezone','currency','member_created_leagues_enabled'])
    or jsonb_typeof(p_defaults->'timezone') <> 'string'
    or jsonb_typeof(p_defaults->'currency') <> 'string'
    or p_defaults->>'currency' <> 'EUR'
    or jsonb_typeof(p_defaults->'member_created_leagues_enabled') <> 'boolean'
    or octet_length(p_defaults::text) > 512 then return false; end if;
  v_timezone := p_defaults->>'timezone';
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = v_timezone) then return false; end if;
  begin
    perform pg_catalog.timezone(v_timezone, now());
  exception when others then return false;
  end;
  return true;
end $$;

alter table public.communities
  add constraint communities_admin_defaults_valid
  check (settings is null or not (settings ? 'admin_defaults')
    or public.valid_community_admin_defaults(settings->'admin_defaults'));

create or replace function public.get_effective_community_admin_defaults(p_settings jsonb)
returns jsonb language sql immutable set search_path = '' as $$
  select coalesce(p_settings->'admin_defaults',
    '{"timezone":"Europe/Madrid","currency":"EUR","member_created_leagues_enabled":true}'::jsonb)
$$;

create function public.update_community_admin_defaults(p_community_id uuid, p_defaults jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid()); v_settings jsonb;
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if not public.valid_community_admin_defaults(p_defaults) then
    raise exception 'Invalid admin defaults' using errcode = '22023';
  end if;
  select c.settings into v_settings from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'Community admin required' using errcode = 'PG001';
  end if;
  v_settings := coalesce(v_settings, '{}'::jsonb) || jsonb_build_object('admin_defaults', p_defaults);
  update public.communities set settings = v_settings where id = p_community_id;
  return p_defaults;
end $$;
revoke all on function public.valid_community_admin_defaults(jsonb) from public, anon, authenticated;
grant execute on function public.valid_community_admin_defaults(jsonb) to authenticated;
revoke all on function public.get_effective_community_admin_defaults(jsonb) from public, anon, authenticated;
revoke all on function public.update_community_admin_defaults(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.update_community_admin_defaults(uuid, jsonb) to authenticated;

create or replace function public.update_community_settings(p_community_id uuid, p_changes jsonb)
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
      or octet_length((p_changes->'settings')::text) > 4096
      or ((p_changes->'settings') ? 'admin_defaults' and not public.valid_community_admin_defaults((p_changes->'settings')->'admin_defaults')))) then
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
