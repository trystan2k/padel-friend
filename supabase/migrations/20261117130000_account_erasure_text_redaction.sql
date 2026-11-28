begin;

-- PAF-231 fix round: complete free-text redaction coverage in the erasure seam.
--
-- Every text-bearing column that survives erasure is classified in
-- test/account-erasure.text.integration.test.ts (live catalog vs registry + justified allowlist).
-- Subject-authored or subject-identifying text is redacted by the seam through three new/extended
-- registry mechanisms:
--   text_redact          column replaced by a fixed literal (or NULL); subject_column is now a comma
--                        list of columns that tie the row to the subject (actor OR target ...).
--   jsonb_strip_text     free-text keys removed (at any depth) from retained jsonb payloads; rows are
--                        selected by the subject columns or by any mention of the subject id.
--   text_clear_via_event raw error text (SQLERRM) stored per match event is cleared for every event
--                        the subject registered in.
-- All text work runs first, inside the erasure window, before the seam writes its own fixed codes.

do $$
declare v_name text;
begin
  select c.conname into v_name from pg_catalog.pg_constraint c
   where c.conrelid = 'privacy_internal.erasure_dispositions'::regclass and c.contype = 'c'
     and pg_catalog.pg_get_constraintdef(c.oid) like '%anchor_rekey%';
  execute pg_catalog.format('alter table privacy_internal.erasure_dispositions drop constraint %I', v_name);
end $$;
alter table privacy_internal.erasure_dispositions add constraint erasure_dispositions_disposition_check
  check (disposition in ('anchor_rekey', 'composite_rekey', 'account_owned', 'delete_rows', 'operator_blocker',
    'uuid_rekey', 'jsonb_rekey', 'derived_rebuild', 'text_redact', 'jsonb_strip_text', 'text_clear_via_event'));

-- A jsonb column can be both re-keyed (ids) and stripped (free-text keys).
alter table privacy_internal.erasure_dispositions drop constraint erasure_dispositions_pkey;
alter table privacy_internal.erasure_dispositions add primary key (schema_name, table_name, column_name, disposition);

update privacy_internal.erasure_dispositions set subject_column = 'actor_id,target_user_id'
 where table_name = 'match_event_audit_log' and column_name = 'reason';

insert into privacy_internal.erasure_dispositions (table_name, column_name, disposition, subject_column, replacement, note) values
  ('match_event_registration_attempts', 'end_reason', 'text_redact', 'ended_by,user_id', 'redacted', 'removal reason written by or about the subject'),
  ('match_event_registrations', 'removal_reason', 'text_redact', 'removed_by,user_id', 'redacted', 'removal reason written by or about the subject'),
  ('match_events', 'cancel_reason', 'text_redact', 'cancelled_by', 'redacted', 'cancellation text written by the subject'),
  ('result_amendment_requests', 'decision_note', 'text_redact', 'decision_actor_id', 'redacted', 'decision text written by the subject'),
  ('result_dispute_resolutions', 'justification', 'text_redact', 'actor_id', 'redacted', 'resolution text written by the subject'),
  ('player_level_review_requests', 'evidence', 'text_redact', 'owner_id', null, 'evidence text written by the subject'),
  ('player_level_review_requests', 'decision_note', 'text_redact', 'owner_id,decision_actor_id', 'redacted', 'decision text written by or about the subject'),
  ('player_rating_admin_adjustments', 'reason', 'text_redact', 'user_id,actor_id', 'redacted', 'adjustment reason written by or about the subject'),
  ('player_rating_admin_adjustments', 'exception_justification', 'text_redact', 'user_id,actor_id', 'redacted', 'adjustment justification written by or about the subject'),
  ('match_event_result_proposal_versions', 'court_label', 'text_redact', 'submitted_by', null, 'free text typed by the submitter'),
  ('communities', 'description', 'text_redact', 'created_by', null, 'description typed by the creator'),
  ('leagues', 'description', 'text_redact', 'owner_id', null, 'description typed by the owner'),
  ('match_event_registration_state', 'cutoff_last_failure_message', 'text_clear_via_event', 'match_event_id', null, 'raw SQLERRM of the cutoff job'),
  ('match_event_management_commands', 'payload', 'jsonb_strip_text', 'actor_id', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'command payload keeps ids only'),
  ('match_event_audit_log', 'before_data', 'jsonb_strip_text', 'actor_id,target_user_id', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'audit snapshot keeps ids and states only'),
  ('match_event_audit_log', 'after_data', 'jsonb_strip_text', 'actor_id,target_user_id', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'audit snapshot keeps ids and states only'),
  ('match_event_invites', 'submission_result', 'jsonb_strip_text', 'invitee_user_id,invited_by', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'submission receipt'),
  ('result_amendment_events', 'data', 'jsonb_strip_text', 'actor_id', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'amendment trail keeps ids and states only'),
  ('result_repair_attempts', 'publication', 'jsonb_strip_text', null, 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'repair publication; selected by any mention of the subject id'),
  ('community_audit_log', 'details', 'jsonb_strip_text', 'actor_user_id', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'audit details keep ids and states only'),
  ('league_events', 'details', 'jsonb_strip_text', 'actor_id', 'reason,note,notes,reason_note,decision_note,justification,description,name,body,message,evidence,display_name,email', 'audit details keep ids and states only'),
  ('leagues', 'create_input', 'jsonb_strip_text', 'owner_id', 'name,description', 'creation payload keeps dates and modes only');

