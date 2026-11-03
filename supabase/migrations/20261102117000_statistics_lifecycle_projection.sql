begin;

-- Entry keys use the same UUID and timestamp as history's public keyset cursor.
create table public.statistics_participant_lifecycle (
  user_id uuid not null references auth.users(id) on delete cascade,
  stable_id uuid not null,
  sort_at timestamptz not null,
  event_id uuid not null references public.match_events(id) on delete cascade,
  community_id uuid not null references public.communities(id) on delete cascade,
  lifecycle_status text not null check (lifecycle_status in ('pending', 'disputed', 'awaiting_result', 'canceled', 'reserve_not_playing')),
  entry_kind text not null check (entry_kind in ('group', 'event')),
  group_number bigint,
  played_at timestamptz,
  viewer_side text,
  match_type text not null,
  league_id uuid,
  primary key (user_id, stable_id)
);
create index statistics_participant_lifecycle_user_sort on public.statistics_participant_lifecycle (user_id, sort_at desc, stable_id desc);
create index statistics_participant_lifecycle_event on public.statistics_participant_lifecycle (event_id);
create table public.statistics_lifecycle_dirty (
  id bigint generated always as identity primary key,
  event_id uuid not null
);
alter table public.statistics_participant_lifecycle enable row level security;
alter table public.statistics_lifecycle_dirty enable row level security;
revoke all on public.statistics_participant_lifecycle, public.statistics_lifecycle_dirty from public, anon, authenticated, service_role;

-- Called under statistics_lock. Future event-level entries are retained and gated by the reader's
-- clock, so a scheduled event becomes visible without a time-driven maintenance job.
create function public.statistics_lifecycle_refresh_event(p_event_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.statistics_participant_lifecycle l where l.event_id = p_event_id;
  insert into public.statistics_participant_lifecycle
    (user_id, stable_id, sort_at, event_id, community_id, lifecycle_status, entry_kind, group_number, played_at, viewer_side, match_type, league_id)
  select r.user_id, p.id, e.starts_at, e.id, e.community_id, p.status, 'group', p.group_number,
    v.played_at_utc, case when v.teams -> 'team_a' ? r.user_id::text then 'team_a' else 'team_b' end,
    e.event_type::text, e.league_id
    from public.match_events e
    join public.match_event_registrations r on r.match_event_id = e.id and r.lifecycle = 'accepted'
    join public.match_event_result_proposals p on p.match_event_id = e.id and p.status in ('pending', 'disputed')
    join public.match_event_result_proposal_versions v on v.proposal_id = p.id and v.version = p.active_version
   where e.id = p_event_id and ((v.teams -> 'team_a') ? r.user_id::text or (v.teams -> 'team_b') ? r.user_id::text)
  union all
  select r.user_id, e.id, e.starts_at, e.id, e.community_id, 'awaiting_result', 'event', ro.grp,
    null::timestamptz, null::text, e.event_type::text, e.league_id
    from public.match_events e
    join public.match_event_registrations r on r.match_event_id = e.id and r.lifecycle = 'accepted'
    cross join lateral (
      select (count(*) - 1) / 4 + 1 as grp from public.match_event_registrations rr
       where rr.match_event_id = e.id and rr.lifecycle = 'accepted' and rr.cancelled_at is null
         and rr.participation_status = 'playing' and (rr.accepted_order, rr.id) <= (r.accepted_order, r.id)
    ) ro
   where e.id = p_event_id and e.status = 'open' and r.cancelled_at is null and r.participation_status = 'playing'
     and not exists (select 1 from public.match_event_result_proposals p where p.match_event_id = e.id and p.group_number = ro.grp)
  union all
  select r.user_id, e.id, e.starts_at, e.id, e.community_id,
    case when e.status = 'cancelled' then 'canceled' else 'reserve_not_playing' end, 'event', null::bigint,
    null::timestamptz, null::text, e.event_type::text, e.league_id
    from public.match_events e
    join public.match_event_registrations r on r.match_event_id = e.id and r.lifecycle = 'accepted'
   where e.id = p_event_id and (e.status = 'cancelled' or (e.status = 'open' and r.participation_status = 'reserve_not_playing' and r.cancelled_at is null));
end $$;

-- Mark only: no rating, result or event locks are acquired by these triggers.
create function public.statistics_lifecycle_mark() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_table_name = 'match_events' then
    insert into public.statistics_lifecycle_dirty(event_id) values (case when tg_op = 'DELETE' then old.id else new.id end);
  else
    insert into public.statistics_lifecycle_dirty(event_id) values (case when tg_op = 'DELETE' then old.match_event_id else new.match_event_id end);
    if tg_op = 'UPDATE' and old.match_event_id is distinct from new.match_event_id then
      insert into public.statistics_lifecycle_dirty(event_id) values (old.match_event_id);
    end if;
  end if;
  return null;
end $$;
create trigger statistics_lifecycle_event_mark after insert or update or delete on public.match_events for each row execute function public.statistics_lifecycle_mark();
create trigger statistics_lifecycle_registration_mark after insert or update or delete on public.match_event_registrations for each row execute function public.statistics_lifecycle_mark();
create trigger statistics_lifecycle_proposal_mark after insert or update or delete on public.match_event_result_proposals for each row execute function public.statistics_lifecycle_mark();

create function public.statistics_lifecycle_drain() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_ids bigint[]; v_events uuid[]; v_event uuid;
begin
  if not exists (select 1 from public.statistics_lifecycle_dirty) then return null; end if;
  perform public.statistics_lock();
  select coalesce(pg_catalog.array_agg(d.id), '{}'::bigint[]), coalesce(pg_catalog.array_agg(distinct d.event_id), '{}'::uuid[])
    into v_ids, v_events from public.statistics_lifecycle_dirty d;
  for v_event in select e from pg_catalog.unnest(v_events) e order by e loop
    perform public.statistics_lifecycle_refresh_event(v_event);
  end loop;
  delete from public.statistics_lifecycle_dirty d where d.id = any(v_ids);
  return null;
end $$;
create constraint trigger statistics_lifecycle_dirty_drain after insert on public.statistics_lifecycle_dirty
  deferrable initially deferred for each row execute function public.statistics_lifecycle_drain();

create function public.statistics_lifecycle_rebuild(p_community_id uuid default null) returns void
language plpgsql security definer set search_path = '' as $$
declare v_event uuid;
begin
  perform public.statistics_lock();
  delete from public.statistics_participant_lifecycle l where p_community_id is null or l.community_id = p_community_id;
  for v_event in select e.id from public.match_events e where p_community_id is null or e.community_id = p_community_id order by e.id loop
    perform public.statistics_lifecycle_refresh_event(v_event);
  end loop;
end $$;
revoke all on function public.statistics_lifecycle_refresh_event(uuid), public.statistics_lifecycle_mark(), public.statistics_lifecycle_drain(), public.statistics_lifecycle_rebuild(uuid) from public, anon, authenticated, service_role;

do $patch$
declare v_definition text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.rebuild_statistics(uuid)'::regprocedure);
  if pg_catalog.strpos(v_definition, 'perform public.statistics_rank_rebuild(p_community_id);') = 0 then
    raise exception 'Unexpected rebuild_statistics definition';
  end if;
  execute pg_catalog.replace(v_definition, 'perform public.statistics_rank_rebuild(p_community_id);', E'perform public.statistics_rank_rebuild(p_community_id);\n  perform public.statistics_lifecycle_rebuild(p_community_id);');
end $patch$;
select public.statistics_lifecycle_rebuild(null);
commit;
