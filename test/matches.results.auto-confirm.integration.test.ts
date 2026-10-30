import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  isRecord,
  sqlRows,
  startSql,
  waitForRows,
  withDeadline
} from './helpers/match-registration-sql';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt,
  reviewResultSets
} from './helpers/match-result-review-fixtures';
import {
  installResultConfirmationAuditPause,
  installResultConfirmationFailure,
  makeResultProcessingRetryDue,
  processDueMatchEventResults,
  seedResultProcessingBackoff,
  setResultReviewDeadlineOffset
} from './helpers/match-result-processing-fixtures';

describe('trusted result auto-confirm scheduler', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createMatchResultReviewFixtures(env);
  });

  afterAll(async () => {
    if (f) await f.cleanup();
  });

  async function pending() {
    const eventId = await f.protectedEvent();
    const created = await f.submit(eventId, { submitter: f.admin });
    expect(created.error).toBeNull();
    return { eventId, proposalId: String(asRecord(created.data).proposal_id) };
  }

  function reviewCall(
    proposalId: string,
    actorIndex: number,
    decision: 'approve' | 'reject' = 'approve'
  ) {
    return f.rpc(f.players[actorIndex]!, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: decision,
      p_reason_code: decision === 'reject' ? 'SCORE_INCORRECT' : null,
      p_reason_note: null,
      p_request_id: crypto.randomUUID()
    });
  }

  async function eventResultCounts(eventId: string) {
    const [row] = await sqlRows(`
      select
        (select count(*)::int from public.match_event_result_confirmations c
          where c.match_event_id = '${eventId}') as confirmations,
        (select count(*)::int from public.match_event_audit_log a
          where a.match_event_id = '${eventId}' and a.action = 'result_confirmed') as confirmation_audits,
        (select count(*)::int from public.notifications n
          where n.target_id = '${eventId}') as notifications
    `);
    return row!;
  }

  it('confirms zero and partial approvals only at/after the DB deadline, with exact effective_at', async () => {
    const beforeDeadline = await pending();
    await setResultReviewDeadlineOffset(beforeDeadline.proposalId, 1, 3600);
    expect(await processDueMatchEventResults()).toMatchObject({
      attempted: 0,
      skipped: 0,
      failed: 0,
      confirmed: 0
    });
    expect(
      await sqlRows(
        `select status from public.match_event_result_proposals where id='${beforeDeadline.proposalId}'`
      )
    ).toEqual([{ status: 'pending' }]);

    const zeroApproval = await pending();
    const partialApproval = await pending();
    const partialVote = await reviewCall(partialApproval.proposalId, 0);
    expect(partialVote.error).toBeNull();
    expect(asRecord(partialVote.data)).toMatchObject({ status: 'pending' });
    const zeroDeadline = await setResultReviewDeadlineOffset(zeroApproval.proposalId, 1, 0);
    const partialDeadline = await setResultReviewDeadlineOffset(partialApproval.proposalId, 1, -2);

    const result = await processDueMatchEventResults();
    expect(result).toMatchObject({ attempted: 2, skipped: 0, failed: 0, confirmed: 2 });
    const confirmations = await sqlRows(`
      select c.proposal_id::text as proposal_id, c.source,
             c.effective_at::text as effective_at,
             c.effective_at = p.review_deadline_at as exact_deadline,
             c.confirmed_at >= p.review_deadline_at as not_early
        from public.match_event_result_confirmations c
        join public.match_event_result_proposals p on p.id = c.proposal_id
       where c.proposal_id in ('${zeroApproval.proposalId}', '${partialApproval.proposalId}')
       order by c.proposal_id
    `);
    expect(confirmations).toHaveLength(2);
    expect(confirmations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          proposal_id: zeroApproval.proposalId,
          source: 'AUTO_48H',
          effective_at: zeroDeadline,
          exact_deadline: true,
          not_early: true
        }),
        expect.objectContaining({
          proposal_id: partialApproval.proposalId,
          source: 'AUTO_48H',
          effective_at: partialDeadline,
          exact_deadline: true,
          not_early: true
        })
      ])
    );

    const replay = await processDueMatchEventResults();
    expect(replay).toMatchObject({ attempted: 0, confirmed: 0, failed: 0 });
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_confirmations
        where proposal_id in ('${zeroApproval.proposalId}', '${partialApproval.proposalId}')`)
    ).toEqual([{ count: 2 }]);
  });

  it('never confirms a disputed proposal, even after its deadline', async () => {
    const current = await pending();
    await setResultReviewDeadlineOffset(current.proposalId, 1, 3600);
    expect(await processDueMatchEventResults()).toMatchObject({ attempted: 0, confirmed: 0 });
    const rejection = await reviewCall(current.proposalId, 1, 'reject');
    expect(rejection.error).toBeNull();
    expect(asRecord(rejection.data)).toMatchObject({ status: 'disputed' });
    await setResultReviewDeadlineOffset(current.proposalId, 1, -1);

    expect(await processDueMatchEventResults()).toMatchObject({
      attempted: 0,
      skipped: 0,
      failed: 0,
      confirmed: 0
    });
    expect(await eventResultCounts(current.eventId)).toMatchObject({
      confirmations: 0,
      confirmation_audits: 0
    });
  });

  it('resets correction retry state and rejects a stale v1 scheduler candidate', async () => {
    const current = await pending();
    await seedResultProcessingBackoff(current.proposalId, 1);
    const correction = await f.rpc(f.admin, 'correct_match_event_result', {
      p_proposal_id: current.proposalId,
      p_expected_version: 1,
      p_teams: f.teamsForGroup(),
      p_sets: reviewResultSets,
      p_played_local: reviewResultPlayedAt,
      p_court_label: 'Corrected processing fixture',
      p_request_id: crypto.randomUUID()
    });
    expect(correction.error).toBeNull();
    expect(asRecord(correction.data)).toMatchObject({ version: 2, status: 'pending' });

    const versionState = await sqlRows(`
      select s.proposal_version::int as proposal_version,
             s.attempt_count, s.failure_count, s.last_failure_code,
             s.next_attempt_at is null as no_backoff,
             v.submitted_at > old.submitted_at as fresh_submission,
             v.review_deadline_at = v.submitted_at + interval '48 hours' as fresh_deadline
        from public.match_event_result_processing_state s
        join public.match_event_result_proposals p on p.id = s.proposal_id
        join public.match_event_result_proposal_versions v
          on v.proposal_id = p.id and v.version = p.active_version
        join public.match_event_result_proposal_versions old
          on old.proposal_id = p.id and old.version = 1
       where s.proposal_id = '${current.proposalId}'
    `);
    expect(versionState).toEqual([
      {
        proposal_version: 2,
        attempt_count: 0,
        failure_count: 0,
        last_failure_code: null,
        no_backoff: true,
        fresh_submission: true,
        fresh_deadline: true
      }
    ]);

    const stale = await sqlRows(`
      select public.try_auto_confirm_match_event_result('${current.proposalId}', 1) as result
    `);
    expect(asRecord(stale[0]?.['result'])).toMatchObject({ reason: 'stale_candidate' });
    expect(await processDueMatchEventResults()).toMatchObject({ attempted: 0, confirmed: 0 });
    expect(await eventResultCounts(current.eventId)).toMatchObject({ confirmations: 0 });
    expect(
      await sqlRows(`select status, active_version::int as version
        from public.match_event_result_proposals where id='${current.proposalId}'`)
    ).toEqual([{ status: 'pending', version: 2 }]);

    const deadline = await setResultReviewDeadlineOffset(current.proposalId, 2, -1);
    expect(await processDueMatchEventResults()).toMatchObject({
      attempted: 1,
      confirmed: 1,
      failed: 0
    });
    expect(
      await sqlRows(`select c.proposal_version::int as version,
                            c.effective_at::text as effective_at,
                            c.effective_at = p.review_deadline_at as exact_deadline
        from public.match_event_result_confirmations c
        join public.match_event_result_proposals p on p.id=c.proposal_id
        where c.proposal_id='${current.proposalId}'`)
    ).toEqual([{ version: 2, effective_at: deadline, exact_deadline: true }]);
  });

  it('rolls back a poison item, advances a healthy peer, and retries without duplicate effects', async () => {
    const poison = await pending();
    const healthy = await pending();
    await setResultReviewDeadlineOffset(poison.proposalId, 1, -3600);
    await setResultReviewDeadlineOffset(healthy.proposalId, 1, -1800);
    const poisonNotificationsBefore = await eventResultCounts(poison.eventId);
    let removeFailure: (() => Promise<void>) | undefined;
    try {
      removeFailure = await installResultConfirmationFailure(poison.proposalId);
      const partialBatch = await processDueMatchEventResults(2);
      expect(partialBatch).toMatchObject({ attempted: 2, skipped: 0, failed: 1, confirmed: 1 });
      const errors = partialBatch['errors'];
      expect(Array.isArray(errors)).toBe(true);
      expect(asRecord(Array.isArray(errors) ? errors[0] : undefined)).toMatchObject({
        proposal_id: poison.proposalId,
        version: 1,
        code: 'P0001',
        message: 'Automatic result confirmation failed; retry is scheduled.'
      });
    } finally {
      if (removeFailure) await removeFailure();
    }

    expect(await eventResultCounts(poison.eventId)).toMatchObject({
      confirmations: 0,
      confirmation_audits: 0,
      notifications: poisonNotificationsBefore['notifications']
    });
    expect(
      await sqlRows(
        `select status from public.match_event_result_proposals where id='${poison.proposalId}'`
      )
    ).toEqual([{ status: 'pending' }]);
    const failureState = await sqlRows(`
      select proposal_version::int as proposal_version, attempt_count, failure_count,
             last_failure_code, last_failure_message,
             next_attempt_at > pg_catalog.clock_timestamp() as backoff_active
        from public.match_event_result_processing_state
       where proposal_id='${poison.proposalId}'
    `);
    expect(failureState).toEqual([
      {
        proposal_version: 1,
        attempt_count: 1,
        failure_count: 1,
        last_failure_code: 'P0001',
        last_failure_message: 'Automatic result confirmation failed; retry is scheduled.',
        backoff_active: true
      }
    ]);
    expect(await eventResultCounts(healthy.eventId)).toMatchObject({
      confirmations: 1,
      confirmation_audits: 1
    });

    await makeResultProcessingRetryDue(poison.proposalId, 1);
    expect(await processDueMatchEventResults(1)).toMatchObject({
      attempted: 1,
      skipped: 0,
      failed: 0,
      confirmed: 1
    });
    const retry = await processDueMatchEventResults();
    expect(retry).toMatchObject({ attempted: 0, failed: 0, confirmed: 0 });
    expect(await eventResultCounts(poison.eventId)).toMatchObject({
      confirmations: 1,
      confirmation_audits: 1
    });
    expect(
      await sqlRows(`select count(*)::int as count from public.match_event_result_confirmations
        where proposal_id='${poison.proposalId}'`)
    ).toEqual([{ count: 1 }]);
  });

  it('does not block finalization on a contended processing-state row', async () => {
    const current = await pending();
    await setResultReviewDeadlineOffset(current.proposalId, 1, -1);
    await seedResultProcessingBackoff(current.proposalId, 1);
    await makeResultProcessingRetryDue(current.proposalId, 1);

    const marker = `paf-result-state-lock-${crypto.randomUUID().replaceAll('-', '')}`;
    const stateHolder = startSql(`
      /* ${marker} */
      select pg_catalog.pg_sleep(8)
        from (
          select proposal_id from public.match_event_result_processing_state
           where proposal_id='${current.proposalId}' for update
        ) locked
    `);
    let processing: Promise<Record<string, unknown>> | undefined;
    try {
      await waitForRows(
        `select pid::int as pid from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and state='active'
            and pid <> pg_catalog.pg_backend_pid()`,
        (rows) => rows.length === 1,
        'processing state row lock holder',
        10000,
        25
      );
      processing = processDueMatchEventResults(1);
      expect(
        await withDeadline(processing, 3000, 'nonblocking result-state bookkeeping')
      ).toMatchObject({
        attempted: 1,
        skipped: 0,
        failed: 0,
        confirmed: 1
      });
    } finally {
      await stateHolder.stop();
      if (processing) await processing.catch(() => undefined);
    }

    expect(await eventResultCounts(current.eventId)).toMatchObject({
      confirmations: 1,
      confirmation_audits: 1
    });
  });

  it('serializes concurrent scheduler runs against a late reviewer to one confirmation', async () => {
    const current = await pending();
    const firstApproval = await reviewCall(current.proposalId, 0);
    expect(firstApproval.error).toBeNull();
    await setResultReviewDeadlineOffset(current.proposalId, 1, -1);
    let removePause: (() => Promise<void>) | undefined;
    let processor: ReturnType<typeof startSql> | undefined;
    let lateReview:
      | Promise<{ data: unknown; error: { message?: string | null } | null }>
      | undefined;
    try {
      removePause = await installResultConfirmationAuditPause(current.proposalId);
      const marker = `paf-result-auto-confirm-${crypto.randomUUID().replaceAll('-', '')}`;
      processor = startSql(
        `/* ${marker} */ select public.process_due_match_event_results(25) as result`
      );
      const processorPid = await processor.backendPid;
      await waitForRows(
        `select pid::int as pid from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and wait_event = 'PgSleep'
            and state = 'active' and pid <> pg_catalog.pg_backend_pid()`,
        (rows) => rows.length === 1,
        'scheduler confirmation audit pause',
        10000,
        25
      );

      lateReview = reviewCall(current.proposalId, 2);
      await waitForRows(
        `select pid::int as pid from pg_catalog.pg_stat_activity a
          where a.wait_event_type = 'Lock'
            and a.query like '%review_match_event_result%'
            and ${processorPid} = any(pg_catalog.pg_blocking_pids(a.pid))`,
        (rows) => rows.length >= 1,
        'late reviewer queued behind scheduler confirmation',
        10000,
        25
      );
      expect(await processDueMatchEventResults()).toMatchObject({
        attempted: 1,
        skipped: 1,
        failed: 0,
        confirmed: 0
      });

      const processorResult = await withDeadline(processor.done, 30000, 'auto-confirm processor');
      expect(processorResult.code).toBe(0);
      const processorRows: unknown = JSON.parse(processorResult.stdout);
      const processorRow = Array.isArray(processorRows) ? processorRows[0] : undefined;
      const processorReceipt = isRecord(processorRow) ? processorRow['result'] : undefined;
      expect(asRecord(processorReceipt)).toMatchObject({
        attempted: 1,
        skipped: 0,
        failed: 0,
        confirmed: 1
      });
      const reviewResult = await withDeadline(lateReview, 30000, 'late review collision');
      expect(reviewResult.error?.message).toBe('MATCH_RESULT_REVIEW_CONFLICT');
    } finally {
      if (processor) await processor.stop();
      if (lateReview) await lateReview.catch(() => undefined);
      if (removePause) await removePause();
    }

    expect(await eventResultCounts(current.eventId)).toMatchObject({
      confirmations: 1,
      confirmation_audits: 1
    });
    expect(
      await sqlRows(`select source, effective_at=review_deadline_at as exact_deadline
        from public.match_event_result_confirmations c
        join public.match_event_result_proposals p on p.id=c.proposal_id
        where c.proposal_id='${current.proposalId}'`)
    ).toEqual([{ source: 'AUTO_48H', exact_deadline: true }]);
  });

  it('keeps processor execution unavailable to browser roles', async () => {
    const [privileges] = await sqlRows(`
      select has_function_privilege('anon',
               'public.process_due_match_event_results(integer)', 'EXECUTE') as anon_execute,
             has_function_privilege('authenticated',
               'public.process_due_match_event_results(integer)', 'EXECUTE') as authenticated_execute
    `);
    expect(privileges).toEqual({ anon_execute: false, authenticated_execute: false });

    const browserCall = await f.rpc(f.admin, 'process_due_match_event_results', { p_limit: 1 });
    expect(browserCall.error).not.toBeNull();
  });
});
