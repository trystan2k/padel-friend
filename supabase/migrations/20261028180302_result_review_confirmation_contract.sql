begin;

-- PAF-118 / T08.1: make result proposal versions carry their own provenance,
-- and establish immutable review and official-confirmation evidence.

-- Delivered PAF-7 proposals are v1-only. Backfill the immutable version facts
-- from their existing pointer before installing the pointer transition guard.
alter table public.match_event_result_proposal_versions
  add column submitted_by uuid references auth.users(id) on delete restrict,
  add column submitted_at timestamptz,
  add column review_deadline_at timestamptz;

-- The legacy guard blocks every UPDATE. Disable it transactionally for the
-- provenance backfill, then restore the same immutable-facts guard below.
drop trigger match_result_proposal_version_immutable
  on public.match_event_result_proposal_versions;

update public.match_event_result_proposal_versions v
   set submitted_by = p.submitted_by,
       submitted_at = p.submitted_at,
       review_deadline_at = p.review_deadline_at
  from public.match_event_result_proposals p
 where v.proposal_id = p.id
   and v.version = 1
   and p.active_version = 1;

do $$
begin
  if exists (
    select 1 from public.match_event_result_proposal_versions v
    where v.submitted_by is null or v.submitted_at is null or v.review_deadline_at is null
  ) then
    raise exception 'Cannot backfill result version provenance from the delivered PAF-7 v1 pointers'
      using errcode = '23514';
  end if;
end $$;

do $$
begin
  if exists (
    select 1
      from public.match_event_result_proposals p
      left join public.match_event_result_proposal_versions v
        on v.proposal_id = p.id and v.version = p.active_version
     where p.status = 'pending'
       and (p.active_version <> 1 or v.proposal_id is null
         or (p.submitted_by, p.submitted_at, p.review_deadline_at)
           is distinct from (v.submitted_by, v.submitted_at, v.review_deadline_at))
  ) then
    raise exception 'Delivered pending PAF-7 result pointers did not survive provenance backfill'
      using errcode = '23514';
  end if;
end $$;

create trigger match_result_proposal_version_immutable
  before update or delete on public.match_event_result_proposal_versions
  for each row execute function public.guard_match_result_proposal_version_immutable();

alter table public.match_event_result_proposal_versions
  alter column submitted_by set not null,
  alter column submitted_at set not null,
  alter column review_deadline_at set not null,
  add constraint match_result_version_deadline_48h
    check (review_deadline_at = submitted_at + interval '48 hours');

alter table public.match_event_result_proposals
  drop constraint match_event_result_proposals_status_check,
  add constraint match_event_result_proposals_status_check
    check (status in ('pending', 'disputed', 'confirmed')),
  add constraint match_result_proposal_deadline_48h
    check (review_deadline_at = submitted_at + interval '48 hours'),
  add constraint match_result_proposal_identity_unique
    unique (id, match_event_id, group_number);

