begin;

-- T08.3: bounded, version-scoped automatic result confirmation.
--
-- Candidate discovery stays lock-free and uses the partial pending/deadline
-- index. Each candidate then takes the established canonical event lock chain
-- non-blockingly, locks its proposal last, revalidates its version/status/clock,
-- and delegates the immutable transition to the shared finalizer. Batch items
-- run in exception subtransactions so one bad proposal cannot roll back peers.

create index match_event_result_proposals_auto_confirm_due
  on public.match_event_result_proposals (review_deadline_at, id)
  include (active_version)
  where status = 'pending';

alter table public.match_event_result_processing_state
  add column proposal_version bigint not null default 1,
  add column failure_count integer not null default 0
    check (failure_count >= 0),
  add column last_failure_message text;

-- Existing processing rows, if any, belong to the pointer's current immutable
-- version. Old failures remain visible but receive a safe generic detail and
-- an immediately eligible retry under the new bounded retry policy.
update public.match_event_result_processing_state s
   set proposal_version = p.active_version,
       failure_count = case when s.last_failure_code is null then 0 else 1 end,
       last_failure_message = case when s.last_failure_code is null then null
         else 'Automatic result confirmation failed; retry is scheduled.' end,
       next_attempt_at = case when s.last_failure_code is null then null
         else pg_catalog.clock_timestamp() end
  from public.match_event_result_proposals p
 where p.id = s.proposal_id;

alter table public.match_event_result_processing_state
  add constraint match_result_processing_failure_details_shape check (
    (last_failure_code is null) = (last_failure_message is null)
    and (last_failure_code is null) = (next_attempt_at is null)
    and (last_failure_code is null or failure_count > 0)
  ),
  add constraint match_result_processing_version_fk
    foreign key (proposal_id, proposal_version)
    references public.match_event_result_proposal_versions(proposal_id, version)
    on delete restrict;

comment on index public.match_event_result_proposals_auto_confirm_due is
  'Narrows trusted automatic-confirmation scans to due Pending proposals.';
comment on column public.match_event_result_processing_state.proposal_version is
  'Attempt and retry metadata applies only to this immutable proposal version.';
comment on column public.match_event_result_processing_state.failure_count is
  'Consecutive failures for proposal_version; controls bounded exponential retry backoff.';
comment on column public.match_event_result_processing_state.last_failure_message is
  'Sanitized operator detail; raw SQL error text is never persisted.';

-- All internal metadata writers serialize per proposal without waiting. A
-- correction can skip reset if a processor owns this key: version mismatch
-- makes the old counters/backoff ineligible and the next attempt starts fresh.
create function public.try_lock_match_result_processing_state(p_proposal_id uuid)
returns boolean language sql volatile security definer set search_path = '' as $$
  select pg_catalog.pg_try_advisory_xact_lock(
    pg_catalog.hashtextextended(p_proposal_id::text, 741203)
  );
$$;
revoke all on function public.try_lock_match_result_processing_state(uuid)
  from public, anon, authenticated;

create function public.reset_match_result_processing_state_for_version()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.active_version is distinct from old.active_version
     and public.try_lock_match_result_processing_state(new.id) then
    insert into public.match_event_result_processing_state(
      proposal_id, proposal_version, attempted_at, attempt_count, failure_count,
      last_failure_at, last_failure_code, last_failure_message, next_attempt_at,
      updated_at
    ) values (
      new.id, new.active_version, null, 0, 0,
      null, null, null, null, pg_catalog.clock_timestamp()
    )
    on conflict (proposal_id) do update
      set proposal_version = excluded.proposal_version,
          attempted_at = null,
          attempt_count = 0,
          failure_count = 0,
          last_failure_at = null,
          last_failure_code = null,
          last_failure_message = null,
          next_attempt_at = null,
          updated_at = excluded.updated_at;
  end if;
  return null;
end $$;
revoke all on function public.reset_match_result_processing_state_for_version()
  from public, anon, authenticated;

create trigger match_result_processing_version_reset
  after update of active_version on public.match_event_result_proposals
  for each row execute function public.reset_match_result_processing_state_for_version();

-- Try to claim the bookkeeping key and row; neither lock attempt waits. The
-- version predicate prevents an already-selected stale candidate from changing
-- corrected-version metadata after it loses the canonical event lock race.
create function public.record_match_result_processing_attempt(
  p_proposal_id uuid,
  p_version bigint,
  p_failed boolean,
  p_failure_code text default null,
  p_clear_failure boolean default false
) returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_state public.match_event_result_processing_state%rowtype;
  v_failure_count integer;
  v_failure_code text;
