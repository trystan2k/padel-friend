begin;

-- PAF-199 review round 4 (F21-F27).
--   F21/F22  restore gate: expected-subject set, project binding, exact coverage, no live subject can be reconciled
--   F23      producer pause survives the finish (un-linked); dead-anchor refusal is the durable fence; ack-gated response
--   F24      pause row pre-created at case open; producers admit under FOR SHARE, the freeze UPDATE serializes against them
--   F25      the freeze revalidates the verified address before the destructive start
--   F26      the FK mapping registry is seeded ONLY from reviewed literals, compared with the live catalog at apply time
--   F27      restore storage phase (object set + Storage API deletion happen in the operator driver)

-- F26: reviewed mapping set + apply-time bidirectional comparison -------------------------------------------------
create function privacy_internal.assert_fk_registry_reviewed(p_reviewed jsonb) returns void
language plpgsql stable security definer set search_path = '' as $$
declare v_live text[]; v_reviewed text[];
begin
  v_live := array(select pg_catalog.format('%s.%s %s -> %s.%s %s', tn.nspname, t.relname,
        privacy_internal.fk_columns(c.conrelid, c.conkey), rn.nspname, r.relname, privacy_internal.fk_columns(c.confrelid, c.confkey))
      from pg_catalog.pg_constraint c
      join pg_catalog.pg_class t on t.oid = c.conrelid join pg_catalog.pg_namespace tn on tn.oid = t.relnamespace
      join pg_catalog.pg_class r on r.oid = c.confrelid join pg_catalog.pg_namespace rn on rn.oid = r.relnamespace
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass));
  v_reviewed := array(select pg_catalog.format('%s.%s %s -> %s.%s %s', e ->> 'source_schema', e ->> 'source_table',
        (e -> 'source_columns')::text, e ->> 'target_schema', e ->> 'target_table', (e -> 'target_columns')::text)
      from pg_catalog.jsonb_array_elements(p_reviewed) e);
  if exists (select x from pg_catalog.unnest(v_live) x where x <> all (v_reviewed)) then
    raise exception 'ACCOUNT_ERASURE_BLOCKED' using errcode = 'P0001', detail = '["unclassified_dependency"]';
  end if;
  if exists (select x from pg_catalog.unnest(v_reviewed) x where x <> all (v_live)) then
    raise exception 'ACCOUNT_ERASURE_BLOCKED' using errcode = 'P0001', detail = '["registry_drift"]';
  end if;
end $$;
revoke all on function privacy_internal.assert_fk_registry_reviewed(jsonb) from public, anon, authenticated, service_role;

create temporary table zz_reviewed_fk (source_schema text, source_table text, source_columns text, target_schema text,
  target_table text, target_columns text) on commit drop;
