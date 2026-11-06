begin;

-- T15.1: audited result amendment requests, corrected candidates and approvals.
--
-- A request never touches the official result. Corrected candidates reuse the
-- immutable proposal-version store (version > the official version) while the
-- proposal pointer, the confirmation and every projection stay on the original
-- official fact. Approval only queues an accepted-pending-publication record
-- (lifecycle approved_pending_repair); publication belongs to the replay units.
--
-- Lock order for every amendment command: community/event chain
-- (lock_match_event_registration) -> proposal row -> amendment row -> official state.

-- 1. Confirmation cardinality: many immutable confirmations per proposal are
-- allowed, one per proposal version. Composite keys used by rating events,
-- notification links and audit evidence are unchanged.
alter table public.match_event_result_confirmations
  drop constraint match_event_result_confirmations_proposal_id_key,
  drop constraint match_result_confirmation_one_per_event_group,
  add constraint match_result_confirmation_one_per_version unique (proposal_id, proposal_version),
  drop constraint match_event_result_confirmations_source_check,
  add constraint match_event_result_confirmations_source_check
    check (source in ('MANUAL', 'AUTO_48H', 'ADMIN_OVERRIDE')),
  drop constraint match_result_confirmation_actor_shape,
  add constraint match_result_confirmation_actor_shape check (
    (source = 'AUTO_48H' and actor_id is null and effective_at <= confirmed_at)
    or (source in ('MANUAL', 'ADMIN_OVERRIDE') and actor_id is not null and effective_at = confirmed_at)
  );
create index match_event_result_confirmations_group
  on public.match_event_result_confirmations (match_event_id, group_number);
comment on constraint match_result_confirmation_actor_shape on public.match_event_result_confirmations is
  'ADMIN_OVERRIDE is the reserved audited-override shape; the insert guard rejects it until the audited override command exists.';

-- The audit actor check admits the new automatic acceptance and the override shape.
alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'reconfirmation_carried', 'result_approved',
      'result_disputed', 'result_corrected', 'result_confirmed', 'player_added', 'player_claimed',
      'result_amendment_requested', 'result_amendment_candidate_submitted',
      'result_amendment_candidate_superseded', 'result_amendment_approved',
      'result_amendment_disputed', 'result_amendment_accepted', 'result_amendment_canceled')),
  drop constraint match_event_audit_log_actor_result_check,
  add constraint match_event_audit_log_actor_result_check check (
    (action = 'result_confirmed' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action = 'result_amendment_accepted' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action = 'reconfirmation_excluded' and actor_id is null)
    or (actor_id is not null and (action <> 'result_confirmed'
      or after_data ->> 'source' in ('MANUAL', 'ADMIN_OVERRIDE')))
  );

alter table public.match_event_management_commands
  drop constraint match_event_management_commands_action_check,
  add constraint match_event_management_commands_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'edit', 'reconfirm',
      'submit_result', 'review_result', 'correct_result',
      'submit_amendment_candidate', 'review_amendment', 'cancel_amendment'));

-- 2. Official state: one current confirmation pointer per game group.
create table public.match_event_result_official_state (
  proposal_id uuid primary key,
  match_event_id uuid not null,
  group_number bigint not null,
  current_confirmation_id uuid,
  current_version bigint,
  official_revision bigint not null default 1 check (official_revision >= 1),
  is_void boolean not null default false,
  void_decision_id uuid,
  selected_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint official_state_group_unique unique (match_event_id, group_number),
  constraint official_state_proposal_fk
    foreign key (proposal_id, match_event_id, group_number)
    references public.match_event_result_proposals(id, match_event_id, group_number)
    on delete cascade,
  constraint official_state_confirmation_fk
    foreign key (current_confirmation_id, proposal_id, current_version)
    references public.match_event_result_confirmations(id, proposal_id, proposal_version)
    on delete cascade,
  constraint official_state_pointer_shape check (
    (current_confirmation_id is null) = (current_version is null)
    and is_void = (current_confirmation_id is null)
    and (void_decision_id is null or is_void)
  )
);
create unique index official_state_current_confirmation
  on public.match_event_result_official_state (current_confirmation_id)
  where current_confirmation_id is not null;
comment on table public.match_event_result_official_state is
  'Single mutable pointer to the current official confirmation per game group. Historical confirmations stay as audit evidence; live readers resolve official facts only through match_event_official_confirmations(). No client access; written by trusted RPCs only.';

insert into public.match_event_result_official_state(
  proposal_id, match_event_id, group_number, current_confirmation_id, current_version, selected_at
)
select c.proposal_id, c.match_event_id, c.group_number, c.id, c.proposal_version, c.confirmed_at
  from public.match_event_result_confirmations c;

do $$
begin
  if (select count(*) from public.match_event_result_confirmations)
    <> (select count(*) from public.match_event_result_official_state) then
    raise exception 'Official result state backfill did not cover every confirmation'
      using errcode = '23514';
  end if;
end $$;

alter table public.match_event_result_official_state enable row level security;
create policy "provisional actor restricted" on public.match_event_result_official_state
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor()))
  with check (not (select public.is_provisional_actor()));
revoke all on public.match_event_result_official_state from public, anon, authenticated, service_role;

create function public.guard_match_event_result_official_state()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if (new.proposal_id, new.match_event_id, new.group_number)
      is distinct from (old.proposal_id, old.match_event_id, old.group_number) then
    raise exception 'Official result state identity is immutable' using errcode = '23514';
  end if;
  if new.official_revision <> old.official_revision + 1 then
    raise exception 'Official result state revisions advance by exactly one' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger match_event_result_official_state_guard
  before update on public.match_event_result_official_state
  for each row execute function public.guard_match_event_result_official_state();

-- Every confirmation must be reachable from an official pointer in the same transaction.
create function public.check_match_result_official_pointer()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not exists (
    select 1 from public.match_event_result_official_state s where s.proposal_id = new.proposal_id
  ) then
    raise exception 'Confirmation requires an official result pointer' using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger match_result_confirmation_official_pointer
  after insert on public.match_event_result_confirmations
  deferrable initially deferred for each row
  execute function public.check_match_result_official_pointer();

-- Canonical official-result read seam. Live consumers join this, never the raw
-- confirmation history, so additional immutable confirmations cannot double-count.
create function public.match_event_official_confirmations()
returns setof public.match_event_result_confirmations
language sql stable security definer set search_path = '' as $$
  select c.*
    from public.match_event_result_official_state s
    join public.match_event_result_confirmations c on c.id = s.current_confirmation_id;
$$;

