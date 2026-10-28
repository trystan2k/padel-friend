import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import {
  asRecord,
  fixtureSql,
  proveOrderedEventLockBarrier,
  sqlRows
} from './helpers/match-registration-sql';
import {
  createMatchResultReviewFixtures,
  reviewResultPlayedAt,
  reviewResultSets
} from './helpers/match-result-review-fixtures';

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
});