begin
  if p_proposal_id is null or p_version is null or p_version < 1 then
    return false;
  end if;
  if p_failed and p_clear_failure then
    raise exception 'Invalid result processing bookkeeping request' using errcode = '22023';
  end if;
  if p_failed then
    v_failure_code := case when p_failure_code ~ '^[A-Z0-9_]{1,80}$'
      then p_failure_code else 'PROCESSING_ERROR' end;
  end if;

  if not public.try_lock_match_result_processing_state(p_proposal_id) then
    return false;
  end if;
  if not exists (
    select 1 from public.match_event_result_proposals p
     where p.id = p_proposal_id and p.active_version = p_version
  ) then
    return false;
  end if;

  begin
    select s.* into v_state
      from public.match_event_result_processing_state s
     where s.proposal_id = p_proposal_id
     for update nowait;
  exception when lock_not_available then
    return false;
  end;

  if not found or v_state.proposal_version <> p_version then
    v_failure_count := case when p_failed then 1 else 0 end;
    insert into public.match_event_result_processing_state(
      proposal_id, proposal_version, attempted_at, attempt_count, failure_count,
      last_failure_at, last_failure_code, last_failure_message, next_attempt_at,
      updated_at
    ) values (
      p_proposal_id, p_version, pg_catalog.clock_timestamp(), 1, v_failure_count,
      case when p_failed then pg_catalog.clock_timestamp() else null end,
      case when p_failed then v_failure_code else null end,
      case when p_failed then 'Automatic result confirmation failed; retry is scheduled.' else null end,
      case when p_failed then pg_catalog.clock_timestamp() + pg_catalog.make_interval(
        secs => least(300, pg_catalog.power(2, least(v_failure_count - 1, 9)))::integer
      ) else null end,
      pg_catalog.clock_timestamp()
    )
    on conflict (proposal_id) do update
      set proposal_version = excluded.proposal_version,
          attempted_at = excluded.attempted_at,
          attempt_count = 1,
          failure_count = excluded.failure_count,
          last_failure_at = excluded.last_failure_at,
          last_failure_code = excluded.last_failure_code,
          last_failure_message = excluded.last_failure_message,
          next_attempt_at = excluded.next_attempt_at,
          updated_at = excluded.updated_at;
    return true;
  end if;

  v_failure_count := case
    when p_failed then v_state.failure_count + 1
    when p_clear_failure then 0
    else v_state.failure_count
  end;
  update public.match_event_result_processing_state s
     set attempted_at = pg_catalog.clock_timestamp(),
         attempt_count = s.attempt_count + 1,
         failure_count = v_failure_count,
         last_failure_at = case when p_failed then pg_catalog.clock_timestamp()
           when p_clear_failure then null else s.last_failure_at end,
         last_failure_code = case when p_failed then v_failure_code
           when p_clear_failure then null else s.last_failure_code end,
         last_failure_message = case when p_failed
           then 'Automatic result confirmation failed; retry is scheduled.'
           when p_clear_failure then null else s.last_failure_message end,
         next_attempt_at = case when p_failed then pg_catalog.clock_timestamp() + pg_catalog.make_interval(
             secs => least(300, pg_catalog.power(2, least(v_failure_count - 1, 9)))::integer
           )
           when p_clear_failure then null else s.next_attempt_at end,
         updated_at = pg_catalog.clock_timestamp()
   where s.proposal_id = p_proposal_id and s.proposal_version = p_version;
  return found;
end $$;
revoke all on function public.record_match_result_processing_attempt(uuid,bigint,boolean,text,boolean)
  from public, anon, authenticated;

