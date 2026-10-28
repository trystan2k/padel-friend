/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type {
  ResultCommandReceipt,
  ResultCommandResponse,
  ResultDecision,
  ResultProposal,
  ResultRejectionReason
} from '../src/features/matches/match-result-model';
import { parseResultProposals } from '../src/features/matches/match-result-model';
import { useMatchResultFreshness } from '../src/features/matches/use-match-result-freshness';
import { useMatchResultReview } from '../src/features/matches/use-match-result-review';
import { resultProposal, resultIds } from './helpers/match-result-fixtures';

type ReviewMutation = (options: {
  data: {
    proposal_id: string;
    expected_version: number;
    decision: ResultDecision;
    reason_code: ResultRejectionReason | null;
    reason_note: string | null;
    request_id: string;
  };
}) => Promise<ResultCommandResponse<ResultCommandReceipt>>;

const mocks = vi.hoisted(() => ({ review: vi.fn<ReviewMutation>() }));

vi.mock('../src/features/matches/match-result.functions', () => ({
  reviewMatchEventResult: mocks.review
}));

function proposal(overrides: Partial<ResultProposal> = {}): ResultProposal {
  const parsed = parseResultProposals([{ ...resultProposal, ...overrides }])?.[0];
  if (!parsed) throw new Error('Invalid controller fixture');
  return parsed;
}

function receipt(
  status: ResultProposal['status'] = 'pending'
): ResultCommandResponse<ResultCommandReceipt> {
  return {
    status: 'ok',
    replayed: false,
    value: {
      proposal_id: resultProposal.proposal_id,
      version: 1,
      status,
      confirmation_id: status === 'confirmed' ? resultIds[3]! : null,
      review_deadline_at: resultProposal.review_deadline_at,
      request_id: resultIds[2]!
    }
  };
}

function visible() {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.resetAllMocks();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
  visible();
});

describe('result review mutation controller', () => {
  it('keeps request identity for explicit retries after an ambiguous failure', async () => {
    mocks.review.mockRejectedValueOnce(new Error('connection lost')).mockResolvedValue(receipt());
    const { result } = renderHook(() =>
      useMatchResultReview({
        proposal: proposal({ can_approve: true }),
        onRefresh: vi.fn<() => void>()
      })
    );

    await act(async () => {
      await result.current.approve();
    });
    expect(result.current.feedback).toMatchObject({ kind: 'error', retryable: true });
    const requestId = mocks.review.mock.calls[0]?.[0].data.request_id;

    await act(async () => {
      await result.current.retry();
    });

    expect(mocks.review).toHaveBeenCalledTimes(2);
    expect(mocks.review.mock.calls[1]?.[0].data.request_id).toBe(requestId);
    expect(result.current.feedback).toMatchObject({ kind: 'recorded', decision: 'approve' });
  });

  it('does not queue a review while offline', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() =>
      useMatchResultReview({
        proposal: proposal({ can_approve: true }),
        onRefresh: vi.fn<() => void>()
      })
    );

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.online).toBe(false);
    expect(result.current.feedback).toEqual({ kind: 'offline' });
    expect(mocks.review).not.toHaveBeenCalled();
  });

  it('surfaces stale conflicts and refreshes without reissuing the mutation', async () => {
    const onRefresh = vi.fn<() => void>();
    mocks.review.mockResolvedValue({
      status: 'conflict',
      code: 'stale_version',
      current_version: 2,
      current_status: 'pending'
    });
    const { result } = renderHook(() =>
      useMatchResultReview({ proposal: proposal({ can_approve: true }), onRefresh })
    );

    await act(async () => {
      await result.current.approve();
    });

    expect(result.current.feedback).toMatchObject({ kind: 'stale', version: 2, status: 'pending' });
    expect(onRefresh).toHaveBeenCalledTimes(1);
    await act(async () => {
      await result.current.retry();
    });
    expect(mocks.review).toHaveBeenCalledTimes(1);
  });

  it('serializes duplicate clicks while a request is pending', async () => {
    let resolve!: (value: ResultCommandResponse<ResultCommandReceipt>) => void;
    mocks.review.mockReturnValue(
      new Promise((done) => {
        resolve = done;
      })
    );
    const { result } = renderHook(() =>
      useMatchResultReview({
        proposal: proposal({ can_approve: true }),
        onRefresh: vi.fn<() => void>()
      })
    );

    await act(async () => {
      const first = result.current.approve();
      const duplicate = result.current.approve();
      expect(await duplicate).toBe(false);
      resolve(receipt());
      await first;
    });

    expect(mocks.review).toHaveBeenCalledTimes(1);
  });
});

describe('result freshness controller', () => {
  it('refreshes at the SSR-seeded deadline and cleans up its timer', async () => {
    vi.useFakeTimers();
    const asOf = '2026-10-03T11:59:58.000Z';
    vi.setSystemTime(new Date(asOf));
    const onRefresh = vi.fn<() => void>();
    const currentProposal = proposal();
    const { unmount } = renderHook(() =>
      useMatchResultFreshness({
        eventId: currentProposal.event_id,
        asOf,
        proposals: [currentProposal],
        onRefresh
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_030);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('coalesces focus, visibility, and online refreshes, then polls pending results', async () => {
    vi.useFakeTimers();
    visible();
    const onRefresh = vi.fn<() => void>();
    const currentProposal = proposal({ status: 'pending' });
    renderHook(() =>
      useMatchResultFreshness({
        eventId: currentProposal.event_id,
        asOf: resultProposal.submitted_at,
        proposals: [currentProposal],
        onRefresh
      })
    );

    act(() => {
      window.dispatchEvent(new Event('focus'));
      window.dispatchEvent(new Event('online'));
      document.dispatchEvent(new Event('visibilitychange'));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(onRefresh).toHaveBeenCalledTimes(1);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(RESULT_POLL_INTERVAL + 30);
    });
    expect(onRefresh).toHaveBeenCalledTimes(2);
  });

  it('does not poll terminal proposals', async () => {
    vi.useFakeTimers();
    const onRefresh = vi.fn<() => void>();
    const currentProposal = proposal({
      status: 'confirmed',
      confirmation: {
        confirmation_id: resultIds[3]!,
        source: 'AUTO_48H',
        confirmed_at: resultProposal.review_deadline_at,
        effective_at: resultProposal.review_deadline_at,
        actor_id: null
      },
      version_timeline: [
        {
          version: 1,
          status: 'confirmed',
          submitted_by: resultIds[0]!,
          submitted_by_name: 'Player',
          submitted_at: resultProposal.submitted_at,
          review_deadline_at: resultProposal.review_deadline_at,
          decisions: [],
          confirmation_id: resultIds[3]!
        }
      ]
    });
    const { unmount } = renderHook(() =>
      useMatchResultFreshness({
        eventId: currentProposal.event_id,
        asOf: resultProposal.submitted_at,
        proposals: [currentProposal],
        onRefresh
      })
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(60_000);
    });
    expect(onRefresh).not.toHaveBeenCalled();
    unmount();
  });
});

const RESULT_POLL_INTERVAL = 30_000;
