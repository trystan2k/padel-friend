import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { ManagementActor } from './helpers/match-management-fixtures';
import { dotEnvPathFromImportMetaUrl, localSupabaseEnv } from './helpers/local-supabase-env';
import { asRecord, sqlRows } from './helpers/match-registration-sql';
import {
  createMatchResultReviewFixtures,
  type ResultTeams
} from './helpers/match-result-review-fixtures';

describe('atomic result review commands', { timeout: 120000 }, () => {
  let f: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;
  let foreign: Awaited<ReturnType<typeof createMatchResultReviewFixtures>>;
  let foreignEventId: string;

  beforeAll(async () => {
    const { env, reason } = localSupabaseEnv({
      filePath: dotEnvPathFromImportMetaUrl(import.meta.url)
    });
    if (!env) throw new Error(reason);
    f = await createMatchResultReviewFixtures(env);
    foreign = await createMatchResultReviewFixtures(env);
    foreignEventId = await foreign.protectedEvent();
  });
  afterAll(async () => {
    if (f) await f.cleanup();
    if (foreign) await foreign.cleanup();
  });

  async function proposal(
    options: {
      submitter?: ManagementActor;
      teams?: ResultTeams;
      reserve?: boolean;
    } = {}
  ) {
    const eventId = await f.protectedEvent({ reserve: options.reserve });
    const submitted = await f.submit(eventId, {
      submitter: options.submitter,
      teams: options.teams
    });
    expect(submitted.error).toBeNull();
    return { eventId, proposalId: String(asRecord(submitted.data).proposal_id) };
  }

  async function review(
    actor: ManagementActor,
    proposalId: string,
    patch: Record<string, unknown> = {}
  ) {
    return f.rpc(actor, 'review_match_event_result', {
      p_proposal_id: proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_reason_code: null,
      p_reason_note: null,
      p_request_id: crypto.randomUUID(),
      ...patch
    });
  }

  async function evidence(eventId: string) {
    const rows = await sqlRows(`select
      (select count(*)::int from public.match_event_result_reviews r
        join public.match_event_result_proposals p on p.id=r.proposal_id where p.match_event_id='${eventId}') as reviews,
      (select count(*)::int from public.match_event_audit_log a where a.match_event_id='${eventId}'
        and a.action in ('result_approved','result_disputed')) as review_audits,
      (select count(*)::int from public.match_event_result_confirmations c where c.match_event_id='${eventId}') as confirmations,
      (select count(*)::int from public.match_event_audit_log a where a.match_event_id='${eventId}'
        and a.action='result_confirmed') as confirmation_audits`);
    return rows[0]!;
  }

  it('requires opposing-team approval for playing submitters; team facts override roster position', async () => {
    const defaultProposal = await proposal();
    for (const actor of [f.players[1]!, f.admin]) {
      expect((await review(actor, defaultProposal.proposalId)).error?.message).toBe(
        'MATCH_RESULT_REVIEW_FORBIDDEN'
      );
    }
    expect((await review(f.players[2]!, defaultProposal.proposalId)).data).toMatchObject({
      status: 'confirmed',
      version: 1,
      replayed: false
    });
    expect(await evidence(defaultProposal.eventId)).toEqual({
      reviews: 1,
      review_audits: 1,
      confirmations: 1,
      confirmation_audits: 1
    });

    const secondOpponent = await proposal();
    expect((await review(f.players[3]!, secondOpponent.proposalId)).data).toMatchObject({
      status: 'confirmed'
    });

    const teamB = await proposal({
      teams: {
        team_a: [f.players[2]!.id, f.players[3]!.id],
        team_b: [f.players[0]!.id, f.players[1]!.id]
      }
    });
    expect((await review(f.players[1]!, teamB.proposalId)).error?.message).toBe(
      'MATCH_RESULT_REVIEW_FORBIDDEN'
    );
    expect((await review(f.players[2]!, teamB.proposalId)).data).toMatchObject({
      status: 'confirmed'
    });
  });

  it('requires distinct approvals from both teams for a nonplaying submitter and ignores admin privilege', async () => {
    const current = await proposal({ submitter: f.admin });
    expect((await review(f.admin, current.proposalId)).error?.message).toBe(
      'MATCH_RESULT_REVIEW_FORBIDDEN'
    );

    const first = await review(f.players[0]!, current.proposalId);
    expect(first.data).toMatchObject({ status: 'pending', version: 1, replayed: false });
    const repeated = await review(f.players[0]!, current.proposalId);
    expect(repeated.data).toMatchObject({ status: 'pending', replayed: false });
    expect(await evidence(current.eventId)).toMatchObject({
      reviews: 1,
      review_audits: 1,
      confirmations: 0
    });

    await f.promoteAdmin(f.players[2]!);
    const last = await review(f.players[2]!, current.proposalId);
    expect(last.data).toMatchObject({ status: 'confirmed', version: 1 });
    expect(await evidence(current.eventId)).toEqual({
      reviews: 2,
      review_audits: 2,
      confirmations: 1,
      confirmation_audits: 1
    });
    const confirmations = await sqlRows(`select id::text as id, source, actor_id::text as actor_id
      from public.match_event_result_confirmations where match_event_id='${current.eventId}'`);
    expect(confirmations).toHaveLength(1);
    expect(confirmations[0]).toMatchObject({ source: 'MANUAL', actor_id: f.players[2]!.id });
    expect(
      await sqlRows(`select a.confirmation_id::text as confirmation_id,c.id::text as id
      from public.match_event_audit_log a
      join public.match_event_result_confirmations c on c.id=a.confirmation_id
      where a.match_event_id='${current.eventId}' and a.action='result_confirmed'`)
    ).toEqual([{ confirmation_id: confirmations[0]!.id, id: confirmations[0]!.id }]);
  });

  it('allows any actual non-submitter player, including submitter teammate, to dispute with fixed reason evidence', async () => {
    const current = await proposal();
    const rejected = await f.rpc(f.players[1]!, 'review_match_event_result', {
      p_proposal_id: current.proposalId,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'SCORE_INCORRECT',
      p_reason_note: '  Set score differs.  ',
      p_request_id: crypto.randomUUID()
    });
    expect(rejected.data).toMatchObject({ status: 'disputed', version: 1 });
    expect((await review(f.players[2]!, current.proposalId)).error?.message).toBe(
      'MATCH_RESULT_REVIEW_CONFLICT'
    );
    expect(
      await sqlRows(
        `select status from public.match_event_result_proposals where id='${current.proposalId}'`
      )
    ).toEqual([{ status: 'disputed' }]);
    expect(
      await sqlRows(`select decision,reason_code,reason_note from public.match_event_result_reviews
      where proposal_id='${current.proposalId}'`)
    ).toEqual([
      { decision: 'reject', reason_code: 'SCORE_INCORRECT', reason_note: 'Set score differs.' }
    ]);
    expect(await evidence(current.eventId)).toEqual({
      reviews: 1,
      review_audits: 1,
      confirmations: 0,
      confirmation_audits: 0
    });
    expect(
      await sqlRows(`select action,reason,changed_fields,after_data
      from public.match_event_audit_log where match_event_id='${current.eventId}'
        and action='result_disputed'`)
    ).toEqual([
      {
        action: 'result_disputed',
        reason: 'SCORE_INCORRECT',
        changed_fields: ['status', 'review', 'reason'],
        after_data: {
          proposal_id: current.proposalId,
          group_number: 1,
          version: 1,
          status: 'disputed',
          decision: 'reject',
          team: 'team_a',
          reason_code: 'SCORE_INCORRECT',
          reason_note: 'Set score differs.'
        }
      }
    ]);
  });

  it('permits a reviewer with a partial approval to reject; submitter cannot reject', async () => {
    const current = await proposal({ submitter: f.admin });
    const approved = await review(f.players[0]!, current.proposalId);
    expect(approved.data).toMatchObject({ status: 'pending' });
    expect(
      (
        await f.rpc(f.admin, 'review_match_event_result', {
          p_proposal_id: current.proposalId,
          p_expected_version: 1,
          p_decision: 'reject',
          p_reason_code: 'OTHER',
          p_reason_note: 'Not a player',
          p_request_id: crypto.randomUUID()
        })
      ).error?.message
    ).toBe('MATCH_RESULT_REVIEW_FORBIDDEN');

    const requestId = crypto.randomUUID();
    const rejected = await f.rpc(f.players[0]!, 'review_match_event_result', {
      p_proposal_id: current.proposalId,
      p_expected_version: 1,
      p_decision: 'reject',
      p_reason_code: 'OTHER',
      p_reason_note: '  Court match did not happen. ',
      p_request_id: requestId
    });
    expect(rejected.data).toMatchObject({ status: 'disputed' });
    expect(
      await sqlRows(`select decision,reason_code,reason_note from public.match_event_result_reviews
      where proposal_id='${current.proposalId}' order by decision`)
    ).toEqual([
      { decision: 'approve', reason_code: null, reason_note: null },
      { decision: 'reject', reason_code: 'OTHER', reason_note: 'Court match did not happen.' }
    ]);
    expect(await evidence(current.eventId)).toMatchObject({
      reviews: 2,
      review_audits: 2,
      confirmations: 0
    });
  });

  it('rejects admins without a player vote, reserves, other groups, outsiders, submitters, and anonymous callers', async () => {
    const current = await proposal({ reserve: true });
    for (const actor of [f.admin, f.players[4]!, f.reserve, f.outsider, foreign.players[0]!]) {
      expect((await review(actor, current.proposalId)).error?.message).toBe(
        'MATCH_RESULT_REVIEW_FORBIDDEN'
      );
    }
    expect((await review(f.players[0]!, current.proposalId)).error?.message).toBe(
      'MATCH_RESULT_REVIEW_FORBIDDEN'
    );
    expect(foreignEventId).toEqual(expect.any(String));
    const anonymous = await f.rpc({ token: f.anonymousToken }, 'review_match_event_result', {
      p_proposal_id: current.proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_request_id: crypto.randomUUID()
    });
    expect(anonymous.error?.message).toBe(
      'permission denied for function review_match_event_result'
    );
    expect(await evidence(current.eventId)).toMatchObject({
      reviews: 0,
      review_audits: 0,
      confirmations: 0
    });
  });

  it('validates rejection codes, mandatory OTHER note, note length, and exact replay payloads', async () => {
    const current = await proposal({ submitter: f.admin });
    const reject = (reason: unknown, note: unknown, requestId = crypto.randomUUID()) =>
      f.rpc(f.players[0]!, 'review_match_event_result', {
        p_proposal_id: current.proposalId,
        p_expected_version: 1,
        p_decision: 'reject',
        p_reason_code: reason,
        p_reason_note: note,
        p_request_id: requestId
      });
    for (const [reason, note] of [
      [null, null],
      ['score_incorrect', null],
      ['UNKNOWN', null],
      ['OTHER', '   '],
      ['OTHER', 'x'.repeat(501)],
      ['OTHER', 'line\nbreak']
    ]) {
      expect((await reject(reason, note)).error?.message).toBe(
        'MATCH_RESULT_INVALID_REJECTION_REASON'
      );
    }

    const requestId = crypto.randomUUID();
    const input = {
      p_proposal_id: current.proposalId,
      p_expected_version: 1,
      p_decision: 'approve',
      p_reason_code: null,
      p_reason_note: null,
      p_request_id: requestId
    };
    const first = await f.rpc(f.players[0]!, 'review_match_event_result', input);
    const replay = await f.rpc(f.players[0]!, 'review_match_event_result', input);
    expect(first.data).toMatchObject({ status: 'pending', replayed: false });
    expect(replay.data).toMatchObject({ status: 'pending', replayed: true });
    expect(
      (
        await f.rpc(f.players[0]!, 'review_match_event_result', {
          ...input,
          p_decision: 'reject',
          p_reason_code: 'SCORE_INCORRECT'
        })
      ).error?.message
    ).toBe('MATCH_RESULT_IDEMPOTENCY_CONFLICT');

    const duplicateVote = await review(f.players[0]!, current.proposalId);
    expect(duplicateVote.data).toMatchObject({ status: 'pending', replayed: false });
    expect(await evidence(current.eventId)).toMatchObject({
      reviews: 1,
      review_audits: 1,
      confirmations: 0
    });
  });

  it('returns typed current-version conflicts without appending evidence', async () => {
    const current = await proposal({ submitter: f.admin });
    const stale = await review(f.players[0]!, current.proposalId, { p_expected_version: 2 });
    expect(stale.error?.message).toBe('MATCH_RESULT_REVIEW_VERSION_CONFLICT');
    expect(JSON.parse(stale.error!.details!)).toEqual({
      current_version: 1,
      current_status: 'pending'
    });
    expect(await evidence(current.eventId)).toMatchObject({ reviews: 0, review_audits: 0 });
  });
});
