import { beforeEach, describe, expect, it, vi } from 'vitest';

// createServerFn is replaced by a thin double that runs the real handler; the Supabase server
// client is mocked per scenario (same approach as player.onboarding-status.test.ts).
const tanstackServer = vi.hoisted(() => ({
  setResponseHeader: vi.fn<(name: string, value: string) => void>()
}));
const supabaseServer = vi.hoisted(() => ({
  getServerClient: vi.fn<() => unknown>()
}));

vi.mock('@tanstack/react-start', () => ({
  createServerFn: () => {
    const builder = {
      handler: (handler: () => unknown) => async () => handler()
    };
    return builder;
  }
}));
vi.mock('@tanstack/react-start/server', () => ({
  setResponseHeader: tanstackServer.setResponseHeader
}));
vi.mock('../src/lib/supabase/server', () => ({ getServerClient: supabaseServer.getServerClient }));

import { getPublicHomepageAuthenticated } from '../src/features/public-homepage/public-homepage.functions';

function clientReturning(result: { data: unknown; error: unknown }) {
  return { auth: { getClaims: vi.fn<() => Promise<unknown>>(async () => result) } };
}

describe('getPublicHomepageAuthenticated', () => {
  beforeEach(() => {
    tanstackServer.setResponseHeader.mockReset();
    supabaseServer.getServerClient.mockReset();
  });

  it('is true for verified claims and returns nothing but the boolean', async () => {
    supabaseServer.getServerClient.mockReturnValue(
      clientReturning({
        data: { claims: { sub: 'user-1', email: 'ana@example.com', role: 'authenticated' } },
        error: null
      })
    );

    const result = await getPublicHomepageAuthenticated();

    expect(result).toBe(true);
    const serialized = JSON.stringify(result);
    expect(serialized).toBe('true');
    expect(serialized).not.toMatch(/user-1|ana@example\.com|authenticated"/);
  });

  it.each([
    ['anonymous (no claims)', { data: null, error: null }],
    ['claims without a subject', { data: { claims: {} }, error: null }],
    ['invalid token', { data: null, error: new Error('invalid JWT') }],
    ['expired token', { data: null, error: new Error('JWT expired') }],
    [
      'recoverable auth lookup failure',
      { data: { claims: { sub: 'user-1' } }, error: new Error('fetch failed') }
    ]
  ])('is false (guest) for %s', async (_name, result) => {
    supabaseServer.getServerClient.mockReturnValue(clientReturning(result));

    await expect(getPublicHomepageAuthenticated()).resolves.toBe(false);
  });

  it('keeps the response private and uncacheable in both states', async () => {
    supabaseServer.getServerClient.mockReturnValue(
      clientReturning({ data: { claims: { sub: 'user-1' } }, error: null })
    );
    await getPublicHomepageAuthenticated();
    supabaseServer.getServerClient.mockReturnValue(clientReturning({ data: null, error: null }));
    await getPublicHomepageAuthenticated();

    expect(tanstackServer.setResponseHeader).toHaveBeenCalledTimes(2);
    for (const call of tanstackServer.setResponseHeader.mock.calls)
      expect(call).toEqual(['Cache-Control', 'private, no-store']);
  });

  it('is false (guest) when getClaims throws an invalid-claims verification error', async () => {
    // Regression: auth-js rethrows non-AuthError failures, e.g. getAlgorithm's 'Invalid alg claim'.
    supabaseServer.getServerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn<() => Promise<unknown>>(async () => {
          throw new Error('Invalid alg claim');
        })
      }
    });

    await expect(getPublicHomepageAuthenticated()).resolves.toBe(false);
  });

  it('is false (guest) when getClaims throws a malformed-token decode error', async () => {
    supabaseServer.getServerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn<() => Promise<unknown>>(async () => {
          throw new SyntaxError('Unexpected token at position 3');
        })
      }
    });

    await expect(getPublicHomepageAuthenticated()).resolves.toBe(false);
  });

  it('is false (guest) when the auth lookup fails transiently', async () => {
    supabaseServer.getServerClient.mockReturnValue({
      auth: {
        getClaims: vi.fn<() => Promise<unknown>>(async () => {
          throw new Error('fetch failed');
        })
      }
    });

    // Recoverable lookup failures never take the public page down.
    await expect(getPublicHomepageAuthenticated()).resolves.toBe(false);
  });

  it('does not swallow client-creation programming errors', async () => {
    supabaseServer.getServerClient.mockImplementation(() => {
      throw new Error('missing env');
    });

    // getServerClient() failures propagate raw by repo convention (see requireAuthenticatedClient);
    // only failures inside the claims lookup resolve as guest.
    await expect(getPublicHomepageAuthenticated()).rejects.toThrow('missing env');
  });
});
