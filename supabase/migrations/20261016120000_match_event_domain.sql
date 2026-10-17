create type public.match_event_type as enum ('competitive', 'friendly');
create type public.match_event_visibility as enum ('community_open', 'invite_only');
create type public.match_team_assignment_mode as enum ('PREDEFINED_TEAMS', 'POST_MATCH_TEAMS');

create function public.valid_match_maps_url(p_url text) returns boolean
language plpgsql immutable set search_path = '' as $$
declare v_parts text[];
begin
  if p_url is null or pg_catalog.char_length(p_url) > 2048
    or p_url ~ '[[:cntrl:]]' or p_url <> pg_catalog.btrim(p_url) then return false; end if;
  if p_url !~ '^https://[^/?#]+(/[^?#]*)?(\?[^#]*)?(#.*)?$' then return false; end if;
  v_parts := pg_catalog.regexp_match(p_url, '^https://([^/?#]+)(/[^?#]*)?(\?[^#]*)?(#.*)?$');
  if v_parts is null or pg_catalog.lower(v_parts[1]) ~ '[@:]' then return false; end if;
  return ((pg_catalog.lower(v_parts[1]) in ('google.com','www.google.com') and coalesce(v_parts[2], '') like '/maps/%')
      or (pg_catalog.lower(v_parts[1]) = 'maps.google.com' and coalesce(v_parts[2], '') like '/%')
      or (pg_catalog.lower(v_parts[1]) = 'maps.app.goo.gl' and coalesce(v_parts[2], '') like '/%')
      or (pg_catalog.lower(v_parts[1]) = 'goo.gl' and coalesce(v_parts[2], '') like '/maps/%'))
    and pg_catalog.length(coalesce(v_parts[2], '')) > 1;
end;
$$;

create table public.match_events (
  id uuid primary key,
  community_id uuid not null references public.communities(id) on delete restrict,
  created_by uuid not null references auth.users(id) on delete restrict,
  starts_at timestamptz not null,
  timezone text not null check (char_length(timezone) between 1 and 100 and timezone = btrim(timezone)),
  event_type public.match_event_type not null,
  visibility public.match_event_visibility not null,
  team_assignment_mode public.match_team_assignment_mode not null,
  venue_name text not null check (char_length(venue_name) between 1 and 120 and venue_name = btrim(venue_name) and venue_name !~ '[[:cntrl:]]'),
  maps_url text not null check (public.valid_match_maps_url(maps_url)),
  photo_path text not null check (char_length(photo_path) between 1 and 512 and photo_path !~ '[[:cntrl:]]'),
  saved_venue_id uuid references public.community_venues(id) on delete restrict,
  court_notes text check (court_notes is null or (char_length(court_notes) <= 300 and court_notes = btrim(court_notes) and court_notes !~ '[[:cntrl:]]')),
  duration_minutes integer check (duration_minutes is null or duration_minutes between 1 and 1440),
  notes text check (notes is null or (char_length(notes) <= 2000 and notes = btrim(notes) and notes !~ '[[:cntrl:]]')),
  court_booked boolean not null default false,
  restriction_enabled boolean not null default false,
  min_level numeric(3,1),
  max_level numeric(3,1),
  price_minor bigint,
  currency text,
  payment_note text check (payment_note is null or (char_length(payment_note) <= 300 and payment_note = btrim(payment_note) and payment_note !~ '[[:cntrl:]]')),
  maximum_registrations integer check (maximum_registrations is null or maximum_registrations > 0),
  registration_cutoff_at timestamptz not null,
  published_at timestamptz not null default pg_catalog.clock_timestamp(),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint match_event_cutoff_before_start check (registration_cutoff_at < starts_at),
  constraint match_event_level_range check ((restriction_enabled and min_level between 0 and 7 and max_level between min_level and 7) or (not restriction_enabled and min_level is null and max_level is null)),
  constraint match_event_price_currency check ((price_minor is null and currency is null) or (price_minor between 0 and 9007199254740991 and currency in ('BRL','USD','EUR')))
);
create index match_events_community_start_id on public.match_events (community_id, starts_at, id);
create index match_events_start_id on public.match_events (starts_at, id);
create index match_events_creator_start on public.match_events (created_by, starts_at);

