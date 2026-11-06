import { beforeEach, describe, expect, it, vi } from 'vitest';
import { parseMatchAudit } from '../src/features/matches/match-management-model';
import {
  parseResultAmendmentReceipt,
  parseResultAmendments,
  resultAmendmentError
} from '../src/features/matches/result-amendment-model';
import { validateResolveResultDispute } from '../src/features/matches/result-amendment.validators';
import {
  parseResultDisputeReceipt,
  parseResultDisputeResolution,
  parseResultDisputeResolutions,
  parseResultRepairJob,
  parseResultRepairJobs
} from '../src/features/matches/result-dispute-model';
import { decodeResultNotificationContext } from '../src/features/notifications/notification-target';

const mocks = vi.hoisted(() => ({
  auth: vi.fn<() => Promise<unknown>>(),
  claims: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  header: vi.fn<(...args: unknown[]) => void>()
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
  getResultDisputeResolutions,
  getResultRepairJobs,
  resolveResultDispute
} from '../src/features/matches/result-amendment.functions';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EVENT = id(1);
const PROPOSAL = id(2);
const CONFIRMATION = id(3);
const AMENDMENT = id(4);
const COMMAND = id(5);
const RESOLUTION = id(6);
const JOB = id(7);

const job = {
  job_id: JOB,
  amendment_id: AMENDMENT,
  resolution_id: RESOLUTION,
  proposal_id: PROPOSAL,
  group_number: 1,
  kind: 'replace',
  status: 'queued',
  publication: 'pending',
  projections_complete: false,
  attempt_count: 0,
  failure_code: null,
  next_attempt_at: '2026-11-05T10:00:00Z',
  requested_at: '2026-11-05T10:00:00Z',
  started_at: null,
  finished_at: null,
  committed_revision: null
};
const resolution = {
  resolution_id: RESOLUTION,
  event_id: EVENT,
  proposal_id: PROPOSAL,
  group_number: 1,
  resolution_kind: 'amendment',
  amendment_id: AMENDMENT,
  base_confirmation_id: CONFIRMATION,
  candidate_version: 2,
  decision: 'replace',
  confirmation_id: null,
  actor_id: id(20),
  justification: 'Court booking record confirms the score',
  evidence_review_id: id(21),
  decided_at: '2026-11-05T10:00:00Z'
};
const receipt = {
  resolution,
  amendment_lifecycle: 'approved_pending_repair',
  official_confirmation_id: CONFIRMATION,
  repair: job,
  pending_application: true,
  command_id: COMMAND,
  replayed: false
};
const command = {
  proposal_id: PROPOSAL,
  expected_base_confirmation_id: CONFIRMATION,
  expected_candidate_version: 2,
  decision: 'replace',
  justification: ' Court booking record confirms the score ',
  command_id: COMMAND
};

describe('dispute resolution validators', () => {
  it('accepts the exact command and normalizes the justification', () => {
    expect(validateResolveResultDispute(command)).toEqual({
      ...command,
      justification: 'Court booking record confirms the score'
    });
    expect(
      validateResolveResultDispute({ ...command, expected_base_confirmation_id: null })
    ).toMatchObject({ expected_base_confirmation_id: null });
  });

  it('fails closed on shape, decision, version and justification problems', () => {
    for (const bad of [
      null,
      { ...command, extra: 1 },
      { proposal_id: PROPOSAL },
      { ...command, decision: 'approve' },
      { ...command, expected_candidate_version: 0 },
      { ...command, expected_candidate_version: 1.5 },
      { ...command, proposal_id: 'nope' },
      { ...command, justification: '' },
      { ...command, justification: '   ' },
      { ...command, justification: 'x'.repeat(501) },
      { ...command, justification: 'tab\u0007' },
      { ...command, justification: 5 }
    ])
      expect(() => validateResolveResultDispute(bad)).toThrow(/.+/);
  });
});

describe('repair job and resolution decoders', () => {
  it('decodes queued, failed and succeeded jobs without ever inventing completion', () => {
    expect(parseResultRepairJob(job)).toMatchObject({ status: 'queued', publication: 'pending' });
    expect(
      parseResultRepairJob({
        ...job,
        status: 'failed',
        publication: 'failed',
        failure_code: 'REPLAY_FAILED',
        attempt_count: 2,
        finished_at: '2026-11-05T11:00:00Z'
      })
    ).toMatchObject({ failure_code: 'REPLAY_FAILED', projections_complete: false });
    expect(
      parseResultRepairJob({
        ...job,
        status: 'succeeded',
        publication: 'published',
        projections_complete: true,
        committed_revision: 9,
        finished_at: '2026-11-05T11:00:00Z'
      })
    ).toMatchObject({ projections_complete: true, committed_revision: 9 });
    for (const bad of [
      null,
      { ...job, status: 'done' },
      { ...job, kind: 'delete' },
      { ...job, failure_code: 'ERROR: relation "x" does not exist' },
      { ...job, publication: 'published' },
      { ...job, projections_complete: true },
      { ...job, status: 'succeeded', publication: 'published', projections_complete: true },
      { ...job, status: 'failed', publication: 'pending' },
      { ...job, attempt_count: -1 },
      { ...job, group_number: 0 },
      { ...job, committed_revision: 0 },
      { ...job, requested_at: 'later' },
      { ...job, job_id: 'x' }
    ])
      expect(parseResultRepairJob(bad)).toBeNull();
    expect(parseResultRepairJobs([job])).toHaveLength(1);
    expect(parseResultRepairJobs([job, null])).toBeNull();
    expect(parseResultRepairJobs({})).toBeNull();
  });

  it('decodes resolutions and rejects inconsistent branch shapes', () => {
    expect(parseResultDisputeResolution(resolution)).toMatchObject({ decision: 'replace' });
    const first = {
      ...resolution,
      resolution_kind: 'first_confirmation',
      amendment_id: null,
      base_confirmation_id: null,
      decision: 'uphold',
      confirmation_id: id(30)
    };
    expect(parseResultDisputeResolution(first)).toMatchObject({ confirmation_id: id(30) });
    expect(
      parseResultDisputeResolution({ ...first, decision: 'void', confirmation_id: null })
    ).not.toBeNull();
    for (const bad of [
      null,
      { ...resolution, decision: 'approve' },
      { ...resolution, base_confirmation_id: null },
      { ...resolution, confirmation_id: id(30) },
      { ...first, decision: 'replace' },
      { ...first, confirmation_id: null },
      { ...first, decision: 'void' },
      { ...resolution, justification: '' },
      { ...resolution, candidate_version: 0 },
      { ...resolution, decided_at: 'x' }
    ])
      expect(parseResultDisputeResolution(bad)).toBeNull();
    expect(parseResultDisputeResolutions([resolution], EVENT)).toHaveLength(1);
    expect(parseResultDisputeResolutions([resolution], id(99))).toBeNull();
    expect(parseResultDisputeResolutions('x', EVENT)).toBeNull();
  });

  it('keeps receipts honest about pending application and the job link', () => {
    expect(parseResultDisputeReceipt(receipt)).toMatchObject({
      pending_application: true,
      repair: { kind: 'replace' }
    });
    const upheld = {
      ...receipt,
      resolution: { ...resolution, decision: 'uphold' },
      amendment_lifecycle: 'rejected',
      repair: null,
      pending_application: false
    };
    expect(parseResultDisputeReceipt(upheld)).toMatchObject({ repair: null });
    for (const bad of [
      null,
      { ...receipt, replayed: 'no' },
      { ...receipt, pending_application: false },
      { ...receipt, repair: null, pending_application: false },
      { ...upheld, repair: job, pending_application: true },
      { ...receipt, repair: { ...job, resolution_id: id(99) } },
      { ...receipt, repair: { ...job, status: 'bogus' } },
      { ...receipt, amendment_lifecycle: 'nonsense' },
      { ...receipt, command_id: 'x' },
      { ...receipt, official_confirmation_id: 'x' }
    ])
      expect(parseResultDisputeReceipt(bad)).toBeNull();
  });
});

describe('amendment decoders with the correction queue', () => {
  const amendmentReceipt = {
    amendment_id: AMENDMENT,
    event_id: EVENT,
    proposal_id: PROPOSAL,
    lifecycle: 'approved_pending_repair',
    base_confirmation_id: CONFIRMATION,
    official_confirmation_id: CONFIRMATION,
    candidate_version: 2,
    review_deadline_at: '2026-11-07T10:00:00Z',
    decision_source: 'ADMIN_OVERRIDE',
    pending_application: true,
    repair_job_id: JOB,
    repair_status: 'queued',
    publication: 'pending',
    command_id: COMMAND,
    replayed: false
  };

  it('decodes repair fields and tolerates receipts that predate them', () => {
    expect(parseResultAmendmentReceipt(amendmentReceipt)).toMatchObject({
      status: 'ok',
      value: { repair_job_id: JOB, repair_status: 'queued', publication: 'pending' }
    });
    const { repair_job_id: _a, repair_status: _b, publication: _c, ...legacy } = amendmentReceipt;
    expect(parseResultAmendmentReceipt(legacy)).toMatchObject({
      status: 'ok',
      value: { repair_job_id: null, repair_status: null, publication: null }
    });
    for (const bad of [
      { ...amendmentReceipt, repair_status: 'bogus' },
      { ...amendmentReceipt, publication: 'applied' },
      { ...amendmentReceipt, repair_status: null },
      { ...amendmentReceipt, repair_job_id: null },
      { ...amendmentReceipt, repair_job_id: 'x' }
    ])
      expect(parseResultAmendmentReceipt(bad)).toBeNull();
  });

  it('decodes the amendment DTO resolution and repair summary consistently', () => {
    const dto = {
      amendment_id: AMENDMENT,
      event_id: EVENT,
      proposal_id: PROPOSAL,
      group_number: 1,
      lifecycle: 'approved_pending_repair',
      base_confirmation_id: CONFIRMATION,
      base_version: 1,
      official_confirmation_id: CONFIRMATION,
      requester_id: id(12),
      reason: 'Wrong score',
      requested_at: '2026-11-05T09:00:00Z',
      candidate: null,
      decision: {
        source: 'ADMIN_OVERRIDE',
        actor_id: id(20),
        decided_at: '2026-11-05T10:00:00Z',
        note: 'ok'
      },
      pending_application: true,
      repair_job_id: JOB,
      repair: job,
      resolution,
      can_resolve: false,
      can_submit_candidate: false,
      can_approve: false,
      can_reject: false,
      can_cancel: false
    };
    expect(parseResultAmendments([dto], EVENT)?.[0]).toMatchObject({
      repair: { job_id: JOB, publication: 'pending' },
      resolution: { decision: 'replace' },
      can_resolve: false
    });
    const { repair: _r, resolution: _s, can_resolve: _c, ...legacy } = dto;
    expect(parseResultAmendments([legacy], EVENT)?.[0]).toMatchObject({
      repair: null,
      resolution: null,
      can_resolve: false
    });
    expect(parseResultAmendments([{ ...dto, repair: { ...job, status: 'x' } }], EVENT)).toBeNull();
    expect(
      parseResultAmendments([{ ...dto, resolution: { ...resolution, decision: 'x' } }], EVENT)
    ).toBeNull();
    expect(
      parseResultAmendments([{ ...dto, repair: { ...job, job_id: id(99) } }], EVENT)
    ).toBeNull();
    expect(parseResultAmendments([{ ...dto, can_resolve: 'yes' }], EVENT)).toBeNull();
  });
});

describe('dispute error contract', () => {
  it('maps resolution conflicts and new reason codes', () => {
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_ALREADY_RESOLVED',
        details: JSON.stringify({ resolution_id: RESOLUTION, decision: 'uphold' })
      })
    ).toEqual({
      status: 'conflict',
      code: 'already_resolved',
      resolution_id: RESOLUTION,
      decision: 'uphold'
    });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_ALREADY_RESOLVED',
        details: JSON.stringify({ resolution_id: RESOLUTION, decision: 'maybe' })
      })
    ).toEqual({ status: 'error', code: 'unavailable' });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT',
        details: JSON.stringify({ current_version: 1, lifecycle: null })
      })
    ).toEqual({
      status: 'conflict',
      code: 'candidate_version_conflict',
      current_version: 1,
      lifecycle: null
    });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_CANDIDATE_VERSION_CONFLICT',
        details: JSON.stringify({ current_version: 1, lifecycle: 'bogus' })
      })
    ).toEqual({ status: 'error', code: 'unavailable' });
    expect(
      resultAmendmentError({
        message: 'RESULT_AMENDMENT_STATE_CONFLICT',
        details: JSON.stringify({ lifecycle: null })
      })
    ).toEqual({ status: 'error', code: 'unavailable' });
    for (const code of ['invalid_justification', 'invalid_decision'])
      expect(resultAmendmentError({ message: 'RESULT_AMENDMENT_' + code.toUpperCase() })).toEqual({
        status: 'error',
        code
      });
  });
});

