import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  decodeLeagueStandings,
  decodeLeagueStandingsAudit,
  decodeLeagueStandingsVersions
} from '../src/features/leagues/league-standings-decoders';

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

import {
  getLeagueStandings,
  getLeagueStandingsAudit,
  getLeagueViewer,
  listLeagueStandingsVersions
} from '../src/features/leagues/league.functions';
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
  source: 'live',
  standings_version: null,
  latest_standings_version: null,
  generated_at: null,
  cause: null,
  entries
});
const final = (overrides: Record<string, unknown> = {}) => ({
  ...standings(),
  status: 'closed',
  source: 'final',
  standings_version: 2,
  latest_standings_version: 3,
  generated_at: '2026-11-01T10:00:00.000000Z',
  cause: 'late_first_confirmation',
  ...overrides
});
const versionSummary = (version: number, overrides: Record<string, unknown> = {}) => ({
  standings_version: version,
  cause: 'closed',
  basis: 'published',
  generated_at: '2026-11-01T10:00:00.000000Z',
  effective_end_at: '2026-10-31T23:59:59.999999Z',
  minimum_matches_for_final_award: 3,
  entry_count: 4,
  confirmation: null,
  ...overrides
});
const lateConfirmation = {
  source: 'AUTO_48H',
  confirmed_at: '2026-11-02T10:00:00.000000Z',
  played_at: '2026-10-31T12:00:00.000000Z'
};
const auditEvent = (overrides: Record<string, unknown> = {}) => ({
  action: 'closed',
  actor_id: id(1),
  system_reason: null,
  occurred_at: '2026-11-01T10:00:00.000000Z',
  details: { closed_at: '2026-11-01T10:00:00.000000Z', standings_version: 1 },
  ...overrides
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
    ['a non-object', () => null],
    ['a live table carrying a version', () => ({ ...standings(), standings_version: 1 })],
    ['a live table of a closed League', () => ({ ...standings(), status: 'closed' })],
    ['a final of an open League', () => final({ status: 'active' })],
    ['a final without a version', () => final({ standings_version: null })],
    ['a version beyond the latest', () => final({ standings_version: 4 })],
    ['an unknown cause', () => final({ cause: 'edited' })],
    ['an unknown source', () => final({ source: 'cached' })],
    ['a final without a generation time', () => final({ generated_at: null })]
  ])('rejects %s', (_label, build) => {
    expect(() => decodeLeagueStandings(build())).toThrow('INVALID_LEAGUE_RESPONSE');
  });

  it('accepts a published final with its own version and cause', () => {
    expect(decodeLeagueStandings(final())).toEqual(final());
  });
});

describe('League standings versions decoder', () => {
  const page = (versions: unknown[], next: unknown = null) => ({
    league_id: LEAGUE_ID,
    status: 'closed',
    versions,
    next_before_version: next
  });

  it('accepts a newest-first history with a late confirmation and a continuation', () => {
    const payload = page(
      [
        versionSummary(3, { cause: 'late_first_confirmation', confirmation: lateConfirmation }),
        versionSummary(2, { cause: 'repair', basis: 'published' }),
        versionSummary(1, { cause: 'reconstruction', basis: 'reconstructed' })
      ],
      1
    );
    expect(decodeLeagueStandingsVersions(payload)).toEqual(payload);
  });

  it.each([
    ['ascending versions', () => page([versionSummary(1), versionSummary(2)])],
    ['a repeated version', () => page([versionSummary(2), versionSummary(2)])],
    [
      'a late version without its confirmation',
      () => page([versionSummary(2, { cause: 'late_first_confirmation' })])
    ],
    [
      'a confirmation on a close',
      () => page([versionSummary(1, { confirmation: lateConfirmation })])
    ],
    ['an unknown basis', () => page([versionSummary(1, { basis: 'guess' })])],
    ['an actor leaking in', () => page([versionSummary(1, { actor_id: id(1) })])],
    ['a bad continuation', () => page([versionSummary(2)], 0)],
    ['an unknown status', () => ({ ...page([]), status: 'archived' })],
    ['a non-array history', () => ({ ...page([]), versions: {} })]
  ])('rejects %s', (_label, build) => {
    expect(() => decodeLeagueStandingsVersions(build())).toThrow('INVALID_LEAGUE_RESPONSE');
  });
});

