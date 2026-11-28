begin;

-- PAF-199 PR review fixes (F54-F57).
--   F54  retained jsonb that COPIED a display name (published standings, roster snapshots, audit payloads) is redacted
--        for the erased subject together with the uuid re-key
--   F55  the rating initialization survives an erasure whenever retained admin adjustments (or events) need it
--   F56  a counter rebuild may update an existing counter row of a withdrawn identity (and never inserts a new one)
--   F57  history/audit tables that expose re-keyed (tombstone) identity columns are no longer readable via the Data API

-- F54 -------------------------------------------------------------------------------------------------------------
-- Names of the subject inside a retained document. An object is "the subject's" when any of its string values is the
-- subject id (user_id / actor_id / id ...) or when it sits under a key that is the subject id; its identifying
-- fields become JSON null (the key stays, so decoders keep their shape and render the localized placeholder).
-- Everything else is returned unchanged, so other participants' entries stay identical.
create function privacy_internal.erasure_redact_names(p_doc jsonb, p_subject uuid, p_force boolean default false)
returns jsonb language plpgsql immutable set search_path = '' as $$
declare v_out jsonb; v_key text; v_val jsonb; v_hit boolean;
begin
  if p_doc is null then return null; end if;
  if pg_catalog.jsonb_typeof(p_doc) = 'array' then
    return coalesce((select pg_catalog.jsonb_agg(privacy_internal.erasure_redact_names(e.value, p_subject, false) order by e.ord)
      from pg_catalog.jsonb_array_elements(p_doc) with ordinality as e(value, ord)), '[]'::jsonb);
  elsif pg_catalog.jsonb_typeof(p_doc) = 'object' then
    v_out := p_doc;
    v_hit := p_force or exists (select 1 from pg_catalog.jsonb_each(p_doc) kv
      where pg_catalog.jsonb_typeof(kv.value) = 'string' and (kv.value #>> '{}') = p_subject::text);
    for v_key, v_val in select kv.key, kv.value from pg_catalog.jsonb_each(p_doc) kv loop
      if v_hit and v_key in ('display_name', 'displayName', 'avatar_url', 'avatarUrl', 'email')
          and pg_catalog.jsonb_typeof(v_val) <> 'null' then
        v_out := pg_catalog.jsonb_set(v_out, array[v_key], 'null'::jsonb);
      elsif pg_catalog.jsonb_typeof(v_val) in ('object', 'array') then
        v_out := pg_catalog.jsonb_set(v_out, array[v_key],
          privacy_internal.erasure_redact_names(v_val, p_subject, v_key = p_subject::text));
      end if;
    end loop;
    return v_out;
  end if;
  return p_doc;
end $$;
revoke all on function privacy_internal.erasure_redact_names(jsonb, uuid, boolean) from public, anon, authenticated, service_role;

-- Backfill for erasures that already happened: the entries now carry the withdrawn identity as user_id.
do $backfill$
declare r record; v_id uuid;
begin
  insert into privacy_internal.erasure_windows (txid) values (pg_catalog.txid_current());
  for r in select d.table_name, d.column_name from privacy_internal.erasure_dispositions d
      where d.disposition = 'jsonb_rekey' order by d.table_name, d.column_name loop
    for v_id in select i.id from public.participant_identities i where i.state = 'withdrawn' loop
      execute pg_catalog.format(
        'update public.%I set %I = privacy_internal.erasure_redact_names(%I, $1) where pg_catalog.strpos(%I::text, $2) > 0 '
          || 'and %I is distinct from privacy_internal.erasure_redact_names(%I, $1)',
        r.table_name, r.column_name, r.column_name, r.column_name, r.column_name, r.column_name) using v_id, v_id::text;
    end loop;
  end loop;
  delete from privacy_internal.erasure_windows where txid = pg_catalog.txid_current();
end $backfill$;

-- F54 + F55 + F56 patches (each asserts its exact occurrence count) -------------------------------------------------
do $patch$
declare
  r record; v_oid oid; v_def text; v_count integer; v_ns regnamespace;
begin
  for r in select * from (values
    ('privacy_internal', 'account_erasure_execute',
      $q$execute pg_catalog.format('update public.%I set %I = pg_catalog.replace(%I::text, $2, $3)::jsonb where %s',$q$,
      $q$execute pg_catalog.format('update public.%I set %I = pg_catalog.replace(privacy_internal.erasure_redact_names(%I, $1)::text, $2, $3)::jsonb where %s',$q$, 1),
    ('privacy_internal', 'account_erasure_execute',
      $q$  if not exists (select 1 from public.player_rating_events e where e.user_id = p_subject) then$q$,
      $q$  -- Retained admin adjustments need the initialization too (the replay rebuilds their owner from it).
  if not exists (select 1 from public.player_rating_events e where e.user_id = p_subject)
      and not exists (select 1 from public.player_rating_admin_adjustments x where x.user_id = p_subject) then$q$, 1),
    ('public', 'guard_live_participant_reference',
      $q$    if v_new is not null and v_new is distinct from v_old
        and exists (select 1 from public.participant_identities i where i.id = v_new::uuid and i.state = 'withdrawn') then$q$,
      $q$    if v_new is not null and v_new is distinct from v_old
        and exists (select 1 from public.participant_identities i where i.id = v_new::uuid and i.state = 'withdrawn')
        -- The upsert of an EXISTING counter row (a trusted rebuild updating historical facts) is no new participation.
        and not (tg_op = 'INSERT' and tg_table_name = 'league_player_counters'
          and exists (select 1 from public.league_player_counters x
            where x.league_id = (pg_catalog.to_jsonb(new) ->> 'league_id')::uuid and x.user_id = v_new::uuid)) then$q$, 1),
    ('public', 'league_rebuild_counters_core',
      $q$      from public.league_counter_rows(p_league_id) t
  on conflict (league_id, user_id) do update$q$,
      $q$      from public.league_counter_rows(p_league_id) t
     -- A withdrawn identity never gets a FRESH counter row (no resurrected participation); an existing row is updated.
     where not exists (select 1 from public.participant_identities w where w.id = t.user_id and w.state = 'withdrawn')
        or exists (select 1 from public.league_player_counters x where x.league_id = p_league_id and x.user_id = t.user_id)
  on conflict (league_id, user_id) do update$q$, 1)
  ) as t(ns, fn, old_text, new_text, expected) loop
    v_ns := r.ns::regnamespace;
    select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = v_ns and p.proname = r.fn;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, r.old_text, ''))) / pg_catalog.length(r.old_text);
    if v_count <> r.expected then
      raise exception 'Cannot patch %: expected % occurrence(s), found % of [%]', r.fn, r.expected, v_count, pg_catalog.left(r.old_text, 60);
    end if;
    execute pg_catalog.replace(v_def, r.old_text, r.new_text);
  end loop;
end $patch$;

-- F57 -------------------------------------------------------------------------------------------------------------
-- History tables whose re-keyed identity columns carry the STABLE tombstone id: the Data API no longer exposes those
-- columns (the readers use the definer RPCs that return a scope-local reference). Every other column keeps its grant.
do $columns$
declare r record; v_cols text;
begin
  for r in select * from (values
    ('match_event_result_reviews', array['reviewer_user_id']),
    ('match_event_result_confirmations', array['actor_id']),
    ('match_event_audit_log', array['actor_id', 'target_user_id']),
    ('result_amendment_events', array['actor_id']),
    ('result_amendment_requests', array['decision_actor_id', 'requester_id']),
    ('result_dispute_resolutions', array['actor_id']),
    ('result_repair_jobs', array['requested_by'])) as t(tbl, cols) loop
    if pg_catalog.has_table_privilege('authenticated', pg_catalog.format('public.%I', r.tbl), 'SELECT') then
      select pg_catalog.string_agg(pg_catalog.quote_ident(a.attname), ', ' order by a.attnum) into v_cols
        from pg_catalog.pg_attribute a
        where a.attrelid = pg_catalog.format('public.%I', r.tbl)::regclass and a.attnum > 0 and not a.attisdropped
          and a.attname <> all (r.cols);
      execute pg_catalog.format('revoke select on public.%I from anon, authenticated', r.tbl);
      execute pg_catalog.format('grant select (%s) on public.%I to authenticated', v_cols, r.tbl);
    else
      execute pg_catalog.format('revoke select (%s) on public.%I from anon, authenticated',
        (select pg_catalog.string_agg(pg_catalog.quote_ident(c), ', ') from pg_catalog.unnest(r.cols) c), r.tbl);
    end if;
  end loop;
end $columns$;

commit;
