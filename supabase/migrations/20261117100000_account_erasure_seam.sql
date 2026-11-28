begin;

-- PAF-231 (PAF-199 unit B): private relational erasure seam.
--
-- Entry points live in the private schema privacy_internal and are granted to NO client role: the
-- Worker wiring and the service-role wrapper are unit C. Contract:
--   privacy_internal.account_erasure_plan(subject uuid, successors jsonb default '{}') -> jsonb
--     Read-only dry run. {revision, fingerprint, impact, successors, blockers[]}. Only coarse counts and
--     sanitized blocker codes: no ids, paths or free text.
--   privacy_internal.account_erasure_execute(subject uuid, expected jsonb) -> jsonb
--     One transaction. expected is the plan {revision, fingerprint, impact, successors} the operator
--     approved. Locks, recomputes the plan and aborts (sanitized, nothing changed) on blockers or any
--     drift. Then transfers or archives ownership, withdraws future activity, redacts subject-authored
--     text, re-keys every retained historic reference to a random withdrawn identity, deletes personal
--     state, rebuilds derived statistics, scans for residue and removes the old anchor.
--   No old->new mapping is stored anywhere: the new id is a local variable. The anchor row lock plus the
--   deleted old anchor make a second tombstone for the same subject impossible.

create function privacy_internal.erasure_location_predicate(p_table text, p_column text) returns text
language plpgsql stable set search_path = '' as $$
declare v_type text;
begin
  select pg_catalog.format_type(a.atttypid, a.atttypmod) into v_type
    from pg_catalog.pg_attribute a
   where a.attrelid = pg_catalog.to_regclass(pg_catalog.format('public.%I', p_table))
     and a.attname = p_column and not a.attisdropped;
  return case
    when v_type = 'uuid' then pg_catalog.format('%I = $1', p_column)
    when v_type = 'uuid[]' then pg_catalog.format('$1 = any(%I)', p_column)
    when v_type in ('jsonb', 'json') then pg_catalog.format('pg_catalog.strpos(%I::text, $2) > 0', p_column)
    else null end;
end $$;

create function privacy_internal.erasure_successor_valid(p_kind text, p_entity uuid, p_successor uuid, p_subject uuid)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare v_community uuid;
begin
  if p_successor is null or p_successor = p_subject
      or not exists (select 1 from public.participant_identities i where i.id = p_successor and i.state = 'live')
      or not exists (select 1 from auth.users u where u.id = p_successor)
      or not exists (select 1 from public.player_profiles p where p.user_id = p_successor and not p.is_provisional) then
    return false;
  end if;
  if p_kind = 'communities' then
    return exists (select 1 from public.communities c where c.id = p_entity and c.created_by = p_subject and c.archived_at is null)
      and exists (select 1 from public.community_members m where m.community_id = p_entity and m.user_id = p_successor
        and m.role = 'admin' and m.status = 'active' and m.valid_until is null)
      and (select pg_catalog.count(*) from public.communities c2 where c2.created_by = p_successor)
        < (select l.community_owned_max from public.security_rate_limits() l);
  elsif p_kind = 'leagues' then
    select l.community_id into v_community from public.leagues l
     where l.id = p_entity and l.owner_id = p_subject and l.status <> 'closed';
    return v_community is not null and exists (select 1 from public.community_members m
      where m.community_id = v_community and m.user_id = p_successor and m.role = 'admin'
        and m.status = 'active' and m.valid_until is null);
  elsif p_kind = 'matches' then
    return exists (select 1 from public.match_events e where e.id = p_entity and e.created_by = p_subject
        and e.status = 'open' and e.starts_at > pg_catalog.clock_timestamp())
      and exists (select 1 from public.match_registration_roster(p_entity) r
        where r.user_id = p_successor and r.participation_status in ('playing', 'reserve'));
  end if;
  return false;
end $$;

