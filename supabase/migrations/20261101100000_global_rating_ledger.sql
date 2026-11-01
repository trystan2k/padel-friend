begin;

-- PAF-10 / U1: immutable app-wide rating ledger and initialization provenance.
--
-- Ledger contract (see docs/plan/Plan PAF-10 T10):
--   * player_rating_events: ONE immutable logical event per (game group, player). The
--     game group id is match_event_result_proposals.id, stable across proposal versions.
--   * player_rating_event_calculations: append-only revisions of that event. A late
--     confirmation of an older group replays the chronological stream and appends new
--     revisions; earlier revisions are never rewritten and never counted as extra groups.
--   * player_rating_initializations: immutable starting-level evidence. Initialization
--     and claim edits are never match rating events.
--   * player_rating_projection_control: single internal row; projection stays inactive
--     until a later migration activates it under the rating lock.
-- global_player_ratings stays the single current materialization per permanent UUID.
-- No projection is installed here.

-- 1. Baseline audit. Nothing projected a rating before this migration, so any rating
-- row that already shows history, a non-V1 sigma or a reliability off the V1 curve is
-- unexpected: abort the upgrade for diagnosis instead of treating it as a starting input.
do $audit$
declare v_unexpected bigint;
begin
  select count(*) into v_unexpected from public.global_player_ratings r
   where r.confirmed_competitive_game_groups <> 0 or r.last_rating_at is not null
     or r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level
     or r.highest_display_level <> r.initial_display_level
     or r.sigma <> 1.00 or r.reliability_percent <> 10
     or r.rating_engine <> 'app-wide-level' or r.rating_engine_version <> '1.0.0';
  if v_unexpected > 0 then
    raise exception 'Rating ledger upgrade aborted: % global_player_ratings row(s) already carry unprojected history or non-V1 state', v_unexpected
      using errcode = '23514';
  end if;
end $audit$;

-- 2. Current-state extension. The reliability curve min(100, 10 + 6n) and sigma = 1 are
-- V1 rules; other engine versions fail closed in the engine, not in this constraint.
alter table public.global_player_ratings
  add column rating_config_version integer not null default 1 check (rating_config_version >= 1),
  add column projection_revision bigint not null default 0 check (projection_revision >= 0),
  add constraint global_player_ratings_v1_state check (
    rating_engine <> 'app-wide-level' or rating_engine_version <> '1.0.0'
    or (sigma = 1.00 and reliability_percent = least(100, 10 + 6 * confirmed_competitive_game_groups)));

-- 3. Projection control: exactly one internal row.
create table public.player_rating_projection_control (
  singleton boolean primary key default true check (singleton),
  activation_enabled boolean not null default false,
  committed_revision bigint not null default 0 check (committed_revision >= 0),
  last_processed_played_at timestamptz,
  last_processed_game_group_id uuid,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint player_rating_control_watermark_shape check (
    (last_processed_played_at is null) = (last_processed_game_group_id is null))
);
insert into public.player_rating_projection_control default values;
comment on table public.player_rating_projection_control is
  'Internal single-row projection control: activation flag, latest processed chronological key (played_at, game_group_id) and committed revision. No runtime role access.';

-- 4. Logical rating events.
create table public.player_rating_events (
  id uuid primary key default gen_random_uuid(),
  game_group_id uuid not null references public.match_event_result_proposals(id) on delete restrict,
  user_id uuid not null references public.player_profiles(user_id) on delete restrict,
  match_event_id uuid not null references public.match_events(id) on delete restrict,
  game_group_number bigint not null,
  confirmation_id uuid not null,
  proposal_version bigint not null,
  played_at timestamptz not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint player_rating_event_identity unique (game_group_id, user_id),
  constraint player_rating_event_pointer_fk foreign key (game_group_id, match_event_id, game_group_number)
    references public.match_event_result_proposals(id, match_event_id, group_number) on delete restrict,
  constraint player_rating_event_version_fk foreign key (game_group_id, proposal_version)
    references public.match_event_result_proposal_versions(proposal_id, version) on delete restrict,
  constraint player_rating_event_confirmation_fk foreign key (confirmation_id, game_group_id, proposal_version)
    references public.match_event_result_confirmations(id, proposal_id, proposal_version) on delete restrict
);
create index player_rating_events_chronology on public.player_rating_events (user_id, played_at, game_group_id);
create index player_rating_events_group on public.player_rating_events (game_group_id);
comment on table public.player_rating_events is
  'Immutable logical rating event per (game_group_id = result proposal id, user_id). Pointers to the confirmed official facts; numeric evidence lives in player_rating_event_calculations.';

