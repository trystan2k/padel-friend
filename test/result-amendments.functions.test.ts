import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  parseResultAmendmentReceipt,
  parseResultAmendments,
  resultAmendmentError
} from '../src/features/matches/result-amendment-model';
import {
  validateCancelResultAmendment,
  validateRequestResultAmendment,
  validateReviewResultAmendment,
  validateSubmitResultAmendmentCandidate
} from '../src/features/matches/result-amendment.validators';

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  claims: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  event: vi.fn<() => Promise<unknown>>(),
  header: vi.fn<(...args: unknown[]) => void>(),
  from: vi.fn<(...args: unknown[]) => unknown>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: typeof validate) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options: { data: unknown }) =>
        fn({ data: validate(options.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.header }));
vi.mock('../src/features/auth/auth.server', () => ({ requireAuthenticatedClient: mocks.auth }));
import {
  cancelResultAmendment,
  getResultAmendments,
  requestResultAmendment,
  reviewResultAmendment,
  submitResultAmendmentCandidate
} from '../src/features/matches/result-amendment.functions';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const PROPOSAL = id(2);
const CONFIRMATION = id(3);
const AMENDMENT = id(4);
const COMMAND = id(5);
const sets = [
  { position: 1, team_a_games: 6, team_b_games: 2, completed: true },
  { position: 2, team_a_games: 6, team_b_games: 3, completed: true }
];
const teams = { team_a: [id(11), id(12)], team_b: [id(13), id(14)] };
const receipt = {
  amendment_id: AMENDMENT,
  event_id: EVENT,
  proposal_id: PROPOSAL,
  lifecycle: 'proposal_pending',
  base_confirmation_id: CONFIRMATION,
  official_confirmation_id: CONFIRMATION,
  candidate_version: 2,
  review_deadline_at: '2026-11-07T10:00:00Z',
  decision_source: null,
  pending_application: false,
  command_id: COMMAND,
  replayed: false
};
const candidate = {
  version: 2,
  submitted_by: id(11),
  submitted_at: '2026-11-05T10:00:00Z',
  review_deadline_at: '2026-11-07T10:00:00Z',
  teams,
  sets,
  classification: 'team_a',
  played_at_utc: '2026-11-01T10:00:00Z',
  played_at_local: '2026-11-01 10:00:00',
  played_at_offset_seconds: 0,
  court_label: null,
  team_a_approval_count: 0,
  team_b_approval_count: 1,
  required_team_coverage_count: 1,
  received_team_coverage_count: 1,
  caller_decision: null,
  dispute_evidence: null
};
const dto = {
  amendment_id: AMENDMENT,
  event_id: EVENT,
  proposal_id: PROPOSAL,
  group_number: 1,
  lifecycle: 'proposal_pending',
  base_confirmation_id: CONFIRMATION,
  base_version: 1,
  official_confirmation_id: CONFIRMATION,
  requester_id: id(12),
  reason: 'Wrong score',
  requested_at: '2026-11-05T09:00:00Z',
  candidate,
  decision: null,
  pending_application: false,
  repair_job_id: null,
  can_submit_candidate: false,
  can_approve: true,
  can_reject: true,
  can_cancel: false
};
const submitCommand = {
  event_id: EVENT,
  amendment_id: AMENDMENT,
  expected_base_confirmation_id: CONFIRMATION,
  expected_candidate_version: null,
  teams,
  sets,
  played_local: { local: '2020-01-01 12:00:00', offset_seconds: 0 },
  court_label: null,
  command_id: COMMAND
};
const reviewCommand = {
  amendment_id: AMENDMENT,
  expected_base_confirmation_id: CONFIRMATION,
  expected_candidate_version: 2,
  decision: 'approve',
  reason_code: null,
  reason_note: null,
  command_id: COMMAND
};

