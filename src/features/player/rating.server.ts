import type { PlayerClient } from './player.server';
import {
  parseMatchEventRatingChanges,
  parseRatingGroupExplanation,
  parseRatingHistoryPage,
  parseRatingProgress,
  parseRatingSummaryResult,
  ratingErrorCode,
  type MatchEventRatingChanges,
  type RatingGroupExplanation,
  type RatingHistoryView,
  type RatingProgress,
  type RatingResponse,
  type RatingSummaryResult
} from './rating-contracts';
import {
  decodeRatingCursor,
  encodeRatingCursor,
  RATING_HISTORY_DEFAULT_LIMIT,
  RATING_PROGRESS_DEFAULT_POINTS,
  type RatingEventChangesInput,
  type RatingExplanationInput,
  type RatingHistoryInput,
  type RatingProgressInput
} from './rating-validators';

type RpcResult = PromiseLike<{ data: unknown; error: { message: string; code?: string } | null }>;

/**
 * Shared reader tail: a database error becomes a stable code (auth and permission failures
 * are explicit errors, never an empty result) and an undecodable payload is `unavailable`.
 */
async function read<T>(
  call: RpcResult,
  parse: (value: unknown) => T | null
): Promise<RatingResponse<T>> {
  const { data, error } = await call;
  if (error) return { status: 'error', code: ratingErrorCode(error) };
  const value = parse(data);
  return value ? { status: 'ok', value } : { status: 'error', code: 'unavailable' };
}

export function readRatingSummary(
  client: PlayerClient
): Promise<RatingResponse<RatingSummaryResult>> {
  return read(client.rpc('get_my_rating_summary'), parseRatingSummaryResult);
}

export async function readRatingHistory(
  client: PlayerClient,
  input: RatingHistoryInput
): Promise<RatingResponse<RatingHistoryView>> {
  const cursor = input.cursor ? decodeRatingCursor(input.cursor) : null;
  const result = await read(
    client.rpc('get_my_rating_history', {
      p_limit: input.limit ?? RATING_HISTORY_DEFAULT_LIMIT,
      ...(cursor
        ? {
            p_revision: cursor.revision,
            p_before_played_at: cursor.position.played_at,
            p_before_game_group_id: cursor.position.game_group_id
          }
        : {})
    }),
    parseRatingHistoryPage
  );
  if (result.status === 'error') return result;
  const { next_cursor, ...page } = result.value;
  return {
    status: 'ok',
    value: {
      ...page,
      next_cursor: next_cursor ? encodeRatingCursor(page.revision, next_cursor) : null
    }
  };
}

export function readRatingProgress(
  client: PlayerClient,
  input: RatingProgressInput
): Promise<RatingResponse<RatingProgress>> {
  return read(
    client.rpc('get_my_rating_progress', {
      p_max_points: input.max_points ?? RATING_PROGRESS_DEFAULT_POINTS
    }),
    parseRatingProgress
  );
}

export function readRatingGroupExplanation(
  client: PlayerClient,
  input: RatingExplanationInput
): Promise<RatingResponse<RatingGroupExplanation>> {
  return read(
    client.rpc('get_rating_group_explanation', {
      p_game_group_id: input.game_group_id,
      ...(input.revision === undefined ? {} : { p_revision: input.revision })
    }),
    parseRatingGroupExplanation
  );
}

export function readMatchEventRatingChanges(
  client: PlayerClient,
  input: RatingEventChangesInput
): Promise<RatingResponse<MatchEventRatingChanges>> {
  return read(
    client.rpc('get_match_event_rating_changes', { p_match_event_id: input.event_id }),
    parseMatchEventRatingChanges
  );
}
