begin;

-- PAF-231 (PAF-199 unit B): separate account data from historical participation.
--
-- Contract:
--   * public.participant_identities is the internal participant anchor: one UUID plus a live/withdrawn
--     discriminator. Live ids equal the Auth UUID (backfilled and kept in step by an auth.users trigger),
--     so every existing live command and join keeps working. A withdrawn row is an internal tombstone
--     created only by the private erasure seam (20261117100000): a random UUID unrelated to any Auth id.
--   * History-preserving edges (actor/owner/participant columns of retained rows) are re-anchored from
--     auth.users / player_profiles to the anchor. Account-owned edges stay on Auth or the profile.
--   * privacy_internal.erasure_dispositions codifies every classified edge. The catalog verification test
--     (test/account-erasure.schema.integration.test.ts) fails when a new FK edge to auth.users,
--     player_profiles or the anchor is not classified here. It is a contract table, not a trigger.
--   * Immutable ledgers stay immutable to normal callers. The private seam opens a transaction-scoped
--     window row (privacy_internal.erasure_windows, no client privilege); only that window lets the
--     listed guard/side-effect trigger functions step aside. No session variable is an authorization bypass.
--   * No tombstone may sign in, own active resources or hold new rows: guard_live_participant_reference
--     rejects new references to a withdrawn identity.

create schema privacy_internal;
revoke all on schema privacy_internal from public, anon, authenticated, service_role;
grant usage on schema privacy_internal to authenticated, service_role;

create table privacy_internal.erasure_windows (
  txid bigint primary key,
  opened_at timestamptz not null default pg_catalog.clock_timestamp()
);
alter table privacy_internal.erasure_windows enable row level security;
revoke all on privacy_internal.erasure_windows from public, anon, authenticated, service_role;

create function privacy_internal.erasure_active() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from privacy_internal.erasure_windows w where w.txid = pg_catalog.txid_current());
$$;
revoke all on function privacy_internal.erasure_active() from public, anon, authenticated, service_role;
grant execute on function privacy_internal.erasure_active() to authenticated, service_role;

create table public.participant_identities (
  id uuid primary key,
  state text not null default 'live' check (state in ('live', 'withdrawn'))
);
alter table public.participant_identities enable row level security;
revoke all on public.participant_identities from public, anon, authenticated, service_role;

create function public.guard_participant_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    if new.state = 'live' and not exists (select 1 from auth.users u where u.id = new.id) then
      raise exception 'PARTICIPANT_IDENTITY_REQUIRES_AUTH_USER' using errcode = '23514';
    end if;
    if new.state = 'withdrawn' and (exists (select 1 from auth.users u where u.id = new.id)
        or not privacy_internal.erasure_active()) then
      raise exception 'PARTICIPANT_WITHDRAWN_ONLY_BY_ERASURE' using errcode = '23514';
    end if;
    return new;
  elsif tg_op = 'UPDATE' then
    raise exception 'PARTICIPANT_IDENTITY_IMMUTABLE' using errcode = '23514';
  end if;
  if old.state = 'withdrawn' and not privacy_internal.erasure_active() then
    raise exception 'PARTICIPANT_IDENTITY_WITHDRAWN_PERMANENT' using errcode = '23514';
  end if;
  if old.state = 'live' and exists (select 1 from auth.users u where u.id = old.id)
      and not privacy_internal.erasure_active() then
    raise exception 'PARTICIPANT_IDENTITY_LIVE_ACCOUNT' using errcode = '23514';
  end if;
  return old;
end $$;
create trigger participant_identity_guard before insert or update or delete on public.participant_identities
  for each row execute function public.guard_participant_identity();

create function public.sync_live_participant_identity() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    insert into public.participant_identities (id) values (new.id) on conflict (id) do nothing;
    return new;
  end if;
  -- A plain Auth delete keeps today's behavior: retained history still restricts it (the anchor
  -- delete fails on the RESTRICT edges); with no history the anchor goes with the account.
  delete from public.participant_identities i where i.id = old.id and i.state = 'live';
  return old;
