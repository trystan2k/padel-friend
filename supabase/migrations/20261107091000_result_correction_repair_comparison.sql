begin;

-- Correction-aware compare-and-publish for the closed-League repair.
--
-- A correction that leaves the standings' sporting content unchanged appends no snapshot, so the
-- latest final keeps the confirmation identity of the replaced fact while the canonical official
-- state points at the new confirmation. Comparing confirmation-ID sets alone would then publish a
-- spurious `repair` version for identical content. The repair therefore compares the canonical
-- content fingerprint (event + group identity, classification, teams, sets, played time) and appends
-- a version only when the included evidence genuinely differs. Provenance of a published repair is
-- unchanged: it still records the exact added/removed confirmation identities.
--
-- Only league_publish_repair_if_needed is redefined; it keeps its signature, caller contract
-- (community and League locks held) and grants. The other functions of the closed-rebuild repair
-- migration are untouched. Rerunnable: create or replace.
create or replace function public.league_publish_repair_if_needed(p_league_id uuid) returns integer
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
  if v_latest.standings_version is not null
    and public.league_snapshot_content_fingerprint(v_latest.included_confirmation_ids)
      = public.league_snapshot_content_fingerprint(v_eligible) then
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

revoke all on function public.league_publish_repair_if_needed(uuid)
  from public, anon, authenticated, service_role;

commit;
