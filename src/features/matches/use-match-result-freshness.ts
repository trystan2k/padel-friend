import { useEffect, useRef } from 'react';
import type { ResultProposal } from './match-result-model';

const RESULT_POLL_INTERVAL = 30_000;
const MAX_TIMEOUT_DELAY = 2_147_000_000;

function isOnline() {
  return typeof navigator === 'undefined' || navigator.onLine;
}

export function useMatchResultFreshness({
  eventId,
  asOf,
  proposals,
  onRefresh
}: {
  eventId: string;
  asOf: string;
  proposals: ResultProposal[];
  onRefresh: () => void | Promise<void>;
}) {
  const refreshRef = useRef(onRefresh);
  useEffect(() => {
    refreshRef.current = onRefresh;
  }, [onRefresh]);
  const pending = proposals.filter((proposal) => proposal.status === 'pending');
  const pendingKey = `${eventId}:${pending
    .map((proposal) => `${proposal.proposal_id}:${proposal.version}:${proposal.review_deadline_at}`)
    .join('|')}`;
  const pendingDeadlines = pending
    .map((proposal) => Date.parse(proposal.review_deadline_at))
    .join(',');

  useEffect(() => {
    const hasPending = pendingKey !== `${eventId}:`;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    let debounceTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const refresh = () => {
      if (disposed || !isOnline()) return;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        if (disposed || !isOnline()) return;
        try {
          void Promise.resolve(refreshRef.current()).catch(() => undefined);
        } catch {
          // A later scheduled refresh retries the authoritative read.
        }
      }, 30);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    const poll = () => {
      if (!hasPending) return;
      pollTimer = setTimeout(() => {
        if (disposed) return;
        if (document.visibilityState === 'visible') refresh();
        poll();
      }, RESULT_POLL_INTERVAL);
    };

    const elapsedSinceSeed = () => Math.max(0, performance.now() - seedObservedAt);
    const seedTime = Date.parse(asOf);
    const seedObservedAt = performance.now();
    const refreshAtDeadline = () => {
      if (!hasPending) return;
      const nearestDeadline = Math.min(...pendingDeadlines.split(',').map(Number));
      const remaining = nearestDeadline - (seedTime + elapsedSinceSeed());
      if (remaining <= 0) {
        refresh();
        return;
      }
      deadlineTimer = setTimeout(refreshAtDeadline, Math.min(remaining, MAX_TIMEOUT_DELAY));
    };

    if (hasPending) {
      refreshAtDeadline();
      poll();
    }
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    document.addEventListener('visibilitychange', onVisibilityChange);
    return () => {
      disposed = true;
      if (pollTimer) clearTimeout(pollTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (debounceTimer) clearTimeout(debounceTimer);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [asOf, eventId, pendingDeadlines, pendingKey]);
}