create function privacy_internal.account_erasure_plan(p_subject uuid, p_successors jsonb default '{}'::jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  r record; v_pred text; v_count bigint; v_impact jsonb := '{}'::jsonb; v_blockers text[] := '{}';
  v_fp text; v_succ jsonb := coalesce(p_successors, '{}'::jsonb); v_kind text; v_entity text; v_uid text;
  v_owned jsonb; v_email text; v_ownership jsonb;
begin
  select pg_catalog.md5(coalesce(pg_catalog.string_agg(
      d.table_name || '.' || d.column_name || ':' || d.disposition || ':' || coalesce(d.subject_column, '') || ':'
        || coalesce(d.replacement, '~'), ',' order by d.table_name, d.column_name), ''))
    into v_fp from privacy_internal.erasure_dispositions d;

  if p_subject is null or not exists (select 1 from public.participant_identities i where i.id = p_subject and i.state = 'live') then
    v_blockers := pg_catalog.array_append(v_blockers, 'subject_not_live');
  end if;
  if exists (
    select 1 from pg_catalog.pg_constraint c
      join pg_catalog.pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
      join pg_catalog.pg_class t on t.oid = c.conrelid
     where c.contype = 'f' and c.connamespace = 'public'::regnamespace and pg_catalog.array_length(c.conkey, 1) = 1
       and c.confrelid in ('auth.users'::regclass, 'public.player_profiles'::regclass, 'public.participant_identities'::regclass)
       and not exists (select 1 from privacy_internal.erasure_dispositions d
          where d.schema_name = 'public' and d.table_name = t.relname and d.column_name = a.attname)) then
    v_blockers := pg_catalog.array_append(v_blockers, 'unclassified_dependency');
  end if;

  for r in select * from privacy_internal.erasure_dispositions d order by d.table_name, d.column_name loop
    if r.disposition = 'text_redact' then
      if pg_catalog.to_regclass(pg_catalog.format('public.%I', r.table_name)) is null then
        v_blockers := pg_catalog.array_append(v_blockers, 'registry_drift'); continue;
      end if;
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %I = $1 and %I is not null and %I is distinct from $2',
        r.table_name, r.subject_column, r.column_name, r.column_name) into v_count using p_subject, r.replacement;
    else
      v_pred := privacy_internal.erasure_location_predicate(r.table_name, r.column_name);
      if v_pred is null then v_blockers := pg_catalog.array_append(v_blockers, 'registry_drift'); continue; end if;
      execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %s', r.table_name, v_pred)
        into v_count using p_subject, p_subject::text;
    end if;
    v_impact := pg_catalog.jsonb_set(v_impact, array[r.disposition],
      pg_catalog.to_jsonb(coalesce((v_impact ->> r.disposition)::bigint, 0) + v_count));
    if r.disposition = 'operator_blocker' and v_count > 0 then v_blockers := pg_catalog.array_append(v_blockers, 'platform_admin_grant'); end if;
  end loop;

  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = p_subject;
  v_ownership := pg_catalog.jsonb_build_object(
    'communities', (select pg_catalog.count(*) from public.communities c where c.created_by = p_subject and c.archived_at is null),
    'leagues', (select pg_catalog.count(*) from public.leagues l where l.owner_id = p_subject and l.status <> 'closed'),
    'matches', (select pg_catalog.count(*) from public.match_events e where e.created_by = p_subject
      and e.status = 'open' and e.starts_at > pg_catalog.clock_timestamp()),
    'email_operations', (select pg_catalog.count(*) from public.match_player_add_operations o
      where v_email is not null and o.email = v_email));

  for v_kind in select k from pg_catalog.jsonb_object_keys(v_succ) k loop
    if v_kind not in ('communities', 'leagues', 'matches') then
      v_blockers := pg_catalog.array_append(v_blockers, 'successor_invalid'); continue;
    end if;
    for v_entity, v_uid in select e.key, e.value from pg_catalog.jsonb_each_text(v_succ -> v_kind) e loop
      begin
        if not privacy_internal.erasure_successor_valid(v_kind, v_entity::uuid, v_uid::uuid, p_subject) then
          v_blockers := pg_catalog.array_append(v_blockers, 'successor_invalid');
        end if;
      exception when invalid_text_representation then
        v_blockers := pg_catalog.array_append(v_blockers, 'successor_invalid');
      end;
    end loop;
  end loop;
  v_blockers := array(select distinct b from pg_catalog.unnest(v_blockers) b order by b);

  return pg_catalog.jsonb_build_object(
    'revision', 1, 'fingerprint', v_fp,
    'impact', v_impact || pg_catalog.jsonb_build_object('ownership', v_ownership),
    'successors', v_succ, 'blockers', pg_catalog.to_jsonb(v_blockers));
