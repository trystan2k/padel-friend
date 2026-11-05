begin;

-- PAF-148 / T14.2 (2/4): immutable ADMIN_REVIEW_ADJUSTMENT evidence.
--
--   * player_rating_admin_adjustments: ONE insert-only event per approved level review, with the
--     full typed before/after state, actor, reason and the optional recorded reliability
--     exception. It never carries a match, proposal or confirmation id and never counts as a
--     competitive group.
--   * player_rating_adjustment_states: append-only "checkpoint state" revisions. The adjustment's
--     own before/after stays the immutable record of what the admin approved; a later ordinary
--     replay (late confirmation, activation) may reconstruct a different incoming reliability or
--     group count at the checkpoint, and that derived state is recorded here instead of ever
--     rewriting the original audit (same idea as player_rating_event_calculations).
--   * Chronology: an adjustment is a stream checkpoint at (boundary_played_at, boundary_group_id).
--     The boundary is strictly after every committed match key, every earlier checkpoint and the
--     decision instant, so approval never replays history; later ordinary replays merge the
--     checkpoint into the chronological stream.

create table public.player_rating_admin_adjustments (
  id uuid primary key default gen_random_uuid(),
  level_review_request_id uuid not null unique,
  user_id uuid not null references public.player_profiles(user_id) on delete restrict,
  event_type text not null default 'ADMIN_REVIEW_ADJUSTMENT' check (event_type = 'ADMIN_REVIEW_ADJUSTMENT'),
  reason text not null check (char_length(reason) between 1 and 2000
    and reason = pg_catalog.btrim(reason, E' \t\n\r\f\v')),
  actor_id uuid not null references auth.users(id) on delete restrict,
  decided_at timestamptz not null,
  effective_at timestamptz not null,
  projection_revision bigint not null unique check (projection_revision >= 1),
  boundary_played_at timestamptz not null,
  boundary_group_id uuid not null,
  boundary_basis text not null check (boundary_basis in ('decision_clock', 'match_watermark', 'prior_checkpoint')),
  rating_engine text not null check (char_length(rating_engine) between 1 and 64),
  rating_config_version integer not null check (rating_config_version >= 1),
  before_engine_version text not null check (char_length(before_engine_version) between 1 and 32),
  after_engine_version text not null check (char_length(after_engine_version) between 1 and 32),
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
  last_rating_at timestamptz,
  reliability_mode text not null check (reliability_mode in ('preserve', 'reset', 'reduce')),
  reliability_target smallint check (reliability_target between 0 and 100),
  exception_justification text check (exception_justification is null
    or (char_length(exception_justification) between 1 and 2000
      and exception_justification = pg_catalog.btrim(exception_justification, E' \t\n\r\f\v'))),
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint player_rating_adjustment_request_fk foreign key (level_review_request_id)
    references public.player_level_review_requests(id) deferrable initially immediate,
  constraint player_rating_adjustment_boundary unique (boundary_played_at, boundary_group_id),
  constraint player_rating_adjustment_time check (effective_at >= decided_at),
  constraint player_rating_adjustment_state check (
    before_highest_display_level >= before_display_level and before_mu = before_display_level
    and after_mu = after_display_level
    and after_highest_display_level = greatest(before_highest_display_level, after_display_level)
    and after_sigma = before_sigma and after_confirmed_groups = before_confirmed_groups),
  constraint player_rating_adjustment_reliability check (
    case reliability_mode
      when 'preserve' then reliability_target is null and exception_justification is null
        and after_reliability_percent = before_reliability_percent
        and after_engine_version = before_engine_version
      when 'reset' then reliability_target = 10 and exception_justification is not null
        and before_reliability_percent > 10 and after_reliability_percent = 10
        and after_engine_version = '1.1.0'
      else reliability_target is not null and exception_justification is not null
        and reliability_target < before_reliability_percent
        and after_reliability_percent = reliability_target
        and after_engine_version = '1.1.0'
    end),
  constraint player_rating_adjustment_exception_sigma check (
    after_engine_version <> '1.1.0' or after_sigma = 1.00)
);
create index player_rating_adjustments_user on public.player_rating_admin_adjustments
  (user_id, boundary_played_at, boundary_group_id);
comment on table public.player_rating_admin_adjustments is
  'Immutable ADMIN_REVIEW_ADJUSTMENT evidence: one row per approved level review with actor, reason, decision/effective instants, full before/after rating state and the recorded reliability exception. Forward-only checkpoint in the rating stream; never a match event.';