-- Source integrity beyond the foreign keys: only an eligible confirmation may anchor an
-- event, the player must be one of the four played team members of the exact confirmed
-- version, and played_at is that version's instant.
create function public.guard_player_rating_event_source() returns trigger
language plpgsql set search_path = '' as $$
declare v_ratable boolean; v_teams jsonb; v_played_at timestamptz;
begin
  select c.ratable_eligible, v.teams, v.played_at_utc into v_ratable, v_teams, v_played_at
    from public.match_event_result_confirmations c
    join public.match_event_result_proposal_versions v
      on v.proposal_id = c.proposal_id and v.version = c.proposal_version
   where c.id = new.confirmation_id and c.proposal_id = new.game_group_id
     and c.proposal_version = new.proposal_version;
  if not found or not v_ratable
    or not ((v_teams -> 'team_a') ? new.user_id::text or (v_teams -> 'team_b') ? new.user_id::text)
    or v_played_at is distinct from new.played_at then
    raise exception 'Rating event does not match its confirmed result facts' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger player_rating_event_source_guard before insert on public.player_rating_events
  for each row execute function public.guard_player_rating_event_source();

-- 5. Calculation revisions. Frozen inputs carry only ids and numeric states of the four
-- played players: exact key sets keep inviter/account/private fields out by construction.
create function public.player_rating_calculation_inputs_valid(p_inputs jsonb) returns boolean
language plpgsql immutable set search_path = '' as $$
declare
  v_uuid constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
  v_teams jsonb; v_states jsonb; v_members text[]; v_member text; v_side text; v_position integer;
begin
  if p_inputs is null or pg_catalog.jsonb_typeof(p_inputs) <> 'object' then return false; end if;
  if (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(p_inputs) k)
    is distinct from array['classification', 'played_at', 'states', 'teams'] then return false; end if;
  if pg_catalog.jsonb_typeof(p_inputs -> 'classification') <> 'string'
    or (p_inputs ->> 'classification') not in ('team_a', 'team_b', 'draw')
    or pg_catalog.jsonb_typeof(p_inputs -> 'played_at') <> 'string' then return false; end if;
  v_teams := p_inputs -> 'teams';
  if pg_catalog.jsonb_typeof(v_teams) <> 'object'
    or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_teams) k)
      is distinct from array['team_a', 'team_b'] then return false; end if;
  v_members := array[]::text[];
  foreach v_side in array array['team_a', 'team_b'] loop
    if pg_catalog.jsonb_typeof(v_teams -> v_side) <> 'array' or pg_catalog.jsonb_array_length(v_teams -> v_side) <> 2 then
      return false;
    end if;
    for v_position in 0..1 loop
      if pg_catalog.jsonb_typeof(v_teams -> v_side -> v_position) <> 'string'
        or (v_teams -> v_side ->> v_position) !~ v_uuid then return false; end if;
      v_members := v_members || (v_teams -> v_side ->> v_position);
    end loop;
  end loop;
  if (select pg_catalog.count(distinct m) from pg_catalog.unnest(v_members) m) <> 4 then return false; end if;
  v_states := p_inputs -> 'states';
  if pg_catalog.jsonb_typeof(v_states) <> 'object'
    or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_states) k)
      is distinct from (select pg_catalog.array_agg(m order by m) from pg_catalog.unnest(v_members) m) then
    return false;
  end if;
  foreach v_member in array v_members loop
    if pg_catalog.jsonb_typeof(v_states -> v_member) <> 'object'
      or (select pg_catalog.array_agg(k order by k) from pg_catalog.jsonb_object_keys(v_states -> v_member) k)
        is distinct from array['confirmed_competitive_game_groups', 'display_level', 'highest_display_level',
          'mu', 'reliability_percent', 'sigma'] then return false; end if;
    if exists (select 1 from pg_catalog.jsonb_each(v_states -> v_member) e
      where pg_catalog.jsonb_typeof(e.value) <> 'number') then return false; end if;
  end loop;
  return true;
