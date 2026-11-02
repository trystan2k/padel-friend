-- PAF-12 review F6: the owner/Admin audit reader publishes an explicit allowlist of safe details
-- (versions, instants, source, provenance, counts) instead of the raw stored event details, which
-- also carry confirmation, proposal, match-event and group identifiers.
create or replace function public.get_league_standings_audit(p_league_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_league public.leagues;
begin
  if (select auth.uid()) is null or coalesce((select auth.jwt() ->> 'is_anonymous'), 'false') = 'true' then
    raise exception using errcode = '28000', message = 'UNAUTHENTICATED';
  end if;
  perform public.assert_actor_not_provisional();
  select * into v_league from public.leagues l where l.id = p_league_id;
  if not found or not public.is_community_member(v_league.community_id) then
    raise exception using errcode = 'P0002', message = 'LEAGUE_NOT_FOUND';
  end if;
  if not public.league_actor_can_manage(v_league.community_id, v_league.owner_id) then
    raise exception using errcode = '42501', message = 'LEAGUE_FORBIDDEN';
  end if;
  return pg_catalog.jsonb_build_object(
    'league_id', v_league.id,
    'events', coalesce((
      select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
        'action', e.action,
        'actor_id', e.actor_id,
        'system_reason', e.system_reason,
        'occurred_at', public.league_utc_text(e.occurred_at),
        'details', pg_catalog.jsonb_strip_nulls(pg_catalog.jsonb_build_object(
          'standings_version', e.details -> 'standings_version',
          'old_standings_version', e.details -> 'old_standings_version',
          'closed_at', e.details -> 'closed_at',
          'source', e.details -> 'source',
          'played_at', e.details -> 'played_at',
          'confirmed_at', e.details -> 'confirmed_at',
          'effective_cutoff', e.details -> 'effective_cutoff',
          'publication_cutoff', e.details -> 'publication_cutoff',
          'provenance', e.details -> 'provenance',
          'added_count', case when pg_catalog.jsonb_typeof(e.details -> 'added_confirmations') = 'array'
            then pg_catalog.jsonb_array_length(e.details -> 'added_confirmations') end,
          'removed_count', case when pg_catalog.jsonb_typeof(e.details -> 'removed_confirmations') = 'array'
            then pg_catalog.jsonb_array_length(e.details -> 'removed_confirmations') end)))
        order by e.occurred_at desc, e.id desc)
      from (select * from public.league_events x
          where x.league_id = p_league_id and x.action in ('closed', 'standings_revised')
          order by x.occurred_at desc, x.id desc limit 100) e), '[]'::jsonb));
end $$;

revoke all on function public.get_league_standings_audit(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_league_standings_audit(uuid) to authenticated;
