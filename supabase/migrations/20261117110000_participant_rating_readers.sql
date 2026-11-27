begin;

-- PAF-231: retained rating history keeps every player slot after an account is erased.
-- A withdrawn identity has no profile, so the two readers that rebuilt a group from profiles would
-- drop the slot (and then hide the whole group: count <> 4). They now keep the slot with a null
-- display name; the client renders the generic localized "former player" placeholder.
do $patch$
declare
  v_oid oid; v_def text; v_new text; v_name text;
begin
  foreach v_name in array array['get_match_event_rating_changes', 'get_rating_group_explanation'] loop
    select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = v_name;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_new := pg_catalog.replace(v_def, 'join public.player_profiles p on p.user_id', 'left join public.player_profiles p on p.user_id');
    v_new := pg_catalog.replace(v_new, E'''is_provisional'', p.is_provisional,', E'''is_provisional'', coalesce(p.is_provisional, false),');
    if v_new = v_def then raise exception 'Cannot patch %', v_name; end if;
    execute v_new;
  end loop;
end $patch$;

commit;
