/** @vitest-environment jsdom */
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  backoffDelay,
  createRefreshLoop,
  isUnauthenticatedError,
  REFRESH_INTERVAL_MS,
  REFRESH_MAX_INTERVAL_MS,
  type RefreshContext,
  type RefreshStatus
} from '../src/lib/authoritative-refresh';
import { useAuthoritativeRefresh } from '../src/lib/use-authoritative-refresh';

function deferred() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function setVisibility(value: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value });
  document.dispatchEvent(new Event('visibilitychange'));
}

function setOnline(value: boolean) {
  Object.defineProperty(navigator, 'onLine', { configurable: true, value });
  window.dispatchEvent(new Event(value ? 'online' : 'offline'));
}

beforeEach(() => {
  vi.useFakeTimers();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe('backoffDelay', () => {
  it('doubles per failure and never exceeds the ceiling', () => {
    expect(backoffDelay(3_000, 30_000, 0)).toBe(3_000);
    expect(backoffDelay(3_000, 30_000, 1)).toBe(6_000);
    expect(backoffDelay(3_000, 30_000, 3)).toBe(24_000);
    expect(backoffDelay(3_000, 30_000, 4)).toBe(30_000);
    expect(backoffDelay(3_000, 30_000, 99)).toBe(30_000);
  });
});

describe('isUnauthenticatedError', () => {
  it('matches only the session-expiry signal', () => {
    expect(isUnauthenticatedError(new Error('UNAUTHENTICATED'))).toBe(true);
    expect(isUnauthenticatedError(new Error('other'))).toBe(false);
    expect(isUnauthenticatedError('UNAUTHENTICATED')).toBe(false);
  });
});

describe('refresh loop scheduling', () => {
  it('reads on the cadence only after start and stops cleanly', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
    const loop = createRefreshLoop({ refresh });
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();

    loop.start();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS - 1);
    expect(refresh).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);

    loop.stop();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 5);
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it('keeps one read in flight and coalesces a burst into a single trailing read', async () => {
    const gates = [deferred(), deferred(), deferred()];
    const refresh = vi.fn<() => Promise<void>>();
    for (const gate of gates) refresh.mockReturnValueOnce(gate.promise);
    const loop = createRefreshLoop({ refresh });
    loop.start();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);

    // A slow read: ticks and a burst of wake events add no concurrent read.
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('online'));
    loop.refreshNow();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
    expect(refresh).toHaveBeenCalledTimes(1);

    gates[0]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    gates[1]!.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // The burst produced exactly one trailing read, not one per event.
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });

  it('pauses while hidden or offline and reads immediately on return', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
    const statuses: RefreshStatus[] = [];
    const loop = createRefreshLoop({ refresh, onStatus: (status) => statuses.push(status) });
    loop.start();

    setVisibility('hidden');
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 4);
    expect(refresh).not.toHaveBeenCalled();
    setVisibility('visible');
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(1);

    setOnline(false);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('paused');
    setOnline(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(2);
    expect(statuses.at(-1)).toBe('fresh');

    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).toHaveBeenCalledTimes(3);
    loop.stop();
  });

  it('does not read on a focus event while the page is hidden', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockResolvedValue();
    const loop = createRefreshLoop({ refresh });
    loop.start();
    Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(0);
    expect(refresh).not.toHaveBeenCalled();
    loop.stop();
  });

  it('backs off while reads fail, flags stale, and restores the cadence after success', async () => {
    const statuses: RefreshStatus[] = [];
    const refresh = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue();
    const loop = createRefreshLoop({ refresh, onStatus: (status) => statuses.push(status) });
    loop.start();

    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('stale');
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2 - 1);
    expect(refresh).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(refresh).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 4);
    expect(refresh).toHaveBeenCalledTimes(3);
    expect(statuses.at(-1)).toBe('fresh');
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(4);
    loop.stop();
  });

  it('never backs off beyond the ceiling', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('network'));
    const loop = createRefreshLoop({ refresh });
    loop.start();
    await vi.advanceTimersByTimeAsync(REFRESH_MAX_INTERVAL_MS * 10);
    const calls = refresh.mock.calls.length;
    await vi.advanceTimersByTimeAsync(REFRESH_MAX_INTERVAL_MS);
    expect(refresh.mock.calls.length).toBe(calls + 1);
    loop.stop();
  });

  it('stops for good on an authentication failure instead of retrying', async () => {
    const onFatal = vi.fn<(error: unknown) => void>();
    const statuses: RefreshStatus[] = [];
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValue(new Error('UNAUTHENTICATED'));
    const loop = createRefreshLoop({
      refresh,
      onFatal,
      onStatus: (status) => statuses.push(status)
    });
    loop.start();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(onFatal).toHaveBeenCalledTimes(1);
    expect(statuses.at(-1)).toBe('stopped');
    expect(vi.getTimerCount()).toBe(0);
    window.dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 10);
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it('discards the late result of a retired scope and starts clean afterwards', async () => {
    const gate = deferred();
    const contexts: RefreshContext[] = [];
    const statuses: RefreshStatus[] = [];
    const refresh = vi
      .fn<(context: RefreshContext) => Promise<void>>()
      .mockImplementationOnce((context) => {
        contexts.push(context);
        return gate.promise;
      })
      .mockResolvedValue();
    const loop = createRefreshLoop({ refresh, onStatus: (status) => statuses.push(status) });
    loop.start();
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(contexts[0]!.isCurrent()).toBe(true);

    loop.stop();
    loop.start();
    expect(contexts[0]!.isCurrent()).toBe(false);
    gate.resolve();
    await vi.advanceTimersByTimeAsync(0);
    // The old read neither marks the new scope fresh nor blocks its next read.
    expect(statuses).toEqual([]);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    expect(refresh).toHaveBeenCalledTimes(2);
    loop.stop();
  });
});

