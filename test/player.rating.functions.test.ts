import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  changesPayload,
  EVENT_ID,
  explanationPayload,
  GROUP_ID,
  historyPayload,
  INVITER_ID,
  PLAYED_AT,
  progressPayload,
  summaryPayload
} from './helpers/rating-read-fixtures';

const mocks = vi.hoisted(() => ({
  claims: vi.fn<() => Promise<unknown>>(),
  rpc: vi.fn<(...args: unknown[]) => Promise<unknown>>(),
  header: vi.fn<(...args: unknown[]) => void>()
}));
vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate = (value: unknown) => value;
    const builder = {
      validator: (fn: typeof validate) => {
        validate = fn;
        return builder;
      },
      handler: (fn: (context: { data: unknown }) => unknown) => (options?: { data?: unknown }) =>
        fn({ data: validate(options?.data) })
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({ setResponseHeader: mocks.header }));
vi.mock('../src/lib/supabase/server', () => ({
  getServerClient: () => ({ auth: { getClaims: mocks.claims }, rpc: mocks.rpc })
}));
import {
  getMatchEventRatingChanges,
  getMyRatingHistory,
  getMyRatingProgress,
  getMyRatingSummary,
  getRatingGroupExplanation
} from '../src/features/player/rating.functions';
import { encodeRatingCursor } from '../src/features/player/rating-validators';

type Call = () => Promise<unknown>;
const calls: [string, Call, unknown][] = [
  ['summary', () => getMyRatingSummary(), summaryPayload],
  ['history', () => getMyRatingHistory({ data: {} }), historyPayload],
  ['progress', () => getMyRatingProgress({ data: {} }), progressPayload],
  [
    'explanation',
    () => getRatingGroupExplanation({ data: { game_group_id: GROUP_ID } }),
    explanationPayload
  ],
  ['changes', () => getMatchEventRatingChanges({ data: { event_id: EVENT_ID } }), changesPayload]
];

describe('rating server functions', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.claims.mockResolvedValue({ data: { claims: { sub: INVITER_ID } }, error: null });
  });

  it.each(calls)('%s: private/no-store and ok payload', async (_name, call, payload) => {
    mocks.rpc.mockResolvedValue({ data: payload, error: null });
    expect(await call()).toMatchObject({ status: 'ok' });
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it.each(calls)('%s: anonymous callers never reach the database', async (_name, call) => {
    mocks.claims.mockResolvedValue({ data: null, error: new Error('no session') });
    await expect(call()).rejects.toThrow('UNAUTHENTICATED');
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.header).toHaveBeenCalledWith('Cache-Control', 'private, no-store');
  });

  it.each(calls)(
    '%s: database failures stay explicit errors, never empty data',
    async (_name, call) => {
      for (const [message, code] of [
        ['RATING_UNAUTHENTICATED', 'unauthenticated'],
        ['RATING_EXPLANATION_FORBIDDEN', 'forbidden'],
        ['PROVISIONAL_PLAYER_RESTRICTED', 'forbidden'],
        ['RATING_REVISION_STALE', 'stale_revision'],
        ['relation "player_rating_events" does not exist', 'unavailable']
      ] as const) {
        mocks.rpc.mockResolvedValueOnce({ data: null, error: { message } });
        expect(await call()).toEqual({ status: 'error', code });
      }
      mocks.rpc.mockResolvedValueOnce({ data: { revision: 'x' }, error: null });
      expect(await call()).toEqual({ status: 'error', code: 'unavailable' });
    }
  );

  it('serializes only whitelisted keys even if the database returns more', async () => {
    mocks.rpc.mockResolvedValue({
      data: {
        ...explanationPayload,
        invited_by: INVITER_ID,
        players: explanationPayload.players.map((entry) => ({
          ...entry,
          email: 'a@b.test',
          invited_by: INVITER_ID
        }))
      },
      error: null
    });
    const response = await getRatingGroupExplanation({ data: { game_group_id: GROUP_ID } });
    const serialized = JSON.stringify(response);
    expect(serialized).not.toMatch(/invited_by|email|99999999/);
    expect(serialized).toContain('"is_provisional":true');
  });

  it('history: forwards the cursor revision and folds the next position into an opaque cursor', async () => {
    const cursor = encodeRatingCursor(3, { played_at: PLAYED_AT, game_group_id: GROUP_ID });
    mocks.rpc.mockResolvedValue({
      data: { ...historyPayload, next_cursor: { played_at: PLAYED_AT, game_group_id: GROUP_ID } },
      error: null
    });
    const response = await getMyRatingHistory({ data: { limit: 5, cursor } });
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_rating_history', {
      p_limit: 5,
      p_revision: 3,
      p_before_played_at: PLAYED_AT,
      p_before_game_group_id: GROUP_ID
    });
    expect(response).toMatchObject({ status: 'ok', value: { next_cursor: cursor } });
  });

  it('history: first page sends no cursor and defaults the page size', async () => {
    mocks.rpc.mockResolvedValue({ data: historyPayload, error: null });
    await getMyRatingHistory({ data: {} });
    expect(mocks.rpc).toHaveBeenCalledWith('get_my_rating_history', { p_limit: 20 });
  });

  it('rejects invalid input before any authentication or database call', () => {
    const invalid: Call[] = [
      () => getMyRatingHistory({ data: { limit: 500 } }),
      () => getMyRatingHistory({ data: { cursor: 'garbage!' } }),
      () => getMyRatingProgress({ data: { max_points: 1 } }),
      () => getRatingGroupExplanation({ data: { game_group_id: 'guess' } }),
      () => getMatchEventRatingChanges({ data: { event_id: '1' } })
    ];
    for (const call of invalid) expect(call).toThrow('INVALID_RATING_INPUT');
    expect(mocks.claims).not.toHaveBeenCalled();
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it('explanation: pins the requested revision', async () => {
    mocks.rpc.mockResolvedValue({ data: explanationPayload, error: null });
    await getRatingGroupExplanation({ data: { game_group_id: GROUP_ID, revision: 3 } });
    expect(mocks.rpc).toHaveBeenCalledWith('get_rating_group_explanation', {
      p_game_group_id: GROUP_ID,
      p_revision: 3
    });
  });
});
