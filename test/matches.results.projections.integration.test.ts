import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ManagementActor } from './helpers/match-management-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { setResultReviewDeadlineOffset } from './helpers/match-result-processing-fixtures';
import { createMatchResultReviewFixtures } from './helpers/match-result-review-fixtures';

function recordRows(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord) : [];
}

describe('result lifecycle projections and privacy', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;
  let restoreResultSchedule: (() => Promise<void>) | null = null;

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createMatchResultReviewFixtures(env);
  });

  afterAll(async () => {
    if (restoreResultSchedule) await restoreResultSchedule();
    if (f) await f.cleanup();
  });

  async function submit(
    eventId: string,
    options: { groupNumber?: number; submitter?: ManagementActor } = {}
  ) {
    const groupNumber = options.groupNumber ?? 1;
    const result = await f.submit(eventId, {
      groupNumber,
      submitter: options.submitter
    });
    expect(result.error).toBeNull();
    return asRecord(result.data);
  }

  async function review(
    actor: ManagementActor,
    proposalId: string,
    decision: 'approve' | 'reject',
    reasonCode: string | null = null,
    reasonNote: string | null = null
  ) {
    return f.rpc(actor, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: decision,
      p_reason_code: reasonCode,
      p_reason_note: reasonNote,
      p_request_id: crypto.randomUUID()
    });
  }

  async function readProposals(actor: ManagementActor | { token: string }, eventId: string) {
    return f.rpc(actor, 'get_match_event_result_proposals', { p_match_event_id: eventId });
  }

  async function eventProjection(actor: ManagementActor, eventId: string) {
    const result = await f.rpc(actor, 'get_match_event', { p_event_id: eventId });
    expect(result.error).toBeNull();
    return asRecord(result.data);
  }

  it('returns shared facts to all players with caller-specific SQL capabilities and denies outsiders', async () => {
    const eventId = await f.protectedEvent();
    const submitted = await submit(eventId);
    const proposalId = String(submitted.proposal_id);
    const byActor = await Promise.all(
      f.players.slice(0, 4).map(async (actor) => {
        const result = await readProposals(actor, eventId);
        expect(result.error).toBeNull();
        const row = asRecord(Array.isArray(result.data) ? result.data[0] : null);
        return row;
      })
    );
    expect(byActor.map((row) => row.teams)).toEqual(
      Array.from({ length: 4 }, () => byActor[0]!.teams)
    );
    expect(byActor.map((row) => row.sets)).toEqual(
      Array.from({ length: 4 }, () => byActor[0]!.sets)
    );
    expect(byActor[0]).toMatchObject({
      proposal_id: proposalId,
      status: 'pending',
      version: 1,
      can_approve: false,
      can_reject: false,
      can_correct: true,
      required_team_coverage_count: 1,
      received_team_coverage_count: 0
    });
    expect(byActor[1]).toMatchObject({ can_approve: false, can_reject: true, can_correct: false });
    expect(byActor[2]).toMatchObject({ can_approve: true, can_reject: true, can_correct: false });
    expect(byActor[3]).toMatchObject({ can_approve: true, can_reject: true, can_correct: false });
    const otherGroupRead = await readProposals(f.players[4]!, eventId);
    expect(
      asRecord(Array.isArray(otherGroupRead.data) ? otherGroupRead.data[0] : null)
    ).toMatchObject({
      can_approve: false,
      can_reject: false,
      can_correct: false
    });
    const adminRead = await readProposals(f.admin, eventId);
    expect(adminRead.error).toBeNull();
    expect(asRecord(Array.isArray(adminRead.data) ? adminRead.data[0] : null)).toMatchObject({
      can_approve: false,
      can_reject: false,
      can_correct: true
    });

    for (const outsider of [f.outsider, { token: f.anonymousToken }]) {
      const denied = await readProposals(outsider, eventId);
      expect(denied.data).toBeNull();
      expect(denied.error).not.toBeNull();
      expect(JSON.stringify(denied.error)).not.toContain(proposalId);
      const official = await f.rpc(outsider, 'get_match_event_official_results', {
        p_match_event_id: eventId
      });
      expect(official.data).toBeNull();
      expect(official.error).not.toBeNull();
      expect(JSON.stringify(official.error)).not.toContain(proposalId);
    }
  });

  it('projects confirmed, pending, disputed, and unsubmitted frozen groups without changing event status', async () => {
    const twoGroupEvent = await f.protectedEvent();
    const confirmedProposal = await submit(twoGroupEvent);
    const manualReceipt = await review(
      f.players[2]!,
      String(confirmedProposal.proposal_id),
      'approve'
    );
    expect(manualReceipt.error).toBeNull();
    expect(manualReceipt.data).toMatchObject({ status: 'confirmed', version: 1 });

    const twoGroupProjection = await eventProjection(f.players[0]!, twoGroupEvent);
    expect(twoGroupProjection.status).toBe('open');
    expect(twoGroupProjection.result_summary).toMatchObject({
      expected_group_count: 2,
      confirmed_group_count: 1,
      pending_group_count: 0,
      disputed_group_count: 0,
      unsubmitted_group_count: 1,
      result_resolution: 'partially_resolved',
      results_roster_frozen: true
    });

    const completedEvent = await f.protectedEvent();
    const completedFirst = await submit(completedEvent, { groupNumber: 1 });
    const completedSecond = await submit(completedEvent, { groupNumber: 2 });
    expect(
      (await review(f.players[2]!, String(completedFirst.proposal_id), 'approve')).data
    ).toMatchObject({ status: 'confirmed' });
    expect(
      (await review(f.players[4]!, String(completedSecond.proposal_id), 'approve')).data
    ).toMatchObject({ status: 'pending' });
    expect(
      (await review(f.players[6]!, String(completedSecond.proposal_id), 'approve')).data
    ).toMatchObject({ status: 'confirmed' });
    expect((await eventProjection(f.players[0]!, completedEvent)).result_summary).toMatchObject({
      expected_group_count: 2,
      confirmed_group_count: 2,
      unsubmitted_group_count: 0,
      result_resolution: 'completed'
    });

    await f.addPlayers(4);
    const threeGroupEvent = await f.protectedEvent();
    await submit(threeGroupEvent, { groupNumber: 1 });
    const disputed = await submit(threeGroupEvent, { groupNumber: 2 });
    const disputedReceipt = await review(
      f.players[4]!,
      String(disputed.proposal_id),
      'reject',
      'SCORE_INCORRECT',
      'The recorded score differs.'
    );
    expect(disputedReceipt.data).toMatchObject({ status: 'disputed', version: 1 });
    const groupThreeSubmission = await submit(threeGroupEvent, {
      groupNumber: 3
    });
    const firstGroupThreeVote = await review(
      f.players[8]!,
      String(groupThreeSubmission.proposal_id),
      'approve'
    );
    expect(firstGroupThreeVote.data).toMatchObject({ status: 'pending', version: 1 });
    const groupThreeReceipt = await review(
      f.players[10]!,
      String(groupThreeSubmission.proposal_id),
      'approve'
    );
    expect(groupThreeReceipt.data).toMatchObject({ status: 'confirmed', version: 1 });

    const allProposals = await readProposals(f.players[0]!, threeGroupEvent);
    expect(allProposals.error).toBeNull();
    const rows = recordRows(allProposals.data);
    expect(rows.map((row) => row.status)).toEqual(['pending', 'disputed', 'confirmed']);
    expect(rows[1]).toMatchObject({
      dispute_evidence: {
        rejector_id: f.players[4]!.id,
        reason_code: 'SCORE_INCORRECT',
        reason_note: 'The recorded score differs.'
      },
      confirmation: null
    });
    expect(rows[2]).toMatchObject({
      confirmation: {
        confirmation_id: asRecord(groupThreeReceipt.data).confirmation_id,
        source: 'MANUAL',
        actor_id: f.players[10]!.id
      },
      version_timeline: [{ version: 1, status: 'confirmed' }]
    });
    expect(rows[0]).toMatchObject({ status: 'pending', version_timeline: [{ status: 'pending' }] });

    const projection = await eventProjection(f.players[0]!, threeGroupEvent);
    expect(projection.status).toBe('open');
    expect(projection.result_summary).toMatchObject({
      expected_group_count: 3,
      confirmed_group_count: 1,
      pending_group_count: 1,
      disputed_group_count: 1,
      unsubmitted_group_count: 0,
      incomplete_result_group_count: 1,
      result_resolution: 'partially_resolved'
    });
    const list = await f.rpc(f.players[0]!, 'list_match_events', {
      p_entry: 'my',
      p_community_id: f.communityId,
      p_limit: 50
    });
    expect(list.error).toBeNull();
    const listedEvent = recordRows(list.data).find((row) => row.event_id === threeGroupEvent);
    expect(listedEvent?.result_summary).toEqual(projection.result_summary);

    const official = await f.rpc(f.players[0]!, 'get_match_event_official_results', {
      p_match_event_id: threeGroupEvent
    });
    expect(official.error).toBeNull();
    expect(official.data).toHaveLength(1);
    const officialFact = asRecord(recordRows(official.data)[0]);
    expect(officialFact).toMatchObject({
      confirmation_id: asRecord(groupThreeReceipt.data).confirmation_id,
      group_number: 3,
      source: 'MANUAL',
      actor_id: f.players[10]!.id,
      event_type: 'friendly',
      classification: 'incomplete',
      ratable_eligible: false
    });
    expect(officialFact).not.toHaveProperty('status');
    expect(rows[0]!.confirmation).toBeNull();
    expect(rows[1]).not.toHaveProperty('confirmation_id');

    const zeroGroupEvent = await f.event({ accepted: [] });
    await f.setCutoff(zeroGroupEvent.id, "now()-interval '1 minute'");
    await f.protectResults(zeroGroupEvent.id);
    const zero = await eventProjection(f.players[0]!, zeroGroupEvent.id);
    expect(zero.result_summary).toMatchObject({
      expected_group_count: 0,
      confirmed_group_count: 0,
      result_resolution: 'awaiting_results',
      results_roster_frozen: true
    });
    expect(zero.result_summary).not.toMatchObject({ result_resolution: 'completed' });

    const cancelled = await f.event({ accepted: [] });
    await fixtureSql(`do $$ begin
      alter table public.match_events disable trigger match_event_immutable;
      update public.match_events set status='cancelled',cancelled_at=now(),
        cancelled_by='${f.creator.id}',cancel_reason='Fixture cancellation' where id='${cancelled.id}';
      alter table public.match_events enable trigger match_event_immutable;
    end $$;`);
    const cancelledProjection = await eventProjection(f.creator, cancelled.id);
    expect(cancelledProjection).toMatchObject({
      status: 'cancelled',
      result_summary: { result_resolution: 'awaiting_results', results_roster_frozen: false }
    });
  });

  it('keeps corrected version history readable and exposes identical manual/automatic identity contracts', async () => {
    const correctedEvent = await f.protectedEvent();
    const original = await submit(correctedEvent);
    await review(f.players[1]!, String(original.proposal_id), 'reject', 'SCORE_INCORRECT');
    const corrected = await f.rpc(f.creator, 'correct_match_event_result', {
      p_proposal_id: String(original.proposal_id),
      p_expected_version: 1,
      p_teams: f.teamsForGroup(1),
      p_sets: [{ position: 1, team_a_games: 6, team_b_games: 4, completed: true }],
      p_played_local: {
        local: '2020-01-01 12:00:00',
        offset_seconds: 0,
        instant: '2020-01-01T12:00:00.000Z'
      },
      p_court_label: 'Court 3',
      p_request_id: crypto.randomUUID()
    });
    expect(corrected.error).toBeNull();
    expect(corrected.data).toMatchObject({ status: 'pending', version: 2 });
    const history = await readProposals(f.players[0]!, correctedEvent);
    const historyRow = asRecord(Array.isArray(history.data) ? history.data[0] : null);
    expect(historyRow.version_timeline).toMatchObject([
      { version: 1, status: 'superseded' },
      { version: 2, status: 'pending' }
    ]);

    const autoEvent = await f.protectedEvent();
    const autoProposal = await submit(autoEvent);
    const autoProposalId = String(autoProposal.proposal_id);
    const jobs = await sqlRows(
      `select jobid::integer as jobid,active,schedule,command from cron.job where jobname='padel-friend-match-result-auto-confirm'`
    );
    const job = jobs[0];
    if (job?.active === true) {
      const jobId = Number(job.jobid);
      await fixtureSql(`select cron.unschedule(${jobId})`);
      const schedule = String(job.schedule).replaceAll("'", "''");
      const command = String(job.command).replaceAll("'", "''");
      restoreResultSchedule = async () => {
        await fixtureSql(
          `select cron.schedule('padel-friend-match-result-auto-confirm','${schedule}','${command}')`
        );
        restoreResultSchedule = null;
      };
    }
    try {
      await setResultReviewDeadlineOffset(autoProposalId, 1, -1);
      const [automatic] = await sqlRows(
        `select public.try_auto_confirm_match_event_result('${autoProposalId}',1) as receipt`
      );
      const autoReceipt = asRecord(automatic?.receipt);
      expect(autoReceipt.reason).toBe('confirmed');
      const official = await f.rpc(f.players[0]!, 'get_match_event_official_results', {
        p_match_event_id: autoEvent
      });
      expect(official.error).toBeNull();
      const officialFact = asRecord(recordRows(official.data)[0]);
      expect(officialFact).toMatchObject({
        confirmation_id: autoReceipt.confirmation_id,
        source: 'AUTO_48H',
        actor_id: null,
        event_type: 'friendly',
        ratable_eligible: false
      });
      expect(officialFact.confirmation_id).toBe(autoReceipt.confirmation_id);
    } finally {
      if (restoreResultSchedule) await restoreResultSchedule();
    }
  });
});