end $$;
-- "a_" sorts before match_player_add_identity so the anchor exists before that trigger writes history.
create trigger a_participant_identity_insert after insert on auth.users
  for each row execute function public.sync_live_participant_identity();
create trigger a_participant_identity_delete after delete on auth.users
  for each row execute function public.sync_live_participant_identity();

insert into public.participant_identities (id) select u.id from auth.users u;

create function public.guard_live_participant_reference() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_col text; v_new text; v_old text;
begin
  if privacy_internal.erasure_active() then return new; end if;
  foreach v_col in array tg_argv loop
    v_new := pg_catalog.to_jsonb(new) ->> v_col;
    v_old := case when tg_op = 'UPDATE' then pg_catalog.to_jsonb(old) ->> v_col end;
    if v_new is not null and v_new is distinct from v_old
        and exists (select 1 from public.participant_identities i where i.id = v_new::uuid and i.state = 'withdrawn') then
      raise exception 'PARTICIPANT_WITHDRAWN' using errcode = '23514';
    end if;
  end loop;
  return new;
end $$;
revoke all on function public.guard_participant_identity(), public.sync_live_participant_identity(),
  public.guard_live_participant_reference() from public, anon, authenticated, service_role;

-- Disposition contract ------------------------------------------------------------------------
create table privacy_internal.erasure_dispositions (
  schema_name text not null default 'public',
  table_name text not null,
  column_name text not null,
  disposition text not null check (disposition in (
    'anchor_rekey',      -- FK to participant_identities; re-keyed to the tombstone
    'composite_rekey',   -- part of a composite FK between re-keyed tables; re-keyed in the same unit
    'account_owned',     -- FK stays on Auth/profile; the row is hard-deleted with the account
    'delete_rows',       -- FK stays on Auth; subject-owned rows are deleted explicitly
    'operator_blocker',  -- platform grant: operator removes it first; the seam blocks
    'uuid_rekey',        -- plain uuid column without FK, re-keyed
    'jsonb_rekey',       -- jsonb carrying subject ids, re-keyed by exact id replacement
    'derived_rebuild',   -- derived projection; rebuilt from re-keyed sources and scanned for residue
    'text_redact')),     -- subject-authored free text replaced by the redaction literal
  subject_column text,   -- text_redact: the column of the same row that holds the subject id
  replacement text,      -- text_redact: replacement literal (null = SQL NULL)
  note text,
  primary key (schema_name, table_name, column_name)
);
alter table privacy_internal.erasure_dispositions enable row level security;
revoke all on privacy_internal.erasure_dispositions from public, anon, authenticated, service_role;