create function privacy_internal.jsonb_strip_keys(p_json jsonb, p_keys text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare v_out jsonb;
begin
  if p_json is null then return null; end if;
  if pg_catalog.jsonb_typeof(p_json) = 'object' then
    select coalesce(pg_catalog.jsonb_object_agg(e.key, privacy_internal.jsonb_strip_keys(e.value, p_keys)), '{}'::jsonb)
      into v_out from pg_catalog.jsonb_each(p_json) e where not (e.key = any (p_keys));
    return v_out;
  elsif pg_catalog.jsonb_typeof(p_json) = 'array' then
    select coalesce(pg_catalog.jsonb_agg(privacy_internal.jsonb_strip_keys(t.x, p_keys) order by t.ord), '[]'::jsonb)
      into v_out from pg_catalog.jsonb_array_elements(p_json) with ordinality as t(x, ord);
    return v_out;
  end if;
  return p_json;
end $$;

create function privacy_internal.erasure_subject_predicate(p_columns text) returns text
language sql immutable set search_path = '' as $$
  select case when p_columns is null then null else '(' || pg_catalog.string_agg(
      pg_catalog.format('%I = $1', pg_catalog.btrim(c)), ' or ') || ')' end
    from pg_catalog.unnest(pg_catalog.string_to_array(p_columns, ',')) c;
$$;

-- Counts (p_apply = false) or applies (true) one text disposition for the subject; returns rows.
create function privacy_internal.erasure_text_rows(p_subject uuid, p_disposition text, p_apply boolean) returns bigint
language plpgsql security definer set search_path = '' as $$
declare r record; v_total bigint := 0; v_n bigint; v_subj text; v_where text; v_keys text[];
begin
  for r in select * from privacy_internal.erasure_dispositions d
      where d.disposition = p_disposition order by d.table_name, d.column_name loop
    v_subj := privacy_internal.erasure_subject_predicate(r.subject_column);
    if p_disposition = 'text_redact' then
      v_where := pg_catalog.format('%s and %I is not null and %I is distinct from $2', v_subj, r.column_name, r.column_name);
      if p_apply then
        execute pg_catalog.format('update public.%I set %I = $2 where %s', r.table_name, r.column_name, v_where)
          using p_subject, r.replacement;
        get diagnostics v_n = row_count;
      else
        execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %s', r.table_name, v_where)
          into v_n using p_subject, r.replacement;
      end if;
    elsif p_disposition = 'jsonb_strip_text' then
      v_keys := pg_catalog.string_to_array(r.replacement, ',');
      v_where := pg_catalog.format('(%spg_catalog.strpos(%I::text, $3) > 0) and %I is distinct from privacy_internal.jsonb_strip_keys(%I, $2)',
        coalesce(v_subj || ' or ', ''), r.column_name, r.column_name, r.column_name);
      if p_apply then
        execute pg_catalog.format('update public.%I set %I = privacy_internal.jsonb_strip_keys(%I, $2) where %s',
          r.table_name, r.column_name, r.column_name, v_where) using p_subject, v_keys, p_subject::text;
        get diagnostics v_n = row_count;
      else
        execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %s', r.table_name, v_where)
          into v_n using p_subject, v_keys, p_subject::text;
      end if;
    else
      v_where := pg_catalog.format('%I in (select rg.match_event_id from public.match_event_registrations rg where rg.user_id = $1) and %I is not null',
        r.subject_column, r.column_name);
      if p_apply then
        execute pg_catalog.format('update public.%I set %I = null where %s', r.table_name, r.column_name, v_where) using p_subject;
        get diagnostics v_n = row_count;
      else
        execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %s', r.table_name, v_where)
          into v_n using p_subject;
      end if;
    end if;
    v_total := v_total + v_n;
  end loop;
  return v_total;
end $$;
revoke all on function privacy_internal.jsonb_strip_keys(jsonb, text[]), privacy_internal.erasure_subject_predicate(text),
  privacy_internal.erasure_text_rows(uuid, text, boolean) from public, anon, authenticated, service_role;

do $patch$
declare
  r record; v_oid oid; v_def text; v_new text; v_count integer;
begin
  for r in select * from (values
    ('account_erasure_plan', $q$    if r.disposition = 'text_redact' then
      if pg_catalog.to_regclass(pg_catalog.format('public.%I', r.table_name)) is null then
        v_blockers := pg_catalog.array_append(v_blockers, 'registry_drift'); continue;
      end if;
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %I = $1 and %I is not null and %I is distinct from $2',
        r.table_name, r.subject_column, r.column_name, r.column_name) into v_count using p_subject, r.replacement;
    else$q$, $q$    if r.disposition in ('text_redact', 'jsonb_strip_text', 'text_clear_via_event') then
      continue; -- counted below by privacy_internal.erasure_text_rows
    else$q$, 1),
    ('account_erasure_plan', $q$  v_ownership := pg_catalog.jsonb_build_object($q$, $q$  for r in select distinct d.disposition from privacy_internal.erasure_dispositions d
      where d.disposition in ('text_redact', 'jsonb_strip_text', 'text_clear_via_event') order by 1 loop
    v_impact := pg_catalog.jsonb_set(v_impact, array[r.disposition],
      pg_catalog.to_jsonb(privacy_internal.erasure_text_rows(p_subject, r.disposition, false)));
  end loop;
  v_ownership := pg_catalog.jsonb_build_object($q$, 1),
    ('account_erasure_execute', $q$  -- 4. Subject-authored text, before the re-key (the subject column still carries the old id).
  for r in select * from privacy_internal.erasure_dispositions d where d.disposition = 'text_redact' loop
    execute pg_catalog.format('update public.%I set %I = $2 where %I = $1 and %I is distinct from $2',
      r.table_name, r.column_name, r.subject_column, r.column_name) using p_subject, r.replacement;
  end loop;

$q$, '', 1),
    ('account_erasure_execute', $q$  -- 1. Ownership: consenting successor transfer, else the approved fallback.$q$, $q$  -- 0. Subject-authored text is redacted first: the subject columns still carry the old id and the
  -- seam has not yet written its own fixed-code reasons.
  for r in select distinct d.disposition from privacy_internal.erasure_dispositions d
      where d.disposition in ('text_redact', 'jsonb_strip_text', 'text_clear_via_event') order by 1 loop
    perform privacy_internal.erasure_text_rows(p_subject, r.disposition, true);
    if privacy_internal.erasure_text_rows(p_subject, r.disposition, false) > 0 then
      raise exception 'ACCOUNT_ERASURE_RESIDUAL_REFERENCE' using errcode = 'P0001', detail = r.disposition;
    end if;
  end loop;

  -- 1. Ownership: consenting successor transfer, else the approved fallback.$q$, 1),
    ('account_erasure_execute', $q$      where d.disposition not in ('text_redact', 'operator_blocker') order by d.table_name, d.column_name loop$q$, $q$      where d.disposition not in ('text_redact', 'jsonb_strip_text', 'text_clear_via_event', 'operator_blocker')
      order by d.table_name, d.column_name loop$q$, 1)
  ) as t(fn, old_text, new_text, expected) loop
    select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'privacy_internal'::regnamespace and p.proname = r.fn;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, r.old_text, ''))) / pg_catalog.length(r.old_text);
    if v_count <> r.expected then
      raise exception 'Cannot patch %: expected % occurrence(s), found % of [%]', r.fn, r.expected, v_count, pg_catalog.left(r.old_text, 60);
    end if;
    v_new := pg_catalog.replace(v_def, r.old_text, r.new_text);
    execute v_new;
  end loop;
end $patch$;

commit;
