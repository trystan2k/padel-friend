begin;

-- PAF-11 review round 1 hardening (F1, F2, F4, F5). Forward-only: replaces functions from their
-- live definitions and adds the append-only League reference history.
--   * F1: League period immutability (approved decision Q4) holds once ANY published event ever
--     referenced the League, even after the last referencing event is switched away. A restricted
--     append-only history records every first (League, event) reference; backfilled below.
--   * F2: create_league stamps created_at AFTER the community lock is held, so the existence anchor
--     compared with match_events.published_at is monotonic under contention (no retroactive binding).
--   * F4: process_due_leagues no longer cuts its batch before skipping locked/failing communities.
--   * F5: list_leagues reports total/truncated next to its 200-row cap.

create table public.league_event_references (
  league_id uuid not null references public.leagues(id) on delete restrict,
  match_event_id uuid not null,
  first_referenced_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (league_id, match_event_id)
);

create function public.guard_league_event_references_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '23514', message = 'LEAGUE_EVENT_REFERENCES_IMMUTABLE';
end $$;
create trigger league_event_references_immutable before update or delete on public.league_event_references
  for each row execute function public.guard_league_event_references_immutable();

create function public.record_league_event_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.league_event_references (league_id, match_event_id)
    values (new.league_id, new.id) on conflict do nothing;
  return null;
end $$;
create trigger match_events_record_league_reference after insert or update of league_id on public.match_events
  for each row when (new.league_id is not null) execute function public.record_league_event_reference();

insert into public.league_event_references (league_id, match_event_id, first_referenced_at)
  select e.league_id, e.id, e.published_at from public.match_events e where e.league_id is not null
  on conflict do nothing;

alter table public.league_event_references enable row level security;
revoke all on public.league_event_references from public, anon, authenticated, service_role;
revoke all on function public.guard_league_event_references_immutable(), public.record_league_event_reference()
  from public, anon, authenticated, service_role;

create or replace function public.league_has_published_events(p_league_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.league_event_references r where r.league_id = p_league_id);
$$;