-- The active pointer can only select a real immutable version. Deferred timing
-- allows submit_match_event_result to insert its pointer before its v1 facts.
-- Deferred NO ACTION also lets trusted cleanup remove both sides of this FK
-- cycle in one transaction; RESTRICT would reject deleting the version first.
alter table public.match_event_result_proposals
  add constraint match_result_proposal_active_version_fk
    foreign key (id, active_version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete no action deferrable initially deferred;

create table public.match_event_result_reviews (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null,
  proposal_version bigint not null,
  reviewer_user_id uuid not null references auth.users(id) on delete restrict,
  decision text not null check (decision in ('approve', 'reject')),
  reason_code text,
  reason_note text,
  decided_at timestamptz not null default clock_timestamp(),
  request_id uuid not null,
  constraint match_result_review_version_fk
    foreign key (proposal_id, proposal_version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete restrict,
  constraint match_result_review_decision_shape check (
    (decision = 'approve' and reason_code is null and reason_note is null)
    or (decision = 'reject'
      and reason_code is not null
      and reason_code ~ '^[A-Z][A-Z0-9_]{0,63}$'
      and (reason_note is null or (
        reason_note = btrim(reason_note)
        and char_length(reason_note) between 1 and 500
        and reason_note !~ '[[:cntrl:]]'
      )))
  ),
  constraint match_result_review_once_per_decision
    unique (proposal_id, proposal_version, reviewer_user_id, decision)
);
comment on table public.match_event_result_reviews is
  'Append-only per-version result review evidence. Readers are limited to the event creator, current community admins, and accepted event participants; all writes remain behind trusted RPCs.';

create table public.match_event_result_confirmations (
  id uuid primary key default gen_random_uuid(),
  proposal_id uuid not null unique,
  proposal_version bigint not null,
  match_event_id uuid not null,
  group_number bigint not null,
  source text not null check (source in ('MANUAL', 'AUTO_48H')),
  confirmed_at timestamptz not null default clock_timestamp(),
  effective_at timestamptz not null,
  actor_id uuid references auth.users(id) on delete restrict,
  event_type public.match_event_type not null,
  ratable_eligible boolean not null,
  constraint match_result_confirmation_pointer_fk
    foreign key (proposal_id, match_event_id, group_number)
    references public.match_event_result_proposals(id, match_event_id, group_number)
    on delete restrict,
  constraint match_result_confirmation_version_fk
    foreign key (proposal_id, proposal_version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete restrict,
  constraint match_result_confirmation_one_per_event_group
    unique (match_event_id, group_number),
  constraint match_result_confirmation_actor_shape check (
    (source = 'AUTO_48H' and actor_id is null and effective_at <= confirmed_at)
    or (source = 'MANUAL' and actor_id is not null and effective_at = confirmed_at)
  )
);
comment on table public.match_event_result_confirmations is
  'Immutable official-result fact pointer and durable ResultConfirmed event. id is confirmation_id; authoritative facts join proposal_id + proposal_version to the immutable version row.';

create table public.match_event_result_processing_state (
  proposal_id uuid primary key references public.match_event_result_proposals(id) on delete restrict,
  attempted_at timestamptz,
  attempt_count integer not null default 0 check (attempt_count >= 0),
  last_failure_at timestamptz,
  last_failure_code text,
  next_attempt_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  constraint match_result_processing_failure_shape check (
    (last_failure_at is null) = (last_failure_code is null)
    and (last_failure_code is null or last_failure_code ~ '^[A-Z0-9_]{1,80}$')
  )
);
comment on table public.match_event_result_processing_state is
  'Internal per-proposal scheduler attempt and sanitized failure bookkeeping; separate from immutable lifecycle pointer state.';

alter table public.match_event_result_reviews enable row level security;
alter table public.match_event_result_confirmations enable row level security;
alter table public.match_event_result_processing_state enable row level security;

create policy match_result_review_reader_read on public.match_event_result_reviews
  for select to authenticated using (
    exists (
      select 1
        from public.match_event_result_proposals p
        join public.match_events e on e.id = p.match_event_id
       where p.id = match_event_result_reviews.proposal_id
         and (
           e.created_by = (select auth.uid())
           or public.is_community_admin(e.community_id)
           or exists (
             select 1 from public.match_event_registrations r
              where r.match_event_id = e.id
                and r.user_id = (select auth.uid())
                and r.lifecycle = 'accepted'
                and r.cancelled_at is null
           )
         )
    )
  );

create policy match_result_confirmation_reader_read on public.match_event_result_confirmations
  for select to authenticated using (
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
                and r.cancelled_at is null
           )
         )
    )
  );

revoke all on public.match_event_result_reviews,
  public.match_event_result_confirmations,
  public.match_event_result_processing_state
  from public, anon, authenticated;
grant select on public.match_event_result_reviews,
  public.match_event_result_confirmations to authenticated;

create function public.guard_match_result_review_immutable()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  raise exception 'Result review evidence is immutable' using errcode = '23514';
end $$;
create trigger match_result_review_immutable
  before update or delete on public.match_event_result_reviews
  for each row execute function public.guard_match_result_review_immutable();

create function public.has_match_event_result_approval_coverage(
  p_proposal_id uuid, p_version bigint, p_actor_id uuid
) returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  v_submitter uuid;
  v_teams jsonb;
  v_submitter_side text;
  v_team_a_approvals integer;
  v_team_b_approvals integer;
  v_actor_approved boolean;
