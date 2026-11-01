begin;

-- PAF-11 / U1: League commands, readers and the due-transition processor.
--
-- Contract:
--   * Every browser-callable function is SECURITY DEFINER with an empty search_path and asserts
--     the actor first (authenticated, non-anonymous, not a provisional/revoked actor). Browser
--     roles can execute only the six commands/readers at the bottom; internal helpers and the
--     processors are revoked from every runtime role.
--   * Lock order: community row (FOR UPDATE, the same serialization boundary as settings,
--     membership and event commands) -> League rows. A caller's expected version is checked
--     against the row as the caller saw it, before lifecycle reconciliation can move it. Permission is checked before the lock to
--     avoid lock probing by outsiders and again under the lock, so a concurrent setting toggle or
--     membership change cannot be bypassed.
--   * Lifecycle (approved decision Q3): start inclusive, Fixed end inclusive (a Fixed League is
--     closed only once the instant passes end_at; closed_at records end_at), Manual stays Active
--     until an authorized, audited close. A due Upcoming League takes the Active slot only when
--     it is the single candidate and the slot is free; otherwise it stays Upcoming with
--     activation_blocked_at until an owner/Admin activates it explicitly. Expired Fixed Leagues
--     are always reconciled in the same transaction before the slot is allocated.
--   * Period immutability (approved decision Q4): start/end-mode/end can change only while no
--     published match event references the League (league_has_published_events).
--   * All "now" decisions use an explicit as-of instant (clock_timestamp() for commands), so the
--     boundary behavior is exactly testable at +/-1 microsecond.

-- 1. Internal helpers.
create function public.league_utc_text(p_instant timestamptz) returns text
language sql immutable set search_path = '' as $$
  select pg_catalog.to_char(p_instant at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"');
$$;

-- True once any published match event references the League. match_events.league_id is added by
-- the ranked-publication unit; until that column exists nothing can reference a League. The
-- catalog probe makes this check correct before and after that migration without a replacement.
create function public.league_has_published_events(p_league_id uuid) returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare v_referenced boolean;
begin
  if not exists (select 1 from pg_catalog.pg_attribute a
      where a.attrelid = 'public.match_events'::regclass and a.attname = 'league_id'
        and a.attnum > 0 and not a.attisdropped) then
    return false;
  end if;
  execute 'select exists (select 1 from public.match_events e where e.league_id = $1)'
    into v_referenced using p_league_id;
  return v_referenced;
end $$;

-- Owner (while still an active member) or an active community Admin. Uses the caller's identity.
create function public.league_actor_can_manage(p_community_id uuid, p_owner_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select public.is_community_admin(p_community_id)
    or (p_owner_id = (select auth.uid()) and public.is_community_member(p_community_id));
$$;

create function public.league_community_dto(p_community_id uuid) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', c.id, 'name', c.name,
    'timezone', public.get_effective_community_admin_defaults(c.settings) ->> 'timezone',
    'creation_enabled', (public.get_effective_community_admin_defaults(c.settings)
      ->> 'member_created_leagues_enabled')::boolean,
    'can_create', public.is_community_admin(c.id)
      or (public.get_effective_community_admin_defaults(c.settings)
        ->> 'member_created_leagues_enabled')::boolean)
  from public.communities c where c.id = p_community_id;
$$;

create function public.league_dto(p_league public.leagues) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', p_league.id, 'community_id', p_league.community_id, 'name', p_league.name,
    'description', p_league.description, 'owner_id', p_league.owner_id,
    'owner_name', (select p.display_name from public.player_profiles p where p.user_id = p_league.owner_id),
    'timezone', p_league.timezone,
    'start_at', public.league_utc_text(p_league.start_at),
    'end_mode', p_league.end_mode, 'end_at', public.league_utc_text(p_league.end_at),
    'start_date', ((p_league.start_at at time zone p_league.timezone)::date)::text,
    'end_date', ((p_league.end_at at time zone p_league.timezone)::date)::text,
    'status', p_league.status,
    'blocked_reason', case when p_league.status = 'upcoming' and p_league.activation_blocked_at is not null then
      case when exists (select 1 from public.leagues a where a.community_id = p_league.community_id
          and a.status = 'active') then 'active_league_exists' else 'explicit_activation_required' end end,
    'activation_due', p_league.status = 'upcoming' and p_league.start_at <= pg_catalog.now(),
    'minimum_matches_for_final_award', p_league.minimum_matches_for_final_award,
    'activated_at', public.league_utc_text(p_league.activated_at),
    'closed_at', public.league_utc_text(p_league.closed_at),
    'closed_reason', p_league.closed_reason,
    'created_at', public.league_utc_text(p_league.created_at),
    'version', p_league.version,
    'can_manage', public.league_actor_can_manage(p_league.community_id, p_league.owner_id),
    'period_locked', p_league.status = 'closed' or public.league_has_published_events(p_league.id));
