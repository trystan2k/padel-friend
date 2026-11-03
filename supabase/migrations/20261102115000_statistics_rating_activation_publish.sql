begin;

-- Activation owns the global rating lock and may advance the committed rating revision.
-- Publish rating-derived statistics before refreshing ranks, under rating -> statistics order.
do $patch$
declare
  v_definition text := pg_catalog.pg_get_functiondef('public.activate_global_rating_projection()'::regprocedure);
  v_needle constant text := 'perform public.statistics_rank_refresh();';
begin
  if pg_catalog.strpos(v_definition, v_needle) = 0 then
    raise exception 'Unexpected rating activation definition: missing rank refresh';
  end if;
  execute pg_catalog.replace(v_definition, v_needle,
    E'perform public.statistics_publish();\n  perform public.statistics_rank_refresh();');
end $patch$;

-- Repair databases which activated/replayed ratings before this hook existed.
select public.lock_global_rating_projection();
select public.statistics_publish();

commit;
