import { getMyRatingSummary } from '../player/rating.functions';
import { isUuid, type RatingErrorCode } from '../player/rating-contracts';
import { ratingFailureCode } from '../player/rating-view';
import type {
  LevelReviewDto,
  LevelReviewErrorCode,
  LevelReviewListResult
} from './level-review-contracts';
import { levelReviewErrorCode } from './level-review-errors';
import {
  cancelLevelReviewRequest,
  getMyLevelReviewRequest,
  listMyLevelReviewRequests
} from './level-review.functions';

export const LEVEL_REVIEW_HISTORY_PAGE_SIZE = 20;

/** Loaders return data or an explicit error code; a denial or outage is never an empty list. */
export type LevelReviewLoad<T> =
  | { status: 'ok'; value: T }
  | { status: 'error'; code: LevelReviewErrorCode };

export type LevelReviewCurrent = { display_level: number; reliability_percent: number };
/** current is null when the player has no rating row yet (not onboarded). */
export type CurrentLevelLoad =
  | { status: 'ok'; current: LevelReviewCurrent | null }
  | { status: 'error'; code: RatingErrorCode };

async function read<T>(call: () => Promise<T>): Promise<LevelReviewLoad<T>> {
  try {
    return { status: 'ok', value: await call() };
  } catch (cause) {
    return { status: 'error', code: levelReviewErrorCode(cause) };
  }
}

/** The server-owned current level and reliability, read from the committed rating summary. */
export async function loadCurrentLevel(): Promise<CurrentLevelLoad> {
  try {
    const response = await getMyRatingSummary();
    if (response.status === 'error') return response;
    const summary = response.value.summary;
    return {
      status: 'ok',
      current: summary
        ? {
            display_level: summary.display_level,
            reliability_percent: summary.reliability_percent
          }
        : null
    };
  } catch (cause) {
    return { status: 'error', code: ratingFailureCode(cause) };
  }
}

export function loadLevelReviewHistory(): Promise<LevelReviewLoad<LevelReviewListResult>> {
  return read(() => listMyLevelReviewRequests({ data: { limit: LEVEL_REVIEW_HISTORY_PAGE_SIZE } }));
}

/** A malformed id is answered without a round trip, as not found. */
export async function loadLevelReviewDetail(
  requestId: string
): Promise<LevelReviewLoad<LevelReviewDto>> {
  if (!isUuid(requestId)) return { status: 'error', code: 'LEVEL_REVIEW_NOT_FOUND' };
  const result = await read(() => getMyLevelReviewRequest({ data: { request_id: requestId } }));
  return result.status === 'ok' ? { status: 'ok', value: result.value.request } : result;
}

export function cancelLevelReview(requestId: string): Promise<LevelReviewLoad<LevelReviewDto>> {
  return read(() => cancelLevelReviewRequest({ data: { request_id: requestId } })).then((result) =>
    result.status === 'ok' ? { status: 'ok', value: result.value.request } : result
  );
}
