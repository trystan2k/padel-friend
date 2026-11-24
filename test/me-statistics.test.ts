import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getPlayerStatistics } = vi.hoisted(() => ({
  getPlayerStatistics: vi.fn<(request: { data: { playerId: string } }) => Promise<unknown>>()
}));
vi.mock('../src/features/statistics/statistics-player.functions', () => ({ getPlayerStatistics }));

import { loadMeStatistics, toMeStatistics } from '../src/features/player/me-statistics';

type Matches = Parameters<typeof toMeStatistics>[0] extends infer R
  ? R extends { status: 'ok'; value: { matches: infer M } }
    ? M
    : never
  : never;

const matches = (overrides: Partial<Matches> = {}): Matches => ({
  played: 42,
  wins: 25,
  losses: 12,
  draws: 5,
  incomplete: 0,
  competitive: 30,
  friendly: 12,
  winRate: { state: 'ready', value: 0.676, numerator: 25, denominator: 37 },
  competitiveWinRate: { state: 'unavailable', value: null, reason: 'unavailable' },
  friendlyWinRate: { state: 'unavailable', value: null, reason: 'unavailable' },
  ...overrides
});

beforeEach(() => getPlayerStatistics.mockReset());

describe('Me statistics tiles', () => {
  it('maps matches, W–L–D and the contract win rate without a new denominator', () => {
    expect(toMeStatistics({ status: 'ok', value: { matches: matches() } })).toEqual({
      status: 'ok',
      played: 42,
      wins: 25,
      losses: 12,
      draws: 5,
      winRate: 0.676
    });
  });

  it('keeps a true zero and leaves the win rate empty when the contract has none', () => {
    expect(
      toMeStatistics({
        status: 'ok',
        value: {
          matches: matches({
            played: 0,
            wins: 0,
            losses: 0,
            draws: 0,
            winRate: {
              state: 'insufficient',
              value: null,
              numerator: 0,
              denominator: 0,
              observed: 0,
              required: 1,
              reason: 'no_resolved_matches'
            }
          })
        }
      })
    ).toEqual({ status: 'ok', played: 0, wins: 0, losses: 0, draws: 0, winRate: null });
  });

  it('reports a failed read as unavailable and a lost session as an authentication failure', () => {
    expect(toMeStatistics({ status: 'error', code: 'STATISTICS_UNAVAILABLE' })).toEqual({
      status: 'unavailable'
    });
    expect(() => toMeStatistics({ status: 'error', code: 'STATISTICS_UNAUTHENTICATED' })).toThrow(
      'UNAUTHENTICATED'
    );
  });

  it('reads once for the given player with no filters (default scope)', async () => {
    getPlayerStatistics.mockResolvedValue({ status: 'ok', value: { matches: matches() } });
    await loadMeStatistics('player-1');
    expect(getPlayerStatistics).toHaveBeenCalledTimes(1);
    expect(getPlayerStatistics).toHaveBeenCalledWith({ data: { playerId: 'player-1' } });
  });

  it('turns a thrown read into unavailable but rethrows a lost session', async () => {
    getPlayerStatistics.mockRejectedValueOnce(new Error('boom'));
    await expect(loadMeStatistics('player-1')).resolves.toEqual({ status: 'unavailable' });
    getPlayerStatistics.mockRejectedValueOnce(new Error('UNAUTHENTICATED'));
    await expect(loadMeStatistics('player-1')).rejects.toThrow('UNAUTHENTICATED');
  });
});