-- 3. Amendment requests (mutable lifecycle pointer) + candidate provenance + audited transitions.
create table public.result_amendment_requests (
  id uuid primary key default gen_random_uuid(),
  match_event_id uuid not null,
  proposal_id uuid not null,
  group_number bigint not null,
  base_confirmation_id uuid not null,
  base_version bigint not null,
  requester_id uuid not null references auth.users(id) on delete restrict,
  reason text not null,
  command_id uuid not null,
  fingerprint text not null,
  requested_at timestamptz not null default pg_catalog.clock_timestamp(),
  lifecycle text not null default 'requested',
  candidate_version bigint,
  decision_source text,
  decision_actor_id uuid references auth.users(id) on delete restrict,
  decided_at timestamptz,
  decision_note text,
  repair_job_id uuid,
  closed_at timestamptz,
  updated_at timestamptz not null default pg_catalog.clock_timestamp(),
  constraint result_amendment_command_unique unique (requester_id, command_id),
  constraint result_amendment_proposal_identity unique (id, proposal_id),
  constraint result_amendment_group_fk
    foreign key (proposal_id, match_event_id, group_number)
    references public.match_event_result_proposals(id, match_event_id, group_number)
    on delete restrict,
  constraint result_amendment_base_fk
    foreign key (base_confirmation_id, proposal_id, base_version)
    references public.match_event_result_confirmations(id, proposal_id, proposal_version)
    on delete restrict,
  constraint result_amendment_lifecycle_check check (lifecycle in (
    'requested', 'proposal_pending', 'disputed', 'approved_pending_repair',
    'applied', 'rejected', 'canceled')),
  constraint result_amendment_reason_check check (
    reason = btrim(reason) and char_length(reason) between 1 and 500 and reason !~ '[[:cntrl:]]'),
  constraint result_amendment_candidate_check check (
    (lifecycle = 'requested' and candidate_version is null)
    or (lifecycle in ('proposal_pending', 'disputed', 'approved_pending_repair', 'applied')
      and candidate_version is not null)
    or lifecycle in ('rejected', 'canceled')),
  constraint result_amendment_candidate_after_base check (
    candidate_version is null or candidate_version > base_version),
  constraint result_amendment_decision_check check (
    (decision_source is null) = (decided_at is null)
    and (decision_source is null or decision_source in ('MANUAL', 'AUTO_48H', 'ADMIN_OVERRIDE'))
    and (decision_source is null or (decision_source = 'AUTO_48H') = (decision_actor_id is null))
    and (decision_source is not null or decision_actor_id is null)
    and (lifecycle not in ('approved_pending_repair', 'applied') or decision_source is not null)
    and (decision_note is null or (decision_note = btrim(decision_note)
      and char_length(decision_note) between 1 and 500 and decision_note !~ '[[:cntrl:]]'))),
  constraint result_amendment_repair_ref_check check (
    repair_job_id is null or lifecycle in ('approved_pending_repair', 'applied')),
  constraint result_amendment_closed_check check (
    (closed_at is not null) = (lifecycle in ('applied', 'rejected', 'canceled')))
);
create unique index result_amendment_one_live_per_group
  on public.result_amendment_requests (proposal_id)
  where lifecycle in ('requested', 'proposal_pending', 'disputed', 'approved_pending_repair');
create index result_amendment_requests_event on public.result_amendment_requests (match_event_id);
create index result_amendment_requests_due on public.result_amendment_requests (id)
  where lifecycle = 'proposal_pending';
comment on table public.result_amendment_requests is
  'Mutable lifecycle pointer for one correction of a confirmed result. Never changes the official result; transitions are also recorded in result_amendment_events. repair_job_id is reserved for the repair-job reference.';

create table public.result_amendment_candidates (
  proposal_id uuid not null,
  version bigint not null,
  amendment_id uuid not null,
  base_confirmation_id uuid not null,
  created_at timestamptz not null default pg_catalog.clock_timestamp(),
  primary key (proposal_id, version),
  constraint result_amendment_candidate_version_fk
    foreign key (proposal_id, version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete restrict,
  constraint result_amendment_candidate_request_fk
    foreign key (amendment_id, proposal_id)
    references public.result_amendment_requests(id, proposal_id)
    on delete no action deferrable initially deferred,
  constraint result_amendment_candidate_base_fk
    foreign key (base_confirmation_id)
    references public.match_event_result_confirmations(id)
    on delete restrict
);
comment on table public.result_amendment_candidates is
  'Insert-only provenance linking an immutable proposal version to the amendment and base confirmation it corrects; prior version rows are never rewritten.';

alter table public.result_amendment_requests
  add constraint result_amendment_candidate_fk
    foreign key (proposal_id, candidate_version)
    references public.result_amendment_candidates(proposal_id, version)
    on delete no action deferrable initially deferred;

create table public.result_amendment_events (
  id uuid primary key default gen_random_uuid(),
  seq bigint generated always as identity,
  amendment_id uuid not null references public.result_amendment_requests(id) on delete restrict,
  event_type text not null check (event_type in (
    'requested', 'candidate_submitted', 'candidate_superseded', 'approved', 'disputed',
    'accepted', 'canceled')),
  from_lifecycle text,
  to_lifecycle text not null,
  actor_id uuid references auth.users(id) on delete restrict,
  candidate_version bigint,
  decision_source text,
  data jsonb not null default '{}'::jsonb check (jsonb_typeof(data) = 'object'),
  command_id uuid,
  occurred_at timestamptz not null default pg_catalog.clock_timestamp()
);
create unique index result_amendment_events_amendment on public.result_amendment_events (amendment_id, seq);
comment on table public.result_amendment_events is
  'Insert-only evidence of every amendment transition; amendment_id correlates the whole chain.';

create function public.guard_result_amendment_request()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Result amendment requests are never deleted' using errcode = '23514';
  end if;
  if (new.id, new.match_event_id, new.proposal_id, new.group_number, new.base_confirmation_id,
      new.base_version, new.requester_id, new.reason, new.command_id, new.fingerprint, new.requested_at)
    is distinct from (old.id, old.match_event_id, old.proposal_id, old.group_number,
      old.base_confirmation_id, old.base_version, old.requester_id, old.reason, old.command_id,
      old.fingerprint, old.requested_at) then
    raise exception 'Result amendment request identity is immutable' using errcode = '23514';
  end if;
  if old.lifecycle in ('applied', 'rejected', 'canceled') then
    raise exception 'Terminal result amendment requests are immutable' using errcode = '23514';
  end if;
  if new.lifecycle <> old.lifecycle and not (
    (old.lifecycle = 'requested' and new.lifecycle in ('proposal_pending', 'canceled', 'rejected'))
    or (old.lifecycle = 'proposal_pending'
      and new.lifecycle in ('disputed', 'approved_pending_repair', 'canceled', 'rejected'))
    or (old.lifecycle = 'disputed'
      and new.lifecycle in ('proposal_pending', 'approved_pending_repair', 'canceled', 'rejected'))
    or (old.lifecycle = 'approved_pending_repair' and new.lifecycle = 'applied')
  ) then
    raise exception 'Invalid result amendment lifecycle transition' using errcode = '23514';
  end if;
  if new.candidate_version is distinct from old.candidate_version
    and old.candidate_version is not null and new.candidate_version <= old.candidate_version then
    raise exception 'Result amendment candidates only advance' using errcode = '23514';
  end if;
  if old.lifecycle = 'approved_pending_repair'
    and (new.candidate_version, new.decision_source, new.decision_actor_id, new.decided_at)
      is distinct from (old.candidate_version, old.decision_source, old.decision_actor_id, old.decided_at) then
    raise exception 'Accepted result amendment decisions are immutable' using errcode = '23514';
  end if;
  new.updated_at := pg_catalog.clock_timestamp();
  return new;
end $$;
create trigger result_amendment_request_guard
  before update or delete on public.result_amendment_requests
  for each row execute function public.guard_result_amendment_request();

create function public.guard_result_amendment_insert_only()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Result amendment evidence is insert-only' using errcode = '23514';
end $$;
create trigger result_amendment_candidates_immutable
  before update or delete on public.result_amendment_candidates
  for each row execute function public.guard_result_amendment_insert_only();
create trigger result_amendment_events_immutable
  before update or delete on public.result_amendment_events
  for each row execute function public.guard_result_amendment_insert_only();

-- Reader rights follow event readers (creator, community admin, accepted participants)
-- plus the original confirmed participants of the base version.
create function public.result_amendment_reader(
  p_match_event_id uuid, p_proposal_id uuid, p_base_version bigint
) returns boolean language sql stable security definer set search_path = '' as $$
  select (select auth.uid()) is not null and exists (
    select 1 from public.match_events e
     where e.id = p_match_event_id
       and (
         e.created_by = (select auth.uid())
         or public.is_community_admin(e.community_id)
         or exists (
           select 1 from public.match_event_registrations r
            where r.match_event_id = e.id and r.user_id = (select auth.uid())
              and r.lifecycle = 'accepted' and r.cancelled_at is null)
         or exists (
           select 1 from public.match_event_result_proposal_versions v
            where v.proposal_id = p_proposal_id and v.version = p_base_version
              and (v.teams -> 'team_a' ? (select auth.uid())::text
                or v.teams -> 'team_b' ? (select auth.uid())::text))
       ));
$$;

alter table public.result_amendment_requests enable row level security;
alter table public.result_amendment_candidates enable row level security;
alter table public.result_amendment_events enable row level security;

create policy result_amendment_request_reader_read on public.result_amendment_requests
  for select to authenticated using (
    public.result_amendment_reader(match_event_id, proposal_id, base_version));
create policy result_amendment_candidate_reader_read on public.result_amendment_candidates
  for select to authenticated using (
    exists (select 1 from public.result_amendment_requests r
      where r.id = result_amendment_candidates.amendment_id));
create policy result_amendment_event_reader_read on public.result_amendment_events
  for select to authenticated using (
    exists (select 1 from public.result_amendment_requests r
      where r.id = result_amendment_events.amendment_id));
create policy "provisional actor restricted" on public.result_amendment_requests
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));
create policy "provisional actor restricted" on public.result_amendment_candidates
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));
create policy "provisional actor restricted" on public.result_amendment_events
  as restrictive for all to authenticated
  using (not (select public.is_provisional_actor())) with check (not (select public.is_provisional_actor()));

