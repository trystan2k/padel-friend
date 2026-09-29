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
// verifiedAvatarKey is wrapped in a spy that keeps the REAL implementation: avatar-key
// ownership/not-found behavior stays under test while call wiring is asserted per scenario.
vi.mock('../src/features/player/player.server', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/features/player/player.server')>();
  return {
    ...actual,
    verifiedAvatarKey: vi.fn<typeof actual.verifiedAvatarKey>(actual.verifiedAvatarKey)
  };
});

import { verifiedAvatarKey } from '../src/features/player/player.server';
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

const OWNER_ID = '11111111-1111-4111-8111-111111111111';
const OBJECT_ID = '22222222-2222-4222-8222-222222222222';
const AVATAR_KEY = `${OWNER_ID}/${OBJECT_ID}.png`;

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

describe('updateMyPlayerProfile avatar verification', () => {
  beforeEach(() => {
    tanstackServer.setResponseHeader.mockReset();
    supabaseServer.getServerClient.mockReset();
    vi.mocked(verifiedAvatarKey).mockClear();
  });

  // Client double for profile updates: playerRows reads go through select/maybeSingle, the
  // UPDATE is recorded, and Storage answers the owner-folder listing verifiedAvatarKey uses.
  function clientWithAvatarFolder(objectNames: string[], storedAvatarKey: string | null) {
    const updates: unknown[] = [];
    const client = {
      auth: {
        getClaims: async () => ({ data: { claims: { sub: OWNER_ID } }, error: null })
      },
      from: (table: string) => ({
        select: () => ({
          eq: () => ({
            maybeSingle: async () => ({
              data:
                table === 'player_profiles'
                  ? { ...PROFILE_ROW, user_id: OWNER_ID, avatar_url: storedAvatarKey }
                  : RATING_ROW,
              error: null
            })
          })
        }),
        update: (values: unknown) => {
          updates.push(values);
          return { eq: async () => ({ error: null }) };
        }
      }),
      storage: {
        from: () => ({
          list: async () => ({ data: objectNames.map((name) => ({ name })), error: null }),
          createSignedUrl: async () => ({
            data: { signedUrl: 'https://signed.example/avatar' },
            error: null
          })
        })
      }
    };
    return { client, updates };
  }

  it('verifies a provided avatar key before writing, even when it equals the stored key', async () => {
    const { client, updates } = clientWithAvatarFolder([`${OBJECT_ID}.png`], AVATAR_KEY);
    supabaseServer.getServerClient.mockReturnValue(client);
    await expect(
      updateMyPlayerProfile({ data: { avatar_url: AVATAR_KEY } })
    ).resolves.toMatchObject({ display_name: 'Status Player' });
    expect(verifiedAvatarKey).toHaveBeenCalledTimes(1);
    expect(verifiedAvatarKey).toHaveBeenCalledWith(client, OWNER_ID, AVATAR_KEY);
    expect(updates).toEqual([{ avatar_url: AVATAR_KEY }]);
  });

  it('never verifies when avatar_url is null or absent', async () => {
    const { client, updates } = clientWithAvatarFolder([], null);
    supabaseServer.getServerClient.mockReturnValue(client);
    await expect(
      updateMyPlayerProfile({ data: { avatar_url: null, display_name: 'Null Key' } })
    ).resolves.toMatchObject({ display_name: 'Status Player' });
    await expect(
      updateMyPlayerProfile({ data: { display_name: 'No Key' } })
    ).resolves.toMatchObject({ display_name: 'Status Player' });
    expect(verifiedAvatarKey).not.toHaveBeenCalled();
    expect(updates).toEqual([
      { avatar_url: null, display_name: 'Null Key' },
      { display_name: 'No Key' }
    ]);
  });

  it('rejects an avatar key whose object is absent from the owner folder before any write', async () => {
    const { client, updates } = clientWithAvatarFolder([], null);
    supabaseServer.getServerClient.mockReturnValue(client);
    await expect(updateMyPlayerProfile({ data: { avatar_url: AVATAR_KEY } })).rejects.toThrow(
      'AVATAR_NOT_FOUND'
    );
    expect(verifiedAvatarKey).toHaveBeenCalledTimes(1);
    expect(updates).toEqual([]);
  });

  it('rejects malformed or unsupported avatar keys through the validator before any client call', async () => {
    supabaseServer.getServerClient.mockReturnValue(
      clientWithAvatarFolder([`${OBJECT_ID}.png`], null).client
    );
    for (const avatarUrl of [
      'u1/a.png',
      `${OBJECT_ID}.png`,
      `${OWNER_ID}/nested/${OBJECT_ID}.png`,
      `${OWNER_ID}/${OBJECT_ID}.gif`,
      `${OWNER_ID}/${OBJECT_ID}`
    ]) {
      await expect(updateMyPlayerProfile({ data: { avatar_url: avatarUrl } })).rejects.toThrow(
        'INVALID_PLAYER_INPUT'
      );
    }
    expect(supabaseServer.getServerClient).not.toHaveBeenCalled();
    expect(verifiedAvatarKey).not.toHaveBeenCalled();
  });
});
