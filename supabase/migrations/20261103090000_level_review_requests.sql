begin;

-- PAF-147 / T14.1: player level review requests, minimal Platform Admin authorization and
-- the request lifecycle.
--
-- Contract (see docs/plan/Plan PAF-17 T14, "Supporting contracts to freeze before coding"):
--   * Lifecycle (approved scope B1): pending -> under_review -> approved | rejected, plus owner
--     canceled. Direct pending resolution is allowed; terminal states never reopen. At most one
--     ACTIVE (pending or under_review) request per owner (partial unique index).
--   * Platform Admin is a trusted database allowlist (platform_admins). Membership is read from
--     the table on every call, never from JWT/user metadata; the table has no runtime grants and
--     is provisioned by a trusted operator only.
--   * Writes happen only through SECURITY DEFINER commands. Owners may read a safe column subset
--     of their own requests; admin queue/detail are RPC-only.
--   * Approval is fail-closed (LEVEL_REVIEW_APPROVAL_UNAVAILABLE) until the atomic rating
--     adjustment exists; no request can reach 'approved' without an adjustment link (CHECK).

create type public.level_review_status as enum ('pending', 'under_review', 'approved', 'rejected', 'canceled');

-- 1. Platform Admin allowlist.
create table public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete restrict,
  granted_at timestamptz not null default pg_catalog.clock_timestamp(),
  granted_by uuid references auth.users(id) on delete restrict
);
alter table public.platform_admins enable row level security;
revoke all on public.platform_admins from public, anon, authenticated, service_role;
create policy "provisional actor restricted" on public.platform_admins as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

create function public.is_platform_admin() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.platform_admins a where a.user_id = (select auth.uid()));
$$;

-- 2. Policy helpers (internal).
create function public.level_review_submission_limits()
returns table (max_requests integer, window_length interval)
language sql immutable set search_path = '' as $$
  select 3, interval '24 hours';
$$;

create function public.level_review_valid_level(p_level numeric) returns boolean
language sql immutable set search_path = '' as $$
  select p_level is not null and p_level between 0 and 7 and p_level = pg_catalog.round(p_level, 2);
$$;

-- 3. Request table.
create table public.player_level_review_requests (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete restrict,
  command_id uuid not null,
  fingerprint text not null,
  snapshot_display_level numeric(4,2) not null check (snapshot_display_level between 0 and 7),
  snapshot_reliability_percent integer not null check (snapshot_reliability_percent between 0 and 100),
  snapshot_rating_revision bigint not null check (snapshot_rating_revision >= 0),
  requested_min_level numeric(4,2) not null check (requested_min_level between 0 and 7),
  requested_max_level numeric(4,2) not null check (requested_max_level between 0 and 7),
  reason text not null check (char_length(reason) between 1 and 2000 and reason = btrim(reason, E' \t\n\r\f\v')),
  evidence text check (evidence is null
    or (char_length(evidence) between 1 and 4000 and evidence = btrim(evidence, E' \t\n\r\f\v'))),
  status public.level_review_status not null default 'pending',
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  under_review_at timestamptz,
  under_review_by uuid references auth.users(id) on delete restrict,
  canceled_at timestamptz,
  decision_actor_id uuid references auth.users(id) on delete restrict,
  decision_command_id uuid,
  decision_fingerprint text,
  decision_note text check (decision_note is null
    or (char_length(decision_note) between 1 and 2000 and decision_note = btrim(decision_note, E' \t\n\r\f\v'))),
  decided_at timestamptz,
  approved_level numeric(4,2) check (approved_level between 0 and 7),
  adjustment_id uuid,
  constraint level_review_owner_command_unique unique (owner_id, command_id),
  constraint level_review_range_ordered check (requested_min_level <= requested_max_level),
  constraint level_review_under_review_pair check ((under_review_at is null) = (under_review_by is null)),
  constraint level_review_decision_complete check (
    (decision_actor_id is null) = (decision_command_id is null)
    and (decision_actor_id is null) = (decision_fingerprint is null)
    and (decision_actor_id is null) = (decision_note is null)
    and (decision_actor_id is null) = (decided_at is null)),
  constraint level_review_status_shape check (
    case status
      when 'pending' then under_review_at is null and canceled_at is null and decision_actor_id is null
        and approved_level is null and adjustment_id is null
      when 'under_review' then under_review_at is not null and canceled_at is null and decision_actor_id is null
        and approved_level is null and adjustment_id is null
      when 'canceled' then canceled_at is not null and decision_actor_id is null
        and approved_level is null and adjustment_id is null
      when 'rejected' then canceled_at is null and decision_actor_id is not null
        and approved_level is null and adjustment_id is null
      when 'approved' then canceled_at is null and decision_actor_id is not null
        and approved_level is not null and adjustment_id is not null
    end),
  constraint level_review_approved_in_range check (
    approved_level is null or approved_level between requested_min_level and requested_max_level)
);