revoke all on public.result_amendment_requests, public.result_amendment_candidates,
  public.result_amendment_events from public, anon, authenticated, service_role;
-- command_id and fingerprint stay internal.
grant select (id, match_event_id, proposal_id, group_number, base_confirmation_id, base_version,
  requester_id, reason, requested_at, lifecycle, candidate_version, decision_source,
  decision_actor_id, decided_at, decision_note, repair_job_id, closed_at, updated_at)
  on public.result_amendment_requests to authenticated;
grant select on public.result_amendment_candidates, public.result_amendment_events to authenticated;

-- 4. Route live consumers through the canonical official-result function and keep
-- candidate versions out of the original proposal timeline.
do $patch$
declare
  v_patch record;
  v_original text;
  v_definition text;
  v_old_marker constant text := $m$  update public.match_event_result_proposals p set status = 'confirmed'$m$;
begin
  for v_patch in select * from (values
    ('public.rating_projection_eligible_groups()'::text,
      'from public.match_event_result_confirmations c'::text,
      'from public.match_event_official_confirmations() c'::text),
    ('public.league_confirmed_groups(uuid)',
      'join public.match_event_result_confirmations c',
      'join public.match_event_official_confirmations() c'),
    ('public.statistics_official_confirmations(uuid[])',
      'from public.match_event_result_confirmations c',
      'from public.match_event_official_confirmations() c'),
    ('public.match_event_result_summary(uuid)',
      'left join public.match_event_result_confirmations c',
      'left join public.match_event_official_confirmations() c'),
    ('public.player_has_rated_history(uuid)',
      'exists (select 1 from public.match_event_result_confirmations c',
      'exists (select 1 from public.match_event_official_confirmations() c'),
    ('public.get_match_event_official_results(uuid)',
      'from public.match_event_result_confirmations c',
      'from public.match_event_official_confirmations() c'),
    ('public.get_match_event_result_proposals(uuid)',
      'where history.proposal_id = p.id',
      'where history.proposal_id = p.id and history.version <= p.active_version'),
    ('public.finalize_match_event_result_locked(uuid,bigint,text,uuid)',
      v_old_marker,
      E'  insert into public.match_event_result_official_state(\n'
      || E'    proposal_id, match_event_id, group_number, current_confirmation_id, current_version\n'
      || E'  ) values (\n'
      || E'    v_proposal.id, v_proposal.match_event_id, v_proposal.group_number,\n'
      || E'    v_confirmation_id, v_proposal.active_version\n'
      || E'  );\n\n' || v_old_marker)
  ) as t(signature, needle, replacement) loop
    v_original := pg_get_functiondef(v_patch.signature::regprocedure);
    if (length(v_original) - length(replace(v_original, v_patch.needle, '')))
      <> length(v_patch.needle) then
      raise exception 'Unexpected % definition; refusing to patch', v_patch.signature;
    end if;
    v_definition := replace(v_original, v_patch.needle, v_patch.replacement);
    execute v_definition;
  end loop;
end $patch$;

-- 5. Internal helpers.
create function public.result_amendment_actor() returns uuid
language plpgsql stable security definer set search_path = '' as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'RESULT_AMENDMENT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  return v_actor;
end $$;