$$;

-- 2. Lifecycle reconciliation. The caller holds the community lock.
create function public.league_process_community_locked(p_community_id uuid, p_as_of timestamptz default pg_catalog.clock_timestamp())
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_row public.leagues;
  v_closed integer := 0;
  v_activated integer := 0;
  v_blocked integer := 0;
  v_expired_until timestamptz;
  v_slot_taken boolean;
  v_candidates uuid[];
  v_candidate_start timestamptz;
begin
  -- 1. An Active Fixed League stays Active through its inclusive end instant, then closes.
  for v_row in select * from public.leagues l
      where l.community_id = p_community_id and l.status = 'active' and l.end_mode = 'fixed_date'
        and l.end_at < p_as_of order by l.id for update loop
    update public.leagues set status = 'closed', closed_at = v_row.end_at, closed_reason = 'fixed_end_reached',
        version = v_row.version + 1 where id = v_row.id;
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'closed', 'fixed_end_reached',
        pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_row.end_at)));
    v_closed := v_closed + 1;
    v_expired_until := greatest(v_expired_until, v_row.end_at);
  end loop;

  -- 2. An Upcoming Fixed League whose whole window passed without ever starting closes unused.
  for v_row in select * from public.leagues l
      where l.community_id = p_community_id and l.status = 'upcoming' and l.end_mode = 'fixed_date'
        and l.end_at < p_as_of order by l.id for update loop
    update public.leagues set status = 'closed', closed_at = v_row.end_at, activation_blocked_at = null,
        closed_reason = 'expired_before_activation', version = v_row.version + 1 where id = v_row.id;
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'closed', 'expired_before_activation',
        pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_row.end_at)));
    v_closed := v_closed + 1;
  end loop;

  -- 3. Due Upcoming Leagues not yet evaluated. Only a single candidate facing a free slot (that
  -- did not overlap a League reconciled above) activates; anything else is marked blocked and
  -- waits for an explicit owner/Admin activation. No arbitrary winner is ever chosen.
  select pg_catalog.array_agg(l.id order by l.start_at, l.id), pg_catalog.min(l.start_at)
    into v_candidates, v_candidate_start
    from public.leagues l
    where l.community_id = p_community_id and l.status = 'upcoming'
      and l.start_at <= p_as_of and l.activation_blocked_at is null;
  if v_candidates is null then
    return pg_catalog.jsonb_build_object('closed', v_closed, 'activated', 0, 'blocked', 0);
  end if;
  v_slot_taken := exists (select 1 from public.leagues a where a.community_id = p_community_id and a.status = 'active');
  if not v_slot_taken and pg_catalog.cardinality(v_candidates) = 1
    and (v_expired_until is null or v_candidate_start > v_expired_until) then
    select * into v_row from public.leagues l where l.id = v_candidates[1] for update;
    update public.leagues set status = 'active', activated_at = p_as_of, version = v_row.version + 1
      where id = v_row.id;
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'activated', 'due_start', '{}'::jsonb);
    v_activated := 1;
  else
    for v_row in select * from public.leagues l where l.id = any (v_candidates) order by l.id for update loop
      update public.leagues set activation_blocked_at = p_as_of, version = v_row.version + 1 where id = v_row.id;
      insert into public.league_events (league_id, community_id, action, system_reason, details)
        values (v_row.id, v_row.community_id, 'activation_blocked', 'activation_conflict',
          pg_catalog.jsonb_build_object('reason',
            case when v_slot_taken or v_expired_until is not null then 'active_league_exists'
              else 'explicit_activation_required' end));
      v_blocked := v_blocked + 1;
    end loop;
  end if;
  return pg_catalog.jsonb_build_object('closed', v_closed, 'activated', v_activated, 'blocked', v_blocked);
