import { beforeEach, describe, expect, it, vi } from 'vitest';
import { requireAuthenticatedClient } from '../src/features/auth/auth.server';
import { getOnboardingStatus } from '../src/features/player/player.functions';

// getOnboardingStatus and the other private server functions need a TanStack Start request
// context at runtime. Per the plan, error/expiry and incomplete-state assertions are unit tested
// here with mocked collaborators: createServerFn is replaced by a thin double that runs the real
// handler (and the real validator), and the Supabase server client is mocked per scenario.
const tanstackServer = vi.hoisted(() => ({
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));
const supabaseServer = vi.hoisted(() => ({ getServerClient: vi.fn<() => unknown>() }));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: (options?: { method?: string }) => {
    const resolved: { method?: string; inputValidator?: (data: unknown) => unknown } = {
      ...options
    };
    const builder = {
      options: resolved,
      middleware: () => builder,
      validator: (validator: (data: unknown) => unknown) => {
        resolved.inputValidator = validator;
        return builder;
      },
      handler: (handler: (context: { data?: unknown }) => unknown) =>
        Object.assign(
          async (callOptions?: { data?: unknown }) => {
            const data = resolved.inputValidator
              ? await resolved.inputValidator(callOptions?.data)
              : callOptions?.data;
            return handler({ data });
          },
          { _testHandler: handler }
        )
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: tanstackServer.setResponseHeader
}));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: supabaseServer.getServerClient }));

import { onboardPlayer, updateMyPlayerProfile } from '../src/features/player/player.functions';

type Row = Record<string, unknown>;

function rowResult(value: unknown) {
  const builder = {
    select: () => builder,
    eq: () => builder,
    maybeSingle: async () => ({ data: value, error: null })
  };
  return builder;
}

function clientWith(claims: { sub: string } | null, profile: Row | null, rating: Row | null) {
  return {
    auth: {
      getClaims: async () =>
        claims ? { data: { claims }, error: null } : { data: null, error: new Error('JWT expired') }
    },
    from: (table: string) => rowResult(table === 'player_profiles' ? profile : rating)
  };
}

const PROFILE_ROW: Row = {
  user_id: 'sub-1',
  display_name: 'Status Player',
  avatar_url: null,
  preferred_side: 'LEFT',
  dominant_hand: null,
  bio: null,
  created_at: '2026-09-28T00:00:00Z',
  updated_at: '2026-09-28T00:00:00Z'
};
const RATING_ROW: Row = {
  user_id: 'sub-1',
  initial_display_level: 3,
  mu: 3,
  sigma: 1,
  display_level: 3,
  reliability_percent: 10,
  confirmed_competitive_game_groups: 0,
  highest_display_level: 3,
  last_rating_at: null,
  rating_engine: 'app-wide-level',
  rating_engine_version: '1.0.0',
  updated_at: '2026-09-28T00:00:00Z'
};

describe('getOnboardingStatus', () => {
  beforeEach(() => {
    tanstackServer.setResponseHeader.mockReset();
    supabaseServer.getServerClient.mockReset();
  });

  it('reports unauthenticated and incomplete for a signed-in user without rows', async () => {
    supabaseServer.getServerClient.mockReturnValue(clientWith(null, null, null));
    await expect(getOnboardingStatus()).resolves.toEqual({ authenticated: false, complete: false });

    supabaseServer.getServerClient.mockReturnValue(clientWith({ sub: 'sub-1' }, null, null));
    await expect(getOnboardingStatus()).resolves.toEqual({ authenticated: true, complete: false });
    expect(tanstackServer.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store'
    );
  });

  it('reports complete when both rows exist', async () => {
    supabaseServer.getServerClient.mockReturnValue(
      clientWith({ sub: 'sub-1' }, PROFILE_ROW, RATING_ROW)
    );
    await expect(getOnboardingStatus()).resolves.toEqual({ authenticated: true, complete: true });
  });

  it('fails with the stable INCOMPLETE_PLAYER_STATE error for a one-row state', async () => {
    supabaseServer.getServerClient.mockReturnValue(clientWith({ sub: 'sub-1' }, PROFILE_ROW, null));
    await expect(getOnboardingStatus()).rejects.toThrow('INCOMPLETE_PLAYER_STATE');

    supabaseServer.getServerClient.mockReturnValue(clientWith({ sub: 'sub-1' }, null, RATING_ROW));
    await expect(getOnboardingStatus()).rejects.toThrow('INCOMPLETE_PLAYER_STATE');
  });
});

describe('requireAuthenticatedClient', () => {
  beforeEach(() => {
    tanstackServer.setResponseHeader.mockReset();
    supabaseServer.getServerClient.mockReset();
  });

  it('returns the client and the claims subject', async () => {
    const client = clientWith({ sub: 'sub-9' }, null, null);
    supabaseServer.getServerClient.mockReturnValue(client);
    await expect(requireAuthenticatedClient()).resolves.toEqual({ client, userId: 'sub-9' });
    expect(tanstackServer.setResponseHeader).toHaveBeenCalledWith(
      'Cache-Control',
      'private, no-store'
    );
  });

  it('throws the stable UNAUTHENTICATED error when claims are missing or expired', async () => {
    supabaseServer.getServerClient.mockReturnValue(clientWith(null, null, null));
    await expect(requireAuthenticatedClient()).rejects.toThrow('UNAUTHENTICATED');
  });
});

describe('private player server functions', () => {
  beforeEach(() => {
    tanstackServer.setResponseHeader.mockReset();
    supabaseServer.getServerClient.mockReset();
  });

  it('maps the RPC incomplete-state error to the stable INCOMPLETE_PLAYER_STATE error', async () => {
    const client = {
      ...clientWith({ sub: 'sub-1' }, null, null),
      rpc: async () => ({ error: { code: '23514' }, data: null })
    };
    supabaseServer.getServerClient.mockReturnValue(client);
    await expect(
      onboardPlayer({ data: { display_name: 'Ana', preferred_side: 'LEFT', initial_level: 3 } })
    ).rejects.toThrow('INCOMPLETE_PLAYER_STATE');
  });

  it('rejects invalid onboarding payloads through the validator before any client call', async () => {
    supabaseServer.getServerClient.mockReturnValue(clientWith(null, null, null));
    await expect(
      onboardPlayer({ data: { display_name: 'Ana', preferred_side: 'SIDEWAYS', initial_level: 3 } })
    ).rejects.toThrow('INVALID_PLAYER_INPUT');
    expect(supabaseServer.getServerClient).not.toHaveBeenCalled();
  });

  it('requires an onboarded player before profile updates', async () => {
    supabaseServer.getServerClient.mockReturnValue(clientWith({ sub: 'sub-1' }, null, null));
    await expect(updateMyPlayerProfile({ data: { display_name: 'Ana' } })).rejects.toThrow(
      'PLAYER_NOT_ONBOARDED'
    );
  });
});