describe('result amendment validators', () => {
  it('accepts exact commands and normalizes text', () => {
    expect(
      validateRequestResultAmendment({
        proposal_id: PROPOSAL,
        expected_confirmation_id: CONFIRMATION,
        reason: '  Wrong score  ',
        command_id: COMMAND
      })
    ).toEqual({
      proposal_id: PROPOSAL,
      expected_confirmation_id: CONFIRMATION,
      reason: 'Wrong score',
      command_id: COMMAND
    });
    expect(validateCancelResultAmendment({ amendment_id: AMENDMENT, command_id: COMMAND })).toEqual(
      {
        amendment_id: AMENDMENT,
        command_id: COMMAND
      }
    );
    expect(validateSubmitResultAmendmentCandidate(submitCommand)).toMatchObject({
      expected_candidate_version: null,
      court_label: null
    });
    expect(validateReviewResultAmendment(reviewCommand)).toMatchObject({ decision: 'approve' });
  });

  it('rejects extra keys, bad ids, blank or control-character reasons and bad versions', () => {
    const base = {
      proposal_id: PROPOSAL,
      expected_confirmation_id: CONFIRMATION,
      reason: 'ok',
      command_id: COMMAND
    };
    expect(() => validateRequestResultAmendment({ ...base, extra: 1 })).toThrow(
      'MATCH_RESULT_INVALID_REQUEST'
    );
    expect(() => validateRequestResultAmendment({ ...base, command_id: 'nope' })).toThrow(/./);
    expect(() => validateRequestResultAmendment({ ...base, reason: '   ' })).toThrow(
      'INVALID_REASON'
    );
    expect(() => validateRequestResultAmendment({ ...base, reason: 'a\u0007b' })).toThrow(
      'INVALID_REASON'
    );
    expect(() => validateRequestResultAmendment({ ...base, reason: 'x'.repeat(501) })).toThrow(
      'INVALID_REASON'
    );
    expect(() =>
      validateSubmitResultAmendmentCandidate({ ...submitCommand, expected_candidate_version: 0 })
    ).toThrow('MATCH_RESULT_INVALID_REQUEST');
    expect(() =>
      validateSubmitResultAmendmentCandidate({ ...submitCommand, court_label: ' ' })
    ).toThrow('INVALID_COURT');
    expect(() =>
      validateReviewResultAmendment({ ...reviewCommand, expected_candidate_version: null })
    ).toThrow('MATCH_RESULT_INVALID_REQUEST');
    expect(() => validateReviewResultAmendment({ ...reviewCommand, reason_code: 'OTHER' })).toThrow(
      'INVALID_REVIEW'
    );
    expect(() =>
      validateReviewResultAmendment({
        ...reviewCommand,
        decision: 'reject',
        reason_code: 'OTHER',
        reason_note: null
      })
    ).toThrow('INVALID_REJECTION_REASON');
    expect(
      validateReviewResultAmendment({
        ...reviewCommand,
        decision: 'reject',
        reason_code: 'SCORE_INCORRECT',
        reason_note: ' no '
      })
    ).toMatchObject({ reason_code: 'SCORE_INCORRECT', reason_note: 'no' });
  });
});

