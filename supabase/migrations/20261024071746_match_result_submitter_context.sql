-- Preserve the authorized proposal reader; enrich provenance without exposing
-- identities through the public roster or changing submission/confirmation.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.get_match_event_result_proposals(uuid)'::regprocedure);
  if position('''submitted_by_name''' in definition) = 0 then
    if position('''submitted_at'',p.submitted_at' in definition) = 0 then
      raise exception 'Unexpected result reader definition';
    end if;
    definition := replace(definition, '''submitted_at'',p.submitted_at',
      '''submitted_by'',p.submitted_by,''submitted_by_name'',(select display_name from public.player_profiles where user_id=p.submitted_by),''submitted_at'',p.submitted_at');
    execute definition;
  end if;
end $$;