end $$;

create function privacy_internal.erasure_has_history(p_subject uuid) returns boolean
language plpgsql security definer set search_path = '' as $$
declare r record; v_pred text; v_count bigint;
begin
  for r in select * from privacy_internal.erasure_dispositions d
      where d.disposition in ('anchor_rekey', 'composite_rekey', 'uuid_rekey', 'jsonb_rekey') order by d.table_name, d.column_name loop
    v_pred := privacy_internal.erasure_location_predicate(r.table_name, r.column_name);
    execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %s', r.table_name, v_pred)
      into v_count using p_subject, p_subject::text;
    if v_count > 0 then return true; end if;
  end loop;
  return false;
end $$;

-- Semantic helpers: run with the OLD subject id as actor; the re-key then replaces every reference.
create function privacy_internal.erasure_cancel_event(p_event_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.match_events%rowtype; t timestamptz := pg_catalog.clock_timestamp();
  v_before jsonb; v_result jsonb; v_rev bigint; v_recipient uuid;
begin
  e := public.lock_match_event_registration(p_event_id);
  perform 1 from public.match_event_registrations where match_event_id = e.id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id = e.id order by id for update;
  perform 1 from public.match_event_invites where match_event_id = e.id order by id for update;
  if e.status = 'cancelled' then return; end if;
  v_before := public.snapshot_match_registration_roster_locked(e.id);
  update public.match_events set status = 'cancelled', cancelled_at = t, cancelled_by = p_actor,
    cancel_reason = 'organizer_account_removed', version = version + 1, updated_at = t where id = e.id;
  update public.match_event_registration_attempts set ended_at = t, ended_by = p_actor, end_kind = 'cancelled',
    outcome = case when outcome = 'pending' then 'expired'::public.match_registration_lifecycle else outcome end,
    decided_at = case when outcome = 'pending' then t else decided_at end,
    actor_id = case when outcome = 'pending' then p_actor else actor_id end
    where match_event_id = e.id and ended_at is null and outcome in ('pending', 'accepted');
  update public.match_event_registrations set cancelled_at = t,
    lifecycle = case when lifecycle = 'pending' then 'expired'::public.match_registration_lifecycle else lifecycle end,
    resolved_at = case when lifecycle = 'pending' then t else resolved_at end,
    resolved_by = case when lifecycle = 'pending' then p_actor else resolved_by end
    where match_event_id = e.id and lifecycle in ('pending', 'accepted');
  update public.match_event_invites set status = 'cancelled', responded_at = t, responded_by = p_actor
    where match_event_id = e.id and status = 'pending';
  v_result := public.reconcile_match_registration_participation(e.id, null, v_before);
  v_rev := (v_result ->> 'transition_revision')::bigint;
  insert into public.match_event_audit_log (match_event_id, community_id, actor_id, action, reason, request_id,
      occurred_at, event_version, transition_revision, before_data, after_data, changed_fields)
    values (e.id, e.community_id, p_actor, 'cancel', 'organizer_account_removed', pg_catalog.gen_random_uuid(), t,
      e.version + 1, v_rev, pg_catalog.jsonb_build_object('status', 'open'),
      pg_catalog.jsonb_build_object('status', 'cancelled'), array['status', 'cancel_reason']);
  for v_recipient in
    select r.user_id from public.match_event_registrations r where r.match_event_id = e.id and r.user_id <> p_actor
    union select i.invitee_user_id from public.match_event_invites i where i.match_event_id = e.id and i.invitee_user_id <> p_actor loop
    perform public.persist_notification(v_recipient, 'match.cancelled:' || e.id || ':' || (e.version + 1),
      'match_event_cancelled', 'matches', 'match_event', e.id, e.community_id);
  end loop;
end $$;

create function privacy_internal.erasure_withdraw_registration(p_event_id uuid, p_subject uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare e public.match_events%rowtype; v_row public.match_event_registrations%rowtype;
  t timestamptz := pg_catalog.clock_timestamp(); v_before jsonb;
begin
  e := public.lock_match_event_registration(p_event_id);
  perform 1 from public.match_event_registrations where match_event_id = e.id order by id for update;
  perform 1 from public.match_event_registration_attempts where match_event_id = e.id order by id for update;
  select * into v_row from public.match_event_registrations where match_event_id = e.id and user_id = p_subject;
  if not found or v_row.cancelled_at is not null then return; end if;
  if v_row.lifecycle = 'accepted' then
    v_before := public.snapshot_match_registration_roster_locked(e.id);
    update public.match_event_registration_attempts set ended_at = t, ended_by = p_subject, end_kind = 'withdrawn'
      where id = v_row.current_attempt_id and ended_at is null and outcome = 'accepted';
    update public.match_event_registrations set lifecycle = 'withdrawn', left_at = t, resolved_at = t, resolved_by = p_subject
      where id = v_row.id;
    perform public.reconcile_match_registration_participation(e.id, null, v_before);
  elsif v_row.lifecycle = 'pending' then
    update public.match_event_registration_attempts set ended_at = t, ended_by = p_subject, end_kind = 'cancelled',
      outcome = 'expired', decided_at = t, actor_id = p_subject
      where id = v_row.current_attempt_id and ended_at is null;
    update public.match_event_registrations set lifecycle = 'expired', resolved_at = t, resolved_by = p_subject
      where id = v_row.id;
  end if;
end $$;

create function privacy_internal.erasure_close_league(p_league_id uuid, p_actor uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare v_row public.leagues; v_now timestamptz := pg_catalog.clock_timestamp(); v_version integer;
begin
  select * into v_row from public.leagues l where l.id = p_league_id for update;
  if not found or v_row.status = 'closed' then return; end if;
  perform public.league_process_community_locked(v_row.community_id, v_now);
  select * into v_row from public.leagues l where l.id = p_league_id for update;
  if v_row.status = 'active' then
    update public.leagues set status = 'closed', closed_at = v_now, closed_by = p_actor, closed_reason = 'manual',
      version = version + 1 where id = v_row.id returning * into v_row;
    v_version := public.league_publish_standings(v_row.id, 'closed', null, null, 'published');
    insert into public.league_events (league_id, community_id, action, actor_id, details)
      values (v_row.id, v_row.community_id, 'closed', p_actor,
        pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_now), 'standings_version', v_version));
  elsif v_row.status = 'upcoming' then
    update public.leagues set status = 'closed', closed_at = v_now, activation_blocked_at = null,
      closed_reason = 'expired_before_activation', version = version + 1 where id = v_row.id;
    insert into public.league_events (league_id, community_id, action, system_reason, details)
      values (v_row.id, v_row.community_id, 'closed', 'expired_before_activation',
        pg_catalog.jsonb_build_object('closed_at', public.league_utc_text(v_now)));
  end if;
end $$;

create function privacy_internal.account_erasure_execute(p_subject uuid, p_expected jsonb) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_plan jsonb; v_state text; v_new uuid; v_has_history boolean; v_email text; v_diff text[];
  r record; v_pred text; v_count bigint; v_residue jsonb := '{}'::jsonb; v_events uuid[]; v_communities uuid[];
  v_id uuid; v_succ jsonb; v_successor text; v_now timestamptz; v_rev bigint; v_ev public.match_events%rowtype;
begin
  if p_subject is null or p_expected is null or jsonb_typeof(p_expected) <> 'object'
      or not (p_expected ?& array['revision', 'fingerprint', 'impact', 'successors']) then
    raise exception 'ACCOUNT_ERASURE_PLAN_INVALID' using errcode = 'P0001';
  end if;

  -- Canonical lock order: subject communities (id order), rating projection, statistics, then rows.
  v_communities := array(
    select x from (
      select m.community_id x from public.community_members m where m.user_id = p_subject
      union select c.id from public.communities c where c.created_by = p_subject
      union select e.community_id from public.match_events e where e.created_by = p_subject
      union select e.community_id from public.match_events e
        join public.match_event_registrations rg on rg.match_event_id = e.id and rg.user_id = p_subject
      union select l.community_id from public.leagues l where l.owner_id = p_subject) q order by x);
  perform 1 from public.communities c where c.id = any (v_communities) order by c.id for update;
  perform public.lock_global_rating_projection();
  perform public.statistics_lock();
  select i.state into v_state from public.participant_identities i where i.id = p_subject for update;
  if not found then raise exception 'ACCOUNT_ERASURE_SUBJECT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_state <> 'live' then raise exception 'ACCOUNT_ERASURE_SUBJECT_NOT_LIVE' using errcode = 'P0001'; end if;

  v_succ := p_expected -> 'successors';
  v_plan := privacy_internal.account_erasure_plan(p_subject, v_succ);
  if pg_catalog.jsonb_array_length(v_plan -> 'blockers') > 0 then
    raise exception 'ACCOUNT_ERASURE_BLOCKED' using errcode = 'P0001', detail = (v_plan -> 'blockers')::text;
  end if;
  if (v_plan - 'blockers') is distinct from (p_expected - 'blockers') then
    v_diff := array(select k from pg_catalog.jsonb_object_keys(v_plan - 'blockers') k
      where (v_plan -> k) is distinct from (p_expected -> k) order by k);
    raise exception 'ACCOUNT_ERASURE_PLAN_MISMATCH' using errcode = 'P0001', detail = pg_catalog.array_to_string(v_diff, ',');
  end if;

  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = p_subject;
  insert into privacy_internal.erasure_windows (txid) values (pg_catalog.txid_current());
  v_now := pg_catalog.clock_timestamp();

  -- Statistics scopes that must be rebuilt (collected before any re-key).
  v_events := array(select distinct x from (
      select rg.match_event_id x from public.match_event_registrations rg where rg.user_id = p_subject) q);


  -- 1. Ownership: consenting successor transfer, else the approved fallback.
  for v_id in select c.id from public.communities c where c.created_by = p_subject and c.archived_at is null order by c.id loop
    v_successor := v_succ -> 'communities' ->> v_id::text;
    if v_successor is not null then
      update public.communities set created_by = v_successor::uuid where id = v_id;
    else
      update public.communities set archived_at = v_now where id = v_id;
    end if;
  end loop;
  -- A community left without any other active admin is archived ownerless too.
  update public.communities c set archived_at = v_now
   where c.archived_at is null and c.id = any (v_communities)
     and exists (select 1 from public.community_members m where m.community_id = c.id and m.user_id = p_subject
       and m.role = 'admin' and m.status = 'active' and m.valid_until is null)
     and not exists (select 1 from public.community_members a where a.community_id = c.id and a.user_id <> p_subject
       and a.role = 'admin' and a.status = 'active' and (a.valid_until is null or a.valid_until > v_now));

  for v_id in select l.id from public.leagues l where l.owner_id = p_subject and l.status <> 'closed' order by l.id loop
    v_successor := v_succ -> 'leagues' ->> v_id::text;
    if v_successor is not null then
      update public.leagues set owner_id = v_successor::uuid, version = version + 1 where id = v_id;
    else
      perform privacy_internal.erasure_close_league(v_id, p_subject);
    end if;
  end loop;

  for v_id in select e.id from public.match_events e where e.created_by = p_subject and e.status = 'open'
      and e.starts_at > v_now order by e.id loop
    v_successor := v_succ -> 'matches' ->> v_id::text;
    if v_successor is not null then
      v_ev := public.lock_match_event_registration(v_id);
      update public.match_events set created_by = v_successor::uuid, version = version + 1, updated_at = v_now where id = v_id;
      v_rev := public.advance_match_registration_revision_locked(v_id);
      insert into public.match_event_audit_log (match_event_id, community_id, actor_id, target_user_id, action, request_id,
          occurred_at, event_version, transition_revision, before_data, after_data, changed_fields)
        values (v_id, v_ev.community_id, p_subject, v_successor::uuid, 'transfer', pg_catalog.gen_random_uuid(), v_now,
          v_ev.version + 1, v_rev, pg_catalog.jsonb_build_object('owner_id', p_subject),
          pg_catalog.jsonb_build_object('owner_id', v_successor::uuid), array['created_by']);
      perform public.persist_notification(v_successor::uuid, 'match.transferred:' || v_id || ':' || (v_ev.version + 1),
        'match_event_ownership_transferred', 'matches', 'match_event', v_id, v_ev.community_id);
    else
      perform privacy_internal.erasure_cancel_event(v_id, p_subject);
    end if;
  end loop;

  -- Archived communities retire their unsupported future activity.
  for v_id in select l.id from public.leagues l join public.communities c on c.id = l.community_id
      where c.archived_at is not null and l.status <> 'closed' order by l.id loop
    perform privacy_internal.erasure_close_league(v_id, p_subject);
  end loop;
  for v_id in select e.id from public.match_events e join public.communities c on c.id = e.community_id
      where c.archived_at is not null and e.status = 'open' and e.starts_at > v_now order by e.id loop
    perform privacy_internal.erasure_cancel_event(v_id, p_subject);
  end loop;

  -- 2. The subject's own future participation and pending capabilities end.
  for v_id in select e.id from public.match_events e
      join public.match_event_registrations rg on rg.match_event_id = e.id and rg.user_id = p_subject
      where e.status = 'open' and e.starts_at > v_now and rg.cancelled_at is null and rg.lifecycle in ('accepted', 'pending')
        and not exists (select 1 from public.match_event_registration_state s
          where s.match_event_id = e.id and s.results_protected_at is not null) order by e.id loop
    perform privacy_internal.erasure_withdraw_registration(v_id, p_subject);
  end loop;
  update public.match_event_invites set status = 'cancelled', responded_at = v_now, responded_by = p_subject
    where status = 'pending' and (invitee_user_id = p_subject or invited_by = p_subject);
  update public.community_invitations set revoked_at = v_now
    where redeemed_at is null and revoked_at is null and (invitee_user_id = p_subject or issued_by = p_subject);
  update public.community_members set status = 'inactive',
      valid_until = greatest(v_now, valid_from + interval '1 microsecond', coalesce(activated_at, valid_from))
    where user_id = p_subject and valid_until is null and status in ('active', 'pending');

  -- Add-by-email work for the subject's own address is fenced and redacted.
  if v_email is not null then
    delete from public.match_player_add_recipient_sends s where s.email_digest = public.match_player_add_digest(v_email);
    delete from public.match_player_add_throttle_hits h where h.email_digest = public.match_player_add_digest(v_email);
    update public.match_player_add_operations set email = 'redacted', display_name = 'redacted',
        capability_hash = null, capability_expires_at = null, dispatch_state = 'suppressed', email_eligible = false
      where email = v_email;
  end if;

  -- 3. Storage pointers: media owned by the subject is detached (no-photo contract).
  update public.match_events set photo_path = null where pg_catalog.split_part(photo_path, '/', 3) = p_subject::text;
  update public.community_venues set photo_path = null where pg_catalog.split_part(photo_path, '/', 3) = p_subject::text;

  -- 4. Subject-authored text, before the re-key (the subject column still carries the old id).
  for r in select * from privacy_internal.erasure_dispositions d where d.disposition = 'text_redact' loop
    execute pg_catalog.format('update public.%I set %I = $2 where %I = $1 and %I is distinct from $2',
      r.table_name, r.column_name, r.subject_column, r.column_name) using p_subject, r.replacement;
  end loop;

  -- 5. Re-key retained history to a random withdrawn identity. The subject's own rating
  -- initialization is personal, not shared history, unless the subject ever played a rated game.
  if not exists (select 1 from public.player_rating_events e where e.user_id = p_subject) then
    delete from public.player_rating_initializations where user_id = p_subject;
  end if;
  v_has_history := privacy_internal.erasure_has_history(p_subject);
  if v_has_history then
    v_new := pg_catalog.gen_random_uuid();
    insert into public.participant_identities (id, state) values (v_new, 'withdrawn');
    set constraints public.match_event_registration_attempts_match_event_id_user_id_fkey deferred;
    for r in select * from privacy_internal.erasure_dispositions d
        where d.disposition in ('anchor_rekey', 'composite_rekey', 'uuid_rekey', 'jsonb_rekey') order by d.table_name, d.column_name loop
      v_pred := privacy_internal.erasure_location_predicate(r.table_name, r.column_name);
      if (select pg_catalog.format_type(a.atttypid, a.atttypmod) from pg_catalog.pg_attribute a
           where a.attrelid = pg_catalog.format('public.%I', r.table_name)::regclass and a.attname = r.column_name) in ('jsonb', 'json') then
        execute pg_catalog.format('update public.%I set %I = pg_catalog.replace(%I::text, $2, $3)::jsonb where %s',
          r.table_name, r.column_name, r.column_name, v_pred) using p_subject, p_subject::text, v_new::text;
      else
        execute pg_catalog.format('update public.%I set %I = $2 where %s', r.table_name, r.column_name, v_pred)
          using p_subject, v_new;
      end if;
    end loop;
    set constraints public.match_event_registration_attempts_match_event_id_user_id_fkey immediate;
  end if;

  -- 6. Personal state is hard-deleted.
  delete from public.statistics_rank_dirty where player_id = p_subject;
  delete from public.community_request_messages where sender_user_id = p_subject or recipient_user_id = p_subject;
  delete from public.community_notifications where recipient_user_id = p_subject;
  delete from public.match_player_add_actor_windows where actor_id = p_subject;
  delete from public.match_player_add_throttle_hits where actor_id = p_subject;
  delete from public.notifications where recipient_user_id = p_subject;
  delete from public.notification_preferences where user_id = p_subject;
  delete from public.push_subscriptions where user_id = p_subject;
  delete from public.provisional_claim_password_pending where user_id = p_subject;
  delete from public.match_event_result_entry_ready_dispatch where creator_user_id = p_subject;
  delete from public.player_profiles where user_id = p_subject;

  -- 7. Derived statistics are rebuilt from the re-keyed sources.
  for v_id in select distinct e.community_id from public.match_events e where e.id = any (v_events) order by 1 loop
    perform public.rebuild_statistics(v_id);
  end loop;

  -- 8. Residue scan over every classified location.
  for r in select * from privacy_internal.erasure_dispositions d
      where d.disposition not in ('text_redact', 'operator_blocker') order by d.table_name, d.column_name loop
    v_pred := privacy_internal.erasure_location_predicate(r.table_name, r.column_name);
    execute pg_catalog.format('select pg_catalog.count(*) from public.%I where %s', r.table_name, v_pred)
      into v_count using p_subject, p_subject::text;
    if v_count > 0 then
      v_residue := pg_catalog.jsonb_set(v_residue, array[r.disposition],
        pg_catalog.to_jsonb(coalesce((v_residue ->> r.disposition)::bigint, 0) + v_count));
    end if;
  end loop;
  if v_residue <> '{}'::jsonb then
    raise exception 'ACCOUNT_ERASURE_RESIDUAL_REFERENCE' using errcode = 'P0001', detail = v_residue::text;
  end if;

  -- 9. The old anchor goes last: RESTRICT edges make any missed typed reference abort the transaction.
  delete from public.participant_identities where id = p_subject;
  delete from privacy_internal.erasure_windows where txid = pg_catalog.txid_current();

  return pg_catalog.jsonb_build_object('revision', 1, 'tombstone_created', v_has_history,
    'impact', v_plan -> 'impact');
end $$;

revoke all on function
  privacy_internal.erasure_location_predicate(text, text),
  privacy_internal.erasure_successor_valid(text, uuid, uuid, uuid),
  privacy_internal.account_erasure_plan(uuid, jsonb),
  privacy_internal.erasure_has_history(uuid),
  privacy_internal.erasure_cancel_event(uuid, uuid),
  privacy_internal.erasure_withdraw_registration(uuid, uuid),
  privacy_internal.erasure_close_league(uuid, uuid),
  privacy_internal.account_erasure_execute(uuid, jsonb)
  from public, anon, authenticated, service_role;

commit;
