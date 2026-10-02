create type public.community_visibility as enum ('public', 'private');
create type public.community_member_role as enum ('admin', 'member');
create type public.community_membership_status as enum ('active', 'pending', 'inactive');

create table public.communities (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name, E' \t\n\r\f\v')),
  description text check (char_length(description) <= 500),
  logo_path text check (char_length(logo_path) <= 256),
  city_label text check (char_length(city_label) <= 120),
  visibility public.community_visibility not null,
  settings jsonb not null default '{}'::jsonb check (jsonb_typeof(settings) = 'object' and octet_length(settings::text) <= 4096),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index communities_discovery on public.communities (visibility, created_at desc);

create table public.community_members (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  role public.community_member_role not null default 'member',
  status public.community_membership_status not null,
  valid_from timestamptz not null default now(),
  valid_until timestamptz,
  -- League eligibility begins at activation, not at the pending request's valid_from.
  activated_at timestamptz,
  created_at timestamptz not null default now(),
  constraint membership_interval check (
    (status in ('active', 'pending') and valid_until is null) or
    (status = 'inactive' and valid_until is not null and valid_until > valid_from)
  ),
  constraint membership_activation check (
    (status = 'pending' and activated_at is null) or
    (status = 'active' and activated_at is not null) or
    status = 'inactive'
  ),
  constraint membership_activation_interval check (
    valid_until is null or activated_at is null or valid_until >= activated_at
  )
);
create unique index community_members_open on public.community_members (community_id, user_id) where valid_until is null;
create index community_members_history on public.community_members (user_id, community_id, valid_until);
create index community_members_roles on public.community_members (community_id, status, role, valid_until);

create table public.community_invitations (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  invitee_user_id uuid not null references auth.users(id) on delete restrict,
  issued_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  token_hash text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz not null,
  redeemed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  constraint invitation_lifecycle check (
    expires_at > created_at and (redeemed_at is null or revoked_at is null)
    and (redeemed_at is null or redeemed_at between created_at and expires_at)
    and (revoked_at is null or revoked_at >= created_at)
  )
);
create unique index community_invitations_open on public.community_invitations (community_id, invitee_user_id)
  where redeemed_at is null and revoked_at is null;
create index community_invitations_invitee on public.community_invitations (invitee_user_id, expires_at);

create table public.community_venues (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 120 and name = btrim(name, E' \t\n\r\f\v')),
  address text check (char_length(address) <= 300),
  maps_url text check (char_length(maps_url) <= 2048 and maps_url like 'https://%'),
  photo_path text check (char_length(photo_path) <= 256),
  created_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index community_venues_lookup on public.community_venues (community_id, name);

create table public.community_audit_log (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  actor_user_id uuid references auth.users(id) on delete restrict,
  entity text not null check (entity in ('communities', 'community_members', 'community_invitations', 'community_venues')),
  entity_id uuid not null,
  action text not null check (action in ('INSERT', 'UPDATE')),
  details jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index community_audit_history on public.community_audit_log (community_id, occurred_at desc, id);

create function public.is_community_member(p_community_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
    and exists (select 1 from public.community_members m where m.community_id = p_community_id
      and m.user_id = (select auth.uid()) and m.status = 'active'
      and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now()));
$$;
create function public.is_community_admin(p_community_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
    and exists (select 1 from public.community_members m where m.community_id = p_community_id
      and m.user_id = (select auth.uid()) and m.status = 'active' and m.role = 'admin'
      and m.valid_from <= now() and (m.valid_until is null or m.valid_until > now()));
$$;
create function public.can_read_community(p_community_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null
    and coalesce((select auth.jwt()->>'is_anonymous'), 'false') <> 'true'
    and exists (select 1 from public.communities c where c.id = p_community_id
      and (c.visibility = 'public' or public.is_community_member(c.id)));
$$;
revoke all on function public.is_community_member(uuid), public.is_community_admin(uuid),
  public.can_read_community(uuid) from public, anon, authenticated;
grant execute on function public.is_community_member(uuid), public.is_community_admin(uuid),
  public.can_read_community(uuid) to authenticated;

alter table public.communities enable row level security;
alter table public.community_members enable row level security;
alter table public.community_invitations enable row level security;
alter table public.community_venues enable row level security;
alter table public.community_audit_log enable row level security;
revoke all on public.communities, public.community_members, public.community_invitations,
  public.community_venues, public.community_audit_log from public, anon, authenticated;
grant select on public.communities, public.community_members, public.community_venues,
  public.community_audit_log to authenticated;
grant select (id, community_id, invitee_user_id, issued_by, expires_at, redeemed_at, revoked_at, created_at)
  on public.community_invitations to authenticated;
grant update (name, description, logo_path, city_label, visibility, settings) on public.communities to authenticated;
grant insert (community_id, user_id, role, status) on public.community_members to authenticated;
grant update (role, status, valid_until) on public.community_members to authenticated;
grant insert (community_id, invitee_user_id, token_hash, expires_at) on public.community_invitations to authenticated;
grant update (revoked_at) on public.community_invitations to authenticated;
grant insert (community_id, name, address, maps_url, photo_path) on public.community_venues to authenticated;
grant update (name, address, maps_url, photo_path) on public.community_venues to authenticated;

create policy "community read" on public.communities for select to authenticated
  using (public.can_read_community(id));
create policy "community admin update" on public.communities for update to authenticated
  using (public.is_community_admin(id)) with check (public.is_community_admin(id));
create policy "membership read" on public.community_members for select to authenticated
  using (user_id = (select auth.uid()) or public.is_community_admin(community_id));
create policy "membership admin insert" on public.community_members for insert to authenticated
  with check (public.is_community_admin(community_id));
create policy "membership admin update" on public.community_members for update to authenticated
  using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));
create policy "invitation read" on public.community_invitations for select to authenticated
  using (invitee_user_id = (select auth.uid()) or public.is_community_admin(community_id));
create policy "invitation admin insert" on public.community_invitations for insert to authenticated
  with check (public.is_community_admin(community_id));
create policy "invitation admin update" on public.community_invitations for update to authenticated
  using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));
