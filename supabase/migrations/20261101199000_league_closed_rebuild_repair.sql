begin;

-- PAF-12 / U1+U3 review fix: a rebuild of a CLOSED League must not leave its latest final stale.
--
-- Before this migration rebuild_league_counters() refreshed counters and receipts only. A closed
-- League rebuilt after a trusted retroactive change kept a final that no longer matched the
-- canonical evidence, and the later finalizer replay exited on the existing receipt without ever
-- publishing a revision.
--
-- Design (consistent with league_repair_closed_standings' once-only semantics):
--   * league_rebuild_counters_core() is the former counters+receipts rebuild, unchanged. The
--     finalizer hook keeps calling it, because a first confirmation into a closed League must keep
--     its truthful `late_first_confirmation` version rather than a generic repair.
--   * league_publish_repair_if_needed() holds the compare-and-publish half of the repair: it
--     appends a `repair` version only when the latest final's included confirmations differ from
--     the eligible evidence, so identical input is a no-op.
--   * rebuild_league_counters() (the internal repair entry, also the backfill) runs the core and,
--     for a closed League, the repair check. An open League is unchanged and never gets a version.
--   * league_repair_closed_standings() keeps its signature and result.

alter function public.rebuild_league_counters(uuid) rename to league_rebuild_counters_core;

-- Caller holds the community lock and the League row lock.
create function public.league_publish_repair_if_needed(p_league_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
  v_latest public.league_standings_snapshots;
  v_eligible uuid[];
  v_version integer;
begin
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found or v_league.status <> 'closed' then return null; end if;

  select * into v_latest from public.league_standings_snapshots s
   where s.league_id = p_league_id order by s.standings_version desc limit 1;
  select coalesce(pg_catalog.array_agg(g.confirmation_id order by g.confirmation_id), '{}'::uuid[])
    into v_eligible from public.league_confirmed_groups(p_league_id) g where g.eligible;
  if v_latest.standings_version is not null and v_latest.included_confirmation_ids = v_eligible then
    return null;
  end if;

  v_version := public.league_publish_standings(p_league_id, 'repair', null, null, 'published');
  insert into public.league_events(league_id, community_id, action, system_reason, details)
    values (p_league_id, v_league.community_id, 'standings_revised', 'standings_repair',
      pg_catalog.jsonb_build_object(
        'old_standings_version', v_latest.standings_version,
        'standings_version', v_version,
        'added_confirmations', (select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb)
          from pg_catalog.unnest(v_eligible) x
          where v_latest.included_confirmation_ids is null or x <> all (v_latest.included_confirmation_ids)),
        'removed_confirmations', (select coalesce(pg_catalog.jsonb_agg(x order by x), '[]'::jsonb)
          from pg_catalog.unnest(coalesce(v_latest.included_confirmation_ids, '{}'::uuid[])) x
          where x <> all (v_eligible))));
  return v_version;
end $$;

create function public.rebuild_league_counters(p_league_id uuid) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result jsonb;
  v_version integer;
begin
  v_result := public.league_rebuild_counters_core(p_league_id);
  -- The core holds community -> League locks until commit; a closed League's final follows.
  v_version := public.league_publish_repair_if_needed(p_league_id);
  return v_result || pg_catalog.jsonb_build_object('repaired_standings_version', v_version);
end $$;

create or replace function public.league_repair_closed_standings(p_league_id uuid) returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_community uuid;
  v_league public.leagues;
begin
  select l.community_id into v_community from public.leagues l where l.id = p_league_id;
  if v_community is null then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  perform 1 from public.communities c where c.id = v_community for update;
  select * into v_league from public.leagues l where l.id = p_league_id for no key update;
  if v_league.status <> 'closed' then return null; end if;
  perform public.league_rebuild_counters_core(p_league_id);
  return public.league_publish_repair_if_needed(p_league_id);
end $$;

-- Finalizer hook: unchanged except it rebuilds through the core, so a first confirmation into a
-- closed League still appends its `late_first_confirmation` version.
create or replace function public.project_league_confirmation(p_confirmation_id uuid) returns boolean
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_confirmation public.match_event_result_confirmations%rowtype;
  v_league_id uuid;
  v_fact public.match_event_result_proposal_versions%rowtype;
begin
  select * into v_confirmation from public.match_event_result_confirmations c where c.id = p_confirmation_id;
  if not found or not v_confirmation.ratable_eligible or v_confirmation.event_type <> 'competitive' then
    return false;
  end if;
  select e.league_id into v_league_id from public.match_events e where e.id = v_confirmation.match_event_id;
  if v_league_id is null then return false; end if;
  if exists (
    select 1 from public.league_projection_confirmations r
     where r.league_id = v_league_id and r.confirmation_id = p_confirmation_id
  ) then return false; end if;

  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = v_confirmation.proposal_id and v.version = v_confirmation.proposal_version;
  if not found or v_fact.classification = 'incomplete'
    or public.match_result_ranked_ineligibility(
      v_confirmation.match_event_id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc) is not null
  then return false; end if;

  perform public.league_rebuild_counters_core(v_league_id);
  if (select l.status from public.leagues l where l.id = v_league_id) = 'closed' then
    perform public.league_publish_late_confirmation(v_league_id, p_confirmation_id);
  end if;
  return true;
end $$;

revoke all on function public.league_rebuild_counters_core(uuid), public.league_publish_repair_if_needed(uuid),
  public.rebuild_league_counters(uuid), public.league_repair_closed_standings(uuid),
  public.project_league_confirmation(uuid)
  from public, anon, authenticated, service_role;

commit;
