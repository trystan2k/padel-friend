import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  proveOrderedEventLockBarrier,
  sqlRows,
  startSql,
  waitForRows
} from './helpers/match-registration-sql';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt,
  reviewResultSets
} from './helpers/match-result-review-fixtures';
import { setResultReviewDeadlineOffset } from './helpers/match-result-processing-fixtures';

describe('separate-connection result command races', { timeout: 120000 }, () => {
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
    decision: 'approve' | 'reject',
    requestId = crypto.randomUUID()
  ) {
    return () =>
      f.rpc(f.players[actorIndex]!, 'review_match_event_result', {
        p_proposal_id: proposalId,
        p_expected_version: 1,
        p_decision: decision,
        p_reason_code: decision === 'reject' ? 'SCORE_INCORRECT' : null,
        p_reason_note: null,
        p_request_id: requestId
      });
  }

  function correctionCall(proposalId: string, requestId = crypto.randomUUID()) {
    return () =>
      f.rpc(f.admin, 'correct_match_event_result', {
        p_proposal_id: proposalId,
        p_expected_version: 1,
        p_teams: f.teamsForGroup(),
        p_sets: reviewResultSets,
        p_played_local: reviewResultPlayedAt,
        p_court_label: 'Race court',
        p_request_id: requestId
      });
  }

  async function counts(eventId: string) {
    const rows = await sqlRows(`select
      (select count(*)::int from public.match_event_result_reviews r
        join public.match_event_result_proposals p on p.id=r.proposal_id where p.match_event_id='${eventId}') as reviews,
      (select count(*)::int from public.match_event_audit_log a where a.match_event_id='${eventId}'
        and a.action in ('result_approved','result_disputed')) as review_audits,
      (select count(*)::int from public.match_event_result_confirmations c where c.match_event_id='${eventId}') as confirmations,
      (select count(*)::int from public.match_event_audit_log a where a.match_event_id='${eventId}'
        and a.action='result_confirmed') as confirmation_audits,
      (select count(*)::int from public.match_event_audit_log a where a.match_event_id='${eventId}'
        and a.action='result_corrected') as correction_audits`);
    return rows[0]!;
  }

  async function setDue(proposalId: string) {
    await fixtureSql(`alter table public.match_event_result_proposal_versions disable trigger match_result_proposal_version_immutable;
      alter table public.match_event_result_proposals disable trigger match_result_proposal_transition_guard;`);
    try {
      await fixtureSql(`do $$ declare v_time timestamptz := clock_timestamp()-interval '49 hours';
      begin
      update public.match_event_result_proposal_versions
         set submitted_at=v_time, review_deadline_at=v_time+interval '48 hours'
       where proposal_id='${proposalId}' and version=1;
      update public.match_event_result_proposals
         set submitted_at=v_time, review_deadline_at=v_time+interval '48 hours'
       where id='${proposalId}';
      end $$;`);
    } finally {
      await fixtureSql(`alter table public.match_event_result_proposals enable trigger match_result_proposal_transition_guard;
        alter table public.match_event_result_proposal_versions enable trigger match_result_proposal_version_immutable;`);
    }
  }

  it('serializes both approval/rejection lock orderings; rejection first disputes, approval coverage first confirms', async () => {
    const rejectFirst = await pending();
    await f.rpc(f.players[2]!, 'review_match_event_result', {
      p_proposal_id: rejectFirst.proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
    const [rejection, approval] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: rejectFirst.eventId,
      rpcToken: 'review_match_event_result',
      fireFirst: reviewCall(rejectFirst.proposalId, 1, 'reject'),
      fireSecond: reviewCall(rejectFirst.proposalId, 0, 'approve')
    });
    expect(rejection.data).toMatchObject({ status: 'disputed' });
    expect(approval.error?.message).toBe('MATCH_RESULT_REVIEW_CONFLICT');
    expect(await counts(rejectFirst.eventId)).toMatchObject({
      reviews: 2,
      review_audits: 2,
      confirmations: 0,
      confirmation_audits: 0
    });

    const approveFirst = await pending();
    await f.rpc(f.players[2]!, 'review_match_event_result', {
      p_proposal_id: approveFirst.proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
    const [approvalWins, rejectionLoses] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: approveFirst.eventId,
      rpcToken: 'review_match_event_result',
      fireFirst: reviewCall(approveFirst.proposalId, 0, 'approve'),
      fireSecond: reviewCall(approveFirst.proposalId, 1, 'reject')
    });
    expect(approvalWins.data).toMatchObject({ status: 'confirmed' });
    expect(rejectionLoses.error?.message).toBe('MATCH_RESULT_REVIEW_CONFLICT');
    expect(asRecord(approvalWins.data).confirmation_id).toEqual(expect.any(String));
    expect(await counts(approveFirst.eventId)).toMatchObject({
      reviews: 2,
      review_audits: 2,
      confirmations: 1,
      confirmation_audits: 1
    });
  });

  it('concurrent final approvals produce one confirmation identity and exact evidence counts', async () => {
    const current = await pending();
    const [first, second] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: current.eventId,
      rpcToken: 'review_match_event_result',
      fireFirst: reviewCall(current.proposalId, 0, 'approve'),
      fireSecond: reviewCall(current.proposalId, 2, 'approve')
    });
    expect(first.data).toMatchObject({ status: 'pending' });
    expect(second.data).toMatchObject({ status: 'confirmed' });
    const firstId = asRecord(first.data).confirmation_id;
    const secondId = asRecord(second.data).confirmation_id;
    expect(firstId).toBeNull();
    expect(secondId).toEqual(expect.any(String));
    expect(await counts(current.eventId)).toMatchObject({
      reviews: 2,
      review_audits: 2,
      confirmations: 1,
      confirmation_audits: 1
    });
    expect(
      await sqlRows(`select id::text as id from public.match_event_result_confirmations
      where proposal_id='${current.proposalId}'`)
    ).toEqual([{ id: secondId }]);
  });

  it('replays identical concurrent request once and rejects a concurrent payload mismatch', async () => {
    const same = await pending();
    const requestId = crypto.randomUUID();
    const sameCall = reviewCall(same.proposalId, 0, 'approve', requestId);
    const [original, replay] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: same.eventId,
      rpcToken: 'review_match_event_result',
      fireFirst: sameCall,
      fireSecond: sameCall
    });
    expect(original.data).toMatchObject({ status: 'pending', replayed: false });
    expect(replay.data).toMatchObject({ status: 'pending', replayed: true });
    expect(await counts(same.eventId)).toMatchObject({ reviews: 1, review_audits: 1 });

    const mismatch = await pending();
    const conflictRequestId = crypto.randomUUID();
    const [accepted, conflict] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: mismatch.eventId,
      rpcToken: 'review_match_event_result',
      fireFirst: reviewCall(mismatch.proposalId, 0, 'approve', conflictRequestId),
      fireSecond: reviewCall(mismatch.proposalId, 0, 'reject', conflictRequestId)
    });
    expect(accepted.data).toMatchObject({ status: 'pending' });
    expect(conflict.error?.message).toBe('MATCH_RESULT_IDEMPOTENCY_CONFLICT');
    expect(await counts(mismatch.eventId)).toMatchObject({ reviews: 1, review_audits: 1 });
  });

  it('orders corrections against stale approvals and rejections without carrying old evidence forward', async () => {
    const correctedFirst = await pending();
    const [correction, staleApproval] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: correctedFirst.eventId,
      rpcToken: 'match_event_result',
      fireFirst: correctionCall(correctedFirst.proposalId),
      fireSecond: reviewCall(correctedFirst.proposalId, 0, 'approve')
    });
    expect(correction.data).toMatchObject({ version: 2, status: 'pending' });
    expect(staleApproval.error?.message).toBe('MATCH_RESULT_REVIEW_VERSION_CONFLICT');
    expect(await counts(correctedFirst.eventId)).toMatchObject({
      reviews: 0,
      review_audits: 0,
      correction_audits: 1
    });

    const approvedFirst = await pending();
    const [oldApproval, correctionAfterApproval] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: approvedFirst.eventId,
      rpcToken: 'match_event_result',
      fireFirst: reviewCall(approvedFirst.proposalId, 0, 'approve'),
      fireSecond: correctionCall(approvedFirst.proposalId)
    });
    expect(oldApproval.data).toMatchObject({ status: 'pending' });
    expect(correctionAfterApproval.data).toMatchObject({ version: 2, status: 'pending' });
    expect(
      await sqlRows(`select proposal_version::int as version from public.match_event_result_reviews
      where proposal_id='${approvedFirst.proposalId}'`)
    ).toEqual([{ version: 1 }]);
    expect(await counts(approvedFirst.eventId)).toMatchObject({
      reviews: 1,
      review_audits: 1,
      correction_audits: 1
    });

    const rejectedFirst = await pending();
    const [oldRejection, correctionAfterRejection] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: rejectedFirst.eventId,
      rpcToken: 'match_event_result',
      fireFirst: reviewCall(rejectedFirst.proposalId, 1, 'reject'),
      fireSecond: correctionCall(rejectedFirst.proposalId)
    });
    expect(oldRejection.data).toMatchObject({ status: 'disputed' });
    expect(correctionAfterRejection.data).toMatchObject({ version: 2, status: 'pending' });
    expect(
      await sqlRows(`select proposal_version::int as version,decision from public.match_event_result_reviews
      where proposal_id='${rejectedFirst.proposalId}'`)
    ).toEqual([{ version: 1, decision: 'reject' }]);
    expect(await counts(rejectedFirst.eventId)).toMatchObject({
      reviews: 1,
      review_audits: 1,
      correction_audits: 1
    });
  });

  it('late reviewer at due boundary auto-confirms once and returns a committed terminal receipt', async () => {
    const current = await pending();
    await setDue(current.proposalId);
    const lateInput = reviewCall(current.proposalId, 0, 'approve');
    const [first, second] = await proveOrderedEventLockBarrier({
      communityId: f.communityId,
      eventId: current.eventId,
      rpcToken: 'review_match_event_result',
      fireFirst: lateInput,
      fireSecond: reviewCall(current.proposalId, 2, 'approve')
    });
    expect(first.data).toMatchObject({ status: 'confirmed', conflict: 'deadline_elapsed' });
    expect(second.error?.message).toBe('MATCH_RESULT_REVIEW_CONFLICT');
    expect(await counts(current.eventId)).toMatchObject({
      reviews: 0,
      review_audits: 0,
      confirmations: 1,
      confirmation_audits: 1
    });
    expect(
      await sqlRows(`select source,effective_at=review_deadline_at as effective_at_is_deadline
      from public.match_event_result_confirmations c
      join public.match_event_result_proposals p on p.id=c.proposal_id
      where c.proposal_id='${current.proposalId}'`)
    ).toEqual([{ source: 'AUTO_48H', effective_at_is_deadline: true }]);
  });

  it('revalidates reminders after rejection/confirmation wins canonical event lock', async () => {
    async function contend(
      commands: Array<{
        token: 'review_match_event_result' | 'notify_match_result_deadline';
        run: () => Promise<unknown>;
      }>
    ) {
      const marker = `paf8-reminder-${crypto.randomUUID().replaceAll('-', '')}`;
      const holder = startSql(`/* ${marker} */ select pg_catalog.pg_sleep(900)
        from (select id from public.communities where id = '${f.communityId}' for update) locked;`);
      try {
        const [holderRow] = await waitForRows(
          `select pid as value from pg_catalog.pg_stat_activity
            where query like '%${marker}%' and state='active' and pid <> pg_catalog.pg_backend_pid()`,
          (rows) => rows.length === 1,
          'reminder race community-lock holder'
        );
        const holderPid = Number(holderRow?.['value']);
        const contenders: Array<Promise<unknown>> = [];
        let reviewCount = 0;
        for (const command of commands) {
          contenders.push(command.run());
          const tokenCount = command.token === 'review_match_event_result' ? ++reviewCount : 1;
          await waitForRows(
            `select a.pid from pg_catalog.pg_stat_activity a
              where a.wait_event_type = 'Lock' and a.query like '%${command.token}%'
                and a.pid <> pg_catalog.pg_backend_pid() and a.pid <> ${holderPid}
                and (${holderPid} = any(pg_catalog.pg_blocking_pids(a.pid)) or exists (
                  select 1 from pg_catalog.pg_stat_activity p
                   where p.wait_event_type = 'Lock' and p.pid <> a.pid
                     and ${holderPid} = any(pg_catalog.pg_blocking_pids(p.pid))
                     and p.pid = any(pg_catalog.pg_blocking_pids(a.pid))))`,
            (rows) => rows.length >= tokenCount,
            `${command.token} blocked behind prior event-lock command`,
            2500,
            20
          );
        }
        const barrier = startSql(`do $barrier$
          declare v_blocked integer; v_deadline timestamptz := pg_catalog.clock_timestamp() + interval '6 seconds';
          begin
            loop
              perform pg_catalog.pg_stat_clear_snapshot();
              select count(*) into v_blocked from pg_catalog.pg_stat_activity a
               where a.wait_event_type = 'Lock'
                 and (a.query like '%review_match_event_result%'
                   or a.query like '%notify_match_result_deadline%')
                 and a.pid <> pg_catalog.pg_backend_pid() and a.pid <> ${holderPid}
                 and (${holderPid} = any(pg_catalog.pg_blocking_pids(a.pid)) or exists (
                   select 1 from pg_catalog.pg_stat_activity p
                    where p.wait_event_type = 'Lock' and p.pid <> a.pid
                      and ${holderPid} = any(pg_catalog.pg_blocking_pids(p.pid))
                      and p.pid = any(pg_catalog.pg_blocking_pids(a.pid))));
              exit when v_blocked = ${commands.length} or pg_catalog.clock_timestamp() > v_deadline;
              perform pg_catalog.pg_sleep(0.025);
            end loop;
            if v_blocked <> ${commands.length} then
              raise exception 'reminder lock race barrier failed: expected %, found %', ${commands.length}, v_blocked;
            end if;
            perform pg_catalog.pg_terminate_backend(${holderPid});
          end $barrier$;`);
        const barrierResult = await barrier.done;
        if (barrierResult.code !== 0)
          throw new Error(`Reminder barrier failed: ${barrierResult.stderr}`);
        return await Promise.all(contenders);
      } finally {
        await fixtureSql(`select pg_catalog.pg_terminate_backend(pid) from pg_catalog.pg_stat_activity
          where query like '%${marker}%' and pid <> pg_catalog.pg_backend_pid()`).catch(
          () => undefined
        );
        await holder.stop();
      }
    }

    const rejectFirst = await pending();
    await setResultReviewDeadlineOffset(rejectFirst.proposalId, 1, 5 * 60 * 60);
    const rejectionAndReminder = await contend([
      { token: 'review_match_event_result', run: reviewCall(rejectFirst.proposalId, 1, 'reject') },
      {
        token: 'notify_match_result_deadline',
        run: () =>
          startSql(`select public.notify_match_result_deadline('${rejectFirst.proposalId}', 1);`)
            .done
      }
    ]);
    expect(rejectionAndReminder[0]).toMatchObject({ error: null });
    expect(
      await sqlRows(`select status from public.match_event_result_proposals
      where id = '${rejectFirst.proposalId}'`)
    ).toEqual([{ status: 'disputed' }]);
    expect(rejectionAndReminder[1]).toMatchObject({ code: 0 });
    expect(
      await sqlRows(`select count(*)::int as count from public.notifications
      where event_key = 'result.deadline:${rejectFirst.proposalId}:v1'`)
    ).toEqual([{ count: 0 }]);

    const confirmFirst = await pending();
    await setResultReviewDeadlineOffset(confirmFirst.proposalId, 1, 5 * 60 * 60);
    const confirmationAndReminder = await contend([
      {
        token: 'review_match_event_result',
        run: reviewCall(confirmFirst.proposalId, 0, 'approve')
      },
      {
        token: 'review_match_event_result',
        run: reviewCall(confirmFirst.proposalId, 2, 'approve')
      },
      {
        token: 'notify_match_result_deadline',
        run: () =>
          startSql(`select public.notify_match_result_deadline('${confirmFirst.proposalId}', 1);`)
            .done
      }
    ]);
    expect(confirmationAndReminder[0]).toMatchObject({ error: null });
    expect(confirmationAndReminder[1]).toMatchObject({ error: null });
    expect(
      await sqlRows(`select status from public.match_event_result_proposals
      where id = '${confirmFirst.proposalId}'`)
    ).toEqual([{ status: 'confirmed' }]);
    expect(confirmationAndReminder[2]).toMatchObject({ code: 0 });
    expect(
      await sqlRows(`select count(*)::int as count from public.notifications
      where event_key = 'result.deadline:${confirmFirst.proposalId}:v1'`)
    ).toEqual([{ count: 0 }]);

    const reminderFirst = await pending();
    await setResultReviewDeadlineOffset(reminderFirst.proposalId, 1, 5 * 60 * 60);
    const reminderAndRejection = await contend([
      {
        token: 'notify_match_result_deadline',
        run: () =>
          startSql(`select public.notify_match_result_deadline('${reminderFirst.proposalId}', 1);`)
            .done
      },
      { token: 'review_match_event_result', run: reviewCall(reminderFirst.proposalId, 1, 'reject') }
    ]);
    expect(reminderAndRejection[0]).toMatchObject({ code: 0 });
    expect(reminderAndRejection[1]).toMatchObject({ error: null });
    expect(
      await sqlRows(`select status from public.match_event_result_proposals
      where id = '${reminderFirst.proposalId}'`)
    ).toEqual([{ status: 'disputed' }]);
    expect(
      await sqlRows(`select count(*)::int as count from public.notifications
      where event_key = 'result.deadline:${reminderFirst.proposalId}:v1'`)
    ).toEqual([{ count: 4 }]);
    expect(await counts(reminderFirst.eventId)).toMatchObject({ reviews: 1, confirmations: 0 });
  });
});