insert into zz_reviewed_fk values
    ('public', 'communities', '["created_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'community_audit_log', '["actor_user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'community_invitations', '["invitee_user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'community_invitations', '["issued_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'community_invitee_directory_preferences', '["user_id"]', 'public', 'player_profiles', '["user_id"]'),
    ('public', 'community_members', '["added_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'community_members', '["user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'community_notifications', '["recipient_user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'community_request_messages', '["recipient_user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'community_request_messages', '["sender_user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'community_venues', '["created_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'global_player_ratings', '["user_id"]', 'public', 'player_profiles', '["user_id"]'),
    ('public', 'league_events', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'league_player_counters', '["user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'leagues', '["closed_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'leagues', '["owner_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_audit_log', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_audit_log', '["target_user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_invites', '["invited_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_invites', '["invitee_user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_invites', '["responded_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_management_commands', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_registration_attempts', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_registration_attempts', '["ended_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_registrations', '["removed_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_registrations', '["resolved_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_registrations', '["user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_result_confirmations', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_result_entry_ready_dispatch', '["creator_user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'match_event_result_proposal_versions', '["submitted_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_result_proposals', '["submitted_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_event_result_reviews', '["reviewer_user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_events', '["cancelled_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_events', '["created_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_events', '["published_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_player_add_actor_windows', '["actor_id"]', 'auth', 'users', '["id"]'),
    ('public', 'match_player_add_operations', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_player_add_operations', '["target_user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'match_player_add_throttle_hits', '["actor_id"]', 'auth', 'users', '["id"]'),
    ('public', 'notification_preferences', '["user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'notifications', '["recipient_user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'platform_admins', '["granted_by"]', 'auth', 'users', '["id"]'),
    ('public', 'platform_admins', '["user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'player_level_review_requests', '["decision_actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_level_review_requests', '["owner_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_level_review_requests', '["under_review_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_profiles', '["invited_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_profiles', '["user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'player_rating_admin_adjustments', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_rating_admin_adjustments', '["user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_rating_events', '["user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'player_rating_initializations', '["user_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'provisional_claim_password_pending', '["user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'push_subscriptions', '["user_id"]', 'auth', 'users', '["id"]'),
    ('public', 'result_amendment_events', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'result_amendment_requests', '["decision_actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'result_amendment_requests', '["requester_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'result_dispute_resolutions', '["actor_id"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'result_repair_jobs', '["requested_by"]', 'public', 'participant_identities', '["id"]'),
    ('public', 'statistics_participant_lifecycle', '["user_id"]', 'public', 'participant_identities', '["id"]');

-- Abort (whole migration rolls back) on any unreviewed live edge or any reviewed edge missing from the catalog.
select privacy_internal.assert_fk_registry_reviewed((select pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
  'source_schema', z.source_schema, 'source_table', z.source_table, 'source_columns', z.source_columns::jsonb,
  'target_schema', z.target_schema, 'target_table', z.target_table, 'target_columns', z.target_columns::jsonb)) from zz_reviewed_fk z));

-- The registry is exactly the reviewed set (no catalog auto-registration).
delete from privacy_internal.erasure_fk_registry;
insert into privacy_internal.erasure_fk_registry
  select z.source_schema, z.source_table, z.source_columns::jsonb, z.target_schema, z.target_table, z.target_columns::jsonb
    from zz_reviewed_fk z;

-- F24 + F23: pause rows exist for the whole case life -------------------------------------------------------------
alter table privacy_internal.case_producer_pause drop constraint case_producer_pause_subject_id_key;
alter table privacy_internal.case_producer_pause alter column subject_id drop not null;
create index case_producer_pause_subject on privacy_internal.case_producer_pause (subject_id) where subject_id is not null;
insert into privacy_internal.case_producer_pause (case_id, subject_id, active)
  select c.id, c.subject_id, false from privacy_internal.privacy_cases c
   where c.subject_id is not null and c.state not in ('closed', 'withdrawn') on conflict do nothing;

-- Admission: row-lock the pause rows (FOR SHARE) so a concurrent freeze UPDATE and this producer serialize; a dead or
-- withdrawn anchor refuses forever, independent of any pause row (survives Auth deletion and the finish).
create or replace function privacy_internal.producer_paused(p_subject uuid) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if p_subject is null then return false; end if;
  perform 1 from privacy_internal.case_producer_pause p where p.subject_id = p_subject for share;
  return exists (select 1 from privacy_internal.case_producer_pause p where p.subject_id = p_subject and p.active)
    or exists (select 1 from privacy_internal.frozen_subjects f where f.subject_id = p_subject)
    or not exists (select 1 from public.participant_identities i where i.id = p_subject and i.state = 'live');
end $$;

create or replace function privacy_internal.player_add_paused(p_actor uuid, p_target uuid, p_email text) returns boolean
language plpgsql volatile security definer set search_path = '' as $$
begin
  if privacy_internal.producer_paused(p_actor) then return true; end if;
  if p_target is not null and privacy_internal.producer_paused(p_target) then return true; end if;
  if p_email is null then return false; end if;
  perform 1 from privacy_internal.case_producer_pause p join auth.users u on u.id = p.subject_id
    where pg_catalog.lower(u.email) = p_email for share of p;
  return exists (select 1 from (select p.subject_id from privacy_internal.case_producer_pause p where p.active
        union select f.subject_id from privacy_internal.frozen_subjects f) s
      join auth.users u on u.id = s.subject_id where pg_catalog.lower(u.email) = p_email);
end $$;

-- F23: the response of a case whose external sends may be outstanding needs the operator's acknowledgment.
drop function public.privacy_op_record_response(text);
create function public.privacy_op_record_response(p_reference text, p_external_followup_ack boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_followup boolean;
begin
  v := privacy_internal.case_by_reference(p_reference);
  if v.state not in ('closed', 'withdrawn') then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'CASE_NOT_FINAL');
  end if;
  v_followup := coalesce((v.phase_manifest ->> 'external_followup')::boolean, false);
  if v_followup and p_external_followup_ack is distinct from true then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EXTERNAL_FOLLOWUP_ACK_REQUIRED');
  end if;
  update privacy_internal.privacy_cases set final_response_at = pg_catalog.clock_timestamp(),
      purge_after = pg_catalog.clock_timestamp() + interval '90 days',
      phase_manifest = phase_manifest || case when v_followup then pg_catalog.jsonb_build_object('external_followup_ack', true) else '{}'::jsonb end
    where id = v.id returning * into v;
  return pg_catalog.jsonb_build_object('status', 'ok', 'reference', v.reference, 'purge_after', v.purge_after);
end $$;

-- F24 + F25: freeze (UPDATE of the pause row = exclusive admission lock) after the address revalidation ----------
drop function public.privacy_proc_freeze(uuid, bigint, uuid);
create function public.privacy_proc_freeze(p_case uuid, p_fence bigint, p_token uuid, p_check_only boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases; v_email text;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.last_phase is not null then return pg_catalog.jsonb_build_object('status', 'skipped', 'phase', 'freeze'); end if;
  -- This freeze IS the destructive start: the identity proof must still belong to the address on file now.
  if v.destructive_started_at is null then
    select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v.subject_id;
    if v.verified_address_digest is distinct from pg_catalog.sha256(pg_catalog.convert_to(coalesce(v_email, ''), 'UTF8')) then
      -- Nothing destructive happened: the arm is un-consumed so verification can restart (F15 rules).
      update privacy_internal.privacy_cases set state = 'blocked', resume_state = null, blocker_code = 'VERIFICATION_STALE',
          next_action = 'operator_review', armed_consumed_at = null, lease_expires_at = null where id = v.id;
      return pg_catalog.jsonb_build_object('status', 'blocked', 'code', 'VERIFICATION_STALE');
    end if;
  end if;
  if p_check_only then return pg_catalog.jsonb_build_object('status', 'ok', 'phase', 'freeze'); end if;
  update privacy_internal.case_producer_pause set active = true, since = pg_catalog.clock_timestamp(), subject_id = v.subject_id
    where case_id = v.id;
  if not found then
    insert into privacy_internal.case_producer_pause (case_id, subject_id, active) values (v.id, v.subject_id, true);
  end if;
  insert into privacy_internal.frozen_subjects (subject_id, case_id) values (v.subject_id, v.id) on conflict do nothing;
  update privacy_internal.privacy_cases set last_phase = 'freeze', attempt_count = 0, quiescence_attempts = 0,
      destructive_started_at = coalesce(destructive_started_at, pg_catalog.clock_timestamp()),
      phase_manifest = v.phase_manifest || pg_catalog.jsonb_build_object('freeze',
        pg_catalog.jsonb_build_object('others_photos_for_review', privacy_internal.erasure_others_photo_count(v.subject_id)))
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done', 'phase', 'freeze');
end $$;

-- F23: the pause row stays (active, un-linked from the subject); the dead anchor refuses the subject forever.
create or replace function public.privacy_proc_finish(p_case uuid, p_fence bigint, p_token uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v privacy_internal.privacy_cases;
begin
  v := privacy_internal.case_lease(p_case, p_fence, p_token);
  if v.state = 'closed' then return pg_catalog.jsonb_build_object('status', 'skipped'); end if;
  if v.state <> 'supabase_erased' then raise exception 'PRIVACY_PHASE_ORDER' using errcode = 'P0001'; end if;
  delete from privacy_internal.frozen_subjects where subject_id = v.subject_id;
  update privacy_internal.case_producer_pause set subject_id = null where case_id = v.id;
  delete from privacy_internal.privacy_case_commands where case_id = v.id;
  update privacy_internal.privacy_cases set state = 'closed', outcome = 'erased', closed_at = pg_catalog.clock_timestamp(),
      subject_id = null, armed_plan = null, armed_plan_hash = null, challenge_digest = null,
      challenge_address_digest = null, verified_address_digest = null, lease_token = null, lease_expires_at = null
    where id = v.id;
  return pg_catalog.jsonb_build_object('status', 'done');
end $$;

-- F21 + F22: restore gate -----------------------------------------------------------------------------------------
alter table privacy_internal.restore_gate
  add column snapshot_at timestamptz,
  add column expected_subjects uuid[] not null default '{}',
  add column reconciled_subjects uuid[] not null default '{}',
  add column restore_project_ref text,
  add column restore_database text,
  drop column reconciled_subject;

create function public.privacy_op_live_identity_ids() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(pg_catalog.jsonb_agg(i.id order by i.id), '[]'::jsonb) from public.participant_identities i where i.state = 'live';
$$;

-- Informational only: the case records do not keep subject ids once erased (data minimization).
create function public.privacy_op_erasures_since(p_since timestamptz) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object('count', pg_catalog.count(*)) from privacy_internal.privacy_cases c
   where c.outcome = 'erased' and c.closed_at > p_since;
$$;

drop function public.privacy_op_restore_gate(text, text);
create function public.privacy_op_restore_gate(p_action text, p_evidence text default null, p_snapshot_at timestamptz default null,
  p_expected_subjects uuid[] default null, p_confirm_empty boolean default false, p_restore_project_ref text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_evidence text := pg_catalog.btrim(coalesce(p_evidence, ''));
  v_expected uuid[]; v_ref text := pg_catalog.btrim(coalesce(p_restore_project_ref, ''));
begin
  if p_action = 'begin' then
    if p_snapshot_at is null or pg_catalog.length(v_ref) not between 1 and 64 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_GATE_PARAMETERS_REQUIRED');
    end if;
    v_expected := coalesce(array(select distinct x from pg_catalog.unnest(coalesce(p_expected_subjects, '{}'::uuid[])) x order by x), '{}'::uuid[]);
    if pg_catalog.cardinality(v_expected) = 0 and p_confirm_empty is distinct from true then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EXPECTED_SUBJECTS_REQUIRED');
    end if;
    if pg_catalog.cardinality(v_expected) > 0 and p_confirm_empty is true then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'EXPECTED_SUBJECTS_CONFLICT');
    end if;
    update privacy_internal.privacy_settings set value = 'false' where key in ('intake_enabled', 'executor_enabled');
    -- A verified-empty expected set has nothing to reconcile; a non-empty one needs exact coverage.
    update privacy_internal.restore_gate set status = case when pg_catalog.cardinality(v_expected) = 0 then 'reconciled' else 'pending' end,
        evidence_ref = null, snapshot_at = p_snapshot_at, expected_subjects = v_expected, reconciled_subjects = '{}',
        restore_project_ref = v_ref, restore_database = pg_catalog.current_database(),
        reconciled_at = case when pg_catalog.cardinality(v_expected) = 0 then pg_catalog.clock_timestamp() end,
        updated_at = pg_catalog.clock_timestamp()
      returning * into g;
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', g.status, 'expected', pg_catalog.cardinality(v_expected));
  elsif p_action = 'clear' then
    select * into g from privacy_internal.restore_gate for update;
    if g.status <> 'reconciled' then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_REQUIRED');
    end if;
    if pg_catalog.length(v_evidence) not between 1 and 200 then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RECONCILIATION_EVIDENCE_REQUIRED');
    end if;
    -- The evidence reference stays for audit; the restored subject ids do not (no standing identity ledger).
    update privacy_internal.restore_gate set status = 'closed', evidence_ref = v_evidence, expected_subjects = '{}',
        reconciled_subjects = '{}', updated_at = pg_catalog.clock_timestamp();
    return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate', 'closed');
  end if;
  raise exception 'Invalid gate action' using errcode = '22023';
end $$;

-- Null when the subject may be reconciled in THIS database, else a sanitized refusal code.
create function privacy_internal.restore_gate_check(p_subject uuid, p_project_ref text) returns text
language plpgsql stable security definer set search_path = '' as $$
declare g privacy_internal.restore_gate;
begin
  select * into g from privacy_internal.restore_gate;
  if g.status is distinct from 'pending' then return 'RESTORE_GATE_NOT_PENDING'; end if;
  if p_project_ref is null or p_project_ref is distinct from g.restore_project_ref
      or g.restore_database is distinct from pg_catalog.current_database() then
    return 'RESTORE_PROJECT_MISMATCH';
  end if;
  if p_subject is null or p_subject <> all (g.expected_subjects) then return 'RESTORE_SUBJECT_NOT_EXPECTED'; end if;
  -- A subject with no trace here (typo, never restored) is refused without touching anything.
  if not (exists (select 1 from public.participant_identities i where i.id = p_subject)
      or exists (select 1 from auth.users u where u.id = p_subject)
      or exists (select 1 from public.player_profiles pp where pp.user_id = p_subject)
      or pg_catalog.cardinality(privacy_internal.subject_residue(p_subject)) > 0) then
    return 'RESTORE_SUBJECT_NOT_FOUND';
  end if;
  return null;
end $$;

-- Object set the restored copy references for one expected subject (pointers, plus storage.objects when present).
create function public.privacy_op_restore_storage_set(p_subject uuid, p_project_ref text) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_code text; v_objects jsonb; v_db jsonb := '[]'::jsonb;
begin
  v_code := privacy_internal.restore_gate_check(p_subject, p_project_ref);
  if v_code is not null then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_code); end if;
  if pg_catalog.to_regclass('storage.objects') is not null then
    select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('bucket', s.bucket_id, 'name', s.name)), '[]'::jsonb)
      into v_db from privacy_internal.erasure_storage_objects(p_subject) s;
  end if;
  select coalesce(pg_catalog.jsonb_agg(distinct o), '[]'::jsonb) into v_objects from (
      select pg_catalog.jsonb_build_object('bucket', 'player-avatars', 'name', p.avatar_url) o
        from public.player_profiles p where p.user_id = p_subject and p.avatar_url is not null
      union select pg_catalog.jsonb_build_object('bucket', 'match-event-photos', 'name', e.photo_path)
        from public.match_events e where pg_catalog.split_part(e.photo_path, '/', 3) = p_subject::text
      union select pg_catalog.jsonb_build_object('bucket', 'community-venue-photos', 'name', v.photo_path)
        from public.community_venues v where pg_catalog.split_part(v.photo_path, '/', 3) = p_subject::text
      union select d from pg_catalog.jsonb_array_elements(v_db) d) q;
  return pg_catalog.jsonb_build_object('status', 'ok', 'objects', v_objects);
end $$;

drop function public.privacy_op_restore_reconcile(uuid);
create function public.privacy_op_restore_reconcile(p_subject uuid, p_project_ref text, p_storage_verified boolean default false)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare g privacy_internal.restore_gate; v_code text; v_plan jsonb; v_residue text[]; v_msg text; v_detail text; v_rec uuid[];
begin
  select * into g from privacy_internal.restore_gate for update;
  v_code := privacy_internal.restore_gate_check(p_subject, p_project_ref);
  if v_code is not null then return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_code); end if;
  -- The Storage API phase (object deletion + absence proof) runs in the operator driver before this call.
  if p_storage_verified is distinct from true then
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_STORAGE_PHASE_REQUIRED');
  end if;
  begin
    if exists (select 1 from public.participant_identities i where i.id = p_subject and i.state = 'live') then
      v_plan := privacy_internal.account_erasure_plan(p_subject, '{}'::jsonb);
      if pg_catalog.jsonb_array_length(v_plan -> 'blockers') > 0 then
        raise exception 'RESTORE_RECONCILE_BLOCKED' using detail = (v_plan -> 'blockers')::text;
      end if;
      perform privacy_internal.account_erasure_execute(p_subject, v_plan - 'blockers');
    end if;
    delete from auth.users where id = p_subject;
    v_residue := privacy_internal.subject_residue(p_subject);
    if pg_catalog.cardinality(v_residue) > 0 then
      raise exception 'RESTORE_RECONCILE_RESIDUE' using detail = pg_catalog.array_to_string(v_residue, ',');
    end if;
  exception when others then
    get stacked diagnostics v_msg = message_text, v_detail = pg_exception_detail;
    if v_msg in ('RESTORE_RECONCILE_BLOCKED', 'RESTORE_RECONCILE_RESIDUE') then
      return pg_catalog.jsonb_build_object('status', 'rejected', 'code', v_msg, 'detail', v_detail);
    end if;
    return pg_catalog.jsonb_build_object('status', 'rejected', 'code', 'RESTORE_RECONCILE_FAILED');
  end;
  v_rec := array(select distinct x from pg_catalog.unnest(g.reconciled_subjects || p_subject) x order by x);
  update privacy_internal.restore_gate set reconciled_subjects = v_rec,
      status = case when not exists (select 1 from pg_catalog.unnest(g.expected_subjects) e where e <> all (v_rec)) then 'reconciled' else 'pending' end,
      reconciled_at = case when not exists (select 1 from pg_catalog.unnest(g.expected_subjects) e where e <> all (v_rec))
        then pg_catalog.clock_timestamp() end,
      updated_at = pg_catalog.clock_timestamp();
  return pg_catalog.jsonb_build_object('status', 'ok', 'restore_gate',
    case when not exists (select 1 from pg_catalog.unnest(g.expected_subjects) e where e <> all (v_rec)) then 'reconciled' else 'pending' end,
    'reconciled', pg_catalog.cardinality(v_rec), 'expected', pg_catalog.cardinality(g.expected_subjects));
end $$;

revoke all on function privacy_internal.restore_gate_check(uuid, text), privacy_internal.producer_paused(uuid),
  privacy_internal.player_add_paused(uuid, uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.privacy_op_live_identity_ids(), public.privacy_op_erasures_since(timestamptz),
  public.privacy_op_restore_gate(text, text, timestamptz, uuid[], boolean, text),
  public.privacy_op_restore_storage_set(uuid, text), public.privacy_op_restore_reconcile(uuid, text, boolean),
  public.privacy_op_record_response(text, boolean), public.privacy_proc_freeze(uuid, bigint, uuid, boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.privacy_op_live_identity_ids(), public.privacy_op_erasures_since(timestamptz),
  public.privacy_op_restore_gate(text, text, timestamptz, uuid[], boolean, text),
  public.privacy_op_restore_storage_set(uuid, text), public.privacy_op_restore_reconcile(uuid, text, boolean),
  public.privacy_op_record_response(text, boolean), public.privacy_proc_freeze(uuid, bigint, uuid, boolean) to service_role;

-- F24: the pause row exists from the moment the case opens (patch asserts exactly one occurrence) -------------------
do $patch$
declare
  v_oid oid; v_def text; v_count integer;
  v_old text := $q$  insert into privacy_internal.privacy_cases (subject_id) values (v_uid) returning * into v_case;$q$;
  v_new text := $q$  insert into privacy_internal.privacy_cases (subject_id) values (v_uid) returning * into v_case;
  insert into privacy_internal.case_producer_pause (case_id, subject_id, active) values (v_case.id, v_uid, false);$q$;
begin
  select p.oid into v_oid from pg_catalog.pg_proc p where p.pronamespace = 'public'::regnamespace and p.proname = 'request_account_deletion';
  v_def := pg_catalog.pg_get_functiondef(v_oid);
  v_count := (pg_catalog.length(v_def) - pg_catalog.length(pg_catalog.replace(v_def, v_old, ''))) / pg_catalog.length(v_old);
  if v_count <> 1 then
    raise exception 'Cannot patch request_account_deletion: expected 1 occurrence, found %', v_count;
  end if;
  execute pg_catalog.replace(v_def, v_old, v_new);
end $patch$;

commit;
