import { useRouter } from '@tanstack/react-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { decideMatchRegistration, submitMatchRegistration } from './match-registration.functions';
import type { MatchRegistrationErrorCode, MyMatchRegistration } from './match-registration-model';
import type { MatchRegistrationDecision } from './match-registration.validators';

// PAF-5.5 mutation controller for the registration surface.
//
// It owns pending/error/offline/retry state, local double-submit protection
// (which still trusts the DB constraints: every conflict re-reads authoritative
// state), router invalidation after success or conflict, stale-feedback clearing
// when the event changes, focus/return refresh and the cutoff-boundary refresh.
// It deliberately does not do optimistic Playing assignment, realtime
// subscription or global caching; the later realtime unit adds those at the
// feature boundary.

/** Result feedback surfaced after the caller's own submit action. */
export type MatchRegistrationFeedback =
  | { kind: 'accepted' }
  | { kind: 'pending' }
  | { kind: 'error'; code: MatchRegistrationErrorCode }
  | { kind: 'offline' };

/** Result feedback surfaced after a creator decision. */
export type MatchRequestQueueFeedback =
  | { kind: 'approved'; replayed: boolean }
  | { kind: 'rejected'; replayed: boolean }
  | { kind: 'error'; code: MatchRegistrationErrorCode }
  | { kind: 'offline' };

// A conflict means the client's view is stale; refreshing authoritative counts
// is mandatory. A generic failure leaves the view untouched for an explicit retry.
const CONFLICT_CODES: ReadonlySet<MatchRegistrationErrorCode> = new Set([
  'duplicate',
  'pending_duplicate',
  'full',
  'closed',
  'already_resolved',
  'not_found',
  'requester_ineligible',
  'invite_only'
]);

// Largest delay a browser timer accepts; anything above it overflows the 32-bit
// timer range and fires immediately, so the cutoff deadline is polled in
// segments of at most this length.
const MAX_TIMER_DELAY = 2 ** 31 - 1;

function isOnlineNow() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

function useConnectivity() {
  const [online, setOnline] = useState(true);
  const onlineRef = useRef(true);
  useEffect(() => {
    const update = () => {
      const value = isOnlineNow();
      onlineRef.current = value;
      setOnline(value);
    };
    queueMicrotask(update);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);
  return { online, onlineRef };
}

// Shared invalidation adapter. The router reference is refreshed in an effect so
// the stable callback always targets the live router without re-subscribing.
function useInvalidate() {
  const router = useRouter();
  const routerRef = useRef(router);
  useEffect(() => {
    routerRef.current = router;
  }, [router]);
  return useCallback(async () => {
    try {
      await routerRef.current.invalidate();
    } catch {
      // Refresh is best effort; the next focus/cutoff tick retries it.
    }
  }, []);
}

export function useMatchRegistration({
  eventId,
  initialRegistration,
  cutoffAt = null
}: {
  eventId: string;
  initialRegistration: MyMatchRegistration;
  cutoffAt?: string | null;
}) {
  const invalidate = useInvalidate();
  const { online, onlineRef } = useConnectivity();
  const [state, setState] = useState({
    eventId,
    source: initialRegistration,
    registration: initialRegistration
  });
  const [pending, setPending] = useState(false);
  const [feedback, setFeedback] = useState<{
    eventId: string;
    value: MatchRegistrationFeedback;
  } | null>(null);
  const [cutoff, setCutoff] = useState({ eventId, reached: false });
  const pendingRef = useRef(false);
  const lastAction = useRef<{ eventId: string; run: () => void } | null>(null);
  const mounted = useRef(true);

  // Adopt the loader's fresh registration (after invalidation) or a different
  // event, without an effect round-trip that would flash stale content.
  if (state.eventId !== eventId || state.source !== initialRegistration) {
    setState({ eventId, source: initialRegistration, registration: initialRegistration });
  }
  if (cutoff.eventId !== eventId) setCutoff({ eventId, reached: false });
  const registration = state.registration;
  const currentFeedback = feedback && feedback.eventId === eventId ? feedback.value : null;
  const cutoffReached = cutoff.reached;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  // Refresh on return/focus/visibility, matching the repo's notification badge
  // pattern; debounced so a burst of focus events collapses into one reload.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void invalidate(), 30);
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') schedule();
    };
    window.addEventListener('focus', schedule);
    window.addEventListener('online', schedule);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('focus', schedule);
      window.removeEventListener('online', schedule);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [invalidate]);

  // Cutoff-boundary refresh: an open screen revalidates with the server exactly
  // at the cutoff so the closed state is never decided by a stale client clock.
  // PAF-5 review F22: a delay beyond 2^31−1 ms (~24.8 days) overflows browser
  // timers and fires immediately, which would close an event that is still far in
  // the future. The deadline is therefore polled in bounded segments, and the
  // cutoff is only marked reached after the real deadline is checked against the
  // clock.
  useEffect(() => {
    const target = cutoffAt ? Date.parse(cutoffAt) : Number.NaN;
    if (!Number.isFinite(target)) return undefined;

    const initialRemaining = target - Date.now();
    let timer: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const check = () => {
      if (cancelled) return;
      const remaining = target - Date.now();
      if (remaining <= 0) {
        setCutoff((current) =>
          current.eventId === eventId ? { eventId, reached: true } : current
        );
        if (initialRemaining > 0) void invalidate();
        return;
      }
      timer = setTimeout(check, Math.min(remaining, MAX_TIMER_DELAY));
    };

    check();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [cutoffAt, eventId, invalidate]);

  const submitAction = useCallback(async () => {
    if (pendingRef.current) return;
    if (!onlineRef.current || !isOnlineNow()) {
      setFeedback({ eventId, value: { kind: 'offline' } });
      return;
    }
    pendingRef.current = true;
    setPending(true);
    try {
      const result = await submitMatchRegistration({ data: { event_id: eventId } });
      if (!mounted.current) return;
      if (result.status === 'accepted') setFeedback({ eventId, value: { kind: 'accepted' } });
      else if (result.status === 'pending') setFeedback({ eventId, value: { kind: 'pending' } });
      else setFeedback({ eventId, value: { kind: 'error', code: result.code } });
      if (result.status !== 'error' || CONFLICT_CODES.has(result.code)) await invalidate();
    } catch {
      if (mounted.current) setFeedback({ eventId, value: { kind: 'error', code: 'unavailable' } });
    } finally {
      pendingRef.current = false;
      if (mounted.current) setPending(false);
    }
  }, [eventId, invalidate, onlineRef]);

  const submit = useCallback(() => {
    lastAction.current = { eventId, run: () => void submitAction() };
    void submitAction();
  }, [eventId, submitAction]);

  const retry = useCallback(() => {
    const last = lastAction.current;
    if (last && last.eventId === eventId) last.run();
  }, [eventId]);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  return {
    registration,
    pending,
    online,
    feedback: currentFeedback,
    cutoffReached,
    submit,
    retry,
    clearFeedback
  };
}

