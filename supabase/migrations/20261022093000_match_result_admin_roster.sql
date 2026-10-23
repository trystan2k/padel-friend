-- Result recording needs explicit player identities for creator and community admin.
-- Preserve the existing safe projection and all cancellation/reconfirmation filters.
do $$
declare d text;
begin
  d := pg_get_functiondef('public.list_match_event_management_participants(uuid)'::regprocedure);
  if position('and e.created_by=auth.uid() and' in d) = 0 then
    raise exception 'Management roster authorization seam missing';
  end if;
  d := replace(d, 'and e.created_by=auth.uid() and',
    'and (e.created_by=auth.uid() or public.is_community_admin(e.community_id)) and');
  execute d;
end $$;
