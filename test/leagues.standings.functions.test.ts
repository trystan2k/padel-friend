import { beforeEach, describe, expect, it, vi } from 'vitest';
import { decodeLeagueStandings } from '../src/features/leagues/league-standings-decoders';

type RpcResult = { data: unknown; error: { message: string } | null };
type Claims = { data: { claims: { sub?: string; is_anonymous?: boolean } } | null; error: unknown };

const mocks = vi.hoisted(() => ({
  requireAuthenticatedClient: vi.fn<() => Promise<{ client: unknown; userId: string }>>()
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    let validate: (value: unknown) => unknown = (value) => value;
    const builder = {
      validator: (fn: (value: unknown) => unknown) => {
        validate = fn;
        return builder;
      },
      handler:
        (fn: (context: { data: unknown }) => unknown) => async (options?: { data: unknown }) =>
          fn({ data: validate(options?.data) })
    };
    return builder;
  }
}));
vi.mock('../src/features/auth/auth.server', () => ({
  requireAuthenticatedClient: mocks.requireAuthenticatedClient
}));

import { getLeagueStandings } from '../src/features/leagues/league.functions';
import { LEAGUE_ID } from './helpers/league-dto-fixtures';

const id = (n: number) => `33333333-3333-4333-8333-33333333333${n}`;

const entry = (n: number, overrides: Record<string, unknown> = {}) => ({
  user_id: id(n),
  display_name: `Player ${n}`,
  is_provisional: false,
  position: 1,
  matches: 3,
  wins: 2,
  losses: 1,
  draws: 0,
  sets_won: 5,
  sets_lost: 3,
  set_differential: 2,
  award_eligible: true,
  matches_remaining: 0,
  ...overrides
});
const standings = (entries: unknown[] = [entry(1)], threshold = 3) => ({
  league_id: LEAGUE_ID,
  status: 'active',
  minimum_matches_for_final_award: threshold,
  entries
});

describe('League standings decoder', () => {
  it('accepts competition positions with shared places and a gap (1, 1, 3)', () => {
    const payload = standings([
      entry(1),
      entry(2),
      entry(3, { position: 3, wins: 1, losses: 2, sets_won: 3, sets_lost: 4, set_differential: -1 })
    ]);
    expect(decodeLeagueStandings(payload)).toEqual(payload);
  });

  it('accepts zero rows below the threshold and Draw-only records without reordering', () => {
    const zero = (n: number, position: number) =>
      entry(n, {
        position,
        matches: 0,
        wins: 0,
        losses: 0,
        draws: 0,
        sets_won: 0,
        sets_lost: 0,
        set_differential: 0,
        award_eligible: false,
        matches_remaining: 3
      });
    const drawn = entry(4, {
      position: 1,
      matches: 1,
      wins: 0,
      losses: 0,
      draws: 1,
      sets_won: 0,
      sets_lost: 0,
      set_differential: 0,
      award_eligible: false,
      matches_remaining: 2
    });
    // A Draw adds Matches only: it ties the zero rows on all four keys, so they share place 1.
    const payload = standings([drawn, zero(5, 1), zero(6, 1)]);
    expect(decodeLeagueStandings(payload).entries.map((row) => row.position)).toEqual([1, 1, 1]);
  });

  it.each([
    ['a missing key', () => standings([{ ...entry(1), draws: undefined }])],
    ['an extra key (no skill or email leaks)', () => standings([entry(1, { mu: 4.2 })])],
    ['inconsistent results', () => standings([entry(1, { wins: 3 })])],
    ['inconsistent set arithmetic', () => standings([entry(1, { set_differential: 9 })])],
    [
      'eligibility contradicting the threshold',
      () => standings([entry(1, { award_eligible: false })])
    ],
    ['wrong matches remaining', () => standings([entry(1, { matches_remaining: 1 })])],
    ['a zero position', () => standings([entry(1, { position: 0 })])],
    ['a first position other than 1', () => standings([entry(1, { position: 2 })])],
    [
      'a shared place for different records',
      () => standings([entry(1), entry(2, { position: 1, wins: 1, losses: 2 })])
    ],
    [
      'a missing gap after a shared place',
      () =>
        standings([
          entry(1),
          entry(2),
          entry(3, {
            position: 2,
            wins: 0,
            losses: 3,
            sets_won: 0,
            sets_lost: 6,
            set_differential: -6
          })
        ])
    ],
    [
      'a wrong sporting order',
      () => standings([entry(1, { wins: 1, losses: 2 }), entry(2, { position: 2 })])
    ],
    ['tied rows out of UUID order', () => standings([entry(2), entry(1)])],
    ['duplicate players', () => standings([entry(1), entry(1)])],
    ['an unknown status', () => ({ ...standings(), status: 'archived' })],
    ['a zero threshold', () => standings([], 0)],
    ['a non-array entry list', () => ({ ...standings(), entries: {} })],
    ['a non-object', () => null]
  ])('rejects %s', (_label, build) => {
    expect(() => decodeLeagueStandings(build())).toThrow('INVALID_LEAGUE_RESPONSE');
  });
});

describe('getLeagueStandings server function', () => {
  let rpc: ReturnType<
    typeof vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>
  >;
  let getClaims: ReturnType<typeof vi.fn<() => Promise<Claims>>>;

  beforeEach(() => {
    rpc = vi.fn<(name: string, args?: Record<string, unknown>) => Promise<RpcResult>>();
    getClaims = vi
      .fn<() => Promise<Claims>>()
      .mockResolvedValue({ data: { claims: { sub: 'user-1' } }, error: null });
    mocks.requireAuthenticatedClient
      .mockReset()
      .mockResolvedValue({ client: { auth: { getClaims }, rpc }, userId: 'user-1' });
  });

  it('rejects missing and anonymous sessions before any database call', async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: new Error('no session') });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    getClaims.mockResolvedValueOnce({
      data: { claims: { sub: 'u', is_anonymous: true } },
      error: null
    });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid input before authenticating', async () => {
    await expect(getLeagueStandings({ data: { league_id: 'x' } })).rejects.toThrow(
      'INVALID_LEAGUE_INPUT'
    );
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('reads through the narrow RPC and returns the decoded standings', async () => {
    rpc.mockResolvedValueOnce({ data: standings(), error: null });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).resolves.toEqual(
      standings()
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_league_standings', { p_league_id: LEAGUE_ID });
  });

  it('maps database failures to stable codes and malformed payloads to a response error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAGUE_NOT_FOUND' } });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'LEAGUE_NOT_FOUND'
    );
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'PROVISIONAL_PLAYER_RESTRICTED' } });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'PROVISIONAL_PLAYER_RESTRICTED'
    );
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist' } });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'LEAGUE_UNAVAILABLE'
    );
    rpc.mockResolvedValueOnce({ data: { league_id: LEAGUE_ID }, error: null });
    await expect(getLeagueStandings({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
  });
});