describe('League standings audit decoder', () => {
  const audit = (events: unknown[]) => ({ league_id: LEAGUE_ID, events });

  it('accepts a human close and a system revision with structured details', () => {
    const payload = audit([
      auditEvent({
        action: 'standings_revised',
        actor_id: null,
        system_reason: 'standings_repair',
        details: {
          old_standings_version: 1,
          added_count: 1,
          removed_count: 0
        }
      }),
      auditEvent()
    ]);
    expect(decodeLeagueStandingsAudit(payload)).toEqual(payload);
  });

  it.each([
    [
      'both an actor and a system reason',
      () => audit([auditEvent({ system_reason: 'due_start' })])
    ],
    ['neither an actor nor a system reason', () => audit([auditEvent({ actor_id: null })])],
    ['an unknown action', () => audit([auditEvent({ action: 'updated' })])],
    ['non-structured details', () => audit([auditEvent({ details: { nested: { a: 1 } } })])],
    ['array details', () => audit([auditEvent({ details: [] })])],
    [
      'a raw confirmation identifier',
      () => audit([auditEvent({ details: { standings_version: 1, confirmation_id: id(2) } })])
    ],
    [
      'raw identifier arrays',
      () => audit([auditEvent({ details: { added_confirmations: [id(2)] } })])
    ],
    ['an unknown detail key', () => audit([auditEvent({ details: { group_number: 2 } })])],
    ['a malformed actor', () => audit([auditEvent({ actor_id: 'x' })])]
  ])('rejects %s', (_label, build) => {
    expect(() => decodeLeagueStandingsAudit(build())).toThrow('INVALID_LEAGUE_RESPONSE');
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
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_league_standings', {
      p_league_id: LEAGUE_ID,
      p_standings_version: undefined
    });
  });

  it('reads one exact historical version when asked and rejects bad versions first', async () => {
    rpc.mockResolvedValueOnce({ data: final({ standings_version: 1 }), error: null });
    await expect(
      getLeagueStandings({ data: { league_id: LEAGUE_ID, standings_version: 1 } })
    ).resolves.toMatchObject({ source: 'final', standings_version: 1 });
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_league_standings', {
      p_league_id: LEAGUE_ID,
      p_standings_version: 1
    });
    for (const bad of [0, -1, 1.5, '1', Number.NaN])
      await expect(
        getLeagueStandings({ data: { league_id: LEAGUE_ID, standings_version: bad } })
      ).rejects.toThrow('INVALID_LEAGUE_INPUT');
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it('maps the typed version errors', async () => {
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'LEAGUE_STANDINGS_VERSION_NOT_FOUND' }
    });
    await expect(
      getLeagueStandings({ data: { league_id: LEAGUE_ID, standings_version: 9 } })
    ).rejects.toThrow('LEAGUE_STANDINGS_VERSION_NOT_FOUND');
    rpc.mockResolvedValueOnce({
      data: null,
      error: { message: 'LEAGUE_STANDINGS_VERSION_INVALID' }
    });
    await expect(
      getLeagueStandings({ data: { league_id: LEAGUE_ID, standings_version: 1 } })
    ).rejects.toThrow('LEAGUE_STANDINGS_VERSION_INVALID');
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

describe('League standings history server functions', () => {
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

  const versionsPayload = {
    league_id: LEAGUE_ID,
    status: 'closed',
    versions: [
      versionSummary(2, { cause: 'late_first_confirmation', confirmation: lateConfirmation })
    ],
    next_before_version: 2
  };

  it('lists versions through the narrow RPC with a validated continuation', async () => {
    rpc.mockResolvedValueOnce({ data: versionsPayload, error: null });
    await expect(
      listLeagueStandingsVersions({ data: { league_id: LEAGUE_ID, before_version: 5 } })
    ).resolves.toEqual(versionsPayload);
    expect(rpc).toHaveBeenCalledExactlyOnceWith('list_league_standings_versions', {
      p_league_id: LEAGUE_ID,
      p_before_version: 5
    });
    await expect(
      listLeagueStandingsVersions({ data: { league_id: LEAGUE_ID, before_version: 0 } })
    ).rejects.toThrow('INVALID_LEAGUE_INPUT');
    await expect(
      listLeagueStandingsVersions({ data: { league_id: LEAGUE_ID, extra: true } })
    ).rejects.toThrow('INVALID_LEAGUE_INPUT');
  });

  it('verifies claims, maps database errors and rejects malformed version payloads', async () => {
    getClaims.mockResolvedValueOnce({ data: null, error: new Error('no session') });
    await expect(listLeagueStandingsVersions({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(rpc).not.toHaveBeenCalled();
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAGUE_NOT_FOUND' } });
    await expect(listLeagueStandingsVersions({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'LEAGUE_NOT_FOUND'
    );
    rpc.mockResolvedValueOnce({ data: { league_id: LEAGUE_ID }, error: null });
    await expect(listLeagueStandingsVersions({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
  });

  it('reports the verified caller id and refuses an anonymous or unverified session', async () => {
    await expect(getLeagueViewer()).resolves.toEqual({ user_id: 'user-1' });
    getClaims.mockResolvedValueOnce({
      data: { claims: { sub: 'u', is_anonymous: true } },
      error: null
    });
    await expect(getLeagueViewer()).rejects.toThrow('UNAUTHENTICATED');
    getClaims.mockResolvedValueOnce({ data: null, error: new Error('bad') });
    await expect(getLeagueViewer()).rejects.toThrow('UNAUTHENTICATED');
  });

  it('reads the owner/Admin audit through its RPC and surfaces denial and bad payloads', async () => {
    const payload = { league_id: LEAGUE_ID, events: [auditEvent()] };
    rpc.mockResolvedValueOnce({ data: payload, error: null });
    await expect(getLeagueStandingsAudit({ data: { league_id: LEAGUE_ID } })).resolves.toEqual(
      payload
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_league_standings_audit', {
      p_league_id: LEAGUE_ID
    });
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAGUE_FORBIDDEN' } });
    await expect(getLeagueStandingsAudit({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'LEAGUE_FORBIDDEN'
    );
    rpc.mockResolvedValueOnce({ data: { league_id: LEAGUE_ID, events: [{}] }, error: null });
    await expect(getLeagueStandingsAudit({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
    await expect(getLeagueStandingsAudit({ data: { league_id: 'x' } })).rejects.toThrow(
      'INVALID_LEAGUE_INPUT'
    );
  });
});
