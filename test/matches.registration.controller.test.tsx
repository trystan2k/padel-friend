/** @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { MyMatchRegistration } from '../src/features/matches/match-registration-model';

const mocks = vi.hoisted(() => ({
  submit: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  decide: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  invalidate: vi.fn<() => Promise<void>>()
}));

vi.mock('../src/features/matches/match-registration.functions', () => ({
  submitMatchRegistration: mocks.submit,
  decideMatchRegistration: mocks.decide,
  getMyMatchRegistration: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  listMatchEventRegistrationRequests: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  useRouter: () => ({ invalidate: mocks.invalidate }),
  Link: ({ children }: { children: import('react').ReactNode }) => children
}));

import {
  useMatchRegistration,
  useMatchRequestQueue
} from '../src/features/matches/use-match-registration';

const EVENT_ID = '00000000-0000-4000-8000-000000000001';
const OTHER_EVENT_ID = '00000000-0000-4000-8000-000000000002';
const ATTEMPT_ID = '00000000-0000-4000-8000-0000000000a1';

const none: MyMatchRegistration = { state: 'none' };

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.invalidate.mockResolvedValue(undefined);
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('useMatchRegistration controller', () => {
  it('reports success and invalidates the router after a direct join', async () => {
    mocks.submit.mockResolvedValue({ status: 'accepted', registration: {} });
    const { result } = renderHook(() =>
      useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none })
    );
    await act(async () => {
      result.current.submit();
    });
    expect(result.current.feedback).toEqual({ kind: 'accepted' });
    expect(result.current.pending).toBe(false);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('refreshes authoritative state on a conflict but not on a generic failure', async () => {
    mocks.submit.mockResolvedValueOnce({ status: 'error', code: 'full' });
    const { result } = renderHook(() =>
      useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none })
    );
    await act(async () => {
      result.current.submit();
    });
    expect(result.current.feedback).toEqual({ kind: 'error', code: 'full' });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);

    mocks.submit.mockResolvedValueOnce({ status: 'error', code: 'unavailable' });
    await act(async () => {
      result.current.submit();
    });
    expect(result.current.feedback).toEqual({ kind: 'error', code: 'unavailable' });
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('retries the last failed action and then refreshes', async () => {
    mocks.submit
      .mockResolvedValueOnce({ status: 'error', code: 'unavailable' })
      .mockResolvedValueOnce({ status: 'pending', registration: {} });
    const { result } = renderHook(() =>
      useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none })
    );
    await act(async () => {
      result.current.submit();
    });
    expect(result.current.feedback).toEqual({ kind: 'error', code: 'unavailable' });
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.feedback).toEqual({ kind: 'pending' });
    expect(mocks.submit).toHaveBeenCalledTimes(2);
    expect(mocks.invalidate).toHaveBeenCalledTimes(1);
  });

  it('guards against a local double submit while a request is in flight', async () => {
    const first = deferred<unknown>();
    mocks.submit.mockReturnValue(first.promise);
    const { result } = renderHook(() =>
      useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none })
    );
    act(() => {
      result.current.submit();
      result.current.submit();
    });
    expect(mocks.submit).toHaveBeenCalledTimes(1);
    expect(result.current.pending).toBe(true);
    await act(async () => {
      first.resolve({ status: 'accepted', registration: {} });
      await first.promise;
    });
    expect(result.current.pending).toBe(false);
  });

  it('refuses to call the server while offline and surfaces explicit feedback', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    const { result } = renderHook(() =>
      useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none })
    );
    await waitFor(() => expect(result.current.online).toBe(false));
    act(() => {
      result.current.submit();
    });
    expect(mocks.submit).not.toHaveBeenCalled();
    expect(result.current.feedback).toEqual({ kind: 'offline' });
  });

  it('clears stale feedback when the event changes', async () => {
    mocks.submit.mockResolvedValue({ status: 'accepted', registration: {} });
    const { result, rerender } = renderHook(
      ({ eventId }: { eventId: string }) =>
        useMatchRegistration({ eventId, initialRegistration: none }),
      { initialProps: { eventId: EVENT_ID } }
    );
    await act(async () => {
      result.current.submit();
    });
    expect(result.current.feedback).toEqual({ kind: 'accepted' });
    rerender({ eventId: OTHER_EVENT_ID });
    expect(result.current.feedback).toBeNull();
  });

  it('adopts refreshed loader registration and revalidates at the cutoff', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
    const initialRegistration: { registration: MyMatchRegistration } = { registration: none };
    const { result, rerender } = renderHook(
      ({ registration }: { registration: MyMatchRegistration }) =>
        useMatchRegistration({
          eventId: EVENT_ID,
          initialRegistration: registration,
          cutoffAt: '2026-10-18T10:00:30.000Z'
        }),
      { initialProps: initialRegistration }
    );
    expect(result.current.cutoffReached).toBe(false);
    const refreshed: MyMatchRegistration = {
      state: 'pending',
      event_id: EVENT_ID,
      registration_source: 'member',
      requested_at: '2026-10-18T09:30:00.000Z'
    };
    rerender({ registration: refreshed });
    expect(result.current.registration).toEqual(refreshed);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(result.current.cutoffReached).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('keeps registration open for a cutoff beyond the browser timer range', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-18T10:00:00.000Z'));
    // Browsers clamp a timer delay above 2^31-1 ms to 0, which fires the timer
    // immediately; reproduce that contract so an overflow regression is visible.
    const realSetTimeout = globalThis.setTimeout;
    const requestedDelays: number[] = [];
    vi.stubGlobal(
      'setTimeout',
      (handler: (...args: unknown[]) => void, timeout?: number, ...rest: unknown[]) => {
        const requested = timeout ?? 0;
        requestedDelays.push(requested);
        return realSetTimeout(handler, requested > 2_147_483_647 ? 0 : requested, ...rest);
      }
    );

    const cutoffAt = '2026-11-20T10:00:00.000Z'; // ~33 days out, beyond the timer range
    const { result } = renderHook(() =>
      useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none, cutoffAt })
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(result.current.cutoffReached).toBe(false);

    // Every scheduled delay stays inside the browser timer range.
    expect(requestedDelays.every((delay) => delay <= 2_147_483_647)).toBe(true);

    // A single bounded segment must not be treated as the cutoff.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2_147_483_647);
    });
    expect(result.current.cutoffReached).toBe(false);
    expect(mocks.invalidate).not.toHaveBeenCalled();

    // Only the real deadline closes registration.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Date.parse(cutoffAt) - Date.now());
    });
    expect(result.current.cutoffReached).toBe(true);
    expect(mocks.invalidate).toHaveBeenCalled();
  });

  it('refreshes on focus return', async () => {
    renderHook(() => useMatchRegistration({ eventId: EVENT_ID, initialRegistration: none }));
    act(() => {
      window.dispatchEvent(new Event('focus'));
    });
    await waitFor(() => expect(mocks.invalidate).toHaveBeenCalled());
  });
});

describe('useMatchRequestQueue controller', () => {
  it('approves, rejects and refreshes on conflict', async () => {
    const { result } = renderHook(() => useMatchRequestQueue({ eventId: EVENT_ID }));
    mocks.decide.mockResolvedValueOnce({ status: 'approved', replayed: false, registration: {} });
    await act(async () => {
      result.current.decide(ATTEMPT_ID, 'approve');
    });
    expect(result.current.feedback).toEqual({ kind: 'approved', replayed: false });
    expect(result.current.decidingAttemptId).toBeNull();

    mocks.decide.mockResolvedValueOnce({ status: 'rejected', replayed: false, registration: {} });
    await act(async () => {
      result.current.decide(ATTEMPT_ID, 'reject');
    });
    expect(result.current.feedback).toEqual({ kind: 'rejected', replayed: false });

    mocks.decide.mockResolvedValueOnce({ status: 'error', code: 'full' });
    await act(async () => {
      result.current.decide(ATTEMPT_ID, 'approve');
    });
    expect(result.current.feedback).toEqual({ kind: 'error', code: 'full' });
    // approve success, reject success and the full conflict each refresh.
    expect(mocks.invalidate).toHaveBeenCalledTimes(3);
  });

  it('retries the last decision after a generic failure', async () => {
    mocks.decide
      .mockResolvedValueOnce({ status: 'error', code: 'unavailable' })
      .mockResolvedValueOnce({ status: 'approved', replayed: true, registration: {} });
    const { result } = renderHook(() => useMatchRequestQueue({ eventId: EVENT_ID }));
    await act(async () => {
      result.current.decide(ATTEMPT_ID, 'approve');
    });
    expect(result.current.feedback).toEqual({ kind: 'error', code: 'unavailable' });
    await act(async () => {
      result.current.retry();
    });
    expect(result.current.feedback).toEqual({ kind: 'approved', replayed: true });
    expect(mocks.decide).toHaveBeenCalledTimes(2);
  });

  it('guards against a double decision and blocks offline decisions', async () => {
    const first = deferred<unknown>();
    mocks.decide.mockReturnValue(first.promise);
    const { result } = renderHook(() => useMatchRequestQueue({ eventId: EVENT_ID }));
    act(() => {
      result.current.decide(ATTEMPT_ID, 'approve');
      result.current.decide(ATTEMPT_ID, 'reject');
    });
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(result.current.decidingAttemptId).toBe(ATTEMPT_ID);
    await act(async () => {
      first.resolve({ status: 'approved', replayed: false, registration: {} });
      await first.promise;
    });

    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    act(() => {
      window.dispatchEvent(new Event('offline'));
    });
    await waitFor(() => expect(result.current.online).toBe(false));
    act(() => {
      result.current.decide(ATTEMPT_ID, 'approve');
    });
    expect(mocks.decide).toHaveBeenCalledTimes(1);
    expect(result.current.feedback).toEqual({ kind: 'offline' });
  });
});
