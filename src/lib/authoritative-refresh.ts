/** Cadence of the visible-online authoritative re-read: converges two active clients inside the 5 s budget. */
export const REFRESH_INTERVAL_MS = 3_000;
/** Ceiling of the error backoff: a failing reader is retried at most this far apart. */
export const REFRESH_MAX_INTERVAL_MS = 30_000;

/**
 * `idle` before the first outcome, `fresh` after a successful read, `stale` while reads fail
 * (backing off), `paused` while hidden/offline, `stopped` after an authentication failure.
 */
export type RefreshStatus = 'idle' | 'fresh' | 'stale' | 'paused' | 'stopped';

export type RefreshContext = {
  /** False once this read's scope was stopped or replaced: its result must be discarded. */
  isCurrent: () => boolean;
};

export type RefreshLoopOptions = {
  refresh: (context: RefreshContext) => Promise<unknown>;
  intervalMs?: number;
  maxIntervalMs?: number;
  /** A fatal failure (expired session) stops the loop instead of retrying forever. */
  isFatal?: (error: unknown) => boolean;
  onStatus?: (status: RefreshStatus) => void;
  onFatal?: (error: unknown) => void;
};

export type RefreshLoop = {
  start: () => void;
  stop: () => void;
  /** Runs a read now (single-flight): used when a deadline passes, never to write. */
  refreshNow: () => void;
};

/** The session-expiry signal every authenticated server function throws. */
export function isUnauthenticatedError(error: unknown) {
  return error instanceof Error && error.message === 'UNAUTHENTICATED';
}

export function backoffDelay(intervalMs: number, maxIntervalMs: number, failures: number) {
  return Math.min(intervalMs * 2 ** Math.max(0, failures), maxIntervalMs);
}

function isActive() {
  return (
    document.visibilityState === 'visible' && (typeof navigator === 'undefined' || navigator.onLine)
  );
}

/**
 * Framework-free scheduler behind `useAuthoritativeRefresh`. One loop is one scope: it never runs
 * two reads at once (a request arriving mid-flight becomes at most one trailing read), pauses while
 * hidden or offline, re-reads immediately on focus/online/visibility return, backs off while reads
 * fail, and drops the result of any read that outlived `stop()`.
 */
export function createRefreshLoop({
  refresh,
  intervalMs = REFRESH_INTERVAL_MS,
  maxIntervalMs = REFRESH_MAX_INTERVAL_MS,
  isFatal = isUnauthenticatedError,
  onStatus,
  onFatal
}: RefreshLoopOptions): RefreshLoop {
  let generation = 0;
  let started = false;
  let running = false;
  let trailing = false;
  let failures = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let status: RefreshStatus = 'idle';

  const setStatus = (next: RefreshStatus) => {
    if (next === status) return;
    status = next;
    onStatus?.(next);
  };
  const clearTimer = () => {
    if (timer) clearTimeout(timer);
    timer = null;
  };

  const schedule = () => {
    clearTimer();
    if (!started) return;
    if (!isActive()) {
      setStatus('paused');
      return;
    }
    timer = setTimeout(
      () => {
        timer = null;
        void run();
      },
      backoffDelay(intervalMs, maxIntervalMs, failures)
    );
  };

  const run = async () => {
    if (!started) return;
    if (!isActive()) {
      clearTimer();
      setStatus('paused');
      return;
    }
    if (running) {
      trailing = true;
      return;
    }
    clearTimer();
    running = true;
    trailing = false;
    const mine = generation;
    const isCurrent = () => started && mine === generation;
    let fatal: unknown = null;
    let failed = false;
    try {
      await refresh({ isCurrent });
    } catch (error) {
      if (isFatal(error)) fatal = error;
      failed = true;
    }
    // stop() already reset the flags: a late result of a retired scope changes nothing.
    if (!isCurrent()) return;
    running = false;
    if (fatal !== null) {
      stop();
      setStatus('stopped');
      onFatal?.(fatal);
      return;
    }
    failures = failed ? failures + 1 : 0;
    setStatus(failed ? 'stale' : 'fresh');
    if (trailing) {
      trailing = false;
      void run();
      return;
    }
    schedule();
  };

  const wake = () => {
    if (isActive()) void run();
  };
  const sleep = () => {
    clearTimer();
    setStatus('paused');
  };
  const onVisibility = () => (document.visibilityState === 'visible' ? wake() : sleep());

  function stop() {
    if (!started) return;
    started = false;
    generation += 1;
    running = false;
    trailing = false;
    clearTimer();
    window.removeEventListener('focus', wake);
    window.removeEventListener('online', wake);
    window.removeEventListener('offline', sleep);
    document.removeEventListener('visibilitychange', onVisibility);
  }

  return {
    start() {
      if (started) return;
      started = true;
      failures = 0;
      window.addEventListener('focus', wake);
      window.addEventListener('online', wake);
      window.addEventListener('offline', sleep);
      document.addEventListener('visibilitychange', onVisibility);
      schedule();
    },
    stop,
    refreshNow: wake
  };
}
