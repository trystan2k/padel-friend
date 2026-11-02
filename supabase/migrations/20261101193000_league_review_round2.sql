begin;

-- PAF-11 review round 2 (F1/D3, F4/D4, F5/D5). Forward-only; 20261101192000 stays untouched.
--   * F1: recover League references that exist only in the edit audit trail (an event switched away
--     before league_event_references existed), so approved decision Q4 holds for them too.
--   * F4: process_due_leagues bounds TOTAL attempts per run and rotates locked/failing
--     communities to the back of the queue so later communities are still reached next run.
--   * F5: list_leagues gains an offset so rows beyond the 200-row page stay reachable.

-- 1. F1 backfill from before/after audit snapshots (top-level and nested competition League ids).
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
  ) as ids(value)
  join public.leagues l on l.id = ids.value
  where a.action in ('minor_edit', 'major_edit')
  group by l.id, a.match_event_id
  on conflict do nothing;

-- 2. F4: rotation state. No FK on purpose: an FK check would block on a community row that a
-- command holds FOR UPDATE, which is exactly the case this table records.
create table public.league_process_attempts (
  community_id uuid primary key,
  attempted_at timestamptz not null
);
alter table public.league_process_attempts enable row level security;
revoke all on public.league_process_attempts from public, anon, authenticated, service_role;

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
  -- F4: p_limit bounds the ATTEMPTS of one run (processed + locked-skipped + failed). Communities
  -- that were skipped or failed are stamped and sort after never-attempted ones, so the next run
  -- continues with the communities this one did not reach.
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
    'failed', v_failed, 'errors', v_errors);
end $$;

-- 3. F5: continuation. The old one-argument signature is replaced (an overload would make
-- list_leagues(p_community_id) ambiguous for PostgREST).
drop function public.list_leagues(uuid);
create function public.list_leagues(p_community_id uuid, p_offset integer default 0) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_offset integer := coalesce(p_offset, 0);
  v_total bigint;
  v_leagues jsonb;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  if p_community_id is null or not public.is_community_member(p_community_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  if v_offset < 0 then
    raise exception using errcode = '22023', message = 'LEAGUE_INVALID_INPUT';
  end if;
  select pg_catalog.count(*) into v_total from public.leagues l where l.community_id = p_community_id;
  select coalesce(pg_catalog.jsonb_agg(public.league_dto(r.l) order by r.rank, r.closed_sort desc nulls last, r.start_sort, r.id), '[]'::jsonb)
    into v_leagues
    from (select l as l, l.id,
        case l.status when 'active' then 0 when 'upcoming' then 1 else 2 end as rank,
        case when l.status = 'closed' then l.closed_at end as closed_sort,
        case when l.status <> 'closed' then l.start_at end as start_sort
      from public.leagues l where l.community_id = p_community_id
      order by 3, 4 desc nulls last, 5, 2 limit 200 offset v_offset) r;
  return pg_catalog.jsonb_build_object(
    'community', public.league_community_dto(p_community_id),
    'leagues', v_leagues,
    'total', v_total,
    -- More rows exist after this page; pass next_offset to continue.
    'truncated', v_offset + pg_catalog.jsonb_array_length(v_leagues) < v_total,
    'next_offset', v_offset + pg_catalog.jsonb_array_length(v_leagues));
end $$;

revoke all on function public.process_due_leagues(integer, timestamptz), public.list_leagues(uuid, integer)
  from public, anon, authenticated, service_role;
grant execute on function public.list_leagues(uuid, integer) to authenticated;

commit;