describe('useAuthoritativeRefresh', () => {
  it('starts after mount, uses the latest callback and cleans up on unmount', async () => {
    const first = vi.fn<() => Promise<void>>().mockResolvedValue();
    const second = vi.fn<() => Promise<void>>().mockResolvedValue();
    const { rerender, unmount } = renderHook(
      ({ refresh }) => useAuthoritativeRefresh({ scope: 'a', refresh }),
      { initialProps: { refresh: first } }
    );
    rerender({ refresh: second });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledTimes(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 3);
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('retires the old scope on an account or community switch and drops its late result', async () => {
    const gate = deferred();
    const seen: Array<{ scope: string; current: boolean }> = [];
    const results: string[] = [];
    const { rerender, result } = renderHook(
      ({ scope }) =>
        useAuthoritativeRefresh({
          scope,
          refresh: async (context) => {
            if (scope === 'user-a') await gate.promise;
            seen.push({ scope, current: context.isCurrent() });
            if (context.isCurrent()) results.push(scope);
          }
        }),
      { initialProps: { scope: 'user-a' } }
    );
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });

    rerender({ scope: 'user-b' });
    expect(result.current.status).toBe('idle');
    await act(async () => {
      gate.resolve();
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(seen).toEqual([{ scope: 'user-a', current: false }]);
    expect(results).toEqual([]);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });
    expect(results).toEqual(['user-b']);
    expect(result.current.status).toBe('fresh');
  });

  it('does nothing while disabled and reports stale then fatal states', async () => {
    const refresh = vi.fn<() => Promise<void>>().mockRejectedValueOnce(new Error('network'));
    const onFatal = vi.fn<(error: unknown) => void>();
    const { rerender, result } = renderHook(
      ({ enabled }) => useAuthoritativeRefresh({ scope: 'x', refresh, enabled, onFatal }),
      { initialProps: { enabled: false } }
    );
    await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    expect(refresh).not.toHaveBeenCalled();

    rerender({ enabled: true });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS);
    });
    expect(result.current.status).toBe('stale');

    refresh.mockRejectedValue(new Error('UNAUTHENTICATED'));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REFRESH_INTERVAL_MS * 2);
    });
    expect(result.current.status).toBe('stopped');
    expect(onFatal).toHaveBeenCalledTimes(1);
  });
});
