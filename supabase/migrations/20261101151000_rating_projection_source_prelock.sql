begin;

-- PAF-10 review F2: replay and activation insert ledger evidence while holding the app-wide
-- rating lock. The evidence FKs take FOR KEY SHARE on the referenced event, proposal,
-- version, confirmation and profile rows. A live confirmation holds the event/proposal rows
-- FOR UPDATE while it waits for the rating lock, so taking those key-shares AFTER the rating
-- lock is a reverse edge (deadlock). Same cure as claim_provisional_player: take the key
-- shares on every source row the replay will reference BEFORE the rating lock, in
-- deterministic key order. The projector still locks only rating rows while it holds the
-- rating lock.

create function public.rating_projection_prelock_sources() returns void
language plpgsql security definer set search_path = '' as $$
begin
  create temporary table if not exists pg_temp.rating_prelock_groups (
    game_group_id uuid, confirmation_id uuid, match_event_id uuid, proposal_version bigint, teams jsonb
  ) on commit drop;
  truncate pg_temp.rating_prelock_groups;
  insert into pg_temp.rating_prelock_groups
    select g.game_group_id, g.confirmation_id, g.match_event_id, g.proposal_version, g.teams
      from public.rating_projection_eligible_groups() g
     where not exists (select 1 from public.player_rating_events e where e.game_group_id = g.game_group_id);

  perform 1 from public.match_events e
   where e.id in (select t.match_event_id from pg_temp.rating_prelock_groups t) order by e.id for key share;
  perform 1 from public.match_event_result_proposals p
   where p.id in (select t.game_group_id from pg_temp.rating_prelock_groups t) order by p.id for key share;
  perform 1 from public.match_event_result_proposal_versions v
   where (v.proposal_id, v.version) in (select t.game_group_id, t.proposal_version from pg_temp.rating_prelock_groups t)
   order by v.proposal_id, v.version for key share;
  perform 1 from public.match_event_result_confirmations c
   where c.id in (select t.confirmation_id from pg_temp.rating_prelock_groups t) order by c.id for key share;
  perform 1 from public.player_profiles pr
   where pr.user_id in (select m.value::uuid from pg_temp.rating_prelock_groups t,
       pg_catalog.jsonb_array_elements_text((t.teams -> 'team_a') || (t.teams -> 'team_b')) m(value))
   order by pr.user_id for key share;
end $$;
revoke all on function public.rating_projection_prelock_sources() from public, anon, authenticated, service_role;

do $locks$
declare v_definition text; v_updated text;
begin
  -- Projector: prelock only once active (a dormant projector returns after the lock anyway).
  v_definition := pg_catalog.pg_get_functiondef('public.project_confirmed_rating_group(uuid)'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    E'begin\n  perform public.lock_global_rating_projection();',
    E'begin\n  if (select c.activation_enabled from public.player_rating_projection_control c) then\n'
    || E'    perform public.rating_projection_prelock_sources();\n  end if;\n'
    || E'  perform public.lock_global_rating_projection();');
  if v_updated = v_definition then
    raise exception 'Unexpected project_confirmed_rating_group definition; refusing to reorder its locks';
  end if;
  execute v_updated;

  v_definition := pg_catalog.pg_get_functiondef('public.activate_global_rating_projection()'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    E'begin\n  perform public.lock_global_rating_projection();',
    E'begin\n  perform public.rating_projection_prelock_sources();\n  perform public.lock_global_rating_projection();');
  if v_updated = v_definition then
    raise exception 'Unexpected activate_global_rating_projection definition; refusing to reorder its locks';
  end if;
  execute v_updated;
end $locks$;

commit;