create unique index level_review_one_active_per_owner on public.player_level_review_requests (owner_id)
  where status in ('pending', 'under_review');
create index level_review_owner_history on public.player_level_review_requests (owner_id, created_at desc, id desc);
create index level_review_queue on public.player_level_review_requests (status, created_at, id);

-- Forward-only lifecycle and immutable submission content.
create function public.guard_level_review_request() returns trigger
language plpgsql set search_path = '' as $$
begin
  if old.status in ('approved', 'rejected', 'canceled') then
    raise exception using errcode = '55000', message = 'LEVEL_REVIEW_TERMINAL_IMMUTABLE';
  end if;
  if (new.id, new.owner_id, new.command_id, new.fingerprint, new.snapshot_display_level,
      new.snapshot_reliability_percent, new.snapshot_rating_revision, new.requested_min_level,
      new.requested_max_level, new.reason, new.evidence, new.created_at)
    is distinct from (old.id, old.owner_id, old.command_id, old.fingerprint, old.snapshot_display_level,
      old.snapshot_reliability_percent, old.snapshot_rating_revision, old.requested_min_level,
      old.requested_max_level, old.reason, old.evidence, old.created_at) then
    raise exception using errcode = '55000', message = 'LEVEL_REVIEW_SUBMISSION_IMMUTABLE';
  end if;
  if not ((old.status = 'pending' and new.status in ('under_review', 'approved', 'rejected', 'canceled'))
    or (old.status = 'under_review' and new.status in ('approved', 'rejected', 'canceled'))) then
    raise exception using errcode = '55000', message = 'LEVEL_REVIEW_INVALID_TRANSITION';
  end if;
  return new;
end $$;
create trigger level_review_requests_guard before update on public.player_level_review_requests
  for each row execute function public.guard_level_review_request();

create function public.guard_level_review_no_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = '55000', message = 'LEVEL_REVIEW_EVIDENCE_IMMUTABLE';
end $$;
create trigger level_review_requests_no_delete before delete on public.player_level_review_requests
  for each row execute function public.guard_level_review_no_delete();
create trigger level_review_requests_no_truncate before truncate on public.player_level_review_requests
  for each statement execute function public.guard_level_review_no_delete();

alter table public.player_level_review_requests enable row level security;
revoke all on public.player_level_review_requests from public, anon, authenticated, service_role;

-- Owners read a safe subset of their own rows; internal actors, command ids and fingerprints
-- stay out of reach. No runtime role holds a write privilege.
grant select (id, owner_id, status, snapshot_display_level, snapshot_reliability_percent,
  requested_min_level, requested_max_level, reason, evidence, created_at, under_review_at,
  canceled_at, decided_at, decision_note, approved_level, adjustment_id)
  on public.player_level_review_requests to authenticated;
create policy "owner select" on public.player_level_review_requests
  for select to authenticated using (owner_id = (select auth.uid()));
create policy "provisional actor restricted" on public.player_level_review_requests
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

-- 4. DTO builders (internal). Fixed key whitelists; owner DTO never carries internal actors.
create function public.level_review_owner_dto(r public.player_level_review_requests) returns jsonb
language sql stable set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', r.id, 'status', r.status,
    'snapshot_display_level', r.snapshot_display_level,
    'snapshot_reliability_percent', r.snapshot_reliability_percent,
    'requested_min_level', r.requested_min_level, 'requested_max_level', r.requested_max_level,
    'reason', r.reason, 'evidence', r.evidence,
    'created_at', public.rating_utc_text(r.created_at),
    'under_review_at', public.rating_utc_text(r.under_review_at),
    'canceled_at', public.rating_utc_text(r.canceled_at),
    'decided_at', public.rating_utc_text(r.decided_at),
    'decision_note', r.decision_note, 'approved_level', r.approved_level,
    'adjustment_id', r.adjustment_id);
