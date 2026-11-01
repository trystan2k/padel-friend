import { isInstant, isUuid, type RatingHistoryCursor } from './rating-contracts';

export const RATING_HISTORY_DEFAULT_LIMIT = 20;
export const RATING_HISTORY_MAX_LIMIT = 50;
export const RATING_PROGRESS_DEFAULT_POINTS = 60;
export const RATING_PROGRESS_MIN_POINTS = 2;
export const RATING_PROGRESS_MAX_POINTS = 120;

export type RatingHistoryInput = { limit?: number; cursor?: string };
export type RatingProgressInput = { max_points?: number };
export type RatingExplanationInput = { game_group_id: string; revision?: number };
export type RatingEventChangesInput = { event_id: string };
export type DecodedRatingCursor = { revision: number; position: RatingHistoryCursor };

function invalid(): never {
  throw new Error('INVALID_RATING_INPUT');
}

function objectWithKeys(value: unknown, allowed: readonly string[]): Record<string, unknown> {
  if (!isRecord(value) || Object.keys(value).some((key) => !allowed.includes(key)))
    return invalid();
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function boundedInteger(value: unknown, min: number, max: number): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
    return invalid();
  return value;
}

function revisionNumber(value: unknown): number {
  return boundedInteger(value, 0, Number.MAX_SAFE_INTEGER);
}

/** Opaque cursor: committed revision + keyset position of the last row served. */
export function encodeRatingCursor(revision: number, position: RatingHistoryCursor): string {
  // Revision, instant and UUID are ASCII, so btoa is safe; map to the URL-safe alphabet.
  return btoa(JSON.stringify({ r: revision, t: position.played_at, g: position.game_group_id }))
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function decodeRatingCursor(cursor: string): DecodedRatingCursor {
  if (cursor.length > 200 || !/^[A-Za-z0-9_-]+$/.test(cursor)) return invalid();
  let parsed: unknown;
  try {
    const padded = cursor.replaceAll('-', '+').replaceAll('_', '/');
    parsed = JSON.parse(atob(padded.padEnd(Math.ceil(padded.length / 4) * 4, '=')));
  } catch {
    return invalid();
  }
  const input = objectWithKeys(parsed, ['r', 't', 'g']);
  if (!isInstant(input['t']) || !isUuid(input['g'])) return invalid();
  return {
    revision: revisionNumber(input['r']),
    position: { played_at: input['t'], game_group_id: input['g'] }
  };
}

export function validateRatingHistory(value: unknown): RatingHistoryInput {
  const input = objectWithKeys(value ?? {}, ['limit', 'cursor']);
  const result: RatingHistoryInput = {};
  if ('limit' in input) result.limit = boundedInteger(input['limit'], 1, RATING_HISTORY_MAX_LIMIT);
  if ('cursor' in input) {
    if (typeof input['cursor'] !== 'string') return invalid();
    decodeRatingCursor(input['cursor']);
    result.cursor = input['cursor'];
  }
  return result;
}

export function validateRatingProgress(value: unknown): RatingProgressInput {
  const input = objectWithKeys(value ?? {}, ['max_points']);
  return 'max_points' in input
    ? {
        max_points: boundedInteger(
          input['max_points'],
          RATING_PROGRESS_MIN_POINTS,
          RATING_PROGRESS_MAX_POINTS
        )
      }
    : {};
}

export function validateRatingExplanation(value: unknown): RatingExplanationInput {
  const input = objectWithKeys(value, ['game_group_id', 'revision']);
  if (!isUuid(input['game_group_id'])) return invalid();
  return {
    game_group_id: input['game_group_id'],
    ...('revision' in input ? { revision: revisionNumber(input['revision']) } : {})
  };
}

export function validateRatingEventChanges(value: unknown): RatingEventChangesInput {
  const input = objectWithKeys(value, ['event_id']);
  if (!isUuid(input['event_id'])) return invalid();
  return { event_id: input['event_id'] };
}
