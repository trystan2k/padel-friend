-- PAF-183 (M-1, I-6): community writes go through RPCs only.
-- Direct INSERT/UPDATE on memberships let any user who held an admin row force-add arbitrary
-- accounts (consent bypass); direct writes on invitations, venues and communities skipped the
-- server-side validators. SELECT grants and read policies are unchanged. Forward-only: never
-- restore these grants, fix forward through the RPCs below.

drop policy if exists "membership admin insert" on public.community_members;
drop policy if exists "membership admin update" on public.community_members;
drop policy if exists "invitation admin insert" on public.community_invitations;
drop policy if exists "invitation admin update" on public.community_invitations;
drop policy if exists "venue admin insert" on public.community_venues;
drop policy if exists "venue admin update" on public.community_venues;
drop policy if exists "community admin update" on public.communities;

revoke insert, update on public.community_members from authenticated;
revoke insert, update on public.community_invitations from authenticated;
revoke insert, update on public.community_venues from authenticated;
revoke update on public.communities from authenticated;

-- Shared typed error vocabulary: message is the exact UPPER_SNAKE code, SQLSTATE P0001.
-- Codes: UNAUTHENTICATED, NOT_COMMUNITY_ADMIN, COMMUNITY_INVALID_INPUT, COMMUNITY_VENUE_NOT_FOUND,
-- COMMUNITY_NOT_ELIGIBLE, ALREADY_MEMBER_OR_PENDING, INVITATION_ALREADY_OPEN, INVITEE_NOT_FOUND,
-- INVITATION_NOT_FOUND. Registry: src/lib/client-error-codes.ts.

create function public.add_community_venue(
  p_community_id uuid, p_name text, p_address text default null, p_maps_url text default null)