begin
  select v.submitted_by, v.teams into v_submitter, v_teams
    from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = p_version;
  if not found then return false; end if;

  v_submitter_side := case
    when v_teams -> 'team_a' ? v_submitter::text then 'team_a'
    when v_teams -> 'team_b' ? v_submitter::text then 'team_b'
    else null
  end;

  select
    count(distinct r.reviewer_user_id) filter (where v_teams -> 'team_a' ? r.reviewer_user_id::text)::integer,
    count(distinct r.reviewer_user_id) filter (where v_teams -> 'team_b' ? r.reviewer_user_id::text)::integer,
    coalesce(bool_or(r.reviewer_user_id = p_actor_id), false)
    into v_team_a_approvals, v_team_b_approvals, v_actor_approved
    from public.match_event_result_reviews r
   where r.proposal_id = p_proposal_id
     and r.proposal_version = p_version
     and r.decision = 'approve'
     and r.reviewer_user_id <> v_submitter
     and (
       (v_submitter_side = 'team_a' and v_teams -> 'team_b' ? r.reviewer_user_id::text)
       or (v_submitter_side = 'team_b' and v_teams -> 'team_a' ? r.reviewer_user_id::text)
       or (v_submitter_side is null and (
         v_teams -> 'team_a' ? r.reviewer_user_id::text
         or v_teams -> 'team_b' ? r.reviewer_user_id::text
       ))
     );

  return v_actor_approved and case v_submitter_side
    when 'team_a' then v_team_b_approvals >= 1
    when 'team_b' then v_team_a_approvals >= 1
    else v_team_a_approvals >= 1 and v_team_b_approvals >= 1
  end;
end $$;

create function public.guard_match_event_result_confirmation_insert()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.match_event_result_proposals%rowtype;
  v_event public.match_events%rowtype;
  v_classification text;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Result confirmations are immutable' using errcode = '23514';
  end if;
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = new.proposal_id;
  if not found or v_proposal.status <> 'pending'
    or v_proposal.active_version <> new.proposal_version
    or v_proposal.match_event_id <> new.match_event_id
    or v_proposal.group_number <> new.group_number then
    raise exception 'Confirmation does not reference the current pending result version'
      using errcode = '23514';
  end if;
  select * into v_event from public.match_events e where e.id = new.match_event_id;
  select v.classification into v_classification
    from public.match_event_result_proposal_versions v
   where v.proposal_id = new.proposal_id and v.version = new.proposal_version;
  if new.event_type is distinct from v_event.event_type
    or new.ratable_eligible is distinct from (v_event.event_type = 'competitive' and v_classification <> 'incomplete')
    or new.confirmed_at > clock_timestamp() then
    raise exception 'Confirmation does not match immutable event eligibility facts'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = new.proposal_id
       and r.proposal_version = new.proposal_version
       and r.decision = 'reject'
  ) then
    raise exception 'Rejected result version cannot be confirmed' using errcode = '23514';
  end if;

  if new.source = 'AUTO_48H' then
    if new.actor_id is not null
      or new.effective_at is distinct from v_proposal.review_deadline_at
      or clock_timestamp() < v_proposal.review_deadline_at then
      raise exception 'Automatic confirmation requires the database deadline'
        using errcode = '23514';
    end if;
  elsif new.source = 'MANUAL' then
    if new.actor_id is null
      or new.effective_at is distinct from new.confirmed_at
      or clock_timestamp() >= v_proposal.review_deadline_at
      or not public.has_match_event_result_approval_coverage(
        new.proposal_id, new.proposal_version, new.actor_id
      ) then
      raise exception 'Manual confirmation requires eligible approval coverage before deadline'
        using errcode = '23514';
    end if;
  else
    raise exception 'Invalid result confirmation source' using errcode = '23514';
  end if;
  return new;
end $$;

create trigger match_result_confirmation_insert_guard
  before insert or update or delete on public.match_event_result_confirmations
  for each row execute function public.guard_match_event_result_confirmation_insert();

create function public.guard_match_result_proposal_transition()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Result proposal identity is immutable' using errcode = '23514';
  end if;
  if (new.id, new.match_event_id, new.group_number)
      is distinct from (old.id, old.match_event_id, old.group_number) then
    raise exception 'Result proposal identity is immutable' using errcode = '23514';
  end if;
  if old.status = 'confirmed' then
    raise exception 'Confirmed result proposals are terminal' using errcode = '23514';
  end if;

  if new.active_version = old.active_version then
    if old.status <> 'pending'
      or new.status not in ('disputed', 'confirmed')
      or (new.review_deadline_at, new.submitted_by, new.submitted_at)
        is distinct from (old.review_deadline_at, old.submitted_by, old.submitted_at) then
      raise exception 'Invalid same-version result status transition' using errcode = '23514';
    end if;
  else
    if new.active_version <> old.active_version + 1
      or old.status not in ('pending', 'disputed')
      or new.status <> 'pending'
      or new.submitted_at <= old.submitted_at
      or (new.submitted_by, new.submitted_at, new.review_deadline_at)
        is not distinct from (old.submitted_by, old.submitted_at, old.review_deadline_at) then
      raise exception 'Invalid result correction pointer transition' using errcode = '23514';
    end if;
  end if;
  return new;