create function public.record_result_amendment_event(
  p_amendment public.result_amendment_requests, p_event_type text, p_from text, p_to text,
  p_actor uuid, p_candidate_version bigint, p_source text, p_data jsonb, p_command_id uuid,
  p_now timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
  v_revision bigint;
  v_action text;
begin
  insert into public.result_amendment_events(
    amendment_id, event_type, from_lifecycle, to_lifecycle, actor_id, candidate_version,
    decision_source, data, command_id, occurred_at
  ) values (
    p_amendment.id, p_event_type, p_from, p_to, p_actor, p_candidate_version,
    p_source, coalesce(p_data, '{}'::jsonb), p_command_id, p_now);

  select * into v_event from public.match_events e where e.id = p_amendment.match_event_id;
  select s.transition_revision into v_revision
    from public.match_event_registration_state s where s.match_event_id = p_amendment.match_event_id;
  if v_revision is null then
    raise exception 'RESULT_AMENDMENT_REGISTRATION_STATE_MISSING' using errcode = '23514';
  end if;
  v_action := 'result_amendment_' || case p_event_type
    when 'requested' then 'requested'
    when 'candidate_submitted' then 'candidate_submitted'
    when 'candidate_superseded' then 'candidate_superseded'
    when 'approved' then 'approved'
    when 'disputed' then 'disputed'
    when 'accepted' then 'accepted'
    else 'canceled' end;
  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, reason, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields
  ) values (
    v_event.id, v_event.community_id, p_actor, v_action,
    case when p_event_type = 'requested' then p_amendment.reason
      when p_event_type = 'disputed' then p_data ->> 'reason_code' end,
    p_command_id, p_now, coalesce(p_candidate_version, p_amendment.base_version), v_revision,
    jsonb_build_object('amendment_id', p_amendment.id, 'proposal_id', p_amendment.proposal_id,
      'group_number', p_amendment.group_number, 'lifecycle', p_from,
      'base_confirmation_id', p_amendment.base_confirmation_id),
    jsonb_strip_nulls(jsonb_build_object('amendment_id', p_amendment.id,
      'proposal_id', p_amendment.proposal_id, 'group_number', p_amendment.group_number,
      'lifecycle', p_to, 'base_confirmation_id', p_amendment.base_confirmation_id,
      'candidate_version', p_candidate_version, 'source', p_source)),
    array['amendment', 'lifecycle']);
end $$;

create function public.result_amendment_receipt(
  r public.result_amendment_requests, p_command_id uuid, p_replayed boolean
) returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'amendment_id', r.id,
    'event_id', r.match_event_id,
    'proposal_id', r.proposal_id,
    'lifecycle', r.lifecycle,
    'base_confirmation_id', r.base_confirmation_id,
    'official_confirmation_id', (
      select s.current_confirmation_id from public.match_event_result_official_state s
       where s.proposal_id = r.proposal_id),
    'candidate_version', r.candidate_version,
    'review_deadline_at', (
      select v.review_deadline_at from public.match_event_result_proposal_versions v
       where v.proposal_id = r.proposal_id and v.version = r.candidate_version),
    'decision_source', r.decision_source,
    'pending_application', r.lifecycle = 'approved_pending_repair',
    'command_id', p_command_id,
    'replayed', p_replayed);
$$;

-- Returns the outcome token: accepted | stale | not_due | rejected | not_covered | ineligible.
-- Caller holds the event chain and proposal locks.
create function public.accept_result_amendment_locked(
  p_amendment_id uuid, p_expected_version bigint, p_source text, p_actor uuid, p_command_id uuid
) returns text language plpgsql security definer set search_path = '' as $$
declare
  v_request public.result_amendment_requests%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_event public.match_events%rowtype;
  v_now timestamptz := clock_timestamp();
begin
  if p_source not in ('MANUAL', 'AUTO_48H') or (p_source = 'MANUAL') <> (p_actor is not null) then
    raise exception 'Invalid result amendment acceptance request' using errcode = '22023';
  end if;
  select * into v_request from public.result_amendment_requests r
   where r.id = p_amendment_id for update;
  if not found or v_request.lifecycle <> 'proposal_pending'
    or v_request.candidate_version is distinct from p_expected_version then
    return 'stale';
  end if;
  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = v_request.proposal_id for share;
  if not found or v_state.current_confirmation_id is distinct from v_request.base_confirmation_id then
    return 'stale';
  end if;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = v_request.proposal_id and v.version = p_expected_version;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = v_request.proposal_id and r.proposal_version = p_expected_version
       and r.decision = 'reject') then
    return 'rejected';
  end if;
  if p_source = 'AUTO_48H' then
    if v_now < v_fact.review_deadline_at then return 'not_due'; end if;
  else
    if v_now >= v_fact.review_deadline_at then return 'not_due'; end if;
    if not public.has_match_event_result_approval_coverage(
      v_request.proposal_id, p_expected_version, p_actor) then
      return 'not_covered';
    end if;
  end if;
  select * into v_event from public.match_events e where e.id = v_request.match_event_id;
  if v_event.league_id is not null and v_event.event_type = 'competitive'
    and public.match_result_ranked_ineligibility(
      v_event.id, public.match_result_fact_quartet(v_fact.teams), v_fact.played_at_utc) is not null then
    return 'ineligible';
  end if;

  update public.result_amendment_requests r
     set lifecycle = 'approved_pending_repair', decision_source = p_source,
         decision_actor_id = p_actor, decided_at = v_now
   where r.id = v_request.id;
  perform public.record_result_amendment_event(
    v_request, 'accepted', 'proposal_pending', 'approved_pending_repair', p_actor,
    p_expected_version, p_source, '{}'::jsonb, p_command_id, v_now);
  return 'accepted';
end $$;

