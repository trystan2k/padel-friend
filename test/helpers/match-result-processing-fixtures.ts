import { asRecord, fixtureSql, isRecord, sqlRows } from './match-registration-sql';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertFixtureIdentity(proposalId: string, version: number): void {
  if (!uuidPattern.test(proposalId)) throw new Error('Invalid result proposal fixture ID');
  if (!Number.isSafeInteger(version) || version < 1)
    throw new Error('Invalid result proposal fixture version');
}

/** Set version and pointer deadline together using only the trusted DB clock. */
export async function setResultReviewDeadlineOffset(
  proposalId: string,
  version: number,
  offsetSeconds: number
): Promise<string> {
  assertFixtureIdentity(proposalId, version);
  if (!Number.isSafeInteger(offsetSeconds) || Math.abs(offsetSeconds) > 2_592_000)
    throw new Error('Result deadline fixture offset must be within 30 days');

  await fixtureSql(`
    alter table public.match_event_result_proposal_versions
      disable trigger match_result_proposal_version_immutable;
    alter table public.match_event_result_proposals
      disable trigger match_result_proposal_transition_guard;
  `);
  try {
    await fixtureSql(`
    do $result_deadline_fixture$
    declare
      v_deadline timestamptz := pg_catalog.clock_timestamp()
        + pg_catalog.make_interval(secs => ${offsetSeconds});
    begin
      update public.match_event_result_proposal_versions
         set submitted_at = v_deadline - interval '48 hours',
             review_deadline_at = v_deadline
       where proposal_id = '${proposalId}' and version = ${version};
      if not found then raise exception 'RESULT_FIXTURE_VERSION_NOT_FOUND'; end if;
      update public.match_event_result_proposals
         set submitted_at = v_deadline - interval '48 hours',
             review_deadline_at = v_deadline
       where id = '${proposalId}' and active_version = ${version};
      if not found then raise exception 'RESULT_FIXTURE_POINTER_NOT_FOUND'; end if;
    end
    $result_deadline_fixture$;
    `);
  } finally {
    await fixtureSql(`
    alter table public.match_event_result_proposals
      enable trigger match_result_proposal_transition_guard;
    alter table public.match_event_result_proposal_versions
      enable trigger match_result_proposal_version_immutable;
    `);
  }

  const [row] = await sqlRows(`
    select p.review_deadline_at::text as deadline,
           p.submitted_at + interval '48 hours' = p.review_deadline_at as exact_48_hours
      from public.match_event_result_proposals p
     where p.id = '${proposalId}' and p.active_version = ${version}
  `);
  if (!row || row['exact_48_hours'] !== true)
    throw new Error('Result deadline fixture did not preserve the 48-hour contract');
  return String(row['deadline']);
}

export async function processDueMatchEventResults(limit = 25): Promise<Record<string, unknown>> {
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('Result processor fixture limit must be between 1 and 100');
  const [row] = await sqlRows(`select public.process_due_match_event_results(${limit}) as result`);
  if (!row || !isRecord(row['result']))
    throw new Error('Result processor returned no JSON receipt');
  return asRecord(row['result']);
}

/** Re-enable a failed fixture version without changing the real DB clock. */
export async function makeResultProcessingRetryDue(
  proposalId: string,
  version: number
): Promise<void> {
  assertFixtureIdentity(proposalId, version);
  await fixtureSql(`
    update public.match_event_result_processing_state
       set next_attempt_at = pg_catalog.clock_timestamp(),
           updated_at = pg_catalog.clock_timestamp()
     where proposal_id = '${proposalId}' and proposal_version = ${version}
  `);
}

/** Seed stale v1 retry metadata so correction-reset behavior stays observable. */
export async function seedResultProcessingBackoff(
  proposalId: string,
  version: number
): Promise<void> {
  assertFixtureIdentity(proposalId, version);
  await fixtureSql(`
    insert into public.match_event_result_processing_state(
      proposal_id, proposal_version, attempted_at, attempt_count, failure_count,
      last_failure_at, last_failure_code, last_failure_message, next_attempt_at,
      updated_at
    ) values (
      '${proposalId}', ${version}, pg_catalog.clock_timestamp(), 8, 3,
      pg_catalog.clock_timestamp(), 'P0001',
      'Automatic result confirmation failed; retry is scheduled.',
      pg_catalog.clock_timestamp() + interval '5 minutes', pg_catalog.clock_timestamp()
    )
    on conflict (proposal_id) do update
      set proposal_version = excluded.proposal_version,
          attempted_at = excluded.attempted_at,
          attempt_count = excluded.attempt_count,
          failure_count = excluded.failure_count,
          last_failure_at = excluded.last_failure_at,
          last_failure_code = excluded.last_failure_code,
          last_failure_message = excluded.last_failure_message,
          next_attempt_at = excluded.next_attempt_at,
          updated_at = excluded.updated_at
  `);
}

/** Install a failure isolated to one owned confirmation fixture. */
export async function installResultConfirmationFailure(
  proposalId: string
): Promise<() => Promise<void>> {
  if (!uuidPattern.test(proposalId)) throw new Error('Invalid result proposal fixture ID');
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const functionName = `paf_result_failure_${suffix}`;
  const triggerName = `paf_result_failure_trigger_${suffix}`;
  await fixtureSql(`
    create function public.${functionName}()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      raise exception using errcode = 'P0001', message = 'FIXTURE_RESULT_CONFIRMATION_FAILURE';
    end $$;
    create trigger ${triggerName}
      after insert on public.match_event_result_confirmations
      for each row when (new.proposal_id = '${proposalId}'::uuid)
      execute function public.${functionName}();
  `);
  return async () => {
    await fixtureSql(`
      drop trigger if exists ${triggerName} on public.match_event_result_confirmations;
      drop function if exists public.${functionName}();
    `);
  };
}

/** Pause the confirmation audit for one fixture to expose lock races. */
export async function installResultConfirmationAuditPause(
  proposalId: string
): Promise<() => Promise<void>> {
  if (!uuidPattern.test(proposalId)) throw new Error('Invalid result proposal fixture ID');
  const suffix = crypto.randomUUID().replaceAll('-', '');
  const functionName = `paf_result_pause_${suffix}`;
  const triggerName = `paf_result_pause_trigger_${suffix}`;
  await fixtureSql(`
    create function public.${functionName}()
    returns trigger language plpgsql set search_path = '' as $$
    begin
      perform pg_catalog.pg_sleep(5);
      return new;
    end $$;
    create trigger ${triggerName}
      before insert on public.match_event_audit_log
      for each row when (
        new.action = 'result_confirmed'
        and new.after_data ->> 'proposal_id' = '${proposalId}'
      )
      execute function public.${functionName}();
  `);
  return async () => {
    await fixtureSql(`
      drop trigger if exists ${triggerName} on public.match_event_audit_log;
      drop function if exists public.${functionName}();
    `);
  };
}