end $$;

drop trigger match_result_proposal_immutable on public.match_event_result_proposals;
create trigger match_result_proposal_transition_guard
  before update or delete on public.match_event_result_proposals
  for each row execute function public.guard_match_result_proposal_transition();

create function public.check_match_result_proposal_pointer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.match_event_result_proposals%rowtype;
  v_version public.match_event_result_proposal_versions%rowtype;
  v_has_confirmation boolean;
  v_has_rejection boolean;
begin
  select * into v_proposal from public.match_event_result_proposals p where p.id = new.id;
  if not found then return null; end if;
  select * into v_version from public.match_event_result_proposal_versions v
   where v.proposal_id = v_proposal.id and v.version = v_proposal.active_version;
  if not found
    or (v_proposal.submitted_by, v_proposal.submitted_at, v_proposal.review_deadline_at)
      is distinct from (v_version.submitted_by, v_version.submitted_at, v_version.review_deadline_at)
    or v_proposal.review_deadline_at <> v_proposal.submitted_at + interval '48 hours' then
    raise exception 'Active result pointer provenance does not match its immutable version'
      using errcode = '23514';
  end if;

  select exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = v_proposal.id
       and r.proposal_version = v_proposal.active_version
       and r.decision = 'reject'
  ) into v_has_rejection;
  select exists (
    select 1 from public.match_event_result_confirmations c
     where c.proposal_id = v_proposal.id
       and c.proposal_version = v_proposal.active_version
       and c.match_event_id = v_proposal.match_event_id
       and c.group_number = v_proposal.group_number
  ) into v_has_confirmation;
  if (v_proposal.status = 'disputed') is distinct from v_has_rejection
    or (v_proposal.status = 'confirmed') is distinct from v_has_confirmation then
    raise exception 'Result lifecycle pointer and immutable evidence disagree'
      using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger match_result_proposal_pointer_integrity
  after insert or update on public.match_event_result_proposals
  deferrable initially deferred for each row
  execute function public.check_match_result_proposal_pointer();

create function public.check_match_result_confirmation_pointer()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_proposal public.match_event_result_proposals%rowtype;
begin
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = new.proposal_id;
  if not found or v_proposal.status <> 'confirmed'
    or v_proposal.active_version <> new.proposal_version
    or v_proposal.match_event_id <> new.match_event_id
    or v_proposal.group_number <> new.group_number then
    raise exception 'Confirmation must match the terminal active result pointer'
      using errcode = '23514';
  end if;
  return null;
end $$;
create constraint trigger match_result_confirmation_pointer_integrity
  after insert on public.match_event_result_confirmations
  deferrable initially deferred for each row
  execute function public.check_match_result_confirmation_pointer();

