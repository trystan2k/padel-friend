begin;

-- PAF-162: notification producers for domain events that raised no alert before Web Push delivery.
-- Every producer writes through the existing public.persist_notification (immutable, deduped by
-- (recipient, event_key)) inside the transaction of the domain transition, so Push and in-app gain
-- the same single source of truth. Reads, reconnects and replays that change nothing never alert.

-- Anonymous Supabase identities are never notification recipients. Preserve unknown-recipient FK errors.
do $guard$
declare v_definition text := pg_catalog.pg_get_functiondef('public.persist_notification(uuid,text,text,text,text,uuid,uuid)'::regprocedure); v_patched text;
begin
  v_patched := pg_catalog.replace(v_definition, E'begin\n  insert into public.notifications',
    E'begin\n  if exists (select 1 from auth.users u where u.id = p_recipient_user_id and u.is_anonymous) then return null; end if;\n  insert into public.notifications');
  if v_patched = v_definition then raise exception 'persist_notification guard anchor not found'; end if;
  execute v_patched;
end $guard$;

-- Private revision counter is independent of deletable notification history.
create table public.community_role_notification_revisions (
  membership_id uuid primary key references public.community_members(id) on delete cascade,
  revision bigint not null check (revision > 0)
);
alter table public.community_role_notification_revisions enable row level security;
revoke all on public.community_role_notification_revisions from public, anon, authenticated, service_role;

-- 1. Community role changes: notify each affected active member, including an actor whose
-- role changes during ownership transfer. Self-leave does not change role; no-op updates are excluded.
create or replace function public.notify_community_role_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_sequence bigint;
begin
  if new.status <> 'active' or new.valid_until is not null then
    return null;
  end if;
  -- Membership update serializes the revision; rollback/replay cannot publish intermediate state.
  insert into public.community_role_notification_revisions(membership_id, revision) values (new.id, 1)
  on conflict (membership_id) do update set revision = public.community_role_notification_revisions.revision + 1
  returning revision into v_sequence;
  perform public.persist_notification(
    p_recipient_user_id := new.user_id,
    p_event_key := 'community.role_changed:' || new.id::text || ':' || v_sequence::text,
    p_kind := 'community_role_changed',
    p_category := 'community',
    p_target_type := 'community_membership',
    p_target_id := new.id,
    p_community_id := new.community_id
  );
  return null;
end
$function$;

create trigger community_role_notification
  after update of role on public.community_members
  for each row
  when (old.role is distinct from new.role)
  execute function public.notify_community_role_change();

-- 2. Result amendment lifecycle. record_result_amendment_event is the single writer of every lifecycle
-- transition (user commands and the 48h auto-accept alike), so one hook covers both paths.
create or replace function public.notify_result_amendment_event(
  p_amendment public.result_amendment_requests,
  p_event_type text,
  p_actor uuid,
  p_candidate_version bigint
) returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event public.match_events%rowtype;
begin
  if p_event_type not in ('requested', 'accepted', 'disputed') then
    return;
  end if;
  select * into v_event from public.match_events e where e.id = p_amendment.match_event_id;

  if p_event_type = 'requested' then
    -- Decision makers: whoever may submit the corrected candidate (organizer and Community Admins).
    perform public.persist_match_result_notification(
      r.user_id, 'result.amendment_requested:' || p_amendment.id::text, 'result_amendment_requested',
      v_event.id, v_event.community_id, p_amendment.proposal_id, p_amendment.base_version)
      from (
        select v_event.created_by as user_id
        union
        select m.user_id from public.community_members m
         where m.community_id = v_event.community_id and m.status = 'active' and m.role = 'admin'
           and m.valid_from <= pg_catalog.clock_timestamp()
           and (m.valid_until is null or m.valid_until > pg_catalog.clock_timestamp())
      ) r
     where r.user_id <> p_amendment.requester_id;
    return;
  end if;

  -- Decisions go to the requester, unless the requester made the decision themselves.
  if p_amendment.requester_id is not distinct from p_actor then
    return;
  end if;
  perform public.persist_match_result_notification(
    p_amendment.requester_id,
    case p_event_type
      when 'accepted' then 'result.amendment_accepted:' || p_amendment.id::text
      else 'result.amendment_rejected:' || p_amendment.id::text || ':v' || p_candidate_version::text
    end,
    case p_event_type when 'accepted' then 'result_amendment_accepted' else 'result_amendment_rejected' end,
    v_event.id, v_event.community_id, p_amendment.proposal_id, p_candidate_version);
end
$function$;