insert into privacy_internal.erasure_dispositions (table_name, column_name, disposition, note) values
  ('communities', 'created_by', 'anchor_rekey', 'creator/owner provenance'),
  ('community_members', 'user_id', 'anchor_rekey', 'membership intervals'),
  ('community_members', 'added_by', 'anchor_rekey', 'add provenance'),
  ('community_invitations', 'invitee_user_id', 'anchor_rekey', 'historic invitation'),
  ('community_invitations', 'issued_by', 'anchor_rekey', 'historic invitation actor'),
  ('community_venues', 'created_by', 'anchor_rekey', 'venue provenance'),
  ('community_audit_log', 'actor_user_id', 'anchor_rekey', 'audit actor'),
  ('match_events', 'created_by', 'anchor_rekey', 'organizer'),
  ('match_events', 'published_by', 'anchor_rekey', 'quota provenance'),
  ('match_events', 'cancelled_by', 'anchor_rekey', 'cancellation actor'),
  ('match_event_registrations', 'user_id', 'anchor_rekey', 'roster membership'),
  ('match_event_registrations', 'resolved_by', 'anchor_rekey', 'resolution actor'),
  ('match_event_registrations', 'removed_by', 'anchor_rekey', 'removal actor'),
  ('match_event_registration_attempts', 'user_id', 'composite_rekey', 'composite FK (match_event_id, user_id) to registrations'),
  ('match_event_registration_attempts', 'actor_id', 'anchor_rekey', 'attempt actor'),
  ('match_event_registration_attempts', 'ended_by', 'anchor_rekey', 'departure actor'),
  ('match_event_invites', 'invitee_user_id', 'anchor_rekey', 'historic invite'),
  ('match_event_invites', 'invited_by', 'anchor_rekey', 'historic invite actor'),
  ('match_event_invites', 'responded_by', 'anchor_rekey', 'historic invite actor'),
  ('match_event_audit_log', 'actor_id', 'anchor_rekey', 'immutable audit'),
  ('match_event_audit_log', 'target_user_id', 'anchor_rekey', 'immutable audit'),
  ('match_event_management_commands', 'actor_id', 'anchor_rekey', 'idempotency receipts'),
  ('match_event_result_proposals', 'submitted_by', 'anchor_rekey', 'official score input'),
  ('match_event_result_proposal_versions', 'submitted_by', 'anchor_rekey', 'official score input'),
  ('match_event_result_reviews', 'reviewer_user_id', 'anchor_rekey', 'immutable review'),
  ('match_event_result_confirmations', 'actor_id', 'anchor_rekey', 'immutable confirmation'),
  ('match_player_add_operations', 'actor_id', 'anchor_rekey', 'add operation actor'),
  ('match_player_add_operations', 'target_user_id', 'anchor_rekey', 'add operation target'),
  ('player_profiles', 'invited_by', 'anchor_rekey', 'redacted provenance: the invited profile keeps a non-null, non-self inviter reference'),
  ('player_rating_events', 'user_id', 'anchor_rekey', 'immutable rating ledger'),
  ('player_rating_initializations', 'user_id', 'anchor_rekey', 'immutable rating ledger'),
  ('player_rating_admin_adjustments', 'user_id', 'anchor_rekey', 'immutable rating ledger'),
  ('player_rating_admin_adjustments', 'actor_id', 'anchor_rekey', 'immutable rating ledger'),
  ('player_level_review_requests', 'owner_id', 'anchor_rekey', 'level review trail'),
  ('player_level_review_requests', 'under_review_by', 'anchor_rekey', 'level review trail'),
  ('player_level_review_requests', 'decision_actor_id', 'anchor_rekey', 'level review trail'),
  ('leagues', 'owner_id', 'anchor_rekey', 'league ownership provenance'),
  ('leagues', 'closed_by', 'anchor_rekey', 'league closer'),
  ('league_events', 'actor_id', 'anchor_rekey', 'immutable league audit'),
  ('league_player_counters', 'user_id', 'anchor_rekey', 'counters feed standings; re-keyed, never cascaded'),
  ('statistics_participant_lifecycle', 'user_id', 'anchor_rekey', 'derived; cascades only from a deleted anchor'),
  ('result_amendment_requests', 'requester_id', 'anchor_rekey', 'amendment trail'),
  ('result_amendment_requests', 'decision_actor_id', 'anchor_rekey', 'amendment trail'),
  ('result_amendment_events', 'actor_id', 'anchor_rekey', 'immutable amendment trail'),
  ('result_dispute_resolutions', 'actor_id', 'anchor_rekey', 'immutable dispute trail'),
  ('result_repair_jobs', 'requested_by', 'anchor_rekey', 'repair trail');