create or replace function public.create_league(p_request_id uuid, p_community_id uuid, p_name text, p_end_mode text, p_start_date date, p_description text DEFAULT NULL::text, p_end_date date DEFAULT NULL::date, p_minimum_matches integer DEFAULT 1)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_timezone text;
  v_input jsonb;
  v_existing public.leagues;
  v_instants timestamptz[];
  v_row public.leagues;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  if p_request_id is null or p_community_id is null then
    raise exception using errcode = '22023', message = 'LEAGUE_INVALID_INPUT';
  end if;
  if not public.league_valid_text(p_name, 80) then
    raise exception using errcode = '22023', message = 'LEAGUE_NAME_INVALID';
  end if;
  if p_description is not null and not public.league_valid_text(p_description, 500) then
    raise exception using errcode = '22023', message = 'LEAGUE_DESCRIPTION_INVALID';
  end if;
  if p_minimum_matches is null or p_minimum_matches not between 1 and 100 then
    raise exception using errcode = '22023', message = 'LEAGUE_MINIMUM_INVALID';
  end if;
  -- Outsiders never reach the lock.
  if not public.is_community_member(p_community_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  perform 1 from public.communities c where c.id = p_community_id for update;
  if not found then raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN'; end if;
  -- F2: the creation instant is taken only after the community lock is held, so it is strictly
  -- later than the published_at of every event that published while this call waited.
  v_now := pg_catalog.clock_timestamp();

  v_input := pg_catalog.jsonb_build_object('community_id', p_community_id, 'name', p_name,
    'description', p_description, 'end_mode', p_end_mode, 'start_date', p_start_date,
    'end_date', p_end_date, 'minimum_matches', p_minimum_matches);
  select * into v_existing from public.leagues l where l.owner_id = v_actor and l.create_request_id = p_request_id;
  if found then
    if v_existing.create_input is distinct from v_input then
      raise exception using errcode = 'P0001', message = 'LEAGUE_REQUEST_CONFLICT';
    end if;
    return public.league_dto(v_existing);
  end if;

  -- Membership and the creation setting are rechecked under the community lock.
  if not public.is_community_member(p_community_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  if not public.is_community_admin(p_community_id) and not coalesce((
      select (public.get_effective_community_admin_defaults(c.settings) ->> 'member_created_leagues_enabled')::boolean
      from public.communities c where c.id = p_community_id), false) then
    raise exception using errcode = '42501', message = 'LEAGUE_CREATION_DISABLED';
  end if;

  select public.get_effective_community_admin_defaults(c.settings) ->> 'timezone'
    into v_timezone from public.communities c where c.id = p_community_id;
  v_instants := public.league_period_instants(v_timezone, p_end_mode, p_start_date, p_end_date);
  if p_start_date < (v_now at time zone v_timezone)::date then
    raise exception using errcode = '22023', message = 'LEAGUE_START_IN_PAST';
  end if;

  insert into public.leagues (community_id, owner_id, name, description, timezone, start_at, end_mode,
      end_at, status, minimum_matches_for_final_award, create_request_id, create_input, created_at)
    values (p_community_id, v_actor, p_name, p_description, v_timezone, v_instants[1], p_end_mode::public.league_end_mode,
      v_instants[2], 'upcoming', p_minimum_matches, p_request_id, v_input, v_now)
    returning * into v_row;
  insert into public.league_events (league_id, community_id, action, actor_id, details)
    values (v_row.id, v_row.community_id, 'created', v_actor, '{}'::jsonb);
  -- Reconcile expired Leagues and settle the new League's activation in the same transaction.
  perform public.league_process_community_locked(p_community_id, v_now);
  select * into v_row from public.leagues l where l.id = v_row.id;
  return public.league_dto(v_row);
end $$;

create or replace function public.process_due_leagues(p_limit integer DEFAULT 25, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $$
declare
  v_as_of timestamptz := coalesce(p_as_of, pg_catalog.clock_timestamp());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_community uuid;
  v_result jsonb;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_community in
    select l.community_id from public.leagues l
    where (l.status = 'active' and l.end_mode = 'fixed_date' and l.end_at < v_as_of)
      or (l.status = 'upcoming' and ((l.end_mode = 'fixed_date' and l.end_at < v_as_of)
        or (l.start_at <= v_as_of and l.activation_blocked_at is null)))
    group by l.community_id order by pg_catalog.min(l.start_at), l.community_id
  loop
    -- F4: the limit bounds communities actually processed. Locked or failing communities are
    -- attempted but never consume the batch, so they cannot starve the ones behind them.
    exit when v_processed >= v_limit;
    begin
      perform 1 from public.communities c where c.id = v_community for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
      else
        v_result := public.league_process_community_locked(v_community, v_as_of);
        v_processed := v_processed + 1;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object('community_id', v_community, 'sqlstate', SQLSTATE, 'message', SQLERRM);
      raise warning 'process_due_leagues failed for community %: % (%)', v_community, SQLERRM, SQLSTATE;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('processed', v_processed, 'skipped', v_skipped,
    'failed', v_failed, 'errors', v_errors);
end $$;

create or replace function public.list_leagues(p_community_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $$
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  if p_community_id is null or not public.is_community_member(p_community_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'community', public.league_community_dto(p_community_id),
    'leagues', coalesce((
      select pg_catalog.jsonb_agg(public.league_dto(r.l) order by r.rank, r.closed_sort desc nulls last, r.start_sort, r.id)
      from (select l as l, l.id,
          case l.status when 'active' then 0 when 'upcoming' then 1 else 2 end as rank,
          case when l.status = 'closed' then l.closed_at end as closed_sort,
          case when l.status <> 'closed' then l.start_at end as start_sort
        from public.leagues l where l.community_id = p_community_id
        order by 3, 4 desc nulls last, 5, 2 limit 200) r), '[]'::jsonb),
    -- F5: the list is capped at 200 rows; total/truncated make a cut-off visible to the caller.
    'total', (select pg_catalog.count(*) from public.leagues l where l.community_id = p_community_id),
    'truncated', (select pg_catalog.count(*) from public.leagues l where l.community_id = p_community_id) > 200);
end $$;

commit;