do $migration$
declare
  v_signature constant regprocedure :=
    'public.record_result_amendment_event(public.result_amendment_requests, text, text, text, uuid, bigint, text, jsonb, uuid, timestamptz)'::regprocedure;
  v_definition text := pg_catalog.pg_get_functiondef(v_signature);
  v_patched text;
begin
  v_patched := pg_catalog.replace(
    v_definition,
    'array[''amendment'', ''lifecycle'']);',
    'array[''amendment'', ''lifecycle'']);' || E'\n'
      || '  perform public.notify_result_amendment_event(p_amendment, p_event_type, p_actor, p_candidate_version);');
  if v_patched = v_definition then
    raise exception 'record_result_amendment_event hook anchor not found';
  end if;
  execute v_patched;

  -- The result context reader gates by kind; the new amendment kinds resolve through the same ownership checks.
  v_definition := pg_catalog.pg_get_functiondef('public.get_my_result_notification_contexts(uuid[])'::regprocedure);
  v_patched := pg_catalog.replace(
    v_definition,
    '''result_amendment_resolved'', ''result_repair_queued''',
    '''result_amendment_resolved'', ''result_amendment_requested'', ''result_amendment_accepted'', ''result_amendment_rejected'', ''result_repair_queued''');
  if v_patched = v_definition then
    raise exception 'get_my_result_notification_contexts kind list anchor not found';
  end if;
  execute v_patched;

  -- Role changes resolve to the member's current community like the other membership notices.
  v_definition := pg_catalog.pg_get_functiondef('public.get_my_notification_target(uuid)'::regprocedure);
  v_patched := pg_catalog.replace(
    v_definition,
    '(''community_membership_approved'',''community_membership_denied'',''community_membership_removed'')',
    '(''community_membership_approved'',''community_membership_denied'',''community_membership_removed'',''community_role_changed'')');
  if v_patched = v_definition then
    raise exception 'get_my_notification_target kind list anchor not found';
  end if;
  execute v_patched;
end
$migration$;

-- 3. Visible rating changes. Alerts key the committed visible state (level and reliability) of a player,
-- never calculation rows: the deferred trigger compares the final committed values with the last published
-- snapshot, so replays that reproduce the same values, intermediate recalculations inside one transaction and
-- the first sight of a player stay silent. A level review approval already announces its own level change.
create table public.player_rating_visible_snapshots (
  user_id uuid primary key references public.global_player_ratings(user_id) on delete cascade,
  display_level numeric(4, 2) not null,
  reliability_percent smallint not null,
  publication_seq bigint not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  constraint player_rating_visible_snapshots_seq_check check (publication_seq >= 0)
);
alter table public.player_rating_visible_snapshots enable row level security;
revoke all on public.player_rating_visible_snapshots from public, anon, authenticated, service_role;
comment on table public.player_rating_visible_snapshots is
  'Last published visible rating (level, reliability) per player; the baseline that decides whether a committed projection change is alert-worthy.';

insert into public.player_rating_visible_snapshots (user_id, display_level, reliability_percent)
select r.user_id, r.display_level, r.reliability_percent from public.global_player_ratings r;

create or replace function public.publish_rating_visible_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_current public.global_player_ratings%rowtype;
  v_snapshot public.player_rating_visible_snapshots%rowtype;
begin
  -- Deferred trigger: NEW is the row as of the event, so the committed row is read again.
  select * into v_current from public.global_player_ratings r where r.user_id = new.user_id;
  if not found then
    return null;
  end if;
  select * into v_snapshot from public.player_rating_visible_snapshots s
   where s.user_id = new.user_id for update;
  if not found then
    insert into public.player_rating_visible_snapshots (user_id, display_level, reliability_percent)
    values (v_current.user_id, v_current.display_level, v_current.reliability_percent)
    on conflict (user_id) do nothing;
    return null;
  end if;
  if v_snapshot.display_level = v_current.display_level
    and v_snapshot.reliability_percent = v_current.reliability_percent then
    return null;
  end if;

  update public.player_rating_visible_snapshots s
     set display_level = v_current.display_level,
         reliability_percent = v_current.reliability_percent,
         publication_seq = s.publication_seq + 1,
         updated_at = pg_catalog.clock_timestamp()
   where s.user_id = v_current.user_id;

  if exists (
    select 1 from public.notifications n
     where n.recipient_user_id = v_current.user_id
       and n.kind = 'level_review_approved'
       and n.created_at = pg_catalog.now()
  ) then
    return null;
  end if;
  perform public.persist_notification(
    p_recipient_user_id := v_current.user_id,
    p_event_key := 'rating.changed:' || v_current.user_id::text || ':' || (v_snapshot.publication_seq + 1)::text,
    p_kind := 'rating_changed',
    p_category := 'rankings',
    p_target_type := 'player_rating',
    p_target_id := v_current.user_id,
    p_community_id := null
  );
  return null;