end $$;

create table public.player_rating_event_calculations (
  rating_event_id uuid not null references public.player_rating_events(id) on delete restrict,
  projection_revision bigint not null check (projection_revision >= 1),
  rating_engine text not null check (char_length(rating_engine) between 1 and 64),
  rating_engine_version text not null check (char_length(rating_engine_version) between 1 and 32),
  rating_config_version integer not null check (rating_config_version >= 1),
  before_mu numeric(4,2) not null check (before_mu between 0 and 7),
  before_sigma numeric(3,2) not null check (before_sigma > 0 and before_sigma <= 7),
  before_display_level numeric(4,2) not null check (before_display_level between 0 and 7),
  before_reliability_percent smallint not null check (before_reliability_percent between 0 and 100),
  before_confirmed_groups integer not null check (before_confirmed_groups >= 0),
  before_highest_display_level numeric(4,2) not null check (before_highest_display_level between 0 and 7),
  after_mu numeric(4,2) not null check (after_mu between 0 and 7),
  after_sigma numeric(3,2) not null check (after_sigma > 0 and after_sigma <= 7),
  after_display_level numeric(4,2) not null check (after_display_level between 0 and 7),
  after_reliability_percent smallint not null check (after_reliability_percent between 0 and 100),
  after_confirmed_groups integer not null check (after_confirmed_groups >= 0),
  after_highest_display_level numeric(4,2) not null check (after_highest_display_level between 0 and 7),
  last_rating_at timestamptz not null,
  inputs jsonb not null check (public.player_rating_calculation_inputs_valid(inputs)),
  explanation jsonb not null check (
    pg_catalog.jsonb_typeof(explanation) = 'object'
    and not (explanation ?| array['invited_by', 'invited_at', 'email', 'bio', 'source_match_event_id', 'claim'])),
  calculated_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (rating_event_id, projection_revision),
  constraint player_rating_calculation_group_count check (after_confirmed_groups = before_confirmed_groups + 1),
  constraint player_rating_calculation_highest check (
    before_highest_display_level >= before_display_level
    and after_highest_display_level >= after_display_level
    and after_highest_display_level >= before_highest_display_level),
  constraint player_rating_calculation_v1_state check (
    rating_engine <> 'app-wide-level' or rating_engine_version <> '1.0.0'
    or (before_sigma = 1.00 and after_sigma = 1.00
      and before_reliability_percent = least(100, 10 + 6 * before_confirmed_groups)
      and after_reliability_percent = least(100, 10 + 6 * after_confirmed_groups)))
);
comment on table public.player_rating_event_calculations is
  'Append-only calculation revisions per logical rating event: full before/after state, explanation payload, frozen four-player inputs and engine/config stamps. The first revision is kept forever; replay appends changed revisions.';

