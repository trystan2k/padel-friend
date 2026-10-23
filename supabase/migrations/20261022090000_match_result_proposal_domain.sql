begin;

-- PAF-7 T07.1 — Result proposal domain (versioned proposals, played_at, group court metadata).
--
-- Additive fact store for per-Game-Group result proposals. One active pointer
-- row per (event, game group) in match_event_result_proposals (status starts
-- 'pending', active_version, review_deadline_at) plus append-only immutable
-- fact-set versions in match_event_result_proposal_versions (explicit 2+2 team
-- assignment by user id, sequential set rows, computed classification, and
-- played_at stored three ways — UTC instant, entered local wall time, entered
-- UTC offset; nothing derives another — plus one optional free-text court
-- label). Later status transitions stay additive: status is a text CHECK, not
-- a new enum.
--
-- PAF-102 protection contract (20261021205000_match_management_result_protection):
-- public.protect_match_event_results reserved this writer: the future result
-- writer must invoke it under the canonical lock chain inside the same
-- transaction as the first proposal insert (overdue cutoff finalized first, so
-- the played quartet freezes atomically with the proposal). No client-facing
-- write path exists yet (T07.3 owns the SECURITY DEFINER submission RPC).
--
-- Safety:
--   * proposals: RLS enabled with exactly one SELECT policy (event creator,
--     event-community admin, accepted participants); no INSERT/UPDATE/DELETE
--     policies; only SELECT is granted to authenticated;
--   * versions: RLS enabled with NO policies and no client grants —
--     internal-only, readable through SECURITY DEFINER RPCs (the table owner
--     bypasses RLS inside definers, every browser role is denied at the ACL);
--   * both tables carry an unconditional UPDATE/DELETE guard trigger: facts
--     are append-only; later corrections append new versions, never rewrite.

create table public.match_event_result_proposals (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  group_number bigint not null check (group_number between 1 and 9007199254740991),
  status text not null check (status = 'pending'),
  active_version bigint not null,
  review_deadline_at timestamptz not null,
  submitted_by uuid not null references auth.users(id) on delete restrict,
  submitted_at timestamptz not null default now(),
  unique (match_event_id, group_number)
);
comment on table public.match_event_result_proposals is
  'PAF-7 active result-proposal pointer, one row per (match event, game group). Status starts ''pending''; review_deadline_at carries the 48-hour auto-confirm deadline for the later review epic. Fulfills the PAF-102 protection contract: the result writer invokes public.protect_match_event_results under the canonical lock chain inside the same transaction as the first insert. Direct client writes are revoked; submission goes through the SECURITY DEFINER RPC only.';