end
$function$;

create constraint trigger global_player_rating_visible_publication
  after insert or update on public.global_player_ratings
  deferrable initially deferred
  for each row
  execute function public.publish_rating_visible_change();

-- 4. Level review submission: the owner gets a receipt, platform reviewers an actionable request.
create or replace function public.notify_level_review_submission()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
begin
  perform public.persist_notification(new.owner_id, 'level-review:' || new.id::text || ':submitted',
    'level_review_submitted', 'rankings', 'level_review_request', new.id, null);
  perform public.persist_notification(a.user_id, 'level-review:' || new.id::text || ':requested',
    'level_review_requested', 'rankings', 'level_review_request', new.id, null)
    from public.platform_admins a
   where a.user_id <> new.owner_id
     and not exists (select 1 from public.player_profiles p where p.user_id = a.user_id and p.is_provisional)
     and not exists (select 1 from auth.users u where u.id = a.user_id and u.is_anonymous);
  return null;
end
$function$;

create trigger level_review_submission_notification
  after insert on public.player_level_review_requests
  for each row
  when (new.status = 'pending')
  execute function public.notify_level_review_submission();

-- 5. League lifecycle and standings publications. The audience is the community's current active members,
-- the same readers the League and standings RPCs authorize; frozen standings participants who left the
-- community cannot read the League and are therefore not alerted.
create or replace function public.league_notification_recipients(p_community_id uuid, p_excluded uuid)
returns table (user_id uuid)
language sql
stable
security definer
set search_path = ''
as $function$
  select distinct m.user_id
    from public.community_members m
   where m.community_id = p_community_id
     and m.status = 'active'
     and m.valid_from <= pg_catalog.clock_timestamp()
     and (m.valid_until is null or m.valid_until > pg_catalog.clock_timestamp())
     and m.user_id is distinct from p_excluded
     and not exists (select 1 from public.player_profiles p where p.user_id = m.user_id and p.is_provisional)
     and not exists (select 1 from auth.users u where u.id = m.user_id and u.is_anonymous);
$function$;

create or replace function public.notify_league_lifecycle()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_kind text;
begin
  -- Every actual close transition is news, including scheduled expiry before activation.
  if new.status = 'active' then
    v_kind := 'league_started';
  elsif new.status = 'closed' then
    v_kind := 'league_closed';
  else
    return null;
  end if;
  perform public.persist_notification(r.user_id,
    case v_kind when 'league_started' then 'league.started:' else 'league.closed:' end || new.id::text,
    v_kind, 'leagues', 'league', new.id, new.community_id)
    -- The actor is also a recipient when currently authorized; revoked members remain excluded.
    from public.league_notification_recipients(new.community_id, null) r;
  return null;
end
$function$;

create trigger league_lifecycle_notification
  after update of status on public.leagues
  for each row
  when (old.status is distinct from new.status)
  execute function public.notify_league_lifecycle();

create or replace function public.notify_league_standings_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_prior public.league_standings_snapshots%rowtype;
begin
  if new.standings_version > 1 then
    select * into v_prior from public.league_standings_snapshots s
     where s.league_id = new.league_id
       and s.standings_version = coalesce(new.prior_standings_version, new.standings_version - 1);
    -- A republication that changes nothing a reader can see is not news.
    if found and v_prior.entries = new.entries then
      return null;
    end if;
  end if;
  perform public.persist_notification(r.user_id,
    'league.standings:' || new.league_id::text || ':v' || new.standings_version::text,
    case when new.standings_version = 1 then 'league_standings_published' else 'league_standings_amended' end,
    'leagues', 'league', new.league_id, new.community_id)
    from public.league_notification_recipients(new.community_id, null) r;
  return null;
end
$function$;

create trigger league_standings_publication_notification
  after insert on public.league_standings_snapshots
  for each row
  execute function public.notify_league_standings_publication();

revoke execute on function public.notify_community_role_change() from public, anon, authenticated, service_role;
revoke execute on function public.notify_result_amendment_event(public.result_amendment_requests, text, uuid, bigint) from public, anon, authenticated, service_role;
revoke execute on function public.publish_rating_visible_change() from public, anon, authenticated, service_role;
revoke execute on function public.notify_level_review_submission() from public, anon, authenticated, service_role;
revoke execute on function public.league_notification_recipients(uuid, uuid) from public, anon, authenticated, service_role;
revoke execute on function public.notify_league_lifecycle() from public, anon, authenticated, service_role;
revoke execute on function public.notify_league_standings_publication() from public, anon, authenticated, service_role;

commit;