-- 6. Initialization audit. initial_level is the effective starting level this entry
-- established; before_initial_level is the previous effective level for claim edits.
create table public.player_rating_initializations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.player_profiles(user_id) on delete restrict,
  sequence integer not null check (sequence >= 1),
  provenance text not null check (provenance in ('self_declared', 'creator_estimated')),
  reason text not null check (reason in ('onboarding', 'creator_estimate', 'claim_before_history', 'migration_snapshot')),
  before_initial_level numeric(3,1) check (before_initial_level between 0.0 and 7.0),
  initial_level numeric(3,1) not null check (initial_level between 0.0 and 7.0),
  original_estimate_level numeric(3,1) check (original_estimate_level between 0.0 and 7.0),
  rating_engine text not null check (char_length(rating_engine) between 1 and 64),
  rating_engine_version text not null check (char_length(rating_engine_version) between 1 and 32),
  rating_config_version integer not null check (rating_config_version >= 1),
  recorded_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint player_rating_initialization_sequence unique (user_id, sequence),
  constraint player_rating_initialization_provenance check (
    (provenance = 'creator_estimated') = (original_estimate_level is not null)),
  constraint player_rating_initialization_reason_shape check (
    case reason
      when 'onboarding' then provenance = 'self_declared' and sequence = 1 and before_initial_level is null
      when 'creator_estimate' then provenance = 'creator_estimated' and sequence = 1
        and before_initial_level is null and initial_level = original_estimate_level
      when 'migration_snapshot' then sequence = 1 and before_initial_level is null
      else sequence > 1 and before_initial_level is not null and before_initial_level <> initial_level
    end)
);
comment on table public.player_rating_initializations is
  'Immutable starting-level audit (onboarding, creator estimate, claim edit before rated history, migration snapshot). Never a match rating event; internal only.';

-- 7. Baseline snapshot of every initialized player: the current effective initial level
-- and, for creator-estimated players, the original estimate. recorded_at is the upgrade
-- time; no historical instant is invented.
insert into public.player_rating_initializations
  (user_id, sequence, provenance, reason, initial_level, original_estimate_level,
   rating_engine, rating_engine_version, rating_config_version)
select r.user_id, 1, p.rating_input_source, 'migration_snapshot', r.initial_display_level, p.estimated_level,
    r.rating_engine, r.rating_engine_version, r.rating_config_version
  from public.global_player_ratings r join public.player_profiles p on p.user_id = r.user_id;

-- 8. Immutability, grants and RLS. Evidence tables reject UPDATE, DELETE and TRUNCATE for
-- everyone; trusted test cleanup disables the trigger explicitly. Runtime roles hold no
-- write privilege (including TRUNCATE) on any ledger table.
create function public.guard_player_rating_evidence_immutable() returns trigger
language plpgsql set search_path = '' as $$
begin
  raise exception using errcode = 'P0001', message = 'RATING_EVIDENCE_IMMUTABLE';
end $$;
create function public.guard_player_rating_control() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op <> 'UPDATE' then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_CONTROL_PROTECTED';
  end if;
  if new.committed_revision < old.committed_revision then
    raise exception using errcode = 'P0001', message = 'RATING_PROJECTION_CONTROL_PROTECTED';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;

create trigger player_rating_events_immutable before update or delete on public.player_rating_events
  for each row execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_events_no_truncate before truncate on public.player_rating_events
  for each statement execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_calculations_immutable before update or delete on public.player_rating_event_calculations
  for each row execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_calculations_no_truncate before truncate on public.player_rating_event_calculations
  for each statement execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_initializations_immutable before update or delete on public.player_rating_initializations
  for each row execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_initializations_no_truncate before truncate on public.player_rating_initializations
  for each statement execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_control_protected before update or delete on public.player_rating_projection_control
  for each row execute function public.guard_player_rating_control();
create trigger player_rating_control_no_truncate before truncate on public.player_rating_projection_control
  for each statement execute function public.guard_player_rating_control();
revoke all on function public.guard_player_rating_event_source(), public.player_rating_calculation_inputs_valid(jsonb),
  public.guard_player_rating_evidence_immutable(), public.guard_player_rating_control()
  from public, anon, authenticated, service_role;

alter table public.player_rating_projection_control enable row level security;
alter table public.player_rating_events enable row level security;
alter table public.player_rating_event_calculations enable row level security;
alter table public.player_rating_initializations enable row level security;
revoke all on public.player_rating_projection_control, public.player_rating_events,
  public.player_rating_event_calculations, public.player_rating_initializations
  from public, anon, authenticated, service_role;