insert into privacy_internal.erasure_dispositions (table_name, column_name, disposition, note) values
  ('player_profiles', 'user_id', 'account_owned', 'hard-deleted; cascades to ratings materialization and directory preferences'),
  ('global_player_ratings', 'user_id', 'account_owned', 'profile cascade'),
  ('community_invitee_directory_preferences', 'user_id', 'account_owned', 'profile cascade'),
  ('notifications', 'recipient_user_id', 'account_owned', 'cascade from Auth; explicit delete first'),
  ('notification_preferences', 'user_id', 'account_owned', 'cascade from Auth; explicit delete first'),
  ('push_subscriptions', 'user_id', 'account_owned', 'cascade from Auth; explicit delete first'),
  ('provisional_claim_password_pending', 'user_id', 'account_owned', 'cascade from Auth; explicit delete first'),
  ('match_event_result_entry_ready_dispatch', 'creator_user_id', 'account_owned', 'cascade from Auth; explicit delete first'),
  ('community_request_messages', 'sender_user_id', 'delete_rows', 'free-text body cannot be redacted reliably'),
  ('community_request_messages', 'recipient_user_id', 'delete_rows', 'free-text body cannot be redacted reliably'),
  ('community_notifications', 'recipient_user_id', 'delete_rows', 'notification copies'),
  ('match_player_add_actor_windows', 'actor_id', 'delete_rows', 'operational window'),
  ('match_player_add_throttle_hits', 'actor_id', 'delete_rows', 'operational throttle evidence'),
  ('platform_admins', 'user_id', 'operator_blocker', 'platform role removed by the operator first'),
  ('platform_admins', 'granted_by', 'operator_blocker', 'platform role removed by the operator first');

insert into privacy_internal.erasure_dispositions (table_name, column_name, disposition, note) values
  ('notifications', 'target_id', 'uuid_rekey', 'notifications to other users may target the subject'),
  ('community_audit_log', 'details', 'jsonb_rekey', null),
  ('league_events', 'details', 'jsonb_rekey', null),
  ('league_standings_snapshots', 'entries', 'jsonb_rekey', 'standings entries carry user ids'),
  ('leagues', 'create_input', 'jsonb_rekey', null),
  ('match_event_audit_log', 'before_data', 'jsonb_rekey', null),
  ('match_event_audit_log', 'after_data', 'jsonb_rekey', null),
  ('match_event_invites', 'submission_result', 'jsonb_rekey', null),
  ('match_event_management_commands', 'payload', 'jsonb_rekey', null),
  ('match_event_management_commands', 'result', 'jsonb_rekey', null),
  ('match_event_result_proposal_versions', 'teams', 'jsonb_rekey', 'team slots keep their positions'),
  ('player_rating_event_calculations', 'inputs', 'jsonb_rekey', 'replay inputs of other players keep their numbers'),
  ('player_rating_event_calculations', 'explanation', 'jsonb_rekey', null),
  ('result_amendment_events', 'data', 'jsonb_rekey', null),
  ('result_repair_attempts', 'publication', 'jsonb_rekey', null);

insert into privacy_internal.erasure_dispositions (table_name, column_name, disposition, note) values
  ('statistics_participant_facts', 'user_id', 'derived_rebuild', null),
  ('statistics_participant_facts', 'partner_id', 'derived_rebuild', null),
  ('statistics_pair_facts', 'player_high', 'derived_rebuild', 'canonical order: rebuilt, never swapped in place'),
  ('statistics_pair_facts', 'player_low', 'derived_rebuild', null),
  ('statistics_opponent_facts', 'player_high', 'derived_rebuild', null),
  ('statistics_opponent_facts', 'player_low', 'derived_rebuild', null),
  ('statistics_league_positions', 'player_id', 'derived_rebuild', null),
  ('statistics_rank_dirty', 'player_id', 'derived_rebuild', null),
  ('statistics_rank_transitions', 'player_id', 'derived_rebuild', null),
  ('statistics_rank_transitions', 'provenance', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'subject_a', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'subject_b', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'subject_players', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'activity', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'extrema', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'recent', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'relations', 'derived_rebuild', null),
  ('statistics_daily_buckets', 'sequence', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'subject_a', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'subject_b', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'subject_players', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'activity', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'extrema', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'recent', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'relations', 'derived_rebuild', null),
  ('statistics_scope_summaries', 'sequence', 'derived_rebuild', null),
  ('statistics_group_facts', 'team_a_players', 'derived_rebuild', null),
  ('statistics_group_facts', 'team_b_players', 'derived_rebuild', null);

