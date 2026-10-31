import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from '../src/routes/auth.callback';

// The /auth/callback handler is unit tested with a fully mocked Supabase server client so the
// PKCE code exchange never touches the network (no fake server-side fetch interception).
type SessionCookie = { name: string; value: string; options?: object };

const supabaseSsr = vi.hoisted(() => {
  let capturedCookies: { setAll: (cookies: SessionCookie[]) => void } | null = null;
  const exchangeCodeForSession = vi.fn<(code: string) => Promise<{ error: unknown }>>();
  const verifyOtp =
    vi.fn<(params: { token_hash: string; type: string }) => Promise<{ error: unknown }>>();
  const createServerClient = vi.fn<
    (
      url: string,
      key: string,
      options: { cookies: { setAll: (cookies: SessionCookie[]) => void } }
    ) => {
      auth: { exchangeCodeForSession: typeof exchangeCodeForSession; verifyOtp: typeof verifyOtp };
    }
  >((_url: string, _key: string, options) => {
    capturedCookies = options.cookies;
    return { auth: { exchangeCodeForSession, verifyOtp } };
  });
  return {
    createServerClient,
    exchangeCodeForSession,
    verifyOtp,
    setSessionCookies(cookies: SessionCookie[]) {
      capturedCookies?.setAll(cookies);
    }
  };
});

vi.mock('@supabase/ssr', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@supabase/ssr')>();
  return { ...actual, createServerClient: supabaseSsr.createServerClient };
});

// The route's own handler destructures only `request` (see src/routes/auth.callback.ts), but
// TanStack's declared RouteMethodHandlerCtx/RouteMethodResult are router-internal generic types
// a unit test cannot faithfully construct, so the handlers record is narrowed to the minimal
// callable shape with a type guard instead of an unsafe type assertion.
type CallbackGet = (context: { request: Request }) => Promise<Response>;

function isCallbackHandlerRecord(value: unknown): value is { GET?: CallbackGet } {
  return typeof value === 'object' && value !== null && 'GET' in value;
}

const handlers: unknown = Route.options.server?.handlers;
const GET = isCallbackHandlerRecord(handlers) ? handlers.GET : undefined;
if (!GET) throw new Error('auth callback route must expose a server GET handler');

const BASE = 'http://127.0.0.1:4173';

const callbackRequest = async (query: string): Promise<Response> =>
  GET({ request: new Request(`${BASE}/auth/callback${query}`) });

describe('/auth/callback handler', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'http://127.0.0.1:55321');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'test-publishable-key');
    supabaseSsr.createServerClient.mockClear();
    supabaseSsr.exchangeCodeForSession.mockReset();
    supabaseSsr.verifyOtp.mockReset();
  });

  it('forwards every Set-Cookie from the exchange and responds 303 to the safe next', async () => {
    supabaseSsr.exchangeCodeForSession.mockImplementation(async () => {
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token', value: 'token-a', options: { path: '/', httpOnly: true } },
        { name: 'sb-project-auth-token.0', value: 'token-b', options: { path: '/' } }
      ]);
      return { error: null };
    });

    const response = await callbackRequest('?code=abc123');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/dashboard`);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(2);
    expect(cookies[0]).toContain('sb-project-auth-token=token-a');
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[1]).toContain('sb-project-auth-token.0=token-b');
    expect(supabaseSsr.exchangeCodeForSession).toHaveBeenCalledWith('abc123');
  });

  it('honours a validated deep-link next on success', async () => {
    supabaseSsr.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await callbackRequest('?code=abc&next=%2Fmatches%3Ftab%3Dhistory%23top');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/matches?tab=history#top`);
  });

  it('never redirects off-site through a hostile next', async () => {
    supabaseSsr.exchangeCodeForSession.mockResolvedValue({ error: null });
    for (const query of ['?code=abc&next=//evil.com', '?code=abc&next=https%3A%2F%2Fevil.com']) {
      const response = await callbackRequest(query);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${BASE}/dashboard`);
    }
  });

  it('responds 303 to /login?authError=1 when the exchange fails, preserving a safe next', async () => {
    supabaseSsr.exchangeCodeForSession.mockResolvedValue({ error: new Error('exchange failed') });
    const response = await callbackRequest('?code=bad&next=%2Fmatches');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1&next=%2Fmatches`);
  });

  it('falls back to /login?authError=1 without a next when none was supplied', async () => {
    supabaseSsr.exchangeCodeForSession.mockResolvedValue({ error: new Error('exchange failed') });
    const response = await callbackRequest('?code=bad');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1`);
  });

  it('never calls the exchange or leaks raw provider error details when the provider reports an error', async () => {
    const response = await callbackRequest(
      '?code=x&error=server_error&error_description=raw-provider-secret-detail'
    );
    expect(response.status).toBe(303);
    const location = response.headers.get('location');
    expect(location).toBe(`${BASE}/login?authError=1`);
    expect(location).not.toContain('raw-provider-secret-detail');
    expect(location).not.toContain('server_error');
    expect(supabaseSsr.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('verifies an invitation token hash, sets the session cookies and honours next', async () => {
    supabaseSsr.verifyOtp.mockImplementation(async () => {
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token', value: 'invite', options: { path: '/' } }
      ]);
      return { error: null };
    });
    const response = await callbackRequest('?next=%2Fmatches%2Fe1&token_hash=abc123&type=invite');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/matches/e1`);
    expect(response.headers.getSetCookie()[0]).toContain('sb-project-auth-token=invite');
    expect(supabaseSsr.verifyOtp).toHaveBeenCalledWith({ token_hash: 'abc123', type: 'invite' });
    expect(supabaseSsr.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('rejects a failed, replayed or non-invite token hash without a session', async () => {
    supabaseSsr.verifyOtp.mockResolvedValue({
      error: new Error('Token has expired or is invalid')
    });
    const replayed = await callbackRequest('?next=%2Fmatches%2Fe1&token_hash=used&type=invite');
    expect(replayed.status).toBe(303);
    expect(replayed.headers.get('location')).toBe(`${BASE}/login?authError=1&next=%2Fmatches%2Fe1`);
    expect(replayed.headers.getSetCookie()).toEqual([]);

    supabaseSsr.verifyOtp.mockClear();
    for (const type of ['recovery', 'signup', 'magiclink', 'email_change', '']) {
      const response = await callbackRequest(`?token_hash=abc&type=${type}`);
      expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1`);
    }
    const noType = await callbackRequest('?token_hash=abc');
    expect(noType.headers.get('location')).toBe(`${BASE}/login?authError=1`);
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
  });

  it('never verifies a token hash when the provider reported an error', async () => {
    const response = await callbackRequest('?token_hash=abc&type=invite&error=access_denied');
    expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1`);
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
  });

  it('falls back to /login?authError=1 when no code is present', async () => {
    const response = await callbackRequest('');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1`);
    expect(supabaseSsr.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