describe('audit and notification enums', () => {
  const row = {
    id: id(40),
    match_event_id: EVENT,
    community_id: id(41),
    actor_id: id(42),
    target_user_id: null,
    request_id: COMMAND,
    reason: null,
    occurred_at: '2026-11-05T10:00:00Z',
    event_version: 2,
    transition_revision: 3,
    before_data: {},
    after_data: {},
    changed_fields: []
  };

  it('accepts the amendment, resolution and repair-queued audit actions', () => {
    for (const action of [
      'result_amendment_requested',
      'result_amendment_accepted',
      'result_dispute_upheld',
      'result_dispute_replaced',
      'result_dispute_voided',
      'result_repair_queued',
      'result_repair_claimed',
      'result_repair_retried',
      'result_repair_failed',
      'result_repair_applied'
    ])
      expect(parseMatchAudit([{ ...row, action }])).toHaveLength(1);
    expect(parseMatchAudit([{ ...row, action: 'result_repair_completed' }])).toBeNull();
  });

  it('decodes the new result notification kinds', () => {
    const context = {
      notification_id: id(50),
      notification_kind: 'result_amendment_resolved',
      match_event_id: EVENT,
      community_id: id(41),
      proposal_id: PROPOSAL,
      proposal_version: 2,
      group_number: 1,
      proposal_status: 'superseded',
      current_version: 1,
      current_status: 'confirmed',
      is_current: false,
      classification: 'team_a',
      winner_sets: 2,
      loser_sets: 0,
      score: '6-2 6-3',
      submitted_by_name: 'Sam',
      review_deadline_at: '2026-11-07T10:00:00Z',
      venue: 'Club',
      starts_at: '2026-11-01T10:00:00Z',
      timezone: 'UTC',
      entry_ready: false
    };
    for (const kind of [
      'result_amendment_resolved',
      'result_repair_queued',
      'result_repair_applied',
      'result_repair_failed'
    ])
      expect(
        decodeResultNotificationContext({ ...context, notification_kind: kind })
      ).toMatchObject({
        notification_kind: kind
      });
    expect(() =>
      decodeResultNotificationContext({ ...context, notification_kind: 'result_repair_completed' })
    ).toThrow('INVALID_NOTIFICATION_RESULT_CONTEXT');
  });
});