$$;

create function public.level_review_admin_dto(r public.player_level_review_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select public.level_review_owner_dto(r) || pg_catalog.jsonb_build_object(
    'owner_id', r.owner_id,
    'owner_display_name', (select p.display_name from public.player_profiles p where p.user_id = r.owner_id),
    'snapshot_rating_revision', r.snapshot_rating_revision,
    'under_review_by', r.under_review_by, 'decision_actor_id', r.decision_actor_id);
$$;

create function public.level_review_queue_item_dto(r public.player_level_review_requests) returns jsonb
language sql stable security definer set search_path = '' as $$
  select pg_catalog.jsonb_build_object(
    'id', r.id, 'status', r.status, 'owner_id', r.owner_id,
    'owner_display_name', (select p.display_name from public.player_profiles p where p.user_id = r.owner_id),
    'snapshot_display_level', r.snapshot_display_level,
    'snapshot_reliability_percent', r.snapshot_reliability_percent,
    'requested_min_level', r.requested_min_level, 'requested_max_level', r.requested_max_level,
    'created_at', public.rating_utc_text(r.created_at),
    'under_review_at', public.rating_utc_text(r.under_review_at),
    'decided_at', public.rating_utc_text(r.decided_at));
$$;

-- 5. Actor gates (internal). Public commands also call assert_actor_not_provisional inline so
-- the provisional-guard inventory sees every entry point.
create function public.level_review_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := (select auth.uid());
begin
  if v_uid is null or coalesce((select auth.jwt()) ->> 'is_anonymous', 'false') = 'true' then
    raise exception using errcode = '28000', message = 'LEVEL_REVIEW_UNAUTHENTICATED';
  end if;
  return v_uid;
end $$;

create function public.level_review_admin_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.level_review_actor();
begin
  if not public.is_platform_admin() then
    raise exception using errcode = '42501', message = 'LEVEL_REVIEW_FORBIDDEN';
  end if;
  return v_uid;
end $$;

-- 6. Access context: only the caller's own access.
create function public.get_level_review_access() returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.level_review_actor();
begin
  perform public.assert_actor_not_provisional();
  return pg_catalog.jsonb_build_object('is_platform_admin', public.is_platform_admin());
end $$;

-- 7. Owner commands and readers.
create function public.submit_level_review_request(p_command_id uuid, p_requested_min_level numeric,
  p_requested_max_level numeric, p_reason text, p_evidence text default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.level_review_actor();
  v_reason text := pg_catalog.btrim(p_reason, E' \t\n\r\f\v');
  v_evidence text := nullif(pg_catalog.btrim(p_evidence, E' \t\n\r\f\v'), '');
  v_fingerprint text; v_row public.player_level_review_requests%rowtype;
  v_limits record; v_recent integer; v_revision bigint; v_summary jsonb;
begin
  perform public.assert_actor_not_provisional();
  if p_command_id is null or not public.level_review_valid_level(p_requested_min_level)
    or not public.level_review_valid_level(p_requested_max_level)
    or p_requested_min_level > p_requested_max_level
    or v_reason is null or pg_catalog.char_length(v_reason) not between 1 and 2000
    or (v_evidence is not null and pg_catalog.char_length(v_evidence) > 4000) then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;

  -- Per-owner submit lock, distinct from the rating lock: serializes idempotency lookup,
  -- duplicate guard and throttle so two submissions race to exactly one winner.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('padel-friend:level-review-submit:' || v_uid::text, 0));

  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(
    p_requested_min_level::numeric(4,2)::text, p_requested_max_level::numeric(4,2)::text,
    v_reason, v_evidence)::text);
  select * into v_row from public.player_level_review_requests r
   where r.owner_id = v_uid and r.command_id = p_command_id;
  if found then
    if v_row.fingerprint <> v_fingerprint then
      raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_IDEMPOTENCY_CONFLICT';
    end if;
    return pg_catalog.jsonb_build_object('request', public.level_review_owner_dto(v_row), 'replayed', true);
  end if;

  if exists (select 1 from public.player_level_review_requests r
     where r.owner_id = v_uid and r.status in ('pending', 'under_review')) then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_DUPLICATE_ACTIVE';
  end if;

  select * into v_limits from public.level_review_submission_limits();
  select pg_catalog.count(*) into v_recent from public.player_level_review_requests r
   where r.owner_id = v_uid and r.created_at > pg_catalog.clock_timestamp() - v_limits.window_length;
  if v_recent >= v_limits.max_requests then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RATE_LIMITED';
  end if;

  v_revision := public.rating_committed_revision();
  v_summary := public.rating_summary_at(v_uid, v_revision);
  if v_summary is null then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RATING_UNAVAILABLE';
  end if;

  begin
    insert into public.player_level_review_requests(owner_id, command_id, fingerprint,
      snapshot_display_level, snapshot_reliability_percent, snapshot_rating_revision,
      requested_min_level, requested_max_level, reason, evidence)
      values (v_uid, p_command_id, v_fingerprint,
        (v_summary ->> 'display_level')::numeric, (v_summary ->> 'reliability_percent')::integer, v_revision,
        p_requested_min_level, p_requested_max_level, v_reason, v_evidence)
      returning * into v_row;
  exception when unique_violation then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_DUPLICATE_ACTIVE';
  end;
  return pg_catalog.jsonb_build_object('request', public.level_review_owner_dto(v_row), 'replayed', false);