describe('result amendment decoders', () => {
  it('decodes receipts and flags the deadline-elapsed acceptance', () => {
    expect(parseResultAmendmentReceipt(receipt)).toEqual({
      status: 'ok',
      value: expect.objectContaining({ amendment_id: AMENDMENT, pending_application: false }),
      replayed: false
    });
    const accepted = {
      ...receipt,
      lifecycle: 'approved_pending_repair',
      decision_source: 'AUTO_48H',
      pending_application: true,
      conflict: 'deadline_elapsed'
    };
    expect(parseResultAmendmentReceipt(accepted)).toMatchObject({
      status: 'conflict',
      code: 'deadline_elapsed',
      value: { pending_application: true, decision_source: 'AUTO_48H' }
    });
  });

  it('fails closed on malformed or inconsistent receipts', () => {
    for (const bad of [
      null,
      { ...receipt, replayed: 'no' },
      { ...receipt, lifecycle: 'applied-ish' },
      { ...receipt, pending_application: true },
      { ...receipt, candidate_version: 0 },
      { ...receipt, review_deadline_at: 'yesterday' },
      { ...receipt, decision_source: 'ROBOT' },
      { ...receipt, amendment_id: 'x' },
      { ...receipt, conflict: 'other' }
    ])
      expect(parseResultAmendmentReceipt(bad)).toBeNull();
  });

  it('decodes amendment lists and rejects foreign events or inconsistent flags', () => {
    expect(parseResultAmendments([dto], EVENT)).toHaveLength(1);
    expect(
      parseResultAmendments([{ ...dto, candidate: null, lifecycle: 'requested' }], EVENT)
    ).toHaveLength(1);
    expect(parseResultAmendments([dto], id(99))).toBeNull();
    expect(parseResultAmendments([{ ...dto, pending_application: true }], EVENT)).toBeNull();
    expect(
      parseResultAmendments([{ ...dto, candidate: { ...candidate, classification: 'win' } }], EVENT)
    ).toBeNull();
    expect(parseResultAmendments([{ ...dto, can_approve: 'yes' }], EVENT)).toBeNull();
    expect(parseResultAmendments({ not: 'a list' }, EVENT)).toBeNull();
    expect(
      parseResultAmendments(
        [
          {
            ...dto,
            lifecycle: 'approved_pending_repair',
            pending_application: true,
            decision: {
              source: 'MANUAL',
              actor_id: id(13),
              decided_at: '2026-11-05T11:00:00Z',
              note: null
            }
          }
        ],
        EVENT
      )?.[0]
    ).toMatchObject({ pending_application: true, decision: { source: 'MANUAL' } });
  });

  it('maps domain errors to typed conflicts and codes without leaking raw messages', () => {
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_BASE_CONFLICT',
        details: JSON.stringify({ current_confirmation_id: CONFIRMATION })
      })
    ).toEqual({ status: 'conflict', code: 'base_conflict', current_confirmation_id: CONFIRMATION });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT',
        details: JSON.stringify({ current_version: 3, lifecycle: 'proposal_pending' })
      })
    ).toEqual({
      status: 'conflict',
      code: 'candidate_version_conflict',
      current_version: 3,
      lifecycle: 'proposal_pending'
    });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_STATE_CONFLICT',
        details: JSON.stringify({ lifecycle: 'disputed' })
      })
    ).toEqual({ status: 'conflict', code: 'state_conflict', lifecycle: 'disputed' });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_ALREADY_OPEN',
        details: JSON.stringify({ amendment_id: AMENDMENT })
      })
    ).toEqual({ status: 'conflict', code: 'already_open', amendment_id: AMENDMENT });
    expect(
      resultAmendmentError({ message: 'RESULT_AMENDMENT_BASE_CONFLICT', details: 'garbage' })
    ).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    expect(resultAmendmentError({ message: 'RESULT_AMENDMENT_IDEMPOTENCY_CONFLICT' })).toEqual({
      status: 'error',
      code: 'idempotency_conflict'
    });
    expect(resultAmendmentError({ message: 'RESULT_AMENDMENT_FORBIDDEN', code: '42501' })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
    expect(resultAmendmentError({ message: 'RESULT_AMENDMENT_NO_CHANGE' })).toEqual({
      status: 'error',
      code: 'no_change'
    });
    expect(
      resultAmendmentError({ message: 'PROVISIONAL_PLAYER_RESTRICTED', code: '42501' })
    ).toEqual({
      status: 'error',
      code: 'forbidden'
    });
    expect(resultAmendmentError({ message: 'MATCH_RESULT_INVALID_TEAMS' })).toMatchObject({
      status: 'error',
      code: 'invalid_teams'
    });
    expect(resultAmendmentError({ message: 'boom: select * from secrets', code: 'XX000' })).toEqual(
      {
        status: 'error',
        code: 'unavailable'
      }
    );
  });
});