-- Finalizer owns no clock input. It acquires the canonical event lock chain,
-- then re-reads and locks the proposal before evaluating current evidence.
create function public.finalize_match_event_result_locked(
  p_proposal_id uuid, p_expected_version bigint, p_source text, p_actor_id uuid
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_fact public.match_event_result_proposal_versions%rowtype;
  v_existing public.match_event_result_confirmations%rowtype;
  v_now timestamptz;
  v_transition_revision bigint;
  v_confirmation_id uuid;
begin
  if p_proposal_id is null or p_expected_version is null or p_expected_version < 1
    or p_source not in ('MANUAL', 'AUTO_48H')
    or (p_source = 'MANUAL' and p_actor_id is null)
    or (p_source = 'AUTO_48H' and p_actor_id is not null) then
    raise exception 'Invalid result finalization request' using errcode = '22023';
  end if;

  select p.match_event_id into v_event_id from public.match_event_result_proposals p
   where p.id = p_proposal_id;
  if not found then return null; end if;
  v_event := public.lock_match_event_registration(v_event_id);
  select * into v_proposal from public.match_event_result_proposals p
   where p.id = p_proposal_id for update;
  if not found then return null; end if;
  if v_proposal.active_version <> p_expected_version then return null; end if;

  if v_proposal.status = 'confirmed' then
    select * into v_existing from public.match_event_result_confirmations c
     where c.proposal_id = p_proposal_id and c.proposal_version = p_expected_version;
    if found then return v_existing.id; end if;
    raise exception 'Confirmed proposal is missing its confirmation evidence' using errcode = '23514';
  end if;
  if v_proposal.status <> 'pending' then return null; end if;

  select * into v_fact from public.match_event_result_proposal_versions v
   where v.proposal_id = p_proposal_id and v.version = p_expected_version;
  if not found then
    raise exception 'Active result version is missing immutable facts' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = p_proposal_id
       and r.proposal_version = p_expected_version
       and r.decision = 'reject'
  ) then return null; end if;

  v_now := clock_timestamp();
  if p_source = 'AUTO_48H' then
    if v_now < v_proposal.review_deadline_at then return null; end if;
  else
    if v_now >= v_proposal.review_deadline_at
      or not public.has_match_event_result_approval_coverage(
        p_proposal_id, p_expected_version, p_actor_id
      ) then return null; end if;
  end if;

  select s.transition_revision into v_transition_revision
    from public.match_event_registration_state s
   where s.match_event_id = v_event.id;
  if v_transition_revision is null then
    raise exception 'Result confirmation requires frozen registration state' using errcode = '23514';
  end if;

  v_confirmation_id := gen_random_uuid();
  insert into public.match_event_result_confirmations(
    id, proposal_id, proposal_version, match_event_id, group_number, source,
    confirmed_at, effective_at, actor_id, event_type, ratable_eligible
  ) values (
    v_confirmation_id, v_proposal.id, v_proposal.active_version,
    v_proposal.match_event_id, v_proposal.group_number, p_source,
    v_now,
    case when p_source = 'AUTO_48H' then v_proposal.review_deadline_at else v_now end,
    p_actor_id, v_event.event_type,
    v_event.event_type = 'competitive' and v_fact.classification <> 'incomplete'
  );

  update public.match_event_result_proposals p set status = 'confirmed'
   where p.id = v_proposal.id and p.active_version = p_expected_version and p.status = 'pending';
  if not found then
    raise exception 'Result proposal changed during finalization' using errcode = '23514';
  end if;

  insert into public.match_event_audit_log(
    match_event_id, community_id, actor_id, action, request_id, occurred_at,
    event_version, transition_revision, before_data, after_data, changed_fields,
    confirmation_id
  ) values (
    v_event.id, v_event.community_id, p_actor_id, 'result_confirmed', null, v_now,
    p_expected_version, v_transition_revision,
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'pending'),
    jsonb_build_object('proposal_id', v_proposal.id, 'group_number', v_proposal.group_number,
      'version', p_expected_version, 'status', 'confirmed', 'source', p_source,
      'confirmation_id', v_confirmation_id),
    array['status', 'confirmation_id'], v_confirmation_id
  );
  return v_confirmation_id;
end $$;

-- Only confirmed facts are official. The confirmation identity and exact fact
-- version travel together; provisional pointer rows never enter this seam.
create function public.get_match_event_official_results(p_match_event_id uuid)
returns setof jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_event public.match_events%rowtype;
begin
  if auth.uid() is null or coalesce(auth.jwt() ->> 'is_anonymous', 'false') = 'true' then
    raise exception 'MATCH_RESULT_UNAUTHENTICATED' using errcode = '28000';
  end if;
  select * into v_event from public.match_events e where e.id = p_match_event_id;
  if not found then raise exception 'MATCH_RESULT_NOT_FOUND' using errcode = 'P0001'; end if;
  if v_event.created_by <> auth.uid()
    and not public.is_community_admin(v_event.community_id)
    and not exists (
      select 1 from public.match_event_registrations r
       where r.match_event_id = v_event.id
         and r.user_id = auth.uid()
         and r.lifecycle = 'accepted'
         and r.cancelled_at is null
    ) then
    raise exception 'MATCH_RESULT_FORBIDDEN' using errcode = '42501';
  end if;

  return query
  select jsonb_build_object(
    'event_id', c.match_event_id,
    'confirmation_id', c.id,
    'proposal_id', c.proposal_id,
    'group_number', c.group_number,
    'version', c.proposal_version,
    'source', c.source,
    'confirmed_at', c.confirmed_at,
    'effective_at', c.effective_at,
    'actor_id', c.actor_id,
    'event_type', c.event_type,
    'ratable_eligible', c.ratable_eligible,
    'teams', v.teams,
    'sets', v.sets,
    'classification', v.classification,
    'played_at_utc', v.played_at_utc,
    'played_at_local', to_char(v.played_at_local, 'YYYY-MM-DD HH24:MI:SS'),
    'played_at_offset_seconds', v.played_at_offset_seconds,
    'court_label', v.court_label
  )
  from public.match_event_result_confirmations c
  join public.match_event_result_proposal_versions v
    on v.proposal_id = c.proposal_id and v.version = c.proposal_version
  where c.match_event_id = v_event.id
  order by c.group_number;