-- Owners see only their own event pointers. Calculations (frozen opponent inputs) and
-- initialization audit stay internal until the later sporting-DTO readers.
grant select on public.player_rating_events to authenticated;
create policy "rating event owner select" on public.player_rating_events
  for select to authenticated using ((select auth.uid()) = user_id);
-- PAF-125's one-time restrictive policy installation does not cover new tables.
do $policies$
declare v_table regclass;
begin
  foreach v_table in array array['public.player_rating_projection_control'::regclass,
    'public.player_rating_events'::regclass, 'public.player_rating_event_calculations'::regclass,
    'public.player_rating_initializations'::regclass] loop
    execute pg_catalog.format('create policy "provisional actor restricted" on %s as restrictive for all to authenticated
      using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()))', v_table);
  end loop;
end $policies$;

-- 9. Rating lock and history evidence.
-- Lock graph: community/event locks first, then this app-wide lock, then rating rows.
-- Every writer of global_player_ratings takes it before touching a rating row.
create function public.lock_global_rating_projection() returns void
language sql set search_path = '' as $$
  select pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('padel-friend:app-wide-rating-projection', 0));
$$;
revoke all on function public.lock_global_rating_projection() from public, anon, authenticated, service_role;

-- Real rating evidence, not profile age: any counted group, recorded rating movement,
-- logical rating event, or an eligible confirmed result the player played in (even if
-- the projection has not run yet) locks the initial level.
create or replace function public.player_has_rated_history(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.global_player_ratings r where r.user_id = p_user_id
      and (r.confirmed_competitive_game_groups > 0 or r.last_rating_at is not null
        or r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level))
    or exists (select 1 from public.player_rating_events e where e.user_id = p_user_id)
    or exists (select 1 from public.match_event_result_confirmations c
      join public.match_event_result_proposal_versions v
        on v.proposal_id = c.proposal_id and v.version = c.proposal_version
      where c.ratable_eligible
        and ((v.teams -> 'team_a') ? p_user_id::text or (v.teams -> 'team_b') ? p_user_id::text));
$$;

