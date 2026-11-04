import { beforeEach, describe, expect, it, vi } from 'vitest';

type RpcResult = { data: unknown; error: { message: string } | null };

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown; userId: string }>>(),
  rpc: vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>()
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options?: { data: unknown }) =>
          fn({ data: validate(options?.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));

import * as functions from '../src/features/level-reviews/level-review.functions';

const ID = '11111111-1111-4111-8111-111111111111';
const CMD = '22222222-2222-4222-8222-222222222222';
const OWNER = '33333333-3333-4333-8333-333333333333';
const AT = '2026-11-03T10:00:00.123456Z';
const dto = {
  id: ID,
  status: 'pending',
  snapshot_display_level: 4,
  snapshot_reliability_percent: 10,
  requested_min_level: 4.5,
  requested_max_level: 5,
  reason: 'Reason',
  evidence: null,
  created_at: AT,
  under_review_at: null,
  canceled_at: null,
  decided_at: null,
  decision_note: null,
  approved_level: null,
  adjustment_id: null
};
const adminDto = {
  ...dto,
  owner_id: OWNER,
  owner_display_name: null,
  snapshot_rating_revision: 1,
  under_review_by: null,
  decision_actor_id: null
};
const approval = {
  request_id: ID,
  command_id: CMD,
  decision: 'approve',
  note: 'ok',
  target_level: 4.75,
  expected_revision: 9
} as const;

type Call = { name: string; rpc: string; payload: unknown; run: () => Promise<unknown> };
const calls: Call[] = [
  {
    name: 'getLevelReviewAccess',
    rpc: 'get_level_review_access',
    payload: { is_platform_admin: false },
    run: () => functions.getLevelReviewAccess()
  },
  {
    name: 'submitLevelReviewRequest',
    rpc: 'submit_level_review_request',
    payload: { request: dto, replayed: false },
    run: () =>
      functions.submitLevelReviewRequest({
        data: {
          command_id: CMD,
          requested_min_level: 4.5,
          requested_max_level: 5,
          reason: 'Reason'
        }
      })
  },
  {
    name: 'listMyLevelReviewRequests',
    rpc: 'list_my_level_review_requests',
    payload: { items: [], next_cursor: null },
    run: () => functions.listMyLevelReviewRequests()
  },
  {
    name: 'getMyLevelReviewRequest',
    rpc: 'get_my_level_review_request',
    payload: { request: dto },
    run: () => functions.getMyLevelReviewRequest({ data: { request_id: ID } })
  },
  {
    name: 'cancelLevelReviewRequest',
    rpc: 'cancel_level_review_request',
    payload: { request: dto, replayed: false },
    run: () => functions.cancelLevelReviewRequest({ data: { request_id: ID } })
  },
  {
    name: 'listLevelReviewQueueRequests',
    rpc: 'list_level_review_queue',
    payload: { pending_count: 0, under_review_count: 0, items: [], next_cursor: null },
    run: () => functions.listLevelReviewQueueRequests()
  },
  {
    name: 'getLevelReviewAdminDetail',
    rpc: 'get_level_review_admin_detail',
    payload: { request: adminDto, current: null, rating_changed: false, recent_history: [] },
    run: () => functions.getLevelReviewAdminDetail({ data: { request_id: ID } })
  },
  {
    name: 'markLevelReviewRequestUnderReview',
    rpc: 'mark_level_review_under_review',
    payload: { request: adminDto, replayed: false },
    run: () => functions.markLevelReviewRequestUnderReview({ data: { request_id: ID } })
  },
  {
    name: 'resolveLevelReviewRequest',
    rpc: 'resolve_level_review_request',
    payload: { request: adminDto, replayed: false },
    run: () =>
      functions.resolveLevelReviewRequest({
        data: { request_id: ID, command_id: CMD, decision: 'reject', note: 'No' }
      })
  }
];

describe('level review server functions', () => {
  beforeEach(() => {
    mocks.requireAuthenticatedClient.mockReset();
    mocks.rpc.mockReset();
    mocks.requireAuthenticatedClient.mockResolvedValue({
      client: { rpc: mocks.rpc },
      userId: OWNER
    });
  });

  it('covers every exported handler', () => {
    expect(calls.map((call) => call.name).sort()).toEqual(Object.keys(functions).sort());
  });

  it.each(calls)('$name authenticates first and calls $rpc', async (call) => {
    mocks.rpc.mockResolvedValue({ data: call.payload, error: null });
    await expect(call.run()).resolves.toEqual(call.payload);
    expect(mocks.requireAuthenticatedClient).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc.mock.calls[0]?.[0]).toBe(call.rpc);
  });

  it.each(calls)('$name makes no database call when unauthenticated', async (call) => {
    mocks.requireAuthenticatedClient.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await expect(call.run()).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each(calls)('$name surfaces database failures as stable codes', async (call) => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'LEVEL_REVIEW_FORBIDDEN' } });
    await expect(call.run()).rejects.toThrow('LEVEL_REVIEW_FORBIDDEN');
    mocks.rpc.mockResolvedValue({ data: null, error: { message: 'relation leaked' } });
    await expect(call.run()).rejects.toThrow('LEVEL_REVIEW_UNAVAILABLE');
  });

  it.each(calls)('$name rejects an undecodable payload', async (call) => {
    mocks.rpc.mockResolvedValue({ data: { unexpected: true }, error: null });
    await expect(call.run()).rejects.toThrow('INVALID_LEVEL_REVIEW_RESPONSE');
  });

  it('validates input before authenticating or calling the database', async () => {
    await expect(
      functions.submitLevelReviewRequest({
        data: { command_id: CMD, requested_min_level: 7.001, requested_max_level: 7, reason: 'x' }
      })
    ).rejects.toThrow('INVALID_LEVEL_REVIEW_INPUT');
    const withOwner = { request_id: ID, owner_id: OWNER };
    await expect(functions.getMyLevelReviewRequest({ data: withOwner })).rejects.toThrow(
      'INVALID_LEVEL_REVIEW_INPUT'
    );
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('maps submit and resolve payloads to RPC arguments', async () => {
    mocks.rpc.mockResolvedValue({ data: { request: dto, replayed: false }, error: null });
    await functions.submitLevelReviewRequest({
      data: {
        command_id: CMD,
        requested_min_level: 4.5,
        requested_max_level: 5,
        reason: 'Reason',
        evidence: 'https://example.test'
      }
    });
    expect(mocks.rpc).toHaveBeenLastCalledWith('submit_level_review_request', {
      p_command_id: CMD,
      p_requested_min_level: 4.5,
      p_requested_max_level: 5,
      p_reason: 'Reason',
      p_evidence: 'https://example.test'
    });
    mocks.rpc.mockResolvedValue({ data: { request: adminDto, replayed: false }, error: null });
    await functions.resolveLevelReviewRequest({ data: approval });
    expect(mocks.rpc).toHaveBeenLastCalledWith('resolve_level_review_request', {
      p_request_id: ID,
      p_command_id: CMD,
      p_decision: 'approve',
      p_note: 'ok',
      p_target_level: 4.75,
      p_expected_revision: 9
    });
  });

  it('forwards bounded keyset pagination and the queue status filter', async () => {
    const cursor = { created_at: AT, id: ID };
    mocks.rpc.mockResolvedValue({
      data: { pending_count: 0, under_review_count: 0, items: [], next_cursor: null },
      error: null
    });
    await functions.listLevelReviewQueueRequests({ data: { status: 'pending', limit: 5, cursor } });
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_level_review_queue', {
      p_limit: 5,
      p_after_created_at: AT,
      p_after_id: ID,
      p_status: 'pending'
    });
    await functions.listLevelReviewQueueRequests();
    expect(mocks.rpc).toHaveBeenLastCalledWith('list_level_review_queue', { p_limit: 20 });
  });

  it('keeps a failed approval fail-closed for the caller', async () => {
    mocks.rpc.mockResolvedValue({
      data: null,
      error: { message: 'LEVEL_REVIEW_APPROVAL_UNAVAILABLE' }
    });
    await expect(functions.resolveLevelReviewRequest({ data: approval })).rejects.toThrow(
      'LEVEL_REVIEW_APPROVAL_UNAVAILABLE'
    );
  });
});