-- 6. Reader DTO.
create function public.result_amendment_dto(r public.result_amendment_requests, p_viewer uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v public.match_event_result_proposal_versions%rowtype;
  e public.match_events%rowtype;
  v_candidate jsonb;
  v_team_a integer := 0;
  v_team_b integer := 0;
  v_can_review boolean := false;
  v_can_manage boolean;
  v_now timestamptz := clock_timestamp();
begin
  select * into e from public.match_events x where x.id = r.match_event_id;
  v_can_manage := p_viewer = e.created_by or public.is_community_admin(e.community_id);
  if r.candidate_version is not null then
    select * into v from public.match_event_result_proposal_versions x
     where x.proposal_id = r.proposal_id and x.version = r.candidate_version;
    select
      count(distinct rv.reviewer_user_id) filter (where v.teams -> 'team_a' ? rv.reviewer_user_id::text)::integer,
      count(distinct rv.reviewer_user_id) filter (where v.teams -> 'team_b' ? rv.reviewer_user_id::text)::integer
      into v_team_a, v_team_b
      from public.match_event_result_reviews rv
     where rv.proposal_id = r.proposal_id and rv.proposal_version = v.version
       and rv.decision = 'approve' and rv.reviewer_user_id <> v.submitted_by;
    v_can_review := r.lifecycle = 'proposal_pending' and v_now < v.review_deadline_at
      and p_viewer <> v.submitted_by
      and (v.teams -> 'team_a' ? p_viewer::text or v.teams -> 'team_b' ? p_viewer::text);
    v_candidate := jsonb_build_object(
      'version', v.version,
      'submitted_by', v.submitted_by,
      'submitted_at', v.submitted_at,
      'review_deadline_at', v.review_deadline_at,
      'teams', v.teams,
      'sets', v.sets,
      'classification', v.classification,
      'played_at_utc', v.played_at_utc,
      'played_at_local', to_char(v.played_at_local, 'YYYY-MM-DD HH24:MI:SS'),
      'played_at_offset_seconds', v.played_at_offset_seconds,
      'court_label', v.court_label,
      'team_a_approval_count', v_team_a,
      'team_b_approval_count', v_team_b,
      'required_team_coverage_count', case
        when v.teams -> 'team_a' ? v.submitted_by::text or v.teams -> 'team_b' ? v.submitted_by::text then 1
        else 2 end,
      'received_team_coverage_count', case
        when v.teams -> 'team_a' ? v.submitted_by::text then least(v_team_b, 1)
        when v.teams -> 'team_b' ? v.submitted_by::text then least(v_team_a, 1)
        else (case when v_team_a > 0 then 1 else 0 end) + (case when v_team_b > 0 then 1 else 0 end) end,
      'caller_decision', (
        select rv.decision from public.match_event_result_reviews rv
         where rv.proposal_id = r.proposal_id and rv.proposal_version = v.version
           and rv.reviewer_user_id = p_viewer
         order by rv.decided_at desc, rv.id desc limit 1),
      'dispute_evidence', case when r.lifecycle = 'disputed' then (
        select jsonb_build_object('rejector_id', rv.reviewer_user_id, 'reason_code', rv.reason_code,
          'reason_note', rv.reason_note, 'decided_at', rv.decided_at)
          from public.match_event_result_reviews rv
         where rv.proposal_id = r.proposal_id and rv.proposal_version = v.version
           and rv.decision = 'reject'
         order by rv.decided_at desc, rv.id desc limit 1) end);
  end if;
  return jsonb_build_object(
    'amendment_id', r.id,
    'event_id', r.match_event_id,
    'proposal_id', r.proposal_id,
    'group_number', r.group_number,
    'lifecycle', r.lifecycle,
    'base_confirmation_id', r.base_confirmation_id,
    'base_version', r.base_version,
    'official_confirmation_id', (
      select s.current_confirmation_id from public.match_event_result_official_state s
       where s.proposal_id = r.proposal_id),
    'requester_id', r.requester_id,
    'reason', r.reason,
    'requested_at', r.requested_at,
    'candidate', v_candidate,
    'decision', case when r.decision_source is null then null else jsonb_build_object(
      'source', r.decision_source, 'actor_id', r.decision_actor_id,
      'decided_at', r.decided_at, 'note', r.decision_note) end,
    'pending_application', r.lifecycle = 'approved_pending_repair',
    'repair_job_id', r.repair_job_id,
    'can_submit_candidate', v_can_manage and r.lifecycle in ('requested', 'proposal_pending', 'disputed'),
    'can_approve', v_can_review and not exists (
      select 1 from public.match_event_result_reviews rv
       where rv.proposal_id = r.proposal_id and rv.proposal_version = r.candidate_version
         and rv.reviewer_user_id = p_viewer and rv.decision = 'approve')
      and case
        when v.teams -> 'team_a' ? v.submitted_by::text then v.teams -> 'team_b' ? p_viewer::text
        when v.teams -> 'team_b' ? v.submitted_by::text then v.teams -> 'team_a' ? p_viewer::text
        else true end,
    'can_reject', v_can_review,
    'can_cancel', (v_can_manage or p_viewer = r.requester_id)
      and r.lifecycle in ('requested', 'proposal_pending', 'disputed'));
end $$;

create function public.get_result_amendments(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  v_event public.match_events%rowtype;
  r public.result_amendment_requests%rowtype;
begin
  perform public.assert_actor_not_provisional();
  select * into v_event from public.match_events e where e.id = p_match_event_id;
  if not found then raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_event.created_by <> v_actor and not public.is_community_admin(v_event.community_id)
    and not exists (
      select 1 from public.match_event_registrations x
       where x.match_event_id = v_event.id and x.user_id = v_actor
         and x.lifecycle = 'accepted' and x.cancelled_at is null)
    and not exists (
      select 1 from public.result_amendment_requests q
       join public.match_event_result_proposal_versions v
         on v.proposal_id = q.proposal_id and v.version = q.base_version
       where q.match_event_id = v_event.id
         and (v.teams -> 'team_a' ? v_actor::text or v.teams -> 'team_b' ? v_actor::text)) then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;
  for r in select q.* from public.result_amendment_requests q
    where q.match_event_id = p_match_event_id order by q.requested_at, q.id
  loop
    return next public.result_amendment_dto(r, v_actor);
  end loop;
end $$;

-- 7. Commands.
create function public.request_result_amendment(
  p_proposal_id uuid, p_expected_confirmation_id uuid, p_reason text, p_command_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_request public.result_amendment_requests%rowtype;
  v_reason text := btrim(p_reason);
  v_fingerprint text;
  v_base_teams jsonb;
  v_now timestamptz;
  v_open uuid;
begin
  perform public.assert_actor_not_provisional();
  if p_proposal_id is null or p_expected_confirmation_id is null or p_command_id is null
    or v_reason is null or char_length(v_reason) not between 1 and 500 or v_reason ~ '[[:cntrl:]]' then
    raise exception 'RESULT_AMENDMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  select p.match_event_id into v_event_id from public.match_event_result_proposals p
   where p.id = p_proposal_id;
  if not found then raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001'; end if;

  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;

  v_fingerprint := pg_catalog.md5(jsonb_build_array(p_proposal_id, p_expected_confirmation_id, v_reason)::text);
  select * into v_request from public.result_amendment_requests q
   where q.requester_id = v_actor and q.command_id = p_command_id;
  if found then
    if v_request.fingerprint <> v_fingerprint then
      raise exception 'RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return public.result_amendment_receipt(v_request, p_command_id, true);
  end if;

  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = p_proposal_id for share;
  if not found or v_state.is_void then
    raise exception 'RESULT_AMENDMENT_NOT_CONFIRMED' using errcode = 'P0001';
  end if;
  select v.teams into v_base_teams from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = v_state.current_version;
  if v_actor <> v_event.created_by and not public.is_community_admin(v_event.community_id)
    and not (v_base_teams -> 'team_a' ? v_actor::text or v_base_teams -> 'team_b' ? v_actor::text) then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_state.current_confirmation_id <> p_expected_confirmation_id then
    raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
  end if;
  select q.id into v_open from public.result_amendment_requests q
   where q.proposal_id = p_proposal_id
     and q.lifecycle in ('requested', 'proposal_pending', 'disputed', 'approved_pending_repair');
  if found then
    raise exception 'RESULT_AMENDMENT_ALREADY_OPEN' using errcode = 'P0001',
      detail = jsonb_build_object('amendment_id', v_open)::text;
  end if;

  v_now := clock_timestamp();
  insert into public.result_amendment_requests(
    match_event_id, proposal_id, group_number, base_confirmation_id, base_version,
    requester_id, reason, command_id, fingerprint, requested_at
  ) values (
    v_event.id, v_proposal.id, v_proposal.group_number, v_state.current_confirmation_id,
    v_state.current_version, v_actor, v_reason, p_command_id, v_fingerprint, v_now
  ) returning * into v_request;
  perform public.record_result_amendment_event(
    v_request, 'requested', null, 'requested', v_actor, null, null, '{}'::jsonb, p_command_id, v_now);
  return public.result_amendment_receipt(v_request, p_command_id, false);
end $$;

create function public.submit_result_amendment_candidate(
  p_amendment_id uuid, p_expected_base_confirmation_id uuid, p_teams jsonb, p_sets jsonb,
  p_played_local jsonb, p_command_id uuid, p_expected_candidate_version bigint default null,
  p_court_label text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  v_event_id uuid;
  v_proposal_id uuid;
  v_event public.match_events%rowtype;
  v_request public.result_amendment_requests%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_base public.match_event_result_proposal_versions%rowtype;
  v_command public.match_event_management_commands%rowtype;
  v_fact jsonb;
  v_payload jsonb;
  v_result jsonb;
  v_next bigint;
  v_now timestamptz;
  v_from text;
  v_old_candidate bigint;
  v_gate jsonb;
begin
  perform public.assert_actor_not_provisional();
  if p_amendment_id is null or p_command_id is null or p_expected_base_confirmation_id is null
    or (p_expected_candidate_version is not null and p_expected_candidate_version < 1) then
    raise exception 'RESULT_AMENDMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  select r.match_event_id, r.proposal_id into v_event_id, v_proposal_id
    from public.result_amendment_requests r where r.id = p_amendment_id;
  if not found then raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001'; end if;

  v_event := public.lock_match_event_registration(v_event_id);
  perform 1 from public.match_event_result_proposals p where p.id = v_proposal_id for update;
  select * into v_request from public.result_amendment_requests r where r.id = p_amendment_id for update;

  v_payload := jsonb_build_object('amendment_id', p_amendment_id,
    'base_confirmation_id', p_expected_base_confirmation_id,
    'expected_candidate_version', p_expected_candidate_version,
    'teams', p_teams, 'sets', p_sets, 'played_local', p_played_local,
    'court_label', nullif(btrim(p_court_label), ''));
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_command_id;
  if found then
    if v_command.action <> 'submit_amendment_candidate' or v_command.payload <> v_payload then
      raise exception 'RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  if v_actor <> v_event.created_by and not public.is_community_admin(v_event.community_id) then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = v_request.proposal_id for share;
  if v_request.base_confirmation_id <> p_expected_base_confirmation_id
    or v_state.current_confirmation_id is distinct from v_request.base_confirmation_id then
    raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
  end if;
  if v_request.lifecycle not in ('requested', 'proposal_pending', 'disputed') then
    raise exception 'RESULT_AMENDMENT_STATE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('lifecycle', v_request.lifecycle)::text;
  end if;
  if v_request.candidate_version is distinct from p_expected_candidate_version then
    raise exception 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_version', v_request.candidate_version,
        'lifecycle', v_request.lifecycle)::text;
  end if;

  v_fact := public.validate_match_event_result_facts(
    v_event.id, v_request.group_number, p_teams, p_sets, p_played_local, p_court_label);
  select * into v_base from public.match_event_result_proposal_versions v
   where v.proposal_id = v_request.proposal_id and v.version = v_request.base_version;
  if (select jsonb_build_object(
        'a', (select jsonb_agg(x order by x) from jsonb_array_elements_text(v_fact -> 'teams' -> 'team_a') x),
        'b', (select jsonb_agg(x order by x) from jsonb_array_elements_text(v_fact -> 'teams' -> 'team_b') x)))
      = (select jsonb_build_object(
        'a', (select jsonb_agg(x order by x) from jsonb_array_elements_text(v_base.teams -> 'team_a') x),
        'b', (select jsonb_agg(x order by x) from jsonb_array_elements_text(v_base.teams -> 'team_b') x)))
    and v_fact -> 'sets' = v_base.sets
    and (v_fact ->> 'played_at_utc')::timestamptz = v_base.played_at_utc
    and (v_fact ->> 'court_label') is not distinct from v_base.court_label then
    raise exception 'RESULT_AMENDMENT_NO_CHANGE' using errcode = 'P0001';
  end if;
  if v_event.league_id is not null and v_event.event_type = 'competitive' then
    v_gate := public.match_result_ranked_ineligibility(
      v_event.id, public.match_result_fact_quartet(v_fact -> 'teams'),
      (v_fact ->> 'played_at_utc')::timestamptz);
    if v_gate is not null then
      raise exception using errcode = 'P0001',
        message = 'RESULT_AMENDMENT_RANKED_' || upper(v_gate ->> 'reason');
    end if;
  end if;

  v_now := clock_timestamp();
  select coalesce(max(v.version), 0) + 1 into v_next
    from public.match_event_result_proposal_versions v where v.proposal_id = v_request.proposal_id;
  insert into public.match_event_result_proposal_versions(
    proposal_id, version, submitted_by, submitted_at, review_deadline_at,
    teams, sets, classification, played_at_utc, played_at_local, played_at_offset_seconds, court_label
  ) values (
    v_request.proposal_id, v_next, v_actor, v_now, v_now + interval '48 hours',
    v_fact -> 'teams', v_fact -> 'sets', v_fact ->> 'classification',
    (v_fact ->> 'played_at_utc')::timestamptz, (v_fact ->> 'played_at_local')::timestamp,
    (v_fact ->> 'played_at_offset_seconds')::integer, v_fact ->> 'court_label');
  insert into public.result_amendment_candidates(proposal_id, version, amendment_id, base_confirmation_id)
    values (v_request.proposal_id, v_next, v_request.id, v_request.base_confirmation_id);

  v_from := v_request.lifecycle;
  v_old_candidate := v_request.candidate_version;
  update public.result_amendment_requests r
     set candidate_version = v_next, lifecycle = 'proposal_pending'
   where r.id = v_request.id returning * into v_request;
  if v_old_candidate is not null then
    perform public.record_result_amendment_event(
      v_request, 'candidate_superseded', v_from, 'proposal_pending', v_actor, v_old_candidate,
      null, jsonb_build_object('superseded_by_version', v_next), p_command_id, v_now);
  end if;
  perform public.record_result_amendment_event(
    v_request, 'candidate_submitted', v_from, 'proposal_pending', v_actor, v_next, null,
    jsonb_build_object('classification', v_fact ->> 'classification'), p_command_id, v_now);

  v_result := public.result_amendment_receipt(v_request, p_command_id, false);
  insert into public.match_event_management_commands(
    match_event_id, actor_id, request_id, action, payload, result, created_at
  ) values (v_event.id, v_actor, p_command_id, 'submit_amendment_candidate', v_payload, v_result, v_now);
  return v_result;
end $$;

create function public.review_result_amendment(
  p_amendment_id uuid, p_expected_base_confirmation_id uuid, p_expected_candidate_version bigint,
  p_decision text, p_command_id uuid, p_reason_code text default null, p_reason_note text default null
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  v_event_id uuid;
  v_proposal_id uuid;
  v_event public.match_events%rowtype;
  v_request public.result_amendment_requests%rowtype;
  v_state public.match_event_result_official_state%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_command public.match_event_management_commands%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_note text := nullif(btrim(p_reason_note), '');
  v_side text;
  v_submitter_side text;
  v_now timestamptz;
  v_outcome text;
  v_conflict text;
begin
  perform public.assert_actor_not_provisional();
  if p_amendment_id is null or p_command_id is null or p_expected_base_confirmation_id is null
    or p_expected_candidate_version is null or p_expected_candidate_version < 1
    or p_decision is null or p_decision not in ('approve', 'reject') then
    raise exception 'RESULT_AMENDMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  if p_decision = 'approve' then
    if p_reason_code is not null or v_note is not null then
      raise exception 'RESULT_AMENDMENT_INVALID_REVIEW' using errcode = 'P0001';
    end if;
  elsif p_reason_code is null or p_reason_code not in (
      'SCORE_INCORRECT', 'TEAMS_INCORRECT', 'PLAYERS_INCORRECT',
      'GROUP_ASSIGNMENT_INCORRECT', 'MATCH_DID_NOT_HAPPEN', 'MATCH_TYPE_INCORRECT',
      'CLASSIFICATION_INCORRECT', 'OTHER'
    ) or (p_reason_code = 'OTHER' and v_note is null)
      or (v_note is not null and (char_length(v_note) > 500 or v_note ~ '[[:cntrl:]]')) then
    raise exception 'RESULT_AMENDMENT_INVALID_REJECTION_REASON' using errcode = 'P0001';
  end if;
  select r.match_event_id, r.proposal_id into v_event_id, v_proposal_id
    from public.result_amendment_requests r where r.id = p_amendment_id;
  if not found then raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001'; end if;

  v_event := public.lock_match_event_registration(v_event_id);
  perform 1 from public.match_event_result_proposals p where p.id = v_proposal_id for update;
  select * into v_request from public.result_amendment_requests r where r.id = p_amendment_id for update;

  v_payload := jsonb_build_object('amendment_id', p_amendment_id,
    'base_confirmation_id', p_expected_base_confirmation_id,
    'expected_candidate_version', p_expected_candidate_version,
    'decision', p_decision, 'reason_code', p_reason_code, 'reason_note', v_note);
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_command_id;
  if found then
    if v_command.action <> 'review_amendment' or v_command.payload <> v_payload then
      raise exception 'RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  if not public.result_amendment_reader(v_request.match_event_id, v_request.proposal_id, v_request.base_version) then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;
  select * into v_state from public.match_event_result_official_state s
   where s.proposal_id = v_request.proposal_id for share;
  if v_request.base_confirmation_id <> p_expected_base_confirmation_id
    or v_state.current_confirmation_id is distinct from v_request.base_confirmation_id then
    raise exception 'RESULT_AMENDMENT_BASE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_confirmation_id', v_state.current_confirmation_id)::text;
  end if;
  if v_request.candidate_version is distinct from p_expected_candidate_version then
    raise exception 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('current_version', v_request.candidate_version,
        'lifecycle', v_request.lifecycle)::text;
  end if;
  if v_request.lifecycle <> 'proposal_pending' then
    raise exception 'RESULT_AMENDMENT_STATE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('lifecycle', v_request.lifecycle)::text;
  end if;
  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = v_request.proposal_id and v.version = p_expected_candidate_version;

  -- Corrected teams define reviewer coverage; the old arrangement grants nothing.
  v_side := case
    when v_fact.teams -> 'team_a' ? v_actor::text then 'team_a'
    when v_fact.teams -> 'team_b' ? v_actor::text then 'team_b'
    else null end;
  if v_side is null or v_actor = v_fact.submitted_by then
    raise exception 'RESULT_AMENDMENT_REVIEW_FORBIDDEN' using errcode = '42501';
  end if;
  if p_decision = 'approve' then
    v_submitter_side := case
      when v_fact.teams -> 'team_a' ? v_fact.submitted_by::text then 'team_a'
      when v_fact.teams -> 'team_b' ? v_fact.submitted_by::text then 'team_b'
      else null end;
    if (v_submitter_side = 'team_a' and v_side <> 'team_b')
      or (v_submitter_side = 'team_b' and v_side <> 'team_a') then
      raise exception 'RESULT_AMENDMENT_REVIEW_FORBIDDEN' using errcode = '42501';
    end if;
  end if;

  v_now := clock_timestamp();
  if v_now >= v_fact.review_deadline_at then
    v_outcome := public.accept_result_amendment_locked(
      v_request.id, p_expected_candidate_version, 'AUTO_48H', null, p_command_id);
    v_conflict := 'deadline_elapsed';
  elsif exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = v_request.proposal_id and r.proposal_version = p_expected_candidate_version
       and r.reviewer_user_id = v_actor and r.decision = p_decision) then
    null;
  else
    insert into public.match_event_result_reviews(
      proposal_id, proposal_version, reviewer_user_id, decision, reason_code, reason_note, decided_at, request_id
    ) values (
      v_request.proposal_id, p_expected_candidate_version, v_actor, p_decision,
      case when p_decision = 'reject' then p_reason_code end,
      case when p_decision = 'reject' then v_note end, v_now, p_command_id);
    if p_decision = 'reject' then
      update public.result_amendment_requests r set lifecycle = 'disputed'
       where r.id = v_request.id and r.lifecycle = 'proposal_pending';
      select * into v_request from public.result_amendment_requests r where r.id = v_request.id;
      perform public.record_result_amendment_event(
        v_request, 'disputed', 'proposal_pending', 'disputed', v_actor, p_expected_candidate_version,
        null, jsonb_build_object('reason_code', p_reason_code, 'reason_note', v_note, 'team', v_side),
        p_command_id, v_now);
    else
      perform public.record_result_amendment_event(
        v_request, 'approved', 'proposal_pending', 'proposal_pending', v_actor,
        p_expected_candidate_version, null, jsonb_build_object('team', v_side), p_command_id, v_now);
      if public.has_match_event_result_approval_coverage(
        v_request.proposal_id, p_expected_candidate_version, v_actor) then
        v_outcome := public.accept_result_amendment_locked(
          v_request.id, p_expected_candidate_version, 'MANUAL', v_actor, p_command_id);
        if v_outcome = 'not_due' then
          v_outcome := public.accept_result_amendment_locked(
            v_request.id, p_expected_candidate_version, 'AUTO_48H', null, p_command_id);
          v_conflict := 'deadline_elapsed';
        end if;
      end if;
    end if;
  end if;
  if v_outcome = 'ineligible' then
    raise exception 'RESULT_AMENDMENT_RANKED_INELIGIBLE' using errcode = 'P0001';
  end if;

  select * into v_request from public.result_amendment_requests r where r.id = v_request.id;
  v_result := public.result_amendment_receipt(v_request, p_command_id, false)
    || case when v_conflict is not null then jsonb_build_object('conflict', v_conflict) else '{}'::jsonb end;
  insert into public.match_event_management_commands(
    match_event_id, actor_id, request_id, action, payload, result, created_at
  ) values (v_event.id, v_actor, p_command_id, 'review_amendment', v_payload, v_result, v_now);
  return v_result;
end $$;

create function public.cancel_result_amendment(p_amendment_id uuid, p_command_id uuid)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_actor uuid := public.result_amendment_actor();
  v_event_id uuid;
  v_proposal_id uuid;
  v_event public.match_events%rowtype;
  v_request public.result_amendment_requests%rowtype;
  v_command public.match_event_management_commands%rowtype;
  v_payload jsonb;
  v_result jsonb;
  v_from text;
  v_now timestamptz;
begin
  perform public.assert_actor_not_provisional();
  if p_amendment_id is null or p_command_id is null then
    raise exception 'RESULT_AMENDMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  select r.match_event_id, r.proposal_id into v_event_id, v_proposal_id
    from public.result_amendment_requests r where r.id = p_amendment_id;
  if not found then raise exception 'RESULT_AMENDMENT_NOT_FOUND' using errcode = 'P0001'; end if;

  v_event := public.lock_match_event_registration(v_event_id);
  perform 1 from public.match_event_result_proposals p where p.id = v_proposal_id for update;
  select * into v_request from public.result_amendment_requests r where r.id = p_amendment_id for update;

  v_payload := jsonb_build_object('amendment_id', p_amendment_id);
  select * into v_command from public.match_event_management_commands c
   where c.match_event_id = v_event.id and c.actor_id = v_actor and c.request_id = p_command_id;
  if found then
    if v_command.action <> 'cancel_amendment' or v_command.payload <> v_payload then
      raise exception 'RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return v_command.result || jsonb_build_object('replayed', true);
  end if;

  if v_actor <> v_request.requester_id and v_actor <> v_event.created_by
    and not public.is_community_admin(v_event.community_id) then
    raise exception 'RESULT_AMENDMENT_FORBIDDEN' using errcode = '42501';
  end if;
  if v_request.lifecycle not in ('requested', 'proposal_pending', 'disputed') then
    raise exception 'RESULT_AMENDMENT_STATE_CONFLICT' using errcode = 'P0001',
      detail = jsonb_build_object('lifecycle', v_request.lifecycle)::text;
  end if;

  v_now := clock_timestamp();
  v_from := v_request.lifecycle;
  update public.result_amendment_requests r
     set lifecycle = 'canceled', closed_at = v_now
   where r.id = v_request.id returning * into v_request;
  perform public.record_result_amendment_event(
    v_request, 'canceled', v_from, 'canceled', v_actor, v_request.candidate_version, null,
    '{}'::jsonb, p_command_id, v_now);
  v_result := public.result_amendment_receipt(v_request, p_command_id, false);
  insert into public.match_event_management_commands(
    match_event_id, actor_id, request_id, action, payload, result, created_at
  ) values (v_event.id, v_actor, p_command_id, 'cancel_amendment', v_payload, v_result, v_now);
  return v_result;
end $$;

-- 8. Trusted automatic acceptance (no rejection after the fresh 48h deadline).
create function public.try_auto_accept_result_amendment(p_amendment_id uuid, p_expected_version bigint)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_proposal_id uuid;
  v_event public.match_events%rowtype;
  v_outcome text;
begin
  select r.match_event_id, r.proposal_id into v_event_id, v_proposal_id
    from public.result_amendment_requests r where r.id = p_amendment_id;
  if not found then return pg_catalog.jsonb_build_object('reason', 'stale_candidate'); end if;
  v_event := public.lock_match_event_registration_skip_locked(v_event_id);
  if v_event.id is null then return pg_catalog.jsonb_build_object('reason', 'locked'); end if;
  perform 1 from public.match_event_result_proposals p where p.id = v_proposal_id for update;
  v_outcome := public.accept_result_amendment_locked(p_amendment_id, p_expected_version, 'AUTO_48H', null, null);
  return pg_catalog.jsonb_build_object('reason', v_outcome);
end $$;

create function public.process_due_result_amendments(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_candidate record;
  v_result jsonb;
  v_attempted integer := 0;
  v_accepted integer := 0;
  v_failed integer := 0;
begin
  for v_candidate in
    select r.id, r.candidate_version
      from public.result_amendment_requests r
      join public.match_event_result_proposal_versions v
        on v.proposal_id = r.proposal_id and v.version = r.candidate_version
     where r.lifecycle = 'proposal_pending'
       and v.review_deadline_at <= pg_catalog.clock_timestamp()
     order by v.review_deadline_at, r.id
     limit v_limit
  loop
    v_attempted := v_attempted + 1;
    begin
      v_result := public.try_auto_accept_result_amendment(v_candidate.id, v_candidate.candidate_version);
      if v_result ->> 'reason' = 'accepted' then v_accepted := v_accepted + 1; end if;
    exception when others then
      v_failed := v_failed + 1;
    end;
  end loop;
  return pg_catalog.jsonb_build_object('attempted', v_attempted, 'accepted', v_accepted, 'failed', v_failed);
end $$;

do $scheduler$
begin
  if not exists (select 1 from pg_catalog.pg_extension where extname = 'pg_cron') then
    raise notice 'T15.1 scheduler: pg_cron is not installed; the result amendment auto-accept job was NOT provisioned.';
    return;
  end if;
  begin
    perform cron.schedule(
      'padel-friend-result-amendment-auto-accept', '* * * * *',
      'select public.process_due_result_amendments(25)');
  exception when others then
    raise notice 'T15.1 scheduler: the result amendment auto-accept job could not be scheduled (%).', sqlerrm;
  end;
end
$scheduler$;

-- 9. Grants: users reach only the guarded commands/readers; everything else is internal.
revoke all on function
  public.guard_match_event_result_official_state(),
  public.check_match_result_official_pointer(),
  public.match_event_official_confirmations(),
  public.guard_result_amendment_request(),
  public.guard_result_amendment_insert_only(),
  public.result_amendment_actor(),
  public.record_result_amendment_event(public.result_amendment_requests, text, text, text, uuid, bigint, text, jsonb, uuid, timestamptz),
  public.result_amendment_receipt(public.result_amendment_requests, uuid, boolean),
  public.accept_result_amendment_locked(uuid, bigint, text, uuid, uuid),
  public.result_amendment_dto(public.result_amendment_requests, uuid),
  public.try_auto_accept_result_amendment(uuid, bigint),
  public.process_due_result_amendments(integer),
  public.result_amendment_reader(uuid, uuid, bigint),
  public.get_result_amendments(uuid),
  public.request_result_amendment(uuid, uuid, text, uuid),
  public.submit_result_amendment_candidate(uuid, uuid, jsonb, jsonb, jsonb, uuid, bigint, text),
  public.review_result_amendment(uuid, uuid, bigint, text, uuid, text, text),
  public.cancel_result_amendment(uuid, uuid)
  from public, anon, authenticated;
-- RLS policies call the reader as the invoker.
grant execute on function public.result_amendment_reader(uuid, uuid, bigint) to authenticated;
grant execute on function
  public.get_result_amendments(uuid),
  public.request_result_amendment(uuid, uuid, text, uuid),
  public.submit_result_amendment_candidate(uuid, uuid, jsonb, jsonb, jsonb, uuid, bigint, text),
  public.review_result_amendment(uuid, uuid, bigint, text, uuid, text, text),
  public.cancel_result_amendment(uuid, uuid)
  to authenticated;

commit;