returns table (id uuid, community_id uuid, name text, address text, maps_url text, photo_path text,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  perform public.assert_actor_not_provisional();
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_community_id is null or p_name is null then
    raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'NOT_COMMUNITY_ADMIN' using errcode = 'P0001';
  end if;
  return query
    insert into public.community_venues as v (community_id, name, address, maps_url, created_by)
      values (p_community_id, p_name, p_address, p_maps_url, v_actor)
      returning v.id, v.community_id, v.name, v.address, v.maps_url, v.photo_path,
        v.created_at, v.updated_at, v.archived_at;
end $$;

-- p_changes carries only the fields to change (name, address, maps_url); null clears address/maps_url.
create function public.edit_community_venue(p_community_id uuid, p_venue_id uuid, p_changes jsonb)
returns table (id uuid, community_id uuid, name text, address text, maps_url text, photo_path text,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_venue public.community_venues%rowtype;
  v_key text;
begin
  perform public.assert_actor_not_provisional();
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_community_id is null or p_venue_id is null or p_changes is null
    or jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
  end if;
  for v_key in select jsonb_object_keys(p_changes) loop
    if v_key not in ('name', 'address', 'maps_url') then
      raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
    end if;
  end loop;
  if (p_changes ? 'name' and jsonb_typeof(p_changes->'name') <> 'string')
    or (p_changes ? 'address' and jsonb_typeof(p_changes->'address') not in ('string', 'null'))
    or (p_changes ? 'maps_url' and jsonb_typeof(p_changes->'maps_url') not in ('string', 'null')) then
    raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'NOT_COMMUNITY_ADMIN' using errcode = 'P0001';
  end if;
  select cv.* into v_venue from public.community_venues cv
    where cv.id = p_venue_id and cv.community_id = p_community_id and cv.archived_at is null for update;
  if not found then
    raise exception 'COMMUNITY_VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
  return query
    update public.community_venues as v set
      name = case when p_changes ? 'name' then p_changes->>'name' else v_venue.name end,
      address = case when p_changes ? 'address' then p_changes->>'address' else v_venue.address end,
      maps_url = case when p_changes ? 'maps_url' then p_changes->>'maps_url' else v_venue.maps_url end
      where v.id = p_venue_id
      returning v.id, v.community_id, v.name, v.address, v.maps_url, v.photo_path,
        v.created_at, v.updated_at, v.archived_at;
end $$;

create function public.archive_community_venue(p_community_id uuid, p_venue_id uuid)
returns table (id uuid, community_id uuid, name text, address text, maps_url text, photo_path text,
  created_at timestamptz, updated_at timestamptz, archived_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  perform public.assert_actor_not_provisional();
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_community_id is null or p_venue_id is null then
    raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'NOT_COMMUNITY_ADMIN' using errcode = 'P0001';
  end if;
  return query
    update public.community_venues as v set archived_at = pg_catalog.now()
      where v.id = p_venue_id and v.community_id = p_community_id and v.archived_at is null
      returning v.id, v.community_id, v.name, v.address, v.maps_url, v.photo_path,
        v.created_at, v.updated_at, v.archived_at;
  if not found then
    raise exception 'COMMUNITY_VENUE_NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

-- Raw token is returned to the issuing admin once; only its SHA-256 digest is stored.
create function public.issue_community_invitation(p_community_id uuid, p_invitee_user_id uuid)
returns table (invitation_id uuid, token text, expires_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_visibility public.community_visibility;
  v_token text;
  v_id uuid;
  v_expires timestamptz;
begin
  perform public.assert_actor_not_provisional();
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_community_id is null or p_invitee_user_id is null then
    raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
  end if;
  select c.visibility into v_visibility from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'NOT_COMMUNITY_ADMIN' using errcode = 'P0001';
  end if;
  if v_visibility <> 'private' then
    raise exception 'COMMUNITY_NOT_ELIGIBLE' using errcode = 'P0001';
  end if;
  if not exists (select 1 from auth.users u where u.id = p_invitee_user_id) then
    raise exception 'INVITEE_NOT_FOUND' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.community_members m
    where m.community_id = p_community_id and m.user_id = p_invitee_user_id and m.valid_until is null) then
    raise exception 'ALREADY_MEMBER_OR_PENDING' using errcode = 'P0001';
  end if;
  v_token := pg_catalog.encode(extensions.gen_random_bytes(32), 'hex');
  v_expires := pg_catalog.now() + interval '7 days';
  begin
    insert into public.community_invitations (community_id, invitee_user_id, issued_by, token_hash, expires_at)
      values (p_community_id, p_invitee_user_id, v_actor,
        pg_catalog.encode(pg_catalog.sha256(pg_catalog.convert_to(v_token, 'utf8')), 'hex'), v_expires)
      returning community_invitations.id into v_id;
  exception when unique_violation then
    raise exception 'INVITATION_ALREADY_OPEN' using errcode = 'P0001';
  end;
  return query select v_id, v_token, v_expires;
end $$;

create function public.revoke_community_invitation(p_community_id uuid, p_invitation_id uuid)
returns table (id uuid, revoked_at timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_actor uuid := (select auth.uid());
begin
  perform public.assert_actor_not_provisional();
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'UNAUTHENTICATED' using errcode = 'P0001';
  end if;
  if p_community_id is null or p_invitation_id is null then
    raise exception 'COMMUNITY_INVALID_INPUT' using errcode = 'P0001';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found or not public.is_community_admin(p_community_id) then
    raise exception 'NOT_COMMUNITY_ADMIN' using errcode = 'P0001';
  end if;
  return query
    update public.community_invitations as i set revoked_at = pg_catalog.now()
      where i.id = p_invitation_id and i.community_id = p_community_id
        and i.revoked_at is null and i.redeemed_at is null
      returning i.id, i.revoked_at;
  if not found then
    raise exception 'INVITATION_NOT_FOUND' using errcode = 'P0001';
  end if;
end $$;

revoke all on function
  public.add_community_venue(uuid, text, text, text),
  public.edit_community_venue(uuid, uuid, jsonb),
  public.archive_community_venue(uuid, uuid),
  public.issue_community_invitation(uuid, uuid),
  public.revoke_community_invitation(uuid, uuid)
  from public, anon, authenticated;
grant execute on function
  public.add_community_venue(uuid, text, text, text),
  public.edit_community_venue(uuid, uuid, jsonb),
  public.archive_community_venue(uuid, uuid),
  public.issue_community_invitation(uuid, uuid),
  public.revoke_community_invitation(uuid, uuid)
  to authenticated;