export function useMatchRequestQueue({ eventId }: { eventId: string }) {
  const invalidate = useInvalidate();
  const { online, onlineRef } = useConnectivity();
  const [pending, setPending] = useState(false);
  const [decidingAttemptId, setDecidingAttemptId] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{
    eventId: string;
    value: MatchRequestQueueFeedback;
  } | null>(null);
  const pendingRef = useRef(false);
  const lastAction = useRef<{ eventId: string; run: () => void } | null>(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const decideAction = useCallback(
    async (attemptId: string, decision: MatchRegistrationDecision) => {
      if (pendingRef.current) return;
      if (!onlineRef.current || !isOnlineNow()) {
        setFeedback({ eventId, value: { kind: 'offline' } });
        return;
      }
      pendingRef.current = true;
      setPending(true);
      setDecidingAttemptId(attemptId);
      try {
        const result = await decideMatchRegistration({
          data: { event_id: eventId, attempt_id: attemptId, decision }
        });
        if (!mounted.current) return;
        if (result.status === 'approved')
          setFeedback({ eventId, value: { kind: 'approved', replayed: result.replayed } });
        else if (result.status === 'rejected')
          setFeedback({ eventId, value: { kind: 'rejected', replayed: result.replayed } });
        else setFeedback({ eventId, value: { kind: 'error', code: result.code } });
        if (result.status !== 'error' || CONFLICT_CODES.has(result.code)) await invalidate();
      } catch {
        if (mounted.current)
          setFeedback({ eventId, value: { kind: 'error', code: 'unavailable' } });
      } finally {
        pendingRef.current = false;
        if (mounted.current) {
          setPending(false);
          setDecidingAttemptId(null);
        }
      }
    },
    [eventId, invalidate, onlineRef]
  );

  const decide = useCallback(
    (attemptId: string, decision: MatchRegistrationDecision) => {
      lastAction.current = { eventId, run: () => void decideAction(attemptId, decision) };
      void decideAction(attemptId, decision);
    },
    [eventId, decideAction]
  );

  const retry = useCallback(() => {
    const last = lastAction.current;
    if (last && last.eventId === eventId) last.run();
  }, [eventId]);

  const clearFeedback = useCallback(() => setFeedback(null), []);

  return {
    pending,
    decidingAttemptId,
    online,
    feedback: feedback && feedback.eventId === eventId ? feedback.value : null,
    decide,
    retry,
    clearFeedback
  };
}