create table public.match_event_registrations (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  user_id uuid not null references auth.users(id) on delete restrict,
  accepted_at timestamptz not null,
  unique (match_event_id, user_id)
);
create index match_event_registrations_event_fifo on public.match_event_registrations (match_event_id, accepted_at, id);
create index match_event_registrations_user_event on public.match_event_registrations (user_id, match_event_id);

create table public.match_event_invites (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  invitee_user_id uuid not null references auth.users(id) on delete restrict,
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  unique (match_event_id, invitee_user_id)
);
create index match_event_invites_invitee_event on public.match_event_invites (invitee_user_id, match_event_id);

create function public.is_private_match_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_events e where e.id = p_event_id and (
    e.created_by = (select auth.uid()) or public.is_community_admin(e.community_id)
    or exists (select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid()))
    or exists (select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=(select auth.uid()))
  ));
$$;
create function public.can_read_match_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'true'
    and exists (select 1 from public.match_events e join public.communities c on c.id=e.community_id
      where e.id=p_event_id and (e.created_by=(select auth.uid()) or public.is_community_admin(e.community_id)
        or (e.visibility='community_open' and (c.visibility='public' or public.is_community_member(e.community_id)))
        or (e.visibility='invite_only' and (exists (select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid()))
          or exists (select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=(select auth.uid()))))));
$$;

create function public.register_match_event_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at <= pg_catalog.clock_timestamp() then raise exception 'Match must start in the future' using errcode='23514'; end if;
  insert into public.match_event_registrations(match_event_id,user_id,accepted_at)
    values(new.id,new.created_by,new.published_at);
  return new;
end;
$$;
create trigger match_event_creator_registration after insert on public.match_events
for each row execute function public.register_match_event_creator();

create function public.guard_match_event_mutation() returns trigger
language plpgsql security definer set search_path = '' as $$
begin raise exception 'Match event facts are immutable' using errcode='23514'; end;
$$;
create trigger match_event_immutable before update or delete on public.match_events for each row execute function public.guard_match_event_mutation();
create trigger match_registration_immutable before update or delete on public.match_event_registrations for each row execute function public.guard_match_event_mutation();
create trigger match_invite_immutable before update or delete on public.match_event_invites for each row execute function public.guard_match_event_mutation();

alter table public.match_events enable row level security;
alter table public.match_event_registrations enable row level security;
alter table public.match_event_invites enable row level security;
revoke all on public.match_events, public.match_event_registrations, public.match_event_invites from public, anon, authenticated;
grant select on public.match_events, public.match_event_registrations, public.match_event_invites to authenticated;
create policy match_event_read on public.match_events for select to authenticated using (public.can_read_match_event(id));
create policy match_registration_read on public.match_event_registrations for select to authenticated using (
  user_id=(select auth.uid()) or exists (select 1 from public.match_events e where e.id=match_event_id and (e.created_by=(select auth.uid()) or public.is_community_admin(e.community_id))));
create policy match_invite_read on public.match_event_invites for select to authenticated using (
  invitee_user_id=(select auth.uid()) or exists (select 1 from public.match_events e where e.id=match_event_id and (e.created_by=(select auth.uid()) or public.is_community_admin(e.community_id))));
revoke all on function public.valid_match_maps_url(text), public.is_private_match_event(uuid), public.register_match_event_creator(), public.guard_match_event_mutation() from public, anon, authenticated;
revoke all on function public.can_read_match_event(uuid) from public, anon, authenticated;
grant execute on function public.can_read_match_event(uuid) to authenticated;
