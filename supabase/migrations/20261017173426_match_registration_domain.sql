begin;

create type public.match_registration_lifecycle as enum ('pending', 'accepted', 'rejected', 'expired');
create type public.match_registration_participation as enum ('playing', 'reserve', 'reserve_not_playing');
create type public.match_registration_source as enum ('creator', 'member', 'guest');

-- F20: the blanket pre-PAF-5 immutability trigger rejects every UPDATE of
-- public.match_event_registrations. It MUST be dropped before any backfill
-- write: on a database that already holds registrations (hosted/production)
-- the backfill would otherwise abort the whole migration with 23514. The new
-- identity guard is installed only after the backfills complete (below), so it
-- can never reject them either.
drop trigger match_registration_immutable on public.match_event_registrations;

alter table public.match_event_registrations
  alter column accepted_at drop not null,
  add column lifecycle public.match_registration_lifecycle not null default 'accepted',
  add column participation_status public.match_registration_participation,
  add column registration_source public.match_registration_source,
  add column requested_at timestamptz,
  add column approved_at timestamptz,
  add column accepted_order bigint,
  add column resolved_at timestamptz,
  add column resolved_by uuid references auth.users(id) on delete restrict;

-- Backfill registration_source and the deterministic creator-first accepted
-- order. Every pre-PAF-5 row was an accepted registration, so the creator's
-- row sorts first and the rest follow accepted_at then id.
with ordered as (
  select r.id, row_number() over (partition by r.match_event_id order by (r.user_id = e.created_by) desc, r.accepted_at, r.id) ordinal,
    (r.user_id = e.created_by) is_creator
  from public.match_event_registrations r join public.match_events e on e.id = r.match_event_id
  where r.lifecycle = 'accepted'
)
update public.match_event_registrations r
set accepted_order = ordered.ordinal,
    registration_source = case when ordered.is_creator then 'creator'::public.match_registration_source else 'member'::public.match_registration_source end
from ordered where r.id = ordered.id;

-- F30: backfill participation from the SAME derived rule the roster uses —
-- the first floor(N/4)*4 accepted rows by (accepted_order, id) are Playing and
-- the residual is Reserve — instead of a blanket 'reserve'. The rule stays
-- cutoff-aware: when the event's cutoff has already passed the residual reads
-- Reserve Not Playing, exactly like public.match_registration_roster does, so
-- the first post-upgrade reconciliation is a no-op rather than emitting false
-- historical promotion and quartet-complete alerts.
with ranked as (
  select r.id, r.match_event_id,
    row_number() over (partition by r.match_event_id order by r.accepted_order, r.id) as position,
    count(*) over (partition by r.match_event_id) as total
  from public.match_event_registrations r
  where r.lifecycle = 'accepted'
)
update public.match_event_registrations r
set participation_status = case
    when ranked.position <= (ranked.total / 4) * 4 then 'playing'::public.match_registration_participation
    when e.registration_cutoff_at <= pg_catalog.clock_timestamp() then 'reserve_not_playing'::public.match_registration_participation
    else 'reserve'::public.match_registration_participation end
from ranked join public.match_events e on e.id = ranked.match_event_id
where r.id = ranked.id;

alter table public.match_event_registrations
  alter column registration_source set not null,
  add constraint match_registration_lifecycle_anchors check (
    (lifecycle = 'accepted' and accepted_at is not null and accepted_order is not null
      and participation_status is not null and (approved_at is null or approved_at = accepted_at))
    or (lifecycle <> 'accepted' and accepted_at is null and accepted_order is null
      and participation_status is null and approved_at is null)
  );
create unique index match_registration_event_accepted_order
  on public.match_event_registrations(match_event_id, accepted_order) where accepted_order is not null;

create table public.match_event_registration_state (
  match_event_id uuid primary key references public.match_events(id) on delete restrict,
  next_accepted_ordinal bigint not null check (next_accepted_ordinal > 0),
  transition_revision bigint not null default 0 check (transition_revision >= 0),
  cutoff_processed_at timestamptz
);
insert into public.match_event_registration_state(match_event_id, next_accepted_ordinal)
select e.id, coalesce(max(r.accepted_order), 0) + 1
from public.match_events e left join public.match_event_registrations r on r.match_event_id=e.id
group by e.id;

create table public.match_event_registration_attempts (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null,
  user_id uuid not null,
  requested_at timestamptz not null,
  decided_at timestamptz,
  outcome public.match_registration_lifecycle not null,
  actor_id uuid references auth.users(id) on delete restrict,
  foreign key (match_event_id, user_id) references public.match_event_registrations(match_event_id, user_id) on delete restrict,
  check (outcome <> 'accepted' or decided_at is not null)
);
create index match_registration_attempts_identity_requested on public.match_event_registration_attempts(match_event_id, user_id, requested_at);

-- Install the replacement identity guard only after every backfill write has
-- completed, so it cannot reject the backfill either.
create function public.guard_match_registration_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' or new.id is distinct from old.id
    or new.match_event_id is distinct from old.match_event_id
    or new.user_id is distinct from old.user_id then
    raise exception 'Registration identity is immutable' using errcode='23514';
  end if;
  return new;
end;
$$;
create trigger match_registration_identity_guard before update or delete on public.match_event_registrations
for each row execute function public.guard_match_registration_identity();

create or replace function public.register_match_event_creator() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.starts_at <= pg_catalog.clock_timestamp() then raise exception 'Match must start in the future' using errcode='23514'; end if;
  insert into public.match_event_registration_state(match_event_id, next_accepted_ordinal) values(new.id, 2);
  insert into public.match_event_registrations(match_event_id,user_id,accepted_at,accepted_order,participation_status,registration_source)
    values(new.id,new.created_by,new.published_at,1,'reserve','creator');
  return new;
end;
$$;

create or replace function public.is_private_match_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.match_events e where e.id=p_event_id and (
    e.created_by=(select auth.uid()) or public.is_community_admin(e.community_id)
    or exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid()))
    or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=(select auth.uid()) and r.lifecycle='accepted')
  ));
$$;
create or replace function public.can_read_match_event(p_event_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and coalesce((select auth.jwt()->>'is_anonymous'),'false') <> 'true'
    and exists(select 1 from public.match_events e join public.communities c on c.id=e.community_id where e.id=p_event_id and (
      e.created_by=(select auth.uid()) or public.is_community_admin(e.community_id)
      or (e.visibility='community_open' and (c.visibility='public' or public.is_community_member(e.community_id)))
      or (e.visibility='invite_only' and (exists(select 1 from public.match_event_invites i where i.match_event_id=e.id and i.invitee_user_id=(select auth.uid()))
        or exists(select 1 from public.match_event_registrations r where r.match_event_id=e.id and r.user_id=(select auth.uid()) and r.lifecycle='accepted')))
    ));
$$;

revoke all on public.match_event_registration_attempts, public.match_event_registration_state from public, anon, authenticated;
revoke all on function public.guard_match_registration_identity() from public, anon, authenticated;
grant execute on function public.can_read_match_event(uuid) to authenticated;
commit;