insert into privacy_internal.erasure_dispositions
    (table_name, column_name, disposition, subject_column, replacement, note) values
  ('match_events', 'notes', 'text_redact', 'created_by', null, 'subject-authored free text'),
  ('match_events', 'court_notes', 'text_redact', 'created_by', null, 'subject-authored free text'),
  ('match_events', 'payment_note', 'text_redact', 'created_by', null, 'subject-authored free text'),
  ('match_event_result_reviews', 'reason_note', 'text_redact', 'reviewer_user_id', null, 'subject-authored free text'),
  ('match_event_audit_log', 'reason', 'text_redact', 'actor_id', 'redacted', 'subject-authored free text (cancel/remove audit rows require a reason)'),
  ('match_player_add_operations', 'email', 'text_redact', 'target_user_id', 'redacted', 'the subject''s own address'),
  ('match_player_add_operations', 'display_name', 'text_redact', 'target_user_id', 'redacted', 'the subject''s own name'),
  ('result_amendment_requests', 'reason', 'text_redact', 'requester_id', 'redacted', 'subject-authored free text'),
  ('player_level_review_requests', 'reason', 'text_redact', 'owner_id', 'redacted', 'subject-authored free text'),
  ('result_repair_jobs', 'reason', 'text_redact', 'requested_by', 'redacted', 'subject-authored free text');

-- Re-anchor every history-preserving FK from auth.users / player_profiles to the anchor ---------
do $reanchor$
declare
  r record; v_con record; v_action text;
begin
  for r in select d.table_name, d.column_name from privacy_internal.erasure_dispositions d
            where d.disposition = 'anchor_rekey' order by d.table_name, d.column_name loop
    select c.conname into v_con from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
     where c.contype = 'f' and c.conrelid = pg_catalog.format('public.%I', r.table_name)::regclass
       and pg_catalog.array_length(c.conkey, 1) = 1 and a.attname = r.column_name
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass);
    if v_con.conname is null then
      raise exception 'No FK to auth.users/player_profiles on %.%', r.table_name, r.column_name;
    end if;
    v_action := case when r.table_name = 'statistics_participant_lifecycle' then 'cascade' else 'restrict' end;
    execute pg_catalog.format('alter table public.%I drop constraint %I', r.table_name, v_con.conname);
    execute pg_catalog.format(
      'alter table public.%I add constraint %I foreign key (%I) references public.participant_identities (id) on delete %s',
      r.table_name, v_con.conname, r.column_name, v_action);
  end loop;
end $reanchor$;

-- The re-key updates a registration and its attempts in one transaction: the composite key is the
-- only selected deferrable constraint; uniqueness semantics are unchanged.
alter table public.match_event_registration_attempts
  alter constraint match_event_registration_attempts_match_event_id_user_id_fkey deferrable initially immediate;

-- Tombstones never take new rows or new ownership.
create trigger participant_live_ref_members before insert or update of user_id, added_by on public.community_members
  for each row execute function public.guard_live_participant_reference('user_id', 'added_by');
create trigger participant_live_ref_communities before insert or update of created_by on public.communities
  for each row execute function public.guard_live_participant_reference('created_by');
create trigger participant_live_ref_invitations before insert or update of invitee_user_id, issued_by on public.community_invitations
  for each row execute function public.guard_live_participant_reference('invitee_user_id', 'issued_by');
create trigger participant_live_ref_venues before insert or update of created_by on public.community_venues
  for each row execute function public.guard_live_participant_reference('created_by');
create trigger participant_live_ref_events before insert or update of created_by, published_by on public.match_events
  for each row execute function public.guard_live_participant_reference('created_by', 'published_by');
create trigger participant_live_ref_registrations before insert or update of user_id on public.match_event_registrations
  for each row execute function public.guard_live_participant_reference('user_id');
create trigger participant_live_ref_attempts before insert on public.match_event_registration_attempts
  for each row execute function public.guard_live_participant_reference('user_id', 'actor_id');
create trigger participant_live_ref_invites before insert on public.match_event_invites
  for each row execute function public.guard_live_participant_reference('invitee_user_id', 'invited_by');
create trigger participant_live_ref_proposals before insert on public.match_event_result_proposals
  for each row execute function public.guard_live_participant_reference('submitted_by');
