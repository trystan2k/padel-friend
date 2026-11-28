begin;

-- PAF-199 closer: match_event_result_proposals.submitted_by carries the re-keyed (stable tombstone) identity of an
-- erased submitter. The app reads proposals only through the get_match_event_result_proposals definer RPC, so the
-- Data API keeps every column except the identity column.
do $grants$
declare v_cols text;
begin
  select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum) into v_cols
    from pg_catalog.pg_attribute a
    where a.attrelid = 'public.match_event_result_proposals'::regclass and a.attnum > 0 and not a.attisdropped
      and a.attname <> 'submitted_by';
  if v_cols is null or pg_catalog.strpos(v_cols, 'submitted_by') > 0 then
    raise exception 'Cannot narrow proposal grants: unexpected column list [%]', v_cols;
  end if;
  revoke select on public.match_event_result_proposals from anon, authenticated;
  execute pg_catalog.format('grant select (%s) on public.match_event_result_proposals to authenticated', v_cols);
end $grants$;

commit;