end $$;

-- Scheduler entry point (also callable manually for controlled catch-up). One community per
-- subtransaction: a failure rolls back only that community and is reported, never swallowed
-- silently. Communities locked by a command are skipped and retried on the next run.
create function public.process_due_leagues(p_limit integer default 25, p_as_of timestamptz default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
    group by l.community_id order by pg_catalog.min(l.start_at), l.community_id limit v_limit
  loop
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

-- 3. Input validation shared by create and update. Returns the UTC instants for local dates.
create function public.league_period_instants(p_timezone text, p_end_mode text, p_start_date date, p_end_date date)
returns timestamptz[] language plpgsql stable set search_path = '' as $$
declare v_start timestamptz; v_end timestamptz;
begin
  if p_end_mode is null or p_end_mode not in ('fixed_date', 'manual') then
    raise exception using errcode = '22023', message = 'LEAGUE_END_MODE_INVALID';
  end if;
  if p_start_date is null or not pg_catalog.isfinite(p_start_date)
    or pg_catalog.date_part('year', p_start_date) not between 2000 and 2200 then
    raise exception using errcode = '22023', message = 'LEAGUE_START_DATE_INVALID';
  end if;
  v_start := p_start_date::timestamp at time zone p_timezone;
  if p_end_mode = 'manual' then
    if p_end_date is not null then
      raise exception using errcode = '22023', message = 'LEAGUE_END_DATE_NOT_ALLOWED';
    end if;
    return array[v_start, null];
  end if;
  if p_end_date is null or not pg_catalog.isfinite(p_end_date)
    or pg_catalog.date_part('year', p_end_date) not between 2000 and 2200 then
    raise exception using errcode = '22023', message = 'LEAGUE_END_DATE_REQUIRED';
  end if;
  if p_end_date <= p_start_date then
    raise exception using errcode = '22023', message = 'LEAGUE_END_NOT_AFTER_START';
  end if;
  -- The end date is inclusive: the League runs through the last microsecond of that local day.
  v_end := ((p_end_date + 1)::timestamp at time zone p_timezone) - interval '1 microsecond';
  return array[v_start, v_end];
end $$;

create function public.league_valid_text(p_value text, p_max integer) returns boolean
language sql immutable set search_path = '' as $$
  select p_value is not null and pg_catalog.char_length(p_value) between 1 and p_max
    and p_value = pg_catalog.btrim(p_value, E' \t\n\r\f\v');
$$;

-- 4. Commands and readers.
create function public.create_league(
  p_request_id uuid, p_community_id uuid, p_name text, p_end_mode text, p_start_date date,
  p_description text default null, p_end_date date default null, p_minimum_matches integer default 1)
returns jsonb language plpgsql security definer set search_path = '' as $$
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
      end_at, status, minimum_matches_for_final_award, create_request_id, create_input)
    values (p_community_id, v_actor, p_name, p_description, v_timezone, v_instants[1], p_end_mode::public.league_end_mode,
      v_instants[2], 'upcoming', p_minimum_matches, p_request_id, v_input)
    returning * into v_row;
  insert into public.league_events (league_id, community_id, action, actor_id, details)
    values (v_row.id, v_row.community_id, 'created', v_actor, '{}'::jsonb);
  -- Reconcile expired Leagues and settle the new League's activation in the same transaction.
  perform public.league_process_community_locked(p_community_id, v_now);
  select * into v_row from public.leagues l where l.id = v_row.id;
  return public.league_dto(v_row);