describe('result amendment server boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: id(11) } }, error: null });
    mocks.event.mockResolvedValue({ data: { timezone: 'UTC' }, error: null });
    mocks.from.mockReturnValue({
      select: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      eq: vi.fn<(...args: unknown[]) => unknown>().mockReturnThis(),
      maybeSingle: mocks.event
    });
    mocks.auth.mockResolvedValue({
      client: { auth: { getClaims: mocks.claims }, rpc: mocks.rpc, from: mocks.from }
    });
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
  });

  it('requires verified non-anonymous claims before any RPC and sets private no-store', async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: id(11), is_anonymous: true } },
      error: null
    });
    await expect(getResultAmendments({ data: { event_id: EVENT } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    mocks.claims.mockResolvedValue({ data: null, error: new Error('bad') });
    await expect(
      cancelResultAmendment({ data: { amendment_id: AMENDMENT, command_id: COMMAND } })
    ).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('requests, reviews and cancels through exact RPC arguments and receipt checks', async () => {
    expect(
      await requestResultAmendment({
        data: {
          proposal_id: PROPOSAL,
          expected_confirmation_id: CONFIRMATION,
          reason: 'Wrong',
          command_id: COMMAND
        }
      })
    ).toMatchObject({ status: 'ok', value: { amendment_id: AMENDMENT }, replayed: false });
    expect(mocks.rpc).toHaveBeenLastCalledWith('request_result_amendment', {
      p_proposal_id: PROPOSAL,
      p_expected_confirmation_id: CONFIRMATION,
      p_reason: 'Wrong',
      p_command_id: COMMAND
    });

    expect(await reviewResultAmendment({ data: reviewCommand })).toMatchObject({ status: 'ok' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('review_result_amendment', {
      p_amendment_id: AMENDMENT,
      p_expected_base_confirmation_id: CONFIRMATION,
      p_expected_candidate_version: 2,
      p_decision: 'approve',
      p_reason_code: undefined,
      p_reason_note: undefined,
      p_command_id: COMMAND
    });

    expect(
      await cancelResultAmendment({ data: { amendment_id: AMENDMENT, command_id: COMMAND } })
    ).toMatchObject({ status: 'ok' });
    expect(mocks.rpc).toHaveBeenLastCalledWith('cancel_result_amendment', {
      p_amendment_id: AMENDMENT,
      p_command_id: COMMAND
    });

    // A receipt for another command or amendment is untrustworthy.
    mocks.rpc.mockResolvedValue({ data: { ...receipt, command_id: id(77) }, error: null });
    expect(await reviewResultAmendment({ data: reviewCommand })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({ data: { ...receipt, amendment_id: id(78) }, error: null });
    expect(await reviewResultAmendment({ data: reviewCommand })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({ data: { ...receipt, proposal_id: id(79) }, error: null });
    expect(
      await requestResultAmendment({
        data: {
          proposal_id: PROPOSAL,
          expected_confirmation_id: CONFIRMATION,
          reason: 'Wrong',
          command_id: COMMAND
        }
      })
    ).toEqual({ status: 'error', code: 'unavailable' });
  });

  it('submits candidates with the DB timezone instant and surfaces replays and conflicts', async () => {
    mocks.event.mockResolvedValue({ data: { timezone: 'America/New_York' }, error: null });
    mocks.rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    expect(
      await submitResultAmendmentCandidate({
        data: {
          ...submitCommand,
          court_label: ' Court 2 ',
          expected_candidate_version: 2,
          played_local: { local: '2020-11-01 01:30:00', offset_seconds: -18000 }
        }
      })
    ).toMatchObject({ status: 'ok', replayed: true });
    expect(mocks.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_amendment_id: AMENDMENT,
      p_expected_candidate_version: 2,
      p_court_label: 'Court 2',
      p_played_local: { local: '2020-11-01 01:30:00', instant: '2020-11-01T06:30:00.000Z' }
    });

    mocks.event.mockResolvedValue({ data: { timezone: 'UTC' }, error: null });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'RESULT_AMENDMENT_BASE_CONFLICT',
        details: JSON.stringify({ current_confirmation_id: CONFIRMATION })
      }
    });
    expect(await submitResultAmendmentCandidate({ data: submitCommand })).toMatchObject({
      status: 'conflict',
      code: 'base_conflict'
    });
  });

  it('rejects a DST-gap played time before any mutation and hides unreadable events', async () => {
    mocks.event.mockResolvedValue({ data: { timezone: 'America/New_York' }, error: null });
    expect(
      await submitResultAmendmentCandidate({
        data: {
          ...submitCommand,
          played_local: { local: '2020-03-08 02:30:00', offset_seconds: -18000 }
        }
      })
    ).toEqual({ status: 'error', code: 'invalid_played_at' });
    mocks.event.mockResolvedValue({ data: null, error: null });
    expect(await submitResultAmendmentCandidate({ data: submitCommand })).toEqual({
      status: 'error',
      code: 'not_found'
    });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('reads amendment lists through the strict decoder', async () => {
    mocks.rpc.mockResolvedValue({ data: [dto], error: null });
    expect(await getResultAmendments({ data: { event_id: EVENT } })).toMatchObject({
      status: 'ok',
      value: [{ amendment_id: AMENDMENT }]
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_result_amendments', {
      p_match_event_id: EVENT
    });
    mocks.rpc.mockResolvedValue({ data: [{ secret: true }], error: null });
    expect(await getResultAmendments({ data: { event_id: EVENT } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RESULT_AMENDMENT_FORBIDDEN', code: '42501' }
    });
    expect(await getResultAmendments({ data: { event_id: EVENT } })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
  });
});