end $$;

create function public.list_my_level_review_requests(p_limit integer default 20,
  p_after_created_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.level_review_actor(); v_ids uuid[]; v_items jsonb; v_more boolean; v_last jsonb;
begin
  perform public.assert_actor_not_provisional();
  if p_limit is null or p_limit < 1 or p_limit > 50
    or (p_after_created_at is null) <> (p_after_id is null) then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;
  v_ids := array(select r.id from public.player_level_review_requests r
     where r.owner_id = v_uid
       and (p_after_created_at is null or (r.created_at, r.id) < (p_after_created_at, p_after_id))
     order by r.created_at desc, r.id desc limit p_limit + 1);
  v_more := pg_catalog.cardinality(v_ids) > p_limit;
  v_ids := v_ids[1:p_limit];
  select coalesce(pg_catalog.jsonb_agg(public.level_review_owner_dto(r) order by r.created_at desc, r.id desc), '[]'::jsonb)
    into v_items from public.player_level_review_requests r where r.id = any(v_ids);
  v_last := v_items -> (pg_catalog.jsonb_array_length(v_items) - 1);
  return pg_catalog.jsonb_build_object('items', v_items,
    'next_cursor', case when v_more then pg_catalog.jsonb_build_object(
      'created_at', v_last ->> 'created_at', 'id', v_last ->> 'id') end);
end $$;

create function public.get_my_level_review_request(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare v_uid uuid := public.level_review_actor(); v_row public.player_level_review_requests%rowtype;
begin
  perform public.assert_actor_not_provisional();
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;
  select * into v_row from public.player_level_review_requests r where r.id = p_request_id and r.owner_id = v_uid;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_NOT_FOUND';
  end if;
  return pg_catalog.jsonb_build_object('request', public.level_review_owner_dto(v_row));
end $$;

create function public.cancel_level_review_request(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.level_review_actor(); v_row public.player_level_review_requests%rowtype;
begin
  perform public.assert_actor_not_provisional();
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;
  select * into v_row from public.player_level_review_requests r
   where r.id = p_request_id and r.owner_id = v_uid for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_NOT_FOUND';
  end if;
  if v_row.status = 'canceled' then
    return pg_catalog.jsonb_build_object('request', public.level_review_owner_dto(v_row), 'replayed', true);
  end if;
  if v_row.status not in ('pending', 'under_review') then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_INVALID_TRANSITION';
  end if;
  update public.player_level_review_requests r
     set status = 'canceled', canceled_at = pg_catalog.clock_timestamp()
   where r.id = v_row.id returning * into v_row;
  return pg_catalog.jsonb_build_object('request', public.level_review_owner_dto(v_row), 'replayed', false);
end $$;

-- 8. Platform Admin readers and commands.
create function public.list_level_review_queue(p_status text default null, p_limit integer default 20,
  p_after_created_at timestamptz default null, p_after_id uuid default null) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.level_review_admin_actor(); v_ids uuid[]; v_items jsonb; v_more boolean; v_last jsonb;
  v_status public.level_review_status;
begin
  perform public.assert_actor_not_provisional();
  if p_limit is null or p_limit < 1 or p_limit > 50
    or (p_after_created_at is null) <> (p_after_id is null)
    or (p_status is not null and p_status not in ('pending', 'under_review', 'approved', 'rejected', 'canceled')) then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;
  v_status := p_status::public.level_review_status;
  v_ids := array(select r.id from public.player_level_review_requests r
     where (v_status is null or r.status = v_status)
       and (p_after_created_at is null or (r.created_at, r.id) > (p_after_created_at, p_after_id))
     order by r.created_at, r.id limit p_limit + 1);
  v_more := pg_catalog.cardinality(v_ids) > p_limit;
  v_ids := v_ids[1:p_limit];
  select coalesce(pg_catalog.jsonb_agg(public.level_review_queue_item_dto(r) order by r.created_at, r.id), '[]'::jsonb)
    into v_items from public.player_level_review_requests r where r.id = any(v_ids);
  v_last := v_items -> (pg_catalog.jsonb_array_length(v_items) - 1);
  return pg_catalog.jsonb_build_object(
    'pending_count', (select pg_catalog.count(*) from public.player_level_review_requests r where r.status = 'pending'),
    'under_review_count', (select pg_catalog.count(*) from public.player_level_review_requests r where r.status = 'under_review'),
    'items', v_items,
    'next_cursor', case when v_more then pg_catalog.jsonb_build_object(
      'created_at', v_last ->> 'created_at', 'id', v_last ->> 'id') end);
end $$;

-- Request, fresh rating state and a bounded safe slice of recent rating history. Read-only:
-- the owner-only rating policies are not widened.
create function public.get_level_review_admin_detail(p_request_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid uuid := public.level_review_admin_actor(); v_row public.player_level_review_requests%rowtype;
  v_revision bigint; v_summary jsonb; v_history jsonb;
begin
  perform public.assert_actor_not_provisional();
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;
  select * into v_row from public.player_level_review_requests r where r.id = p_request_id;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_NOT_FOUND';
  end if;
  v_revision := public.rating_committed_revision();
  v_summary := public.rating_summary_at(v_row.owner_id, v_revision);
  select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'played_at', public.rating_utc_text(h.played_at),
      'before_display_level', h.before_display_level, 'after_display_level', h.after_display_level,
      'after_reliability_percent', h.after_reliability_percent)
    order by h.played_at desc, h.game_group_id desc), '[]'::jsonb) into v_history
    from (select c.* from public.rating_current_calculations(v_row.owner_id, v_revision) c
      order by c.played_at desc, c.game_group_id desc limit 5) h;
  return pg_catalog.jsonb_build_object(
    'request', public.level_review_admin_dto(v_row),
    'current', case when v_summary is null then null else pg_catalog.jsonb_build_object(
      'revision', v_revision, 'display_level', (v_summary ->> 'display_level')::numeric,
      'reliability_percent', (v_summary ->> 'reliability_percent')::integer,
      'confirmed_competitive_game_groups', (v_summary ->> 'confirmed_competitive_game_groups')::integer) end,
    'rating_changed', v_row.snapshot_rating_revision <> v_revision,
    'recent_history', v_history);
end $$;

create function public.mark_level_review_under_review(p_request_id uuid) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare v_uid uuid := public.level_review_admin_actor(); v_row public.player_level_review_requests%rowtype;
begin
  perform public.assert_actor_not_provisional();
  if p_request_id is null then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;
  select * into v_row from public.player_level_review_requests r where r.id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_NOT_FOUND';
  end if;
  if v_row.status = 'under_review' then
    return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', true);
  end if;
  if v_row.status <> 'pending' then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_INVALID_TRANSITION';
  end if;
  update public.player_level_review_requests r
     set status = 'under_review', under_review_at = pg_catalog.clock_timestamp(), under_review_by = v_uid
   where r.id = v_row.id returning * into v_row;
  return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', false);
end $$;

-- Resolution. Reject is complete here. Approve validates authorization, input, corrected
-- target and expected rating revision, then fails closed: no request is ever marked approved
-- without the immutable rating adjustment, which a later migration installs atomically.
create function public.resolve_level_review_request(p_request_id uuid, p_command_id uuid, p_decision text,
  p_note text, p_target_level numeric default null, p_expected_revision bigint default null) returns jsonb
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := public.level_review_admin_actor();
  v_note text := pg_catalog.btrim(p_note, E' \t\n\r\f\v');
  v_row public.player_level_review_requests%rowtype; v_fingerprint text;
begin
  perform public.assert_actor_not_provisional();
  if p_request_id is null or p_command_id is null or p_decision is null
    or p_decision not in ('approve', 'reject')
    or v_note is null or pg_catalog.char_length(v_note) not between 1 and 2000
    or (p_decision = 'approve' and (not public.level_review_valid_level(p_target_level)
      or p_expected_revision is null or p_expected_revision < 0))
    or (p_decision = 'reject' and (p_target_level is not null or p_expected_revision is not null)) then
    raise exception using errcode = '22023', message = 'LEVEL_REVIEW_INVALID_ARGUMENT';
  end if;

  select * into v_row from public.player_level_review_requests r where r.id = p_request_id for update;
  if not found then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_NOT_FOUND';
  end if;
  v_fingerprint := pg_catalog.md5(pg_catalog.jsonb_build_array(p_decision, v_note,
    p_target_level::numeric(4,2)::text)::text);

  if v_row.status in ('approved', 'rejected') then
    if v_row.decision_command_id = p_command_id and v_row.decision_fingerprint = v_fingerprint then
      return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', true);
    end if;
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_RESOLUTION_CONFLICT';
  end if;
  if v_row.status = 'canceled' then
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_INVALID_TRANSITION';
  end if;

  if p_decision = 'approve' then
    if p_target_level not between v_row.requested_min_level and v_row.requested_max_level then
      raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_TARGET_OUT_OF_RANGE';
    end if;
    if p_expected_revision <> public.rating_committed_revision() then
      raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_STALE_RATING';
    end if;
    raise exception using errcode = 'P0001', message = 'LEVEL_REVIEW_APPROVAL_UNAVAILABLE';
  end if;

  update public.player_level_review_requests r
     set status = 'rejected', decision_actor_id = v_uid, decision_command_id = p_command_id,
         decision_fingerprint = v_fingerprint, decision_note = v_note,
         decided_at = pg_catalog.clock_timestamp()
   where r.id = v_row.id returning * into v_row;
  return pg_catalog.jsonb_build_object('request', public.level_review_admin_dto(v_row), 'replayed', false);
end $$;

-- 9. Grants: only the public commands/readers are callable by signed-in users.
revoke all on function public.is_platform_admin(), public.level_review_submission_limits(),
  public.level_review_valid_level(numeric), public.guard_level_review_request(),
  public.guard_level_review_no_delete(),
  public.level_review_owner_dto(public.player_level_review_requests),
  public.level_review_admin_dto(public.player_level_review_requests),
  public.level_review_queue_item_dto(public.player_level_review_requests),
  public.level_review_actor(), public.level_review_admin_actor(),
  public.get_level_review_access(),
  public.submit_level_review_request(uuid, numeric, numeric, text, text),
  public.list_my_level_review_requests(integer, timestamptz, uuid),
  public.get_my_level_review_request(uuid), public.cancel_level_review_request(uuid),
  public.list_level_review_queue(text, integer, timestamptz, uuid),
  public.get_level_review_admin_detail(uuid), public.mark_level_review_under_review(uuid),
  public.resolve_level_review_request(uuid, uuid, text, text, numeric, bigint)
  from public, anon, authenticated, service_role;
grant execute on function public.get_level_review_access(),
  public.submit_level_review_request(uuid, numeric, numeric, text, text),
  public.list_my_level_review_requests(integer, timestamptz, uuid),
  public.get_my_level_review_request(uuid), public.cancel_level_review_request(uuid),
  public.list_level_review_queue(text, integer, timestamptz, uuid),
  public.get_level_review_admin_detail(uuid), public.mark_level_review_under_review(uuid),
  public.resolve_level_review_request(uuid, uuid, text, text, numeric, bigint)
  to authenticated;

commit;