describe('dispute server boundary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: id(11) } }, error: null });
    mocks.auth.mockResolvedValue({
      client: { auth: { getClaims: mocks.claims }, rpc: mocks.rpc }
    });
    mocks.rpc.mockResolvedValue({ data: receipt, error: null });
  });

  it('requires verified non-anonymous claims before any RPC', async () => {
    mocks.claims.mockResolvedValue({
      data: { claims: { sub: id(11), is_anonymous: true } },
      error: null
    });
    await expect(resolveResultDispute({ data: command })).rejects.toThrow('UNAUTHENTICATED');
    await expect(getResultRepairJobs({ data: { event_id: EVENT } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it('sends the exact RPC arguments and verifies the receipt answers the command', async () => {
    expect(await resolveResultDispute({ data: command })).toMatchObject({
      status: 'ok',
      replayed: false,
      value: { pending_application: true, repair: { status: 'queued' } }
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('resolve_result_dispute', {
      p_proposal_id: PROPOSAL,
      p_expected_candidate_version: 2,
      p_decision: 'replace',
      p_justification: 'Court booking record confirms the score',
      p_command_id: COMMAND,
      p_expected_base_confirmation_id: CONFIRMATION
    });
    await resolveResultDispute({ data: { ...command, expected_base_confirmation_id: null } });
    expect(mocks.rpc.mock.lastCall?.[1]).toMatchObject({
      p_expected_base_confirmation_id: undefined
    });

    for (const wrong of [
      { ...receipt, command_id: id(77) },
      { ...receipt, resolution: { ...resolution, proposal_id: id(78) } },
      {
        ...receipt,
        resolution: { ...resolution, decision: 'void' },
        repair: { ...job, kind: 'void' }
      },
      { ...receipt, pending_application: false }
    ]) {
      mocks.rpc.mockResolvedValue({ data: wrong, error: null });
      expect(await resolveResultDispute({ data: command })).toEqual({
        status: 'error',
        code: 'unavailable'
      });
    }
    mocks.rpc.mockResolvedValue({ data: { ...receipt, replayed: true }, error: null });
    expect(await resolveResultDispute({ data: command })).toMatchObject({ replayed: true });
  });

  it('surfaces database conflicts and denials as typed results', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: {
        message: 'RESULT_AMENDMENT_ALREADY_RESOLVED',
        details: JSON.stringify({ resolution_id: RESOLUTION, decision: 'void' })
      }
    });
    expect(await resolveResultDispute({ data: command })).toMatchObject({
      status: 'conflict',
      code: 'already_resolved'
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { code: '42501', message: 'RESULT_AMENDMENT_FORBIDDEN' }
    });
    expect(await resolveResultDispute({ data: command })).toEqual({
      status: 'error',
      code: 'forbidden'
    });
  });

  it('reads resolutions and repair jobs through strict decoders', async () => {
    mocks.rpc.mockResolvedValue({ data: [resolution], error: null });
    expect(await getResultDisputeResolutions({ data: { event_id: EVENT } })).toMatchObject({
      status: 'ok',
      value: [{ resolution_id: RESOLUTION }]
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('get_result_dispute_resolutions', {
      p_match_event_id: EVENT
    });
    mocks.rpc.mockResolvedValue({ data: [job], error: null });
    expect(await getResultRepairJobs({ data: { event_id: EVENT } })).toMatchObject({
      status: 'ok',
      value: [{ job_id: JOB, projections_complete: false }]
    });
    mocks.rpc.mockResolvedValue({ data: [{ ...job, status: 'bogus' }], error: null });
    expect(await getResultRepairJobs({ data: { event_id: EVENT } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({ data: [{ ...resolution, event_id: id(90) }], error: null });
    expect(await getResultDisputeResolutions({ data: { event_id: EVENT } })).toEqual({
      status: 'error',
      code: 'unavailable'
    });
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'RESULT_AMENDMENT_NOT_FOUND' }
    });
    expect(await getResultRepairJobs({ data: { event_id: EVENT } })).toEqual({
      status: 'error',
      code: 'not_found'
    });
  });
});