-- One candidate only. Event/community/registration locks precede the proposal
-- lock; every eligibility condition is re-read after those locks are held.
create function public.try_auto_confirm_match_event_result(
  p_proposal_id uuid,
  p_expected_version bigint
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_event_id uuid;
  v_event public.match_events%rowtype;
  v_proposal public.match_event_result_proposals%rowtype;
  v_confirmation_id uuid;
begin
  select p.match_event_id into v_event_id
    from public.match_event_result_proposals p where p.id = p_proposal_id;
  if not found then
    return pg_catalog.jsonb_build_object('reason', 'stale_candidate');
  end if;

  v_event := public.lock_match_event_registration_skip_locked(v_event_id);
  if v_event.id is null then
    return pg_catalog.jsonb_build_object('reason', 'locked');
  end if;

  select p.* into v_proposal
    from public.match_event_result_proposals p
   where p.id = p_proposal_id
   for update;
  if not found or v_proposal.active_version <> p_expected_version then
    return pg_catalog.jsonb_build_object('reason', 'stale_candidate');
  end if;
  if v_proposal.status <> 'pending' then
    return pg_catalog.jsonb_build_object('reason', 'not_pending');
  end if;
  if pg_catalog.clock_timestamp() < v_proposal.review_deadline_at then
    return pg_catalog.jsonb_build_object('reason', 'not_due');
  end if;
  if exists (
    select 1 from public.match_event_result_reviews r
     where r.proposal_id = v_proposal.id
       and r.proposal_version = p_expected_version
       and r.decision = 'reject'
  ) then
    return pg_catalog.jsonb_build_object('reason', 'rejected');
  end if;

  v_confirmation_id := public.finalize_match_event_result_locked(
    v_proposal.id, p_expected_version, 'AUTO_48H', null
  );
  if v_confirmation_id is null then
    return pg_catalog.jsonb_build_object('reason', 'not_eligible');
  end if;
  return pg_catalog.jsonb_build_object(
    'reason', 'confirmed', 'confirmation_id', v_confirmation_id
  );
end $$;
revoke all on function public.try_auto_confirm_match_event_result(uuid,bigint)
  from public, anon, authenticated;

-- `attempted` counts selected candidates; skipped and failed are outcome
-- subsets, while confirmed counts successful transitions. Least-attempted then
-- oldest-first ordering rotates lock-skipped/poison proposals behind peers.
create function public.process_due_match_event_results(p_limit integer default 25)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_limit integer := least(greatest(coalesce(p_limit, 25), 1), 100);
  v_candidate record;
  v_result jsonb;
  v_reason text;
  v_sqlstate text;
  v_attempted integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_confirmed integer := 0;
  v_errors jsonb := '[]'::jsonb;
begin
  for v_candidate in
    select p.id as proposal_id,
           p.active_version,
           p.review_deadline_at,
           case when s.proposal_version = p.active_version then s.attempt_count else 0 end
             as attempt_count
      from public.match_event_result_proposals p
      left join public.match_event_result_processing_state s on s.proposal_id = p.id
     where p.status = 'pending'
       and p.review_deadline_at <= pg_catalog.clock_timestamp()
       and (s.proposal_id is null
         or s.proposal_version is distinct from p.active_version
         or s.next_attempt_at is null
         or s.next_attempt_at <= pg_catalog.clock_timestamp())
     order by case when s.proposal_version = p.active_version then s.attempt_count else 0 end,
              p.review_deadline_at, p.id
     limit v_limit
  loop
    v_attempted := v_attempted + 1;
    begin
      v_result := public.try_auto_confirm_match_event_result(
        v_candidate.proposal_id, v_candidate.active_version
      );
      v_reason := coalesce(v_result ->> 'reason', 'not_eligible');
      if v_reason = 'confirmed' then
        v_confirmed := v_confirmed + 1;
      else
        v_skipped := v_skipped + 1;
      end if;

      perform public.record_match_result_processing_attempt(
        v_candidate.proposal_id,
        v_candidate.active_version,
        false,
        null,
        v_reason in ('confirmed', 'stale_candidate', 'not_pending', 'rejected')
      );
    exception when others then
      -- The exception subtransaction has rolled back confirmation/audit work
      -- and released event/proposal locks before failure bookkeeping begins.
      v_sqlstate := SQLSTATE;
      v_failed := v_failed + 1;
      v_errors := v_errors || pg_catalog.jsonb_build_object(
        'proposal_id', v_candidate.proposal_id,
        'version', v_candidate.active_version,
        'code', case when v_sqlstate ~ '^[A-Z0-9_]{1,80}$' then v_sqlstate else 'PROCESSING_ERROR' end,
        'message', 'Automatic result confirmation failed; retry is scheduled.'
      );
      begin
        perform public.record_match_result_processing_attempt(
          v_candidate.proposal_id, v_candidate.active_version, true, v_sqlstate, false
        );
      exception when others then
        -- Bookkeeping is best-effort only when a non-cooperating state-row lock
        -- defeats the nonblocking claim; the next bounded tick retries it.
        null;
      end;
    end;
  end loop;

  return pg_catalog.jsonb_build_object(
    'attempted', v_attempted,
    'skipped', v_skipped,
    'failed', v_failed,
    'confirmed', v_confirmed,
    'errors', v_errors
  );
end $$;

revoke all on function public.process_due_match_event_results(integer)
  from public, anon, authenticated;

commit;
