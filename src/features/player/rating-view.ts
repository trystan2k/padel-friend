import { getMyRatingHistory, getMyRatingProgress, getMyRatingSummary } from './rating.functions';
import type {
  RatingErrorCode,
  RatingHistoryView,
  RatingProgress,
  RatingSummaryResult
} from './rating-contracts';

export const RATING_HISTORY_PAGE_SIZE = 10;
const MAX_ATTEMPTS = 2;

/** Everything the profile shows about ratings, read from one committed projection revision. */
export type RatingView = {
  status: 'ok';
  revision: number;
  summary: RatingSummaryResult;
  progress: RatingProgress;
  history: RatingHistoryView;
};
export type RatingLoad = RatingView | { status: 'error'; code: RatingErrorCode };

/** A thrown server function means a lost session or a transport failure, never empty data. */
export function ratingFailureCode(cause: unknown): RatingErrorCode {
  return cause instanceof Error && cause.message === 'UNAUTHENTICATED'
    ? 'unauthenticated'
    : 'unavailable';
}

async function attempt(): Promise<RatingLoad & { retryable?: boolean }> {
  const [summary, progress, history] = await Promise.all([
    getMyRatingSummary(),
    getMyRatingProgress({ data: {} }),
    getMyRatingHistory({ data: { limit: RATING_HISTORY_PAGE_SIZE } })
  ]);
  if (summary.status === 'error') return summary;
  if (progress.status === 'error') return progress;
  if (history.status === 'error') return history;
  const revision = summary.value.revision;
  if (progress.value.revision !== revision || history.value.revision !== revision)
    return { status: 'error', code: 'stale_revision', retryable: true };
  return {
    status: 'ok',
    revision,
    summary: summary.value,
    progress: progress.value,
    history: history.value
  };
}

/**
 * Reads summary, progress and the first history page. A projection that moved between the
 * three reads is retried once; mixed revisions are never rendered together. Failures become
 * an explicit error state so the profile still loads and never shows a fake empty history.
 */
export async function loadRatingView(): Promise<RatingLoad> {
  let last: RatingLoad = { status: 'error', code: 'unavailable' };
  for (let tries = 0; tries < MAX_ATTEMPTS; tries++) {
    try {
      const { retryable, ...result } = await attempt();
      if (!retryable) return result;
      last = result;
    } catch (cause) {
      return { status: 'error', code: ratingFailureCode(cause) };
    }
  }
  return last;
}
