import { describe, expect, it } from 'vitest';
import {
  parseMatchEventRatingChanges,
  parseRatingGroupExplanation,
  parseRatingHistoryPage,
  parseRatingProgress,
  parseRatingSummaryResult,
  ratingErrorCode
} from '../src/features/player/rating-contracts';
import {
  decodeRatingCursor,
  encodeRatingCursor,
  validateRatingEventChanges,
  validateRatingExplanation,
  validateRatingHistory,
  validateRatingProgress
} from '../src/features/player/rating-validators';
import {
  changesPayload,
  explanationPayload,
  GROUP_ID,
  historyPayload,
  INVITER_ID,
  PLAYED_AT,
  progressPayload,
  summaryPayload
} from './helpers/rating-read-fixtures';

describe('rating reader decoders', () => {
  it('decode valid payloads and drop every key outside the whitelist', () => {
    const leaky = {
      ...explanationPayload,
      players: explanationPayload.players.map((entry) => ({
        ...entry,
        invited_by: INVITER_ID,
        email: 'someone@example.com'
      }))
    };
    const decoded = parseRatingGroupExplanation(leaky);
    expect(decoded?.players).toHaveLength(4);
    expect(JSON.stringify(decoded)).not.toMatch(/invited_by|email|99999999/);
    expect(parseRatingSummaryResult({ ...summaryPayload, extra: INVITER_ID })).toEqual(
      summaryPayload
    );
    expect(parseRatingHistoryPage(historyPayload)).toEqual(historyPayload);
    expect(parseRatingProgress(progressPayload)).toEqual(progressPayload);
    expect(parseMatchEventRatingChanges(changesPayload)?.groups[0]?.players).toHaveLength(4);
  });

  it('keeps the provisional marker per player', () => {
    const decoded = parseRatingGroupExplanation(explanationPayload);
    expect(decoded?.players.filter((entry) => entry.is_provisional)).toHaveLength(1);
  });

  it('distinguish unavailable, empty and ready summaries', () => {
    expect(parseRatingSummaryResult({ revision: 0, state: 'unavailable', summary: null })).toEqual({
      revision: 0,
      state: 'unavailable',
      summary: null
    });
    expect(parseRatingSummaryResult({ revision: 0, state: 'ready', summary: null })).toBeNull();
    expect(
      parseRatingSummaryResult({
        ...summaryPayload,
        summary: { ...summaryPayload.summary, last_rating_at: null }
      })?.summary?.last_rating_at
    ).toBeNull();
    expect(
      parseRatingHistoryPage({ ...historyPayload, state: 'empty', total_events: 0, items: [] })
    ).toMatchObject({ state: 'empty', items: [] });
  });

  it('fail closed on malformed payloads instead of returning partial data', () => {
    expect(parseRatingSummaryResult(null)).toBeNull();
    expect(parseRatingSummaryResult({ ...summaryPayload, state: 'weird' })).toBeNull();
    expect(
      parseRatingSummaryResult({
        ...summaryPayload,
        summary: { ...summaryPayload.summary, display_level: '4' }
      })
    ).toBeNull();
    expect(
      parseRatingHistoryPage({
        ...historyPayload,
        items: [{ ...historyPayload.items[0], team: 'x' }]
      })
    ).toBeNull();
    expect(
      parseRatingHistoryPage({
        ...historyPayload,
        next_cursor: { played_at: 'bad', game_group_id: GROUP_ID }
      })
    ).toBeNull();
    expect(parseRatingProgress({ ...progressPayload, scope: 'recent' })).toBeNull();
    expect(parseRatingProgress({ ...progressPayload, points: [{ ordinal: -1 }] })).toBeNull();
    expect(
      parseRatingGroupExplanation({
        ...explanationPayload,
        players: explanationPayload.players.slice(0, 3)
      })
    ).toBeNull();
    expect(
      parseRatingGroupExplanation({ ...explanationPayload, played_at: '2026-11-01' })
    ).toBeNull();
    expect(
      parseMatchEventRatingChanges({
        ...changesPayload,
        groups: [{ ...changesPayload.groups[0], players: [] }]
      })
    ).toBeNull();
  });

  it('map database failures to stable codes without the database message', () => {
    expect(ratingErrorCode({ message: 'RATING_UNAUTHENTICATED' })).toBe('unauthenticated');
    expect(ratingErrorCode({ message: 'RATING_EXPLANATION_FORBIDDEN' })).toBe('forbidden');
    expect(ratingErrorCode({ message: 'PROVISIONAL_PLAYER_RESTRICTED' })).toBe('forbidden');
    expect(ratingErrorCode({ message: 'RATING_REVISION_STALE' })).toBe('stale_revision');
    expect(ratingErrorCode({ message: 'RATING_HISTORY_INVALID_ARGUMENT' })).toBe('invalid_request');
    expect(ratingErrorCode({ message: 'connection reset', code: '08006' })).toBe('unavailable');
  });
});

describe('rating reader validators', () => {
  it('round-trip the opaque history cursor with its revision', () => {
    const cursor = encodeRatingCursor(7, { played_at: PLAYED_AT, game_group_id: GROUP_ID });
    expect(cursor).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeRatingCursor(cursor)).toEqual({
      revision: 7,
      position: { played_at: PLAYED_AT, game_group_id: GROUP_ID }
    });
    expect(validateRatingHistory({ limit: 50, cursor })).toEqual({ limit: 50, cursor });
  });

  it('reject malformed cursors, unknown keys and out-of-range pages', () => {
    const forged = btoa(JSON.stringify({ r: 1, t: PLAYED_AT, g: GROUP_ID, x: 1 }));
    for (const cursor of [
      '',
      'not base64!',
      forged.replaceAll('=', ''),
      btoa('{"r":-1}'),
      'a'.repeat(201)
    ])
      expect(() => validateRatingHistory({ cursor })).toThrow('INVALID_RATING_INPUT');
    for (const limit of [0, 51, 1.5, '10', null])
      expect(() => validateRatingHistory({ limit })).toThrow('INVALID_RATING_INPUT');
    expect(() => validateRatingHistory({ user_id: GROUP_ID })).toThrow('INVALID_RATING_INPUT');
    expect(validateRatingHistory(undefined)).toEqual({});
  });

  it('validate progress bounds, group identity and event identity', () => {
    expect(validateRatingProgress(undefined)).toEqual({});
    expect(validateRatingProgress({ max_points: 120 })).toEqual({ max_points: 120 });
    for (const max_points of [1, 121, 2.5])
      expect(() => validateRatingProgress({ max_points })).toThrow('INVALID_RATING_INPUT');
    expect(validateRatingExplanation({ game_group_id: GROUP_ID, revision: 4 })).toEqual({
      game_group_id: GROUP_ID,
      revision: 4
    });
    expect(() => validateRatingExplanation({ game_group_id: 'nope' })).toThrow(
      'INVALID_RATING_INPUT'
    );
    expect(() => validateRatingExplanation({ game_group_id: GROUP_ID, revision: -1 })).toThrow(
      'INVALID_RATING_INPUT'
    );
    expect(() => validateRatingExplanation({ game_group_id: GROUP_ID, user_id: GROUP_ID })).toThrow(
      'INVALID_RATING_INPUT'
    );
    expect(validateRatingEventChanges({ event_id: GROUP_ID })).toEqual({ event_id: GROUP_ID });
    expect(() =>
      validateRatingEventChanges({ event_id: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA' })
    ).toThrow('INVALID_RATING_INPUT');
  });
});
