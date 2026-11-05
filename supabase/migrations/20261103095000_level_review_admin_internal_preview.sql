begin;

-- Extend only the protected admin reader; owner-facing DTOs remain unchanged.
do $detail$
declare v_definition text; v_updated text;
begin
  v_definition := pg_catalog.pg_get_functiondef('public.get_level_review_admin_detail(uuid)'::regprocedure);
  v_updated := pg_catalog.replace(v_definition,
    '''revision'', v_revision, ''display_level'', (v_summary ->> ''display_level'')::numeric,',
    '''revision'', v_revision, ''mu'', (select r.mu from public.global_player_ratings r where r.user_id = v_row.owner_id), ''display_level'', (v_summary ->> ''display_level'')::numeric,');
  if v_updated = v_definition then
    raise exception 'Unexpected get_level_review_admin_detail definition; refusing to patch it';
  end if;
  execute v_updated;
end $detail$;

revoke all on function public.get_level_review_admin_detail(uuid) from public, anon, authenticated, service_role;
grant execute on function public.get_level_review_admin_detail(uuid) to authenticated;

commit;
