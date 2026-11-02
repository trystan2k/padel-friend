begin;

-- PAF-11 review round 3 (E1-E4). Forward-only; earlier migrations stay untouched.
--   * E1: the audit-history backfill guards every uuid cast with CASE WHEN pg_input_is_valid(...),
--     so a malformed snapshot value can never abort it whatever order Postgres evaluates quals in.
--   * E2: list_leagues paginates with a keyset on the immutable (created_at, id) pair instead of an
--     offset over a lifecycle-dependent ordering, so a status change between page requests can
--     neither omit nor duplicate a League.
--   * E3/E4: process_due_leagues serializes invocations with a transaction-level advisory lock and
--     prunes stale rotation rows.

-- 1. E1. Idempotent, re-runnable; returns the number of references added.
create function public.league_backfill_references_from_audit() returns integer
language plpgsql security definer set search_path = '' as $$
declare v_added integer;
begin
  insert into public.league_event_references (league_id, match_event_id, first_referenced_at)
    select l.id, a.match_event_id, pg_catalog.min(a.occurred_at)
    from public.match_event_audit_log a
    cross join lateral (values
      (case when pg_catalog.pg_input_is_valid(a.before_data ->> 'league_id', 'uuid')
        then (a.before_data ->> 'league_id')::uuid end),
      (case when pg_catalog.pg_input_is_valid(a.after_data ->> 'league_id', 'uuid')
        then (a.after_data ->> 'league_id')::uuid end),
      (case when pg_catalog.pg_input_is_valid(a.before_data -> 'competition' ->> 'league_id', 'uuid')
        then (a.before_data -> 'competition' ->> 'league_id')::uuid end),
      (case when pg_catalog.pg_input_is_valid(a.after_data -> 'competition' ->> 'league_id', 'uuid')
        then (a.after_data -> 'competition' ->> 'league_id')::uuid end)
    ) as ids(league_id)
    join public.leagues l on l.id = ids.league_id
    where a.action in ('minor_edit', 'major_edit')
    group by l.id, a.match_event_id
    on conflict do nothing;
  get diagnostics v_added = row_count;
  return v_added;
end $$;
revoke all on function public.league_backfill_references_from_audit()
  from public, anon, authenticated, service_role;
select public.league_backfill_references_from_audit();

-- G5: serves the keyset predicate and ordering of list_leagues (and its per-community count)
-- directly from the index; the Active-first lookup is served by leagues_one_active_per_community.
create index leagues_community_created_keyset on public.leagues (community_id, created_at desc, id desc);