end $$;

-- Extend existing replay and audit vocabulary without exposing new commands.
alter table public.match_event_management_commands
  drop constraint match_event_management_commands_action_check,
  add constraint match_event_management_commands_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'edit', 'reconfirm',
      'submit_result', 'review_result', 'correct_result'));

alter table public.match_event_audit_log
  drop constraint match_event_audit_log_action_check,
  drop constraint match_event_audit_log_check2,
  add column confirmation_id uuid,
  add constraint match_event_audit_log_action_check
    check (action in ('withdraw', 'remove', 'transfer', 'cancel', 'minor_edit', 'major_edit',
      'reconfirm', 'reconfirmation_excluded', 'result_approved', 'result_disputed',
      'result_corrected', 'result_confirmed')),
  add constraint match_event_audit_log_actor_result_check check (
    (action = 'result_confirmed' and after_data ->> 'source' = 'AUTO_48H' and actor_id is null)
    or (action = 'reconfirmation_excluded' and actor_id is null)
    or (actor_id is not null and (action <> 'result_confirmed' or after_data ->> 'source' = 'MANUAL'))
  ),
  add constraint match_event_audit_log_confirmation_fk
    foreign key (confirmation_id)
    references public.match_event_result_confirmations(id)
    on delete restrict,
  add constraint match_event_audit_log_confirmation_unique unique (confirmation_id),
  add constraint match_event_audit_log_confirmation_action_check
    check ((action = 'result_confirmed') = (confirmation_id is not null));

create or replace function public.guard_match_event_audit()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op <> 'INSERT' then
    raise exception 'Match audit is insert-only' using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.match_events e
     where e.id = new.match_event_id and e.community_id = new.community_id
  ) then
    raise exception 'Audit community does not match event' using errcode = '23514';
  end if;
  if new.confirmation_id is not null and not exists (
    select 1 from public.match_event_result_confirmations c
     where c.id = new.confirmation_id and c.match_event_id = new.match_event_id
  ) then
    raise exception 'Confirmation audit identity does not match event' using errcode = '23514';
  end if;
  return new;
end $$;

-- Replace the existing submission body by a narrow, fail-closed source edit.
-- v1 metadata is copied from the trusted pointer written by auth.uid()/DB time;
-- no browser-supplied provenance parameter is added.
do $$
declare
  v_definition text;
  v_original text;
  v_old text := 'public.match_event_result_proposal_versions(proposal_id,version,teams,sets,classification,played_at_utc,played_at_local,played_at_offset_seconds,court_label)' || E'\n    values(proposal.id,1,teams,sets,public.classify_match_result_sets(sets),instant,local_time,offset_seconds,btrim(p_court_label));';
  v_new text := 'public.match_event_result_proposal_versions(proposal_id,version,submitted_by,submitted_at,review_deadline_at,teams,sets,classification,played_at_utc,played_at_local,played_at_offset_seconds,court_label)' || E'\n    values(proposal.id,1,proposal.submitted_by,proposal.submitted_at,proposal.review_deadline_at,teams,sets,public.classify_match_result_sets(sets),instant,local_time,offset_seconds,btrim(p_court_label));';
begin
  v_original := pg_get_functiondef('public.submit_match_event_result(uuid,bigint,jsonb,jsonb,jsonb,text,uuid)'::regprocedure);
  v_definition := replace(v_original, v_old, v_new);
  if v_definition = v_original then
    raise exception 'Unexpected submit_match_event_result definition; refusing incomplete v1 provenance update';
  end if;
  execute v_definition;
end $$;

revoke all on function public.guard_match_result_review_immutable(),
  public.guard_match_event_result_confirmation_insert(),
  public.guard_match_result_proposal_transition(),
  public.check_match_result_proposal_pointer(),
  public.check_match_result_confirmation_pointer(),
  public.has_match_event_result_approval_coverage(uuid, bigint, uuid),
  public.finalize_match_event_result_locked(uuid, bigint, text, uuid),
  public.get_match_event_official_results(uuid)
  from public, anon, authenticated;

-- The reader is the only new client RPC. Review and confirmation evidence can
-- also be selected through matching RLS; all table writes stay RPC/internal.
grant execute on function public.get_match_event_official_results(uuid) to authenticated;

revoke all on function public.guard_match_event_audit() from public, anon, authenticated;

commit;
