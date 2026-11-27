begin;

-- PAF-199 e2e gate fix: the rating projection REPLAY rebuilt every player of the ledger (events, adjustments and the
-- confirmed groups) and demanded a live rating row for each. An erased player keeps its rating history under a
-- withdrawn identity that has no profile and therefore no global_player_ratings row (account-owned, deleted with the
-- profile), so after ANY erasure of a rated player every later replay (an out-of-order result, an amendment, a
-- repair, an activation) failed 'Incomplete player state' for everybody. A withdrawn identity now takes its initial
-- state from its retained initialization; the live-state writer already only updates existing rating rows.
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$    join public.global_player_ratings r on r.user_id = i.user_id and r.initial_display_level = i.initial_level;
  if v_found is distinct from v_expected then$q$;
  v_new text := $q$    left join public.global_player_ratings r on r.user_id = i.user_id and r.initial_display_level = i.initial_level
   where r.user_id is not null
      or exists (select 1 from public.participant_identities w where w.id = i.user_id and w.state = 'withdrawn');
  if v_found is distinct from v_expected then$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'rating_projection_replay';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch rating_projection_replay: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

commit;
