import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, fixtureSql, sqlRows } from './helpers/match-registration-sql';
import { scoringCases } from './helpers/match-result-scoring-cases';
import {
  createMatchResultReviewFixtures,
  reviewResultSets,
  reviewResultPlayedAt
} from './helpers/match-result-review-fixtures';

describe('atomic corrected result versions', { timeout: 120000 }, () => {
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

  async function pending(submitter = f.admin) {
    const eventId = await f.protectedEvent();
    const created = await f.submit(eventId, { submitter });
    expect(created.error).toBeNull();
    return { eventId, proposalId: String(asRecord(created.data).proposal_id) };
  }

  function correctionArgs(proposalId: string, patch: Record<string, unknown> = {}) {
    return {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_teams: f.teamsForGroup(),
      p_sets: reviewResultSets,
      p_played_local: reviewResultPlayedAt,
      p_court_label: 'Court 4',
      p_request_id: crypto.randomUUID(),
      ...patch
    };
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

  it('appends v2 with fresh submitter/deadline; retains but does not count v1 reviews or facts', async () => {
    const current = await pending();
    const firstApproval = await f.rpc(f.players[0]!, 'review_match_event_result', {
      p_proposal_id: current.proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
    expect(firstApproval.data).toMatchObject({ status: 'pending' });

    const v1Before =
      await sqlRows(`select to_jsonb(v) as fact from public.match_event_result_proposal_versions v
      where proposal_id='${current.proposalId}' and version=1`);
    const result = await f.rpc(
      f.admin,
      'correct_match_event_result',
      correctionArgs(current.proposalId, {
        p_teams: {
          team_a: [f.players[0]!.id, f.players[2]!.id],
          team_b: [f.players[1]!.id, f.players[3]!.id]
        }
      })
    );
    expect(result.error).toBeNull();
    expect(result.data).toMatchObject({ version: 2, status: 'pending', replayed: false });

    const versions =
      await sqlRows(`select version::int as version, submitted_by::text as submitted_by,
      submitted_at::text as submitted_at, review_deadline_at::text as review_deadline_at,
      review_deadline_at=submitted_at+interval '48 hours' as exact_deadline, teams
      from public.match_event_result_proposal_versions where proposal_id='${current.proposalId}' order by version`);
    expect(versions).toHaveLength(2);
    expect(versions[0]).toMatchObject({ version: 1, submitted_by: f.admin.id });
    expect(versions[1]).toMatchObject({
      version: 2,
      submitted_by: f.admin.id,
      exact_deadline: true
    });
    expect(versions[1]!.submitted_at).not.toBe(versions[0]!.submitted_at);
    expect(versions[1]!.review_deadline_at).not.toBe(versions[0]!.review_deadline_at);
    expect(versions[1]!.teams).toEqual({
      team_a: [f.players[0]!.id, f.players[2]!.id],
      team_b: [f.players[1]!.id, f.players[3]!.id]
    });
    expect(
      await sqlRows(`select to_jsonb(v) as fact from public.match_event_result_proposal_versions v
      where proposal_id='${current.proposalId}' and version=1`)
    ).toEqual(v1Before);
    expect(
      await sqlRows(`select proposal_version::int as version,decision from public.match_event_result_reviews
      where proposal_id='${current.proposalId}'`)
    ).toEqual([{ version: 1, decision: 'approve' }]);
    expect(
      (
        await f.rpc(f.players[2]!, 'review_match_event_result', {
          p_proposal_id: current.proposalId,
          p_expected_version: 2,
          p_decision: 'approve',
          p_request_id: crypto.randomUUID()
        })
      ).data
    ).toMatchObject({ status: 'pending' });
    expect(
      await sqlRows(`select proposal_version::int as version from public.match_event_result_reviews
      where proposal_id='${current.proposalId}' order by proposal_version`)
    ).toEqual([{ version: 1 }, { version: 2 }]);
    const correctionAudit = await sqlRows(`select action,changed_fields,after_data
      from public.match_event_audit_log where match_event_id='${current.eventId}'
        and action='result_corrected'`);
    expect(correctionAudit).toHaveLength(1);
    expect(correctionAudit[0]).toMatchObject({
      action: 'result_corrected',
      changed_fields: [
        'version',
        'status',
        'submitted_by',
        'submitted_at',
        'review_deadline_at',
        'teams',
        'sets',
        'classification',
        'played_at_utc',
        'played_at_local',
        'played_at_offset_seconds',
        'court_label'
      ],
      after_data: {
        proposal_id: current.proposalId,
        group_number: 1,
        version: 2,
        status: 'pending',
        submitted_by: f.admin.id,
        teams: {
          team_a: [f.players[0]!.id, f.players[2]!.id],
          team_b: [f.players[1]!.id, f.players[3]!.id]
        }
      }
    });
  });

  it('corrects disputed versions; old decisions and stale corrections report current version/status', async () => {
    const eventId = await f.protectedEvent();
    const created = await f.submit(eventId, { submitter: f.creator });
    const proposalId = String(asRecord(created.data).proposal_id);
    const dispute = await f.rpc(f.players[1]!, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'TEAMS_INCORRECT',
      p_request_id: crypto.randomUUID()
    });
    expect(dispute.data).toMatchObject({ status: 'disputed' });

    const correction = await f.rpc(
      f.creator,
      'correct_match_event_result',
      correctionArgs(proposalId)
    );
    expect(correction.data).toMatchObject({ version: 2, status: 'pending' });
    const staleReview = await f.rpc(f.players[2]!, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT',
      p_request_id: crypto.randomUUID()
    });
    expect(staleReview.error?.message).toBe('MATCH_RESULT_REVIEW_VERSION_CONFLICT');
    expect(JSON.parse(staleReview.error!.details!)).toEqual({
      current_version: 2,
      current_status: 'pending'
    });
    const staleCorrection = await f.rpc(
      f.creator,
      'correct_match_event_result',
      correctionArgs(proposalId)
    );
    expect(staleCorrection.error?.message).toBe('MATCH_RESULT_CORRECTION_VERSION_CONFLICT');
    expect(JSON.parse(staleCorrection.error!.details!)).toEqual({
      current_version: 2,
      current_status: 'pending'
    });
    expect(
      await sqlRows(`select status,active_version::int as active_version from public.match_event_result_proposals
      where id='${proposalId}'`)
    ).toEqual([{ status: 'pending', active_version: 2 }]);
    expect(
      await sqlRows(`select count(*)::int as versions from public.match_event_result_proposal_versions
      where proposal_id='${proposalId}'`)
    ).toEqual([{ versions: 2 }]);
  });

  it('replays correction receipt exactly and rejects same request ID with changed payload', async () => {
    const current = await pending();
    const args = correctionArgs(current.proposalId);
    const first = await f.rpc(f.admin, 'correct_match_event_result', args);
    const replay = await f.rpc(f.admin, 'correct_match_event_result', args);
    expect(first.data).toMatchObject({ version: 2, status: 'pending', replayed: false });
    expect(replay.data).toMatchObject({ version: 2, status: 'pending', replayed: true });
    expect(
      (
        await f.rpc(f.admin, 'correct_match_event_result', {
          ...args,
          p_court_label: 'Different court'
        })
      ).error?.message
    ).toBe('MATCH_RESULT_IDEMPOTENCY_CONFLICT');
    expect(
      await sqlRows(`select count(*)::int as versions from public.match_event_result_proposal_versions
      where proposal_id='${current.proposalId}'`)
    ).toEqual([{ versions: 2 }]);
    expect(
      await sqlRows(`select count(*)::int as audits from public.match_event_audit_log
      where match_event_id='${current.eventId}' and action='result_corrected'`)
    ).toEqual([{ audits: 1 }]);
  });

  it('compares changed correction payloads for legacy receipts without proposal_id', async () => {
    const current = await pending();
    const args = correctionArgs(current.proposalId);
    const first = await f.rpc(f.admin, 'correct_match_event_result', args);
    expect(first.error).toBeNull();
    await fixtureSql(`update public.match_event_management_commands
      set payload = payload - 'proposal_id'
      where match_event_id = '${current.eventId}' and actor_id = '${f.admin.id}'
        and request_id = '${args.p_request_id}'`);
    expect((await f.rpc(f.admin, 'correct_match_event_result', args)).data).toMatchObject({
      replayed: true,
      proposal_id: current.proposalId
    });
    expect(
      (
        await f.rpc(f.admin, 'correct_match_event_result', {
          ...args,
          p_court_label: 'Different court'
        })
      ).error?.message
    ).toBe('MATCH_RESULT_IDEMPOTENCY_CONFLICT');
  });

  it('allows only event creator/admin correction and auto-confirms instead of correcting a due pending version', async () => {
    const current = await pending();
    expect(
      (await f.rpc(f.players[1]!, 'correct_match_event_result', correctionArgs(current.proposalId)))
        .error?.message
    ).toBe('MATCH_RESULT_CORRECTION_FORBIDDEN');
    await setDue(current.proposalId);
    const due = await f.rpc(
      f.admin,
      'correct_match_event_result',
      correctionArgs(current.proposalId)
    );
    expect(due.error).toBeNull();
    expect(due.data).toMatchObject({
      version: 1,
      status: 'confirmed',
      conflict: 'deadline_elapsed'
    });
    expect(asRecord(due.data).confirmation_id).toEqual(expect.any(String));
    expect(
      await sqlRows(`select status,active_version::int as active_version from public.match_event_result_proposals
      where id='${current.proposalId}'`)
    ).toEqual([{ status: 'confirmed', active_version: 1 }]);
    expect(
      await sqlRows(
        `select source from public.match_event_result_confirmations where proposal_id='${current.proposalId}'`
      )
    ).toEqual([{ source: 'AUTO_48H' }]);
    expect(
      await sqlRows(`select count(*)::int as versions from public.match_event_result_proposal_versions
      where proposal_id='${current.proposalId}'`)
    ).toEqual([{ versions: 1 }]);
  });

  it('uses submission-identical validation errors for corrected facts', async () => {
    const invalidCases: Array<[Record<string, unknown>, string]> = [
      [
        { p_sets: [{ position: 1, team_a_games: 6, team_b_games: 5, completed: true }] },
        'MATCH_RESULT_INVALID_SET_SCORE'
      ],
      [
        {
          p_teams: {
            team_a: [f.players[0]!.id, f.players[1]!.id],
            team_b: [f.players[1]!.id, f.players[3]!.id]
          }
        },
        'MATCH_RESULT_DUPLICATE_PLAYER'
      ],
      [
        { p_played_local: { ...reviewResultPlayedAt, offset_seconds: 1 } },
        'MATCH_RESULT_INVALID_PLAYED_AT'
      ],
      [{ p_court_label: 'x'.repeat(101) }, 'MATCH_RESULT_INVALID_COURT']
    ];

    for (const [patch, token] of invalidCases) {
      const newEvent = await f.protectedEvent();
      const submitArgs = f.submissionArgs(newEvent);
      const submitError = await f.rpc(f.admin, 'submit_match_event_result', {
        ...submitArgs,
        ...patch
      });
      expect(submitError.error?.message).toBe(token);

      const current = await pending();
      const correctionError = await f.rpc(
        f.admin,
        'correct_match_event_result',
        correctionArgs(current.proposalId, patch)
      );
      expect(correctionError.error?.message).toBe(submitError.error?.message);
      expect(
        await sqlRows(`select count(*)::int as versions from public.match_event_result_proposal_versions
        where proposal_id='${current.proposalId}'`)
      ).toEqual([{ versions: 1 }]);
    }
  });

  it('matches PAF-7 scoring classifications for every valid scoring decision-table row', async () => {
    for (const scoreCase of scoringCases) {
      if (!('classification' in scoreCase)) continue;
      const sets = scoreCase.sets;
      const eventId = await f.protectedEvent();
      const submitted = await f.submit(eventId, { submitter: f.admin, sets });
      expect(submitted.error).toBeNull();
      const proposalId = String(asRecord(submitted.data).proposal_id);
      const corrected = await f.rpc(
        f.admin,
        'correct_match_event_result',
        correctionArgs(proposalId, {
          p_sets: sets
        })
      );
      expect(corrected.error).toBeNull();
      const rows = await sqlRows(`select version::int as version,classification,sets
        from public.match_event_result_proposal_versions where proposal_id='${proposalId}' order by version`);
      expect(rows.map(({ classification }) => classification)).toEqual([
        scoreCase.classification,
        scoreCase.classification
      ]);
      expect(rows.map(({ sets: storedSets }) => storedSets)).toEqual([sets, sets]);
    }
  });
});