end $$;

create function public.list_leagues(p_community_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
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
        order by 3, 4 desc nulls last, 5, 2 limit 200) r), '[]'::jsonb));
end $$;

create function public.get_league(p_league_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_row public.leagues;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_row from public.leagues l where l.id = p_league_id;
  -- Unknown and unreadable Leagues fail identically.
  if not found or not public.is_community_member(v_row.community_id) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  return pg_catalog.jsonb_build_object('community', public.league_community_dto(v_row.community_id),
    'league', public.league_dto(v_row));
end $$;

-- Shared prologue of the owner/Admin commands: authenticates, locks community then League,
-- reconciles lifecycle, rechecks permission under the lock and verifies the expected version.
create function public.league_lock_for_command(p_league_id uuid, p_expected_version integer)
returns public.leagues language plpgsql security definer set search_path = '' as $$
declare v_community uuid; v_row public.leagues; v_now timestamptz := pg_catalog.clock_timestamp();
begin
  if p_league_id is null or p_expected_version is null or p_expected_version < 1 then
    raise exception using errcode = '22023', message = 'LEAGUE_INVALID_INPUT';
  end if;
  select l.community_id into v_community from public.leagues l where l.id = p_league_id;
  if not found or not public.is_community_member(v_community) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_community for update;
  select * into v_row from public.leagues l where l.id = p_league_id for update;
  if not public.is_community_member(v_community)
    or not public.league_actor_can_manage(v_community, v_row.owner_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  -- The caller's version is compared with what the caller saw, before reconciliation moves it.
  if v_row.version <> p_expected_version then
    raise exception using errcode = 'P0001', message = 'LEAGUE_VERSION_CONFLICT';
  end if;
  perform public.league_process_community_locked(v_community, v_now);
  select * into v_row from public.leagues l where l.id = p_league_id;
  return v_row;
end $$;

create function public.update_league(p_league_id uuid, p_expected_version integer, p_changes jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.leagues;
  v_key text;
  v_name text;
  v_description text;
  v_minimum integer;
  v_mode text;
  v_start_date date;
  v_end_date date;
  v_instants timestamptz[];
  v_period_changed boolean := false;
  v_changed text[] := '{}';
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  if p_changes is null or pg_catalog.jsonb_typeof(p_changes) <> 'object' or p_changes = '{}'::jsonb then
    raise exception using errcode = '22023', message = 'LEAGUE_CHANGES_INVALID';
  end if;
  for v_key in select pg_catalog.jsonb_object_keys(p_changes) loop
    if v_key not in ('name', 'description', 'minimum_matches_for_final_award', 'end_mode', 'start_date', 'end_date') then
      raise exception using errcode = '22023', message = 'LEAGUE_CHANGES_INVALID';
    end if;
  end loop;
  v_row := public.league_lock_for_command(p_league_id, p_expected_version);
  if v_row.status = 'closed' then
    raise exception using errcode = '55000', message = 'LEAGUE_INVALID_STATE';
  end if;

  begin
    v_name := case when p_changes ? 'name' then p_changes ->> 'name' else v_row.name end;
    v_description := case when p_changes ? 'description' then p_changes ->> 'description' else v_row.description end;
    v_minimum := case when p_changes ? 'minimum_matches_for_final_award'
      then (p_changes ->> 'minimum_matches_for_final_award')::integer else v_row.minimum_matches_for_final_award end;
    v_mode := case when p_changes ? 'end_mode' then p_changes ->> 'end_mode' else v_row.end_mode::text end;
    v_start_date := case when p_changes ? 'start_date' then (p_changes ->> 'start_date')::date
      else (v_row.start_at at time zone v_row.timezone)::date end;
    v_end_date := case when p_changes ? 'end_date' then (p_changes ->> 'end_date')::date
      when v_mode = 'manual' then null else (v_row.end_at at time zone v_row.timezone)::date end;
  exception when others then
    raise exception using errcode = '22023', message = 'LEAGUE_CHANGES_INVALID';
  end;
  if (p_changes ? 'name' and pg_catalog.jsonb_typeof(p_changes -> 'name') <> 'string')
    or (p_changes ? 'description' and pg_catalog.jsonb_typeof(p_changes -> 'description') not in ('string', 'null'))
    or (p_changes ? 'minimum_matches_for_final_award' and pg_catalog.jsonb_typeof(p_changes -> 'minimum_matches_for_final_award') <> 'number') then
    raise exception using errcode = '22023', message = 'LEAGUE_CHANGES_INVALID';
  end if;
  if not public.league_valid_text(v_name, 80) then
    raise exception using errcode = '22023', message = 'LEAGUE_NAME_INVALID';
  end if;
  if v_description is not null and not public.league_valid_text(v_description, 500) then
    raise exception using errcode = '22023', message = 'LEAGUE_DESCRIPTION_INVALID';
  end if;
  if v_minimum is null or v_minimum not between 1 and 100 then
    raise exception using errcode = '22023', message = 'LEAGUE_MINIMUM_INVALID';
  end if;

  if p_changes ?| array['end_mode', 'start_date', 'end_date'] then
    v_instants := public.league_period_instants(v_row.timezone, v_mode, v_start_date, v_end_date);
    if v_instants[1] is distinct from v_row.start_at or v_mode <> v_row.end_mode::text
      or v_instants[2] is distinct from v_row.end_at then
      v_period_changed := true;
      if public.league_has_published_events(v_row.id) then
        raise exception using errcode = '55000', message = 'LEAGUE_PERIOD_LOCKED';
      end if;
      if v_instants[1] is distinct from v_row.start_at then
        if v_row.status <> 'upcoming' then
          raise exception using errcode = '55000', message = 'LEAGUE_START_LOCKED';
        end if;
        if v_start_date < (v_now at time zone v_row.timezone)::date then
          raise exception using errcode = '22023', message = 'LEAGUE_START_IN_PAST';
        end if;
      end if;
      if v_instants[2] is not null and v_instants[2] < v_now then
        raise exception using errcode = '22023', message = 'LEAGUE_END_IN_PAST';
      end if;
    end if;
  end if;

  if v_name is distinct from v_row.name then v_changed := v_changed || 'name'::text; end if;
  if v_description is distinct from v_row.description then v_changed := v_changed || 'description'::text; end if;
  if v_minimum is distinct from v_row.minimum_matches_for_final_award then
    v_changed := v_changed || 'minimum_matches_for_final_award'::text;
  end if;
  if v_period_changed then v_changed := v_changed || 'period'::text; end if;
  if pg_catalog.cardinality(v_changed) = 0 then
    return public.league_dto(v_row);
  end if;

  update public.leagues set name = v_name, description = v_description,
      minimum_matches_for_final_award = v_minimum,
      start_at = case when v_period_changed then v_instants[1] else start_at end,
      end_mode = case when v_period_changed then v_mode::public.league_end_mode else end_mode end,
      end_at = case when v_period_changed then v_instants[2] else end_at end,
      version = version + 1
    where id = v_row.id returning * into v_row;
  insert into public.league_events (league_id, community_id, action, actor_id, details)
    values (v_row.id, v_row.community_id, 'updated', v_actor, pg_catalog.jsonb_build_object('changed', v_changed));
  return public.league_dto(v_row);
end $$;

create function public.activate_league(p_league_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.leagues;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  v_row := public.league_lock_for_command(p_league_id, p_expected_version);
  -- Reconciliation inside this very call already started the League (a due Upcoming League the
  -- scheduler had not reached yet): the requested outcome holds, so answer idempotently.
  if v_row.status = 'active' and v_row.version = p_expected_version + 1 then
    return public.league_dto(v_row);
  end if;
  if v_row.status <> 'upcoming' then
    raise exception using errcode = '55000', message = 'LEAGUE_INVALID_STATE';
  end if;
  if v_row.start_at > v_now then
    raise exception using errcode = '55000', message = 'LEAGUE_NOT_DUE';
  end if;
  if exists (select 1 from public.leagues a where a.community_id = v_row.community_id and a.status = 'active') then
    raise exception using errcode = '55000', message = 'LEAGUE_ACTIVE_EXISTS';
  end if;
  update public.leagues set status = 'active', activated_at = v_now, activation_blocked_at = null,
      version = version + 1 where id = v_row.id returning * into v_row;
  insert into public.league_events (league_id, community_id, action, actor_id, details)
    values (v_row.id, v_row.community_id, 'activated', v_actor, '{}'::jsonb);
  return public.league_dto(v_row);
end $$;

create function public.close_league(p_league_id uuid, p_expected_version integer)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := (select auth.uid());
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_row public.leagues;
begin
  if v_actor is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  v_row := public.league_lock_for_command(p_league_id, p_expected_version);
  if v_row.status <> 'active' then
    raise exception using errcode = '55000', message = 'LEAGUE_INVALID_STATE';
  end if;
  -- A Fixed League ends by its own end date; closing it early would be a covert date edit.
  if v_row.end_mode <> 'manual' then
    raise exception using errcode = '55000', message = 'LEAGUE_CLOSE_NOT_MANUAL';
  end if;
  update public.leagues set status = 'closed', closed_at = v_now, closed_by = v_actor,
      closed_reason = 'manual', version = version + 1 where id = v_row.id returning * into v_row;
  insert into public.league_events (league_id, community_id, action, actor_id, details)
    values (v_row.id, v_row.community_id, 'closed', v_actor,
      pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_now)));
  return public.league_dto(v_row);
end $$;

-- 5. Grants.
revoke all on function
  public.league_utc_text(timestamptz), public.league_has_published_events(uuid),
  public.league_actor_can_manage(uuid, uuid), public.league_community_dto(uuid),
  public.league_dto(public.leagues), public.league_process_community_locked(uuid, timestamptz),
  public.process_due_leagues(integer, timestamptz), public.league_period_instants(text, text, date, date),
  public.league_valid_text(text, integer), public.league_lock_for_command(uuid, integer),
  public.create_league(uuid, uuid, text, text, date, text, date, integer),
  public.list_leagues(uuid), public.get_league(uuid),
  public.update_league(uuid, integer, jsonb), public.activate_league(uuid, integer),
  public.close_league(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function
  public.create_league(uuid, uuid, text, text, date, text, date, integer),
  public.list_leagues(uuid), public.get_league(uuid),
  public.update_league(uuid, integer, jsonb), public.activate_league(uuid, integer),
  public.close_league(uuid, integer)
  to authenticated;

-- 6. Scheduler (guarded like the registration cutoff job: the migration succeeds without
-- pg_cron and the processor stays callable for controlled operation).
do $scheduler$
begin
  if not exists (select 1 from pg_catalog.pg_available_extensions where name = 'pg_cron') then
    raise notice 'PAF-11 scheduler: pg_cron is not available in this environment; the League lifecycle job was NOT provisioned. Due transitions stay internal/manual until an approved scheduler is available.';
    return;
  end if;
  begin
    execute 'create extension if not exists pg_cron';
  exception when others then
    raise notice 'PAF-11 scheduler: pg_cron could not be created (%); the League lifecycle job was NOT provisioned.', sqlerrm;
    return;
  end;
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'PAF-11 scheduler: pg_cron is not installed; the League lifecycle job was NOT provisioned.';
    return;
  end if;
  begin
    perform cron.schedule('padel-friend-league-lifecycle', '* * * * *', 'select public.process_due_leagues(25)');
    raise notice 'PAF-11 scheduler: League lifecycle job scheduled every minute (singleton job name padel-friend-league-lifecycle).';
  exception when others then
    raise notice 'PAF-11 scheduler: the pg_cron job could not be scheduled (%); the League lifecycle job was NOT provisioned.', sqlerrm;
  end;
end
$scheduler$;

commit;