create trigger participant_live_ref_leagues before insert or update of owner_id on public.leagues
  for each row execute function public.guard_live_participant_reference('owner_id');
create trigger participant_live_ref_counters before insert on public.league_player_counters
  for each row execute function public.guard_live_participant_reference('user_id');
create trigger participant_live_ref_add_operations before insert on public.match_player_add_operations
  for each row execute function public.guard_live_participant_reference('actor_id', 'target_user_id');
create trigger participant_live_ref_ratings before insert on public.player_rating_events
  for each row execute function public.guard_live_participant_reference('user_id');

-- Archived (ownerless) communities and the no-photo contract ------------------------------------
alter table public.communities add column archived_at timestamptz;
alter table public.match_events alter column photo_path drop not null;

create function public.guard_community_not_archived() returns trigger
language plpgsql security definer set search_path = '' as $$
declare v_community uuid := (pg_catalog.to_jsonb(new) ->> 'community_id')::uuid;
begin
  if privacy_internal.erasure_active() then return new; end if;
  if exists (select 1 from public.communities c where c.id = v_community and c.archived_at is not null) then
    raise exception 'COMMUNITY_ARCHIVED' using errcode = '55000';
  end if;
  return new;
end $$;
revoke all on function public.guard_community_not_archived() from public, anon, authenticated, service_role;
create trigger community_archived_members before insert on public.community_members
  for each row execute function public.guard_community_not_archived();
create trigger community_archived_invitations before insert on public.community_invitations
  for each row execute function public.guard_community_not_archived();
create trigger community_archived_venues before insert on public.community_venues
  for each row execute function public.guard_community_not_archived();
create trigger community_archived_events before insert on public.match_events
  for each row execute function public.guard_community_not_archived();
create trigger community_archived_leagues before insert on public.leagues
  for each row execute function public.guard_community_not_archived();
create trigger community_archived_messages before insert on public.community_request_messages
  for each row execute function public.guard_community_not_archived();

-- Guard / side-effect trigger functions that step aside only inside the erasure window ----------
do $patch$
declare
  v_name text; v_oid oid; v_def text; v_new text;
  v_names text[] := array[
    'guard_player_profile_provenance', 'guard_community_member', 'guard_community_invitation',
    'audit_community_change', 'notify_community_membership', 'notify_community_role_change',
    'guard_match_event_mutation', 'guard_match_event_league_binding', 'guard_match_registration_identity',
    'guard_match_invitation_mutation', 'guard_match_registration_attempt', 'guard_match_event_audit',
    'guard_match_result_proposal_transition', 'guard_match_result_proposal_version_immutable',
    'guard_match_result_review_immutable', 'guard_match_event_result_confirmation_insert',
    'guard_player_rating_evidence_immutable', 'guard_league_identity', 'guard_league_events_immutable',
    'guard_league_standings_snapshots_immutable', 'guard_level_review_request',
    'guard_level_review_no_delete', 'guard_result_amendment_request', 'guard_result_amendment_insert_only',
    'guard_result_repair_job', 'guard_result_repair_attempt', 'notify_league_lifecycle',
    'notify_level_review_resolution'];
begin
  foreach v_name in array v_names loop
    select p.oid into v_oid from pg_catalog.pg_proc p
     where p.pronamespace = 'public'::regnamespace and p.proname = v_name;
    if v_oid is null then raise exception 'Missing trigger function %', v_name; end if;
    v_def := pg_catalog.pg_get_functiondef(v_oid);
    if pg_catalog.strpos(v_def, 'privacy_internal.erasure_active') > 0 then continue; end if;
    v_new := pg_catalog.regexp_replace(v_def, E'\\mbegin\\M',
      E'begin\n  if privacy_internal.erasure_active() then\n    if tg_op = ''DELETE'' then return old; end if;\n    return new;\n  end if;',
      'i');
    if v_new = v_def then raise exception 'Cannot patch %', v_name; end if;
    execute v_new;
  end loop;
end $patch$;

commit;
