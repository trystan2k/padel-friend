begin;

-- PAF-11 / U1: period-based community Leagues (schema, integrity and read policies).
--
-- Contract (see docs/plan/Plan PAF-11 T11, "Shared implementation contracts" and U1):
--   * A League belongs to one community and one owner (its creator). Its period is stored as UTC
--     instants plus the community timezone snapshot taken at creation: start inclusive, Fixed
--     end inclusive, Manual end = the audited closed_at instant (inclusive). Draft/Archived
--     statuses and deletion do not exist: closed Leagues are retained as sporting history.
--   * status: upcoming -> active -> closed. A due Upcoming League that cannot take the single
--     Active slot stays Upcoming and carries activation_blocked_at until an authorized actor
--     activates it explicitly (approved decision Q3).
--   * One Active League per community is enforced by a partial unique index whose predicate is
--     the immutable status literal (no volatile now() in the predicate); race safety comes from
--     the community lock taken by every command in 20261101161000_league_commands.sql.
--   * Writes happen only through those SECURITY DEFINER commands: browser roles hold SELECT on
--     leagues (active-member policy) and nothing on the audit table.

create type public.league_end_mode as enum ('fixed_date', 'manual');
create type public.league_status as enum ('upcoming', 'active', 'closed');

create function public.valid_league_timezone(p_timezone text) returns boolean
language sql stable set search_path = '' as $$
  select p_timezone in ('Europe/Madrid', 'UTC')
    and exists (select 1 from pg_catalog.pg_timezone_names n where n.name = p_timezone);
$$;

create table public.leagues (
  id uuid primary key default gen_random_uuid(),
  community_id uuid not null references public.communities(id) on delete restrict,
  owner_id uuid not null references auth.users(id) on delete restrict,
  name text not null check (char_length(name) between 1 and 80 and name = btrim(name, E' \t\n\r\f\v')),
  description text check (description is null
    or (char_length(description) between 1 and 500 and description = btrim(description, E' \t\n\r\f\v'))),
  timezone text not null check (public.valid_league_timezone(timezone)),
  start_at timestamptz not null,
  end_mode public.league_end_mode not null,
  end_at timestamptz,
  status public.league_status not null,
  minimum_matches_for_final_award integer not null default 1
    check (minimum_matches_for_final_award between 1 and 100),
  activation_blocked_at timestamptz,
  activated_at timestamptz,
  closed_at timestamptz,
  closed_by uuid references auth.users(id) on delete restrict,
  closed_reason text check (closed_reason in ('manual', 'fixed_end_reached', 'expired_before_activation')),
  create_request_id uuid not null,
  create_input jsonb not null,
  version integer not null default 1 check (version >= 1),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint leagues_id_community_unique unique (id, community_id),
  constraint leagues_owner_request_unique unique (owner_id, create_request_id),
  constraint leagues_end_mode_consistent check (
    (end_mode = 'fixed_date' and end_at is not null and end_at > start_at)
    or (end_mode = 'manual' and end_at is null)),
  constraint leagues_status_evidence check (
    (status = 'upcoming' and activated_at is null and closed_at is null and closed_by is null and closed_reason is null)
    or (status = 'active' and activated_at is not null and activation_blocked_at is null
      and closed_at is null and closed_by is null and closed_reason is null)
    or (status = 'closed' and closed_at is not null and closed_reason is not null
      and activation_blocked_at is null
      and (closed_reason = 'manual') = (closed_by is not null))),
  constraint leagues_blocked_only_upcoming check (activation_blocked_at is null or status = 'upcoming')
);

-- Exactly one Active League per community; any number of Upcoming/closed ones.
create unique index leagues_one_active_per_community on public.leagues (community_id) where status = 'active';
create index leagues_community_status_start on public.leagues (community_id, status, start_at, id);
create index leagues_due_work on public.leagues (status, start_at) where status in ('upcoming', 'active');

-- Restricted audit evidence: every lifecycle transition, including scheduler actions
-- (actor_id is null for system transitions). No browser access.
create table public.league_events (
  id uuid primary key default gen_random_uuid(),
  league_id uuid not null,
  community_id uuid not null,
  action text not null check (action in ('created', 'updated', 'activated', 'activation_blocked', 'closed')),
  actor_id uuid references auth.users(id) on delete restrict,
  system_reason text check (system_reason in ('due_start', 'fixed_end_reached', 'expired_before_activation', 'activation_conflict')),
  details jsonb not null default '{}'::jsonb check (jsonb_typeof(details) = 'object'),
  occurred_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint league_events_league_fk foreign key (league_id, community_id)
    references public.leagues (id, community_id) on delete restrict,
  constraint league_events_actor_or_system check ((actor_id is null) = (system_reason is not null))
);
create index league_events_league on public.league_events (league_id, occurred_at, id);

create function public.touch_league() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger leagues_touch before update on public.leagues
  for each row execute function public.touch_league();

-- Identity and ownership of a League never move; only the lifecycle commands update the rest.
create function public.guard_league_identity() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.id is distinct from old.id or new.community_id is distinct from old.community_id
    or new.owner_id is distinct from old.owner_id or new.timezone is distinct from old.timezone
    or new.create_request_id is distinct from old.create_request_id
    or new.create_input is distinct from old.create_input or new.created_at is distinct from old.created_at then
    raise exception using errcode = '23514', message = 'LEAGUE_IDENTITY_IMMUTABLE';
  end if;
  if old.status = 'closed' and (to_jsonb(new) - 'updated_at') is distinct from (to_jsonb(old) - 'updated_at') then
    raise exception using errcode = '23514', message = 'LEAGUE_CLOSED_IMMUTABLE';
  end if;
  return new;
end $$;
create trigger leagues_identity_guard before update on public.leagues
  for each row execute function public.guard_league_identity();

create function public.guard_league_events_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'LEAGUE_EVENTS_IMMUTABLE';
end $$;
create trigger league_events_immutable before update or delete on public.league_events
  for each row execute function public.guard_league_events_immutable();

revoke all on function public.valid_league_timezone(text), public.touch_league(),
  public.guard_league_identity(), public.guard_league_events_immutable()
  from public, anon, authenticated, service_role;

alter table public.leagues enable row level security;
alter table public.league_events enable row level security;
revoke all on public.leagues, public.league_events from public, anon, authenticated, service_role;

-- Active community members (admins included) read their community's Leagues. Everything
-- sensitive about writing stays behind the SECURITY DEFINER commands; league_events has no policy.
grant select on public.leagues to authenticated;
create policy "league member select" on public.leagues
  for select to authenticated using (public.is_community_member(community_id));

-- PAF-125's one-time restrictive policy installation does not cover new tables.
create policy "provisional actor restricted" on public.leagues as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

commit;