-- 10. Single initialization seam. First initialization inserts the current state and
-- sequence 1 audit (reason from the profile provenance unless onboarding passes
-- 'onboarding'); 'claim_before_history' revises the effective level of a player with no
-- rated history and appends audit only. Always under the rating lock.
drop function public.initialize_global_player_rating_locked(uuid, numeric);
create function public.initialize_global_player_rating_locked(p_user_id uuid, p_level numeric,
  p_reason text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_profile public.player_profiles%rowtype; v_state public.global_player_ratings%rowtype; v_reason text;
begin
  if p_user_id is null or p_level is null or p_level < 0 or p_level > 7 or p_level * 10 <> pg_catalog.trunc(p_level * 10)
    or p_reason is not null and p_reason not in ('onboarding', 'creator_estimate', 'claim_before_history') then
    raise exception 'Invalid rating initialization' using errcode = '22023';
  end if;
  select * into v_profile from public.player_profiles p where p.user_id = p_user_id;
  if not found then raise exception 'Incomplete player state' using errcode = '23514'; end if;
  perform public.lock_global_rating_projection();
  select * into v_state from public.global_player_ratings r where r.user_id = p_user_id for update;
  if not found then
    v_reason := coalesce(p_reason,
      case when v_profile.rating_input_source = 'creator_estimated' then 'creator_estimate' else 'onboarding' end);
    if v_reason not in ('onboarding', 'creator_estimate') then
      raise exception 'Incomplete player state' using errcode = '23514';
    end if;
    insert into public.global_player_ratings
      (user_id, initial_display_level, mu, sigma, display_level,
       reliability_percent, confirmed_competitive_game_groups, highest_display_level,
       rating_engine, rating_engine_version, rating_config_version)
      values (p_user_id, p_level, p_level, 1.00, p_level, 10, 0, p_level, 'app-wide-level', '1.0.0', 1);
    insert into public.player_rating_initializations
      (user_id, sequence, provenance, reason, initial_level, original_estimate_level,
       rating_engine, rating_engine_version, rating_config_version)
      values (p_user_id, 1, v_profile.rating_input_source, v_reason, p_level, v_profile.estimated_level,
        'app-wide-level', '1.0.0', 1);
    return;
  end if;
  if p_reason is distinct from 'claim_before_history' then
    raise exception 'Player rating already initialized' using errcode = '23505';
  end if;
  if public.player_has_rated_history(p_user_id) then
    raise exception using errcode = 'P0001', message = 'PROVISIONAL_CLAIM_LEVEL_LOCKED';
  end if;
  if p_level = v_state.initial_display_level then return; end if;
  update public.global_player_ratings set initial_display_level = p_level, mu = p_level,
    display_level = p_level, highest_display_level = p_level where user_id = p_user_id;
  insert into public.player_rating_initializations
    (user_id, sequence, provenance, reason, before_initial_level, initial_level, original_estimate_level,
     rating_engine, rating_engine_version, rating_config_version)
    select p_user_id, coalesce(max(i.sequence), 0) + 1, v_profile.rating_input_source, 'claim_before_history',
        v_state.initial_display_level, p_level, v_profile.estimated_level,
        v_state.rating_engine, v_state.rating_engine_version, v_state.rating_config_version
      from public.player_rating_initializations i where i.user_id = p_user_id;
end $$;
revoke all on function public.initialize_global_player_rating_locked(uuid, numeric, text)
  from public, anon, authenticated, service_role;

-- Onboarding: same body as before (including the provisional-actor assertion) with the
-- rating initialization routed through the seam.
create or replace function public.onboard_player(p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_user_id uuid := (select auth.uid());
begin perform public.assert_actor_not_provisional();
  if v_user_id is null then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')) not between 1 and 80
    or p_display_name <> pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')
    or p_preferred_side is null or p_preferred_side not in ('LEFT','RIGHT','EITHER')
    or (p_dominant_hand is not null and p_dominant_hand not in ('LEFT','RIGHT'))
    or (p_bio is not null and char_length(p_bio) > 280)
    or p_initial_level is null or p_initial_level < 0 or p_initial_level > 7
    or p_initial_level * 10 <> pg_catalog.trunc(p_initial_level * 10) then
    raise exception 'Invalid onboarding input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_user_id::text, 0));
  if exists (select 1 from public.player_profiles where user_id = v_user_id)
    or exists (select 1 from public.global_player_ratings where user_id = v_user_id) then
    if exists (select 1 from public.player_profiles where user_id = v_user_id)
      and exists (select 1 from public.global_player_ratings where user_id = v_user_id) then
      return;
    end if;
    raise exception 'Incomplete player state' using errcode = '23514';
  end if;
  insert into public.player_profiles (user_id, display_name, preferred_side, dominant_hand, bio)
    values (v_user_id, p_display_name, p_preferred_side, p_dominant_hand, p_bio);
  perform public.initialize_global_player_rating_locked(v_user_id, p_initial_level, 'onboarding');
end;
$$;

-- 11. Claim: unchanged mailbox proof, identity cleanup, password continuity and audit
-- anchor. Only the rating section changes: the rating lock precedes the rating row, the
-- history decision is taken under it, and an allowed level edit goes through the seam.
create or replace function public.claim_provisional_player(p_display_name text, p_preferred_side text, p_initial_level numeric,
  p_dominant_hand text default null, p_bio text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_uid uuid := auth.uid(); v_profile public.player_profiles%rowtype; v_rating public.global_player_ratings%rowtype;
  v_event public.match_events%rowtype; v_revision bigint; v_locked boolean; v_email text;
begin
  if v_uid is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'Authentication required' using errcode = '28000';
  end if;
  if p_display_name is null or char_length(pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')) not between 1 and 80
    or p_display_name <> pg_catalog.btrim(p_display_name, E' \t\n\r\f\v')
    or p_preferred_side is null or p_preferred_side not in ('LEFT', 'RIGHT', 'EITHER')
    or (p_dominant_hand is not null and p_dominant_hand not in ('LEFT', 'RIGHT'))
    or (p_bio is not null and char_length(p_bio) > 280)
    or p_initial_level is null or p_initial_level < 0 or p_initial_level > 7
    or p_initial_level * 10 <> pg_catalog.trunc(p_initial_level * 10) then
    raise exception 'Invalid onboarding input' using errcode = '22023';
  end if;
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_uid::text, 0));
  select * into v_profile from public.player_profiles p where p.user_id = v_uid for update;
  if v_profile.user_id is null or not v_profile.is_provisional then
    raise exception using errcode = 'P0001', message = 'PROVISIONAL_CLAIM_NOT_PENDING';
  end if;
  if public.provisional_claim_state() <> 'ready' then
    raise exception using errcode = '42501', message = 'PROVISIONAL_CLAIM_EMAIL_NOT_VERIFIED';
  end if;
  perform public.lock_global_rating_projection();
  select * into v_rating from public.global_player_ratings r where r.user_id = v_uid for update;
  if v_rating.user_id is null then raise exception 'Incomplete player state' using errcode = '23514'; end if;

  v_locked := public.player_has_rated_history(v_uid);
  if v_locked then
    if p_initial_level <> v_rating.initial_display_level then
      raise exception using errcode = 'P0001', message = 'PROVISIONAL_CLAIM_LEVEL_LOCKED';
    end if;
  elsif p_initial_level <> v_rating.initial_display_level then
    perform public.initialize_global_player_rating_locked(v_uid, p_initial_level, 'claim_before_history');
  end if;

  update public.player_profiles set display_name = p_display_name, preferred_side = p_preferred_side,
    dominant_hand = p_dominant_hand, bio = p_bio, is_provisional = false where user_id = v_uid;

  select pg_catalog.lower(u.email) into v_email from auth.users u where u.id = v_uid;
  delete from auth.identities i where i.user_id = v_uid and i.provider <> 'email'
    and not (coalesce(pg_catalog.lower(i.identity_data ->> 'email') = v_email, false)
      and coalesce(i.identity_data ->> 'email_verified', '') = 'true');
  delete from auth.sessions s where s.user_id = v_uid
    and s.id is distinct from nullif(auth.jwt() ->> 'session_id', '')::uuid;
  update auth.users set encrypted_password = '', email_change = '', email_change_token_new = '',
    email_change_token_current = '', email_change_sent_at = null, email_change_confirm_status = 0,
    updated_at = pg_catalog.now()
    where id = v_uid;
  delete from auth.one_time_tokens t where t.user_id = v_uid
    and t.token_type in ('email_change_token_new', 'email_change_token_current');
  -- Only verified provider identities are left: without one the claimant owes a password.
  if not exists (select 1 from auth.identities i where i.user_id = v_uid and i.provider <> 'email') then
    insert into public.provisional_claim_password_pending(user_id) values (v_uid) on conflict do nothing;
  end if;

  select * into v_event from public.match_events e where e.id = v_profile.source_match_event_id;
  select s.transition_revision into v_revision from public.match_event_registration_state s
    where s.match_event_id = v_event.id;
  insert into public.match_event_audit_log(match_event_id, community_id, actor_id, target_user_id, action, request_id,
    occurred_at, event_version, transition_revision, after_data)
    values (v_event.id, v_event.community_id, v_uid, v_uid, 'player_claimed', pg_catalog.gen_random_uuid(),
      pg_catalog.clock_timestamp(), v_event.version, coalesce(v_revision, 0),
      pg_catalog.jsonb_build_object('level_locked', v_locked));
end $$;
revoke all on function public.claim_provisional_player(text, text, numeric, text, text)
  from public, anon, authenticated, service_role;
grant execute on function public.claim_provisional_player(text, text, numeric, text, text) to authenticated;

commit;