create policy "venue read" on public.community_venues for select to authenticated
  using (public.is_community_member(community_id));
create policy "venue admin insert" on public.community_venues for insert to authenticated
  with check (public.is_community_admin(community_id));
create policy "venue admin update" on public.community_venues for update to authenticated
  using (public.is_community_admin(community_id)) with check (public.is_community_admin(community_id));
create policy "audit admin read" on public.community_audit_log for select to authenticated
  using (public.is_community_admin(community_id));

create function public.create_community(p_name text, p_visibility public.community_visibility,
  p_description text default null, p_city_label text default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare v_id uuid; v_actor uuid := (select auth.uid());
begin
  if v_actor is null or coalesce((select auth.jwt()->>'is_anonymous'), 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  insert into public.communities (name, visibility, description, city_label, created_by)
    values (p_name, p_visibility, p_description, p_city_label, v_actor) returning id into v_id;
  insert into public.community_members (community_id, user_id, role, status)
    values (v_id, v_actor, 'admin', 'active');
  return v_id;
end;
$$;
revoke all on function public.create_community(text, public.community_visibility, text, text) from public, anon, authenticated;
grant execute on function public.create_community(text, public.community_visibility, text, text) to authenticated;

create function public.guard_community_member() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Membership history cannot be deleted' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' then
    -- Activation, not request creation, starts League eligibility (activated_at..valid_until).
    new.activated_at := case when new.status = 'active' then now() else null end;
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
create trigger community_member_guard before insert or update or delete on public.community_members
  for each row execute function public.guard_community_member();

create function public.guard_community_invitation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if old.id is distinct from new.id or old.community_id is distinct from new.community_id
    or old.invitee_user_id is distinct from new.invitee_user_id or old.issued_by is distinct from new.issued_by
    or old.token_hash is distinct from new.token_hash or old.expires_at is distinct from new.expires_at
    or old.created_at is distinct from new.created_at
    or old.revoked_at is not null or old.redeemed_at is not null then
    raise exception 'Invitation cannot be reopened or reassigned' using errcode = '23514';
  end if;
  return new;
end;
$$;
create trigger community_invitation_guard before update on public.community_invitations
  for each row execute function public.guard_community_invitation();

create function public.touch_community_updated_at() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
create trigger communities_touch_updated_at before update on public.communities
  for each row execute function public.touch_community_updated_at();
create trigger community_venues_touch_updated_at before update on public.community_venues
  for each row execute function public.touch_community_updated_at();
revoke all on function public.touch_community_updated_at() from public, anon, authenticated;

create function public.audit_community_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_details jsonb := '{}'::jsonb; v_community_id uuid;
begin
  if tg_table_name = 'communities' then
    v_community_id := new.id;
  else
    v_community_id := new.community_id;
  end if;
  if tg_table_name = 'community_members' then
    v_details := pg_catalog.jsonb_build_object('role', new.role, 'status', new.status);
  elsif tg_table_name = 'communities' then
    v_details := pg_catalog.jsonb_build_object('visibility', new.visibility);
  elsif tg_table_name = 'community_invitations' then
    v_details := pg_catalog.jsonb_build_object('revoked', new.revoked_at is not null);
  end if;
  insert into public.community_audit_log (community_id, actor_user_id, entity, entity_id, action, details)
    values (v_community_id, (select auth.uid()), tg_table_name, new.id, tg_op, v_details);
  return new;
end;
$$;
create trigger community_audit after insert or update on public.communities
  for each row execute function public.audit_community_change();
create trigger community_member_audit after insert or update on public.community_members
  for each row execute function public.audit_community_change();
create trigger community_invitation_audit after insert or update on public.community_invitations
  for each row execute function public.audit_community_change();
create trigger community_venue_audit after insert or update on public.community_venues
  for each row execute function public.audit_community_change();
revoke all on function public.guard_community_member(), public.guard_community_invitation(),
  public.audit_community_change() from public, anon, authenticated;
