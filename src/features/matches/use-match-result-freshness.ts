import { useEffect, useRef } from 'react';
import { useAuthoritativeRefresh } from '../../lib/use-authoritative-refresh';
import type { ResultProposal } from './match-result-model';

const MAX_TIMEOUT_DELAY = 2_147_000_000;

/**
 * Keeps the result lifecycle converged: the shared authoritative refresh covers proposals,
 * reviews and confirmations from other clients, and a deadline timer anchored to the server's
 * `asOf` triggers one extra read when a review deadline passes. The timer only reads; the trusted
 * server processor owns the scheduled confirmation.
 */
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
  const { refreshNow } = useAuthoritativeRefresh({
    scope: `result:${eventId}`,
    refresh: async () => {
      await onRefresh();
    }
  });
  // A passed deadline triggers one read; the cadence keeps polling until the server settles it.
  const firedDeadline = useRef<string | null>(null);
  const pendingDeadlines = proposals
    .filter((proposal) => proposal.status === 'pending')
    .map((proposal) => Date.parse(proposal.review_deadline_at))
    .join(',');

  useEffect(() => {
    if (!pendingDeadlines) return undefined;
    let deadlineTimer: ReturnType<typeof setTimeout> | null = null;
    const seedTime = Date.parse(asOf);
    const seedObservedAt = performance.now();
    const refreshAtDeadline = () => {
      const nearestDeadline = Math.min(...pendingDeadlines.split(',').map(Number));
      const remaining =
        nearestDeadline - (seedTime + Math.max(0, performance.now() - seedObservedAt));
      if (remaining <= 0) {
        if (firedDeadline.current === `${eventId}:${nearestDeadline}`) return;
        firedDeadline.current = `${eventId}:${nearestDeadline}`;
        refreshNow();
        return;
      }
      deadlineTimer = setTimeout(refreshAtDeadline, Math.min(remaining, MAX_TIMEOUT_DELAY));
    };
    refreshAtDeadline();
    return () => {
      if (deadlineTimer) clearTimeout(deadlineTimer);
    };
  }, [asOf, eventId, pendingDeadlines, refreshNow]);
}