-- 2. E2. The old offset signature is replaced (an overload would make the call ambiguous).
drop function public.list_leagues(uuid, integer);
create function public.list_leagues(
  p_community_id uuid, p_after_created_at timestamptz default null, p_after_id uuid default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_page uuid[];
  v_ids uuid[];
  v_more boolean;
  v_total bigint;
  v_active uuid;
  v_cursor jsonb;
  v_leagues jsonb;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  if p_community_id is null or not public.is_community_member(p_community_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  if (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'LEAGUE_INVALID_INPUT';
  end if;
  select pg_catalog.count(*) into v_total from public.leagues l where l.community_id = p_community_id;
  -- Newest first on immutable keys: one extra row tells whether another page exists.
  select pg_catalog.array_agg(x.id order by x.created_at desc, x.id desc) into v_page
    from (select l.id, l.created_at from public.leagues l
        where l.community_id = p_community_id
          and (p_after_id is null or (l.created_at, l.id) < (p_after_created_at, p_after_id))
        order by l.created_at desc, l.id desc limit 201) x;
  v_page := coalesce(v_page, '{}');
  v_more := pg_catalog.cardinality(v_page) > 200;
  v_ids := v_page[1:200];
  if v_more then
    select pg_catalog.jsonb_build_object('created_at', public.league_utc_text(l.created_at), 'id', l.id)
      into v_cursor from public.leagues l where l.id = v_ids[200];
  end if;
  -- The first page always carries the Active League, however old it is; later pages dedupe by id.
  if p_after_id is null then
    select l.id into v_active from public.leagues l
      where l.community_id = p_community_id and l.status = 'active';
    if v_active is not null and not (v_active = any (v_ids)) then v_ids := v_ids || v_active; end if;
  end if;
  select coalesce(pg_catalog.jsonb_agg(public.league_dto(l) order by l.created_at desc, l.id desc), '[]'::jsonb)
    into v_leagues from public.leagues l where l.id = any (v_ids);
  return pg_catalog.jsonb_build_object(
    'community', public.league_community_dto(p_community_id),
    'leagues', v_leagues,
    'total', v_total,
    'truncated', v_more,
    'next_cursor', v_cursor);
end $$;
revoke all on function public.list_leagues(uuid, timestamptz, uuid) from public, anon, authenticated, service_role;
grant execute on function public.list_leagues(uuid, timestamptz, uuid) to authenticated;

-- 3. E3 + E4.
create or replace function public.process_due_leagues(p_limit integer DEFAULT 25, p_as_of timestamp with time zone DEFAULT NULL::timestamp with time zone)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $$
declare
  v_as_of timestamptz := coalesce(p_as_of, pg_catalog.clock_timestamp());
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_community uuid;
  v_result jsonb;
  v_attempts integer := 0;
  v_processed integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  -- E4: one scheduler invocation at a time. A concurrent run exits cleanly (the next cron tick
  -- retries), so the rotation rows below are never contended. Released at transaction end.
  if not pg_catalog.pg_try_advisory_xact_lock(pg_catalog.hashtextextended('padel-friend:process_due_leagues', 0)) then
    return pg_catalog.jsonb_build_object('processed', 0, 'skipped', 0, 'failed', 0,
      'errors', '[]'::jsonb, 'busy', true);
  end if;
  -- E3/G4: rotation rows only matter while a community still has due work. At most v_limit * 4
  -- stale rows are pruned per invocation (same order of work as the attempt budget), so a large
  -- backlog never turns one run into a long lock-holding transaction; later runs finish it.
  delete from public.league_process_attempts
    where community_id in (
      select p.community_id from public.league_process_attempts p
      where not exists (select 1 from public.communities c where c.id = p.community_id)
        or not exists (select 1 from public.leagues l where l.community_id = p.community_id
          and ((l.status = 'active' and l.end_mode = 'fixed_date' and l.end_at < v_as_of)
            or (l.status = 'upcoming' and ((l.end_mode = 'fixed_date' and l.end_at < v_as_of)
              or (l.start_at <= v_as_of and l.activation_blocked_at is null)))))
      order by p.attempted_at
      limit v_limit * 4);
  for v_community in
    select l.community_id from public.leagues l
    left join public.league_process_attempts p on p.community_id = l.community_id
    where (l.status = 'active' and l.end_mode = 'fixed_date' and l.end_at < v_as_of)
      or (l.status = 'upcoming' and ((l.end_mode = 'fixed_date' and l.end_at < v_as_of)
        or (l.start_at <= v_as_of and l.activation_blocked_at is null)))
    group by l.community_id, p.attempted_at
    order by p.attempted_at nulls first, pg_catalog.min(l.start_at), l.community_id
  loop
    exit when v_attempts >= v_limit;
    v_attempts := v_attempts + 1;
    begin
      perform 1 from public.communities c where c.id = v_community for update skip locked;
      if not found then
        v_skipped := v_skipped + 1;
        insert into public.league_process_attempts (community_id, attempted_at)
          values (v_community, pg_catalog.clock_timestamp())
          on conflict (community_id) do update set attempted_at = excluded.attempted_at;
      else
        v_result := public.league_process_community_locked(v_community, v_as_of);
        v_processed := v_processed + 1;
        delete from public.league_process_attempts where community_id = v_community;
      end if;
    exception when others then
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object('community_id', v_community, 'sqlstate', SQLSTATE, 'message', SQLERRM);
      raise warning 'process_due_leagues failed for community %: % (%)', v_community, SQLERRM, SQLSTATE;
      insert into public.league_process_attempts (community_id, attempted_at)
        values (v_community, pg_catalog.clock_timestamp())
        on conflict (community_id) do update set attempted_at = excluded.attempted_at;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('processed', v_processed, 'skipped', v_skipped,
    'failed', v_failed, 'errors', v_errors, 'busy', false);
end $$;

commit;
