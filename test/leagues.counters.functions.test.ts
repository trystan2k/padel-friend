/** @vitest-environment jsdom */
import { cleanup, render, screen, within } from '@testing-library/react';
import { createElement } from 'react';
import { I18nextProvider } from 'react-i18next';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LeagueCountersResult } from '../src/features/leagues/league-contracts';
import { decodeLeagueCounters } from '../src/features/leagues/league-decoders';
import { createI18n } from '../src/i18n/config';

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

import { LeagueCounters } from '../src/features/leagues/LeagueCounters';
import { getLeagueCounters } from '../src/features/leagues/league.functions';
import enTranslation from '../src/locales/en/translation.json';
import esTranslation from '../src/locales/es/translation.json';
import ptTranslation from '../src/locales/pt-BR/translation.json';
import { LEAGUE_ID } from './helpers/league-dto-fixtures';

const USER_A = '33333333-3333-4333-8333-333333333331';
const USER_B = '33333333-3333-4333-8333-333333333332';

const entry = (overrides: Record<string, unknown> = {}) => ({
  user_id: USER_A,
  display_name: 'Ana',
  is_provisional: false,
  matches: 3,
  wins: 2,
  losses: 1,
  draws: 0,
  sets_won: 5,
  sets_lost: 3,
  set_differential: 2,
  ...overrides
});
const counters = (participants: unknown[] = [entry()], excluded = 0) => ({
  league_id: LEAGUE_ID,
  participants,
  excluded_group_count: excluded
});

describe('League counters decoder', () => {
  it('accepts zero-initialised participants and signed set differentials', () => {
    const zero = entry({
      user_id: USER_B,
      display_name: null,
      is_provisional: true,
      matches: 0,
      wins: 0,
      losses: 0,
      draws: 0,
      sets_won: 0,
      sets_lost: 0,
      set_differential: 0
    });
    const negative = entry({ sets_won: 1, sets_lost: 4, set_differential: -3 });
    expect(decodeLeagueCounters(counters([negative, zero], 2))).toEqual(
      counters([negative, zero], 2)
    );
  });

  it.each([
    ['a missing key', () => counters([{ ...entry(), draws: undefined }])],
    ['an extra key (no email/inviter/skill leaks)', () => counters([entry({ email: 'a@b.c' })])],
    ['a skill input', () => counters([entry({ mu: 4.2 })])],
    ['inconsistent results', () => counters([entry({ wins: 3 })])],
    ['inconsistent set arithmetic', () => counters([entry({ set_differential: 9 })])],
    ['a negative counter', () => counters([entry({ matches: -1, wins: -1, losses: 0 })])],
    ['duplicate players', () => counters([entry(), entry()])],
    ['a bad UUID', () => counters([entry({ user_id: 'nope' })])],
    ['a non-array participant list', () => ({ ...counters(), participants: {} })],
    ['a missing excluded count', () => ({ league_id: LEAGUE_ID, participants: [] })],
    ['a non-object', () => null]
  ])('rejects %s', (_label, build) => {
    expect(() => decodeLeagueCounters(build())).toThrow('INVALID_LEAGUE_RESPONSE');
  });
});

describe('getLeagueCounters server function', () => {
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
    await expect(getLeagueCounters({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    getClaims.mockResolvedValueOnce({
      data: { claims: { sub: 'u', is_anonymous: true } },
      error: null
    });
    await expect(getLeagueCounters({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'UNAUTHENTICATED'
    );
    expect(rpc).not.toHaveBeenCalled();
  });

  it('rejects invalid input before authenticating', async () => {
    await expect(getLeagueCounters({ data: { league_id: 'x' } })).rejects.toThrow(
      'INVALID_LEAGUE_INPUT'
    );
    expect(mocks.requireAuthenticatedClient).not.toHaveBeenCalled();
  });

  it('reads through the narrow RPC and returns the decoded counters', async () => {
    rpc.mockResolvedValueOnce({ data: counters(), error: null });
    await expect(getLeagueCounters({ data: { league_id: LEAGUE_ID } })).resolves.toEqual(
      counters()
    );
    expect(rpc).toHaveBeenCalledExactlyOnceWith('get_league_counters', { p_league_id: LEAGUE_ID });
  });

  it('maps database failures to stable codes and malformed payloads to a response error', async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'LEAGUE_NOT_FOUND' } });
    await expect(getLeagueCounters({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'LEAGUE_NOT_FOUND'
    );
    rpc.mockResolvedValueOnce({ data: null, error: { message: 'relation "x" does not exist' } });
    await expect(getLeagueCounters({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'LEAGUE_UNAVAILABLE'
    );
    rpc.mockResolvedValueOnce({ data: { league_id: LEAGUE_ID }, error: null });
    await expect(getLeagueCounters({ data: { league_id: LEAGUE_ID } })).rejects.toThrow(
      'INVALID_LEAGUE_RESPONSE'
    );
  });
});

describe('LeagueCounters view', () => {
  afterEach(cleanup);
  const view = (value: LeagueCountersResult, locale: 'en' | 'pt-BR' | 'es' = 'en') =>
    render(
      createElement(
        I18nextProvider,
        { i18n: createI18n(locale) },
        createElement(LeagueCounters, { counters: value })
      )
    );

  it('shows every participant with the provisional badge and no ordering claim', () => {
    view(
      decodeLeagueCounters(
        counters([
          entry(),
          entry({
            user_id: USER_B,
            display_name: 'Bia',
            is_provisional: true,
            matches: 0,
            wins: 0,
            losses: 0,
            sets_won: 0,
            sets_lost: 0,
            set_differential: 0
          })
        ])
      )
    );
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(within(items[0]!).getByText('Ana')).toBeTruthy();
    expect(within(items[0]!).queryByText('Provisional')).toBeNull();
    expect(within(items[0]!).getByText('+2')).toBeTruthy();
    expect(within(items[1]!).getByText('Provisional')).toBeTruthy();
    expect(screen.queryByText(/position|rank|points/i)).toBeNull();
  });

  it('explains empty and excluded states in every locale', () => {
    const { unmount } = view(decodeLeagueCounters(counters([], 2)));
    expect(screen.getByRole('status').textContent).toContain('2 confirmed Ranked groups');
    expect(screen.getByText('No participants yet.')).toBeTruthy();
    unmount();
    view(decodeLeagueCounters(counters([], 1)), 'pt-BR');
    expect(screen.getByRole('status').textContent).toContain('1 grupo Ranqueado');
  });

  it('has the same counters keys in en, pt-BR and es', () => {
    const keys = (value: { leagues: { counters: Record<string, string> } }) =>
      Object.keys(value.leagues.counters).sort();
    expect(keys(ptTranslation)).toEqual(keys(enTranslation));
    expect(keys(esTranslation)).toEqual(keys(enTranslation));
  });
});