-- Derived checkpoint states: first row written by the approval itself, later rows only when an
-- ordinary replay reconstructs a different state at the checkpoint.
create table public.player_rating_adjustment_states (
  adjustment_id uuid not null references public.player_rating_admin_adjustments(id) on delete restrict,
  projection_revision bigint not null check (projection_revision >= 1),
  rating_engine text not null check (char_length(rating_engine) between 1 and 64),
  rating_engine_version text not null check (char_length(rating_engine_version) between 1 and 32),
  rating_config_version integer not null check (rating_config_version >= 1),
  mu numeric(4,2) not null check (mu between 0 and 7),
  sigma numeric(3,2) not null check (sigma > 0 and sigma <= 7),
  display_level numeric(4,2) not null check (display_level between 0 and 7),
  reliability_percent smallint not null check (reliability_percent between 0 and 100),
  confirmed_groups integer not null check (confirmed_groups >= 0),
  highest_display_level numeric(4,2) not null check (highest_display_level between 0 and 7),
  last_rating_at timestamptz,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (adjustment_id, projection_revision),
  constraint player_rating_adjustment_state_shape check (
    mu = display_level and highest_display_level >= display_level
    and (rating_engine_version <> '1.1.0' or sigma = 1.00))
);
comment on table public.player_rating_adjustment_states is
  'Append-only reconstructed stream state at each adjustment checkpoint per projection revision.';

-- NO ACTION (not RESTRICT) so fixture teardown can defer the request <-> adjustment cycle; outside a
-- deferred transaction the check is still immediate.
alter table public.player_level_review_requests
  add constraint level_review_adjustment_fk foreign key (adjustment_id)
    references public.player_rating_admin_adjustments(id) deferrable initially immediate;

-- The adjustment and the request that approved it must agree on owner, actor, instant, note and
-- target; checked at commit so the approval can insert the event first and link the request after.
create function public.guard_player_rating_adjustment_link() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if not exists (select 1 from public.player_level_review_requests r
      where r.id = new.level_review_request_id and r.status = 'approved' and r.adjustment_id = new.id
        and r.owner_id = new.user_id and r.decision_actor_id = new.actor_id
        and r.decided_at = new.decided_at and r.decision_note = new.reason
        and r.approved_level = new.after_display_level) then
    raise exception using errcode = '23514', message = 'RATING_ADJUSTMENT_REQUEST_MISMATCH';
  end if;
  return null;
end $$;
create constraint trigger player_rating_adjustment_link after insert on public.player_rating_admin_adjustments
  deferrable initially deferred for each row execute function public.guard_player_rating_adjustment_link();

create trigger player_rating_adjustments_immutable before update or delete on public.player_rating_admin_adjustments
  for each row execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_adjustments_no_truncate before truncate on public.player_rating_admin_adjustments
  for each statement execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_adjustment_states_immutable before update or delete on public.player_rating_adjustment_states
  for each row execute function public.guard_player_rating_evidence_immutable();
create trigger player_rating_adjustment_states_no_truncate before truncate on public.player_rating_adjustment_states
  for each statement execute function public.guard_player_rating_evidence_immutable();
revoke all on function public.guard_player_rating_adjustment_link() from public, anon, authenticated, service_role;

-- Internal evidence: no runtime grants; owners and admins read through DTO RPCs only.
alter table public.player_rating_admin_adjustments enable row level security;
alter table public.player_rating_adjustment_states enable row level security;
revoke all on public.player_rating_admin_adjustments, public.player_rating_adjustment_states
  from public, anon, authenticated, service_role;
do $policies$
declare v_table regclass;
begin
  foreach v_table in array array['public.player_rating_admin_adjustments'::regclass,
    'public.player_rating_adjustment_states'::regclass] loop
    execute pg_catalog.format('create policy "provisional actor restricted" on %s as restrictive for all to authenticated
      using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()))', v_table);
  end loop;
end $policies$;

-- Adjustment evidence is real rating history: a zero-delta or no-match correction must still
-- lock the initial level (onboarding / claim initialization paths).
create or replace function public.player_has_rated_history(p_user_id uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.global_player_ratings r where r.user_id = p_user_id
      and (r.confirmed_competitive_game_groups > 0 or r.last_rating_at is not null
        or r.mu <> r.initial_display_level or r.display_level <> r.initial_display_level))
    or exists (select 1 from public.player_rating_events e where e.user_id = p_user_id)
    or exists (select 1 from public.player_rating_admin_adjustments a where a.user_id = p_user_id)
    or exists (select 1 from public.match_event_result_confirmations c
      join public.match_event_result_proposal_versions v
        on v.proposal_id = c.proposal_id and v.version = c.proposal_version
      where c.ratable_eligible
        and ((v.teams -> 'team_a') ? p_user_id::text or (v.teams -> 'team_b') ? p_user_id::text));
$$;

commit;