create table public.match_event_result_proposal_versions (
  proposal_id uuid not null references public.match_event_result_proposals(id) on delete restrict,
  version bigint not null check (version >= 1),
  teams jsonb not null check (
    -- Exact-key {team_a:[user,user],team_b:[user,user]} holding four distinct
    -- canonical lowercase uuids. CASE guards keep jsonb_array_length off
    -- non-arrays (branch selection is ordered, so no type error can escape);
    -- every predicate is total and immutable (no subqueries, no casts), so a
    -- shape violation is always a clean 23514 check_violation.
    case
      when jsonb_typeof(teams) <> 'object' then false
      when teams <> jsonb_build_object('team_a', teams -> 'team_a', 'team_b', teams -> 'team_b') then
        false -- exact keys: no missing, no extra
      when jsonb_typeof(teams -> 'team_a') <> 'array' or jsonb_typeof(teams -> 'team_b') <> 'array' then
        false
      when jsonb_array_length(teams -> 'team_a') <> 2 or jsonb_array_length(teams -> 'team_b') <> 2 then
        false
      when jsonb_typeof(teams -> 'team_a' -> 0) <> 'string'
        or jsonb_typeof(teams -> 'team_a' -> 1) <> 'string'
        or jsonb_typeof(teams -> 'team_b' -> 0) <> 'string'
        or jsonb_typeof(teams -> 'team_b' -> 1) <> 'string' then
        false
      when (teams -> 'team_a' ->> 0) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (teams -> 'team_a' ->> 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (teams -> 'team_b' ->> 0) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
        or (teams -> 'team_b' ->> 1) !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
        false
      else
        (teams -> 'team_a' ->> 0) is distinct from (teams -> 'team_a' ->> 1)
        and (teams -> 'team_a' ->> 0) is distinct from (teams -> 'team_b' ->> 0)
        and (teams -> 'team_a' ->> 0) is distinct from (teams -> 'team_b' ->> 1)
        and (teams -> 'team_a' ->> 1) is distinct from (teams -> 'team_b' ->> 0)
        and (teams -> 'team_a' ->> 1) is distinct from (teams -> 'team_b' ->> 1)
        and (teams -> 'team_b' ->> 0) is distinct from (teams -> 'team_b' ->> 1)
    end
  ),
  sets jsonb not null check (
    -- Array of 1..3 exact-key rows {position 1..3, team_a_games 0..7,
    -- team_b_games 0..7, completed boolean}. Canonical integer text only
    -- ('2' passes, '2.0'/'01'/' 2' fail); ordering/sequencing of set rows is
    -- owned by the T07.2 scoring engine, not by this shape CHECK.
    case
      when jsonb_typeof(sets) <> 'array' then false
      when jsonb_array_length(sets) not between 1 and 3 then false
      else
        (
          case
            when sets -> 0 is null then true
            when jsonb_typeof(sets -> 0) <> 'object' then false
            when sets -> 0 <> jsonb_build_object(
              'position', sets -> 0 -> 'position',
              'team_a_games', sets -> 0 -> 'team_a_games',
              'team_b_games', sets -> 0 -> 'team_b_games',
              'completed', sets -> 0 -> 'completed') then false
            else
              jsonb_typeof(sets -> 0 -> 'position') = 'number'
              and sets -> 0 ->> 'position' in ('1', '2', '3')
              and jsonb_typeof(sets -> 0 -> 'team_a_games') = 'number'
              and sets -> 0 ->> 'team_a_games' ~ '^[0-7]$'
              and jsonb_typeof(sets -> 0 -> 'team_b_games') = 'number'
              and sets -> 0 ->> 'team_b_games' ~ '^[0-7]$'
              and jsonb_typeof(sets -> 0 -> 'completed') = 'boolean'
          end
        )
        and (
          case
            when sets -> 1 is null then true
            when jsonb_typeof(sets -> 1) <> 'object' then false
            when sets -> 1 <> jsonb_build_object(
              'position', sets -> 1 -> 'position',
              'team_a_games', sets -> 1 -> 'team_a_games',
              'team_b_games', sets -> 1 -> 'team_b_games',
              'completed', sets -> 1 -> 'completed') then false
            else
              jsonb_typeof(sets -> 1 -> 'position') = 'number'
              and sets -> 1 ->> 'position' in ('1', '2', '3')
              and jsonb_typeof(sets -> 1 -> 'team_a_games') = 'number'
              and sets -> 1 ->> 'team_a_games' ~ '^[0-7]$'
              and jsonb_typeof(sets -> 1 -> 'team_b_games') = 'number'
              and sets -> 1 ->> 'team_b_games' ~ '^[0-7]$'
              and jsonb_typeof(sets -> 1 -> 'completed') = 'boolean'
          end
        )
        and (
          case
            when sets -> 2 is null then true
            when jsonb_typeof(sets -> 2) <> 'object' then false
            when sets -> 2 <> jsonb_build_object(
              'position', sets -> 2 -> 'position',
              'team_a_games', sets -> 2 -> 'team_a_games',
              'team_b_games', sets -> 2 -> 'team_b_games',
              'completed', sets -> 2 -> 'completed') then false
            else
              jsonb_typeof(sets -> 2 -> 'position') = 'number'
              and sets -> 2 ->> 'position' in ('1', '2', '3')
              and jsonb_typeof(sets -> 2 -> 'team_a_games') = 'number'
              and sets -> 2 ->> 'team_a_games' ~ '^[0-7]$'
              and jsonb_typeof(sets -> 2 -> 'team_b_games') = 'number'
              and sets -> 2 ->> 'team_b_games' ~ '^[0-7]$'
              and jsonb_typeof(sets -> 2 -> 'completed') = 'boolean'
          end
        )
    end
  ),
  classification text not null check (classification in ('team_a', 'team_b', 'draw', 'incomplete')),
  played_at_utc timestamptz not null,
  played_at_local timestamp not null,
  played_at_offset_seconds integer not null check (
    played_at_offset_seconds between -50400 and 50400
    and played_at_offset_seconds % 60 = 0
  ),
  court_label text check (
    court_label is null
    or (
      char_length(btrim(court_label)) between 1 and 100
      and court_label = btrim(court_label)
      and court_label !~ '[[:cntrl:]]'
    )
  ),
  -- Triple-column consistency: the stored UTC instant must equal the entered
  -- local wall time minus the entered offset. Both sides are compared as
  -- timestamp (UTC-normalized left side), so the predicate never depends on
  -- the session TimeZone.
  check (played_at_utc at time zone 'UTC' = played_at_local - make_interval(secs => played_at_offset_seconds)),
  primary key (proposal_id, version)
);
comment on table public.match_event_result_proposal_versions is
  'PAF-7 append-only result fact set per proposal version: explicit 2+2 teams by user id, ordered set rows, classification (team_a/team_b/draw/incomplete), played_at stored independently as UTC instant + entered local wall time + entered UTC offset, and one optional trimmed court label. Internal-only: RLS enabled with no policies and no client grants; readers go through SECURITY DEFINER RPCs. Fulfills the result-writer contract reserved by public.protect_match_event_results (20261021205000).';

-- Append-only guards: facts are never rewritten in place; corrections append a
-- new version row and the active pointer moves in a later, explicitly migrated
-- transition. Both triggers are unconditional on UPDATE/DELETE.
create function public.guard_match_result_proposal_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Result proposals are immutable' using errcode = '23514';
end $$;
create trigger match_result_proposal_immutable
  before update or delete on public.match_event_result_proposals
  for each row execute function public.guard_match_result_proposal_immutable();

create function public.guard_match_result_proposal_version_immutable() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Result proposal versions are immutable' using errcode = '23514';
end $$;
create trigger match_result_proposal_version_immutable
  before update or delete on public.match_event_result_proposal_versions
  for each row execute function public.guard_match_result_proposal_version_immutable();

revoke all on function public.guard_match_result_proposal_immutable(),
  public.guard_match_result_proposal_version_immutable() from public, anon, authenticated;

-- RLS: proposals are readable by the event creator, a current admin of the
-- event's community, or an accepted participant of the event. Write access is
-- intentionally policy-less: the ACL revoke below plus the immutability guard
-- leave every mutation to the SECURITY DEFINER RPC.
alter table public.match_event_result_proposals enable row level security;
create policy match_result_proposal_reader_read on public.match_event_result_proposals for select to authenticated using (
  exists (
    select 1 from public.match_events e
    where e.id = match_event_id
      and (
        e.created_by = (select auth.uid())
        or public.is_community_admin(e.community_id)
        or exists (
          select 1 from public.match_event_registrations r
          where r.match_event_id = e.id
            and r.user_id = (select auth.uid())
            and r.lifecycle = 'accepted'
        )
      )
  )
);

-- Versions are internal-only: RLS enabled with NO policies and no grants, so
-- no browser role can touch them at the ACL; SECURITY DEFINER readers (owner)
-- bypass RLS inside the function body.
alter table public.match_event_result_proposal_versions enable row level security;

revoke all on public.match_event_result_proposals, public.match_event_result_proposal_versions
  from public, anon, authenticated;
grant select on public.match_event_result_proposals to authenticated;

-- Command-ledger extension (assumption 7): result submission replays through
-- the existing management request_id ledger with a new additive action value.
alter table public.match_event_management_commands drop constraint match_event_management_commands_action_check;
alter table public.match_event_management_commands add constraint match_event_management_commands_action_check
  check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'edit', 'reconfirm', 'submit_result'));

commit;
