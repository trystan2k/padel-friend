import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Route } from '../src/routes/auth.callback';
import { readInviteConfirmation } from '../src/features/auth/invite-confirmation.server';

// The /auth/callback handler is unit tested with a fully mocked Supabase server client so the
// PKCE code exchange never touches the network (no fake server-side fetch interception).
type SessionCookie = { name: string; value: string; options?: object };

const supabaseSsr = vi.hoisted(() => {
  type CapturedCookies = {
    getAll: () => { name: string; value: string }[];
    setAll: (cookies: SessionCookie[]) => void;
  };
  let capturedCookies: CapturedCookies | null = null;
  const exchangeCodeForSession = vi.fn<(code: string) => Promise<{ error: unknown }>>();
  const verifyOtp =
    vi.fn<(params: { token_hash: string; type: string }) => Promise<{ error: unknown }>>();
  const getClaims = vi
    .fn<
      () => Promise<{
        data: { claims: { sub: string; email: string } } | null;
        error: unknown;
      }>
    >()
    .mockResolvedValue({ data: null, error: null });
  const createServerClient = vi.fn<
    (
      url: string,
      key: string,
      options: { cookies: CapturedCookies }
    ) => {
      auth: {
        exchangeCodeForSession: typeof exchangeCodeForSession;
        verifyOtp: typeof verifyOtp;
        getClaims: typeof getClaims;
      };
    }
  >((_url: string, _key: string, options) => {
    capturedCookies = options.cookies;
    return { auth: { exchangeCodeForSession, verifyOtp, getClaims } };
  });
  return {
    createServerClient,
    exchangeCodeForSession,
    verifyOtp,
    getClaims,
    setSessionCookies(cookies: SessionCookie[]) {
      capturedCookies?.setAll(cookies);
    },
    readSessionCookies() {
      return capturedCookies?.getAll() ?? [];
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

function isCallbackHandlerRecord(
  value: unknown
): value is { GET?: CallbackGet; POST?: CallbackGet } {
  return typeof value === 'object' && value !== null && 'GET' in value;
}

const handlers: unknown = Route.options.server?.handlers;
const GET = isCallbackHandlerRecord(handlers) ? handlers.GET : undefined;
const POST = isCallbackHandlerRecord(handlers) ? handlers.POST : undefined;
if (!POST) throw new Error('auth callback route must expose a server POST handler');
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
    supabaseSsr.getClaims.mockReset().mockResolvedValue({ data: null, error: null });
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
    expect(response.headers.get('cache-control')).toBe('private, no-store');
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

  it('stages an invitation without consuming it or changing an existing session on GET', async () => {
    const response = await callbackRequest('?next=%2Fmatches%2Fe1&token_hash=abc123&type=invite');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/auth/confirm-invite`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    const cookies = response.headers.getSetCookie();
    expect(cookies).toHaveLength(1);
    expect(cookies[0]).toContain('HttpOnly');
    expect(cookies[0]).toContain('SameSite=Lax');
    expect(cookies[0]).toContain('Max-Age=600');
    expect(cookies[0]).not.toContain('sb-project-auth-token');
    expect(supabaseSsr.createServerClient).not.toHaveBeenCalled();
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
    expect(supabaseSsr.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it('rejects unsupported invitation types without contacting Auth', async () => {
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

  async function staged(next = '/matches/e1') {
    const response = await callbackRequest(
      `?token_hash=abc123&type=invite&next=${encodeURIComponent(next)}`
    );
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!;
    const confirmation = await readInviteConfirmation(
      new Request(`${BASE}/auth/confirm-invite`, { headers: { cookie } })
    );
    if (!confirmation || 'error' in confirmation) throw new Error('missing confirmation');
    const body = new URLSearchParams({ csrf: confirmation.csrf, account: confirmation.account });
    return { cookie, confirmation, body };
  }

  function submit(cookie: string, body: URLSearchParams, overrides: Record<string, string> = {}) {
    return POST!({
      request: new Request(`${BASE}/auth/callback`, {
        method: 'POST',
        headers: {
          cookie,
          origin: BASE,
          'sec-fetch-site': 'same-origin',
          'content-type': 'application/x-www-form-urlencoded',
          ...overrides
        },
        body
      })
    });
  }

  it('forwards rotated near-expiry session cookies during confirmation read', async () => {
    const response = await callbackRequest('?token_hash=abc123&type=invite');
    const cookie = response.headers.getSetCookie()[0]!.split(';')[0]!;
    supabaseSsr.getClaims.mockImplementationOnce(async () => {
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token.0', value: 'rotated-access', options: { path: '/' } },
        { name: 'sb-project-auth-token.1', value: 'rotated-refresh', options: { path: '/' } }
      ]);
      return { data: { claims: { sub: 'current', email: 'current@example.test' } }, error: null };
    });
    const headers = new Headers();
    // Extra argument is deliberately exercised before the cookie-forwarding fix.
    await Reflect.apply(readInviteConfirmation, undefined, [
      new Request(`${BASE}/auth/confirm-invite`, { headers: { cookie } }),
      headers
    ]);
    expect(headers.getSetCookie()).toEqual([
      'sb-project-auth-token.0=rotated-access; Path=/',
      'sb-project-auth-token.1=rotated-refresh; Path=/'
    ]);
  });

  it.each(['returned', 'rejected'])(
    'fails closed when current claims verification %s',
    async (failure) => {
      const { cookie, body } = await staged();
      const fail = () =>
        failure === 'rejected'
          ? supabaseSsr.getClaims.mockRejectedValueOnce(new Error('private provider failure'))
          : supabaseSsr.getClaims.mockResolvedValueOnce({
              data: null,
              error: new Error('private provider failure')
            });
      fail();
      const confirmation = await readInviteConfirmation(
        new Request(`${BASE}/auth/confirm-invite`, { headers: { cookie } })
      );
      expect(confirmation).toEqual({ error: 'verification_failed' });
      fail();
      const response = await submit(cookie, body);
      expect(response.status).toBe(303);
      expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1`);
      expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
    }
  );

  it('verifies exactly once after same-origin signed confirmation, forwarding session cookies', async () => {
    const { cookie, body } = await staged();
    supabaseSsr.verifyOtp.mockImplementation(async () => {
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token', value: 'invite', options: { path: '/' } },
        { name: 'sb-project-auth-token.0', value: 'chunk', options: { path: '/' } }
      ]);
      return { error: null };
    });
    const response = await submit(cookie, body);
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/matches/e1`);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
    expect(response.headers.get('referrer-policy')).toBe('no-referrer');
    expect(response.headers.getSetCookie()).toHaveLength(3);
    expect(response.headers.getSetCookie()[0]).toContain('Max-Age=0');
    expect(response.headers.getSetCookie()[1]).toContain('sb-project-auth-token=invite');
    expect(response.headers.getSetCookie()[2]).toContain('sb-project-auth-token.0=chunk');
    expect(supabaseSsr.verifyOtp).toHaveBeenCalledExactlyOnceWith({
      token_hash: 'abc123',
      type: 'invite'
    });
    expect(supabaseSsr.exchangeCodeForSession).not.toHaveBeenCalled();

    expect((await submit('', body)).status).toBe(403);
    expect(supabaseSsr.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('threads one cookie state through claims rotation and OTP exchange without stale chunks', async () => {
    supabaseSsr.getClaims.mockResolvedValue({
      data: { claims: { sub: 'current', email: 'current@example.test' } },
      error: null
    });
    const { cookie: pending, body } = await staged();
    const cookie = `${pending}; sb-project-auth-token.0=old0; sb-project-auth-token.1=old1; sb-project-auth-token.2=old2`;
    const gone = { path: '/', maxAge: 0 };
    supabaseSsr.getClaims.mockImplementationOnce(async () => {
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token.0', value: 'new0', options: { path: '/' } },
        { name: 'sb-project-auth-token.1', value: 'new1', options: { path: '/' } },
        { name: 'sb-project-auth-token.2', value: '', options: gone }
      ]);
      return { data: { claims: { sub: 'current', email: 'current@example.test' } }, error: null };
    });
    let seenByOtp: { name: string; value: string }[] = [];
    supabaseSsr.verifyOtp.mockImplementation(async () => {
      seenByOtp = supabaseSsr.readSessionCookies();
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token', value: 'switched', options: { path: '/' } },
        { name: 'sb-project-auth-token.0', value: '', options: gone },
        { name: 'sb-project-auth-token.1', value: '', options: gone }
      ]);
      return { error: null };
    });
    supabaseSsr.createServerClient.mockClear();

    const response = await submit(cookie, body);

    expect(supabaseSsr.createServerClient).toHaveBeenCalledTimes(1);
    expect(seenByOtp.filter((entry) => entry.name.startsWith('sb-project-auth-token'))).toEqual([
      { name: 'sb-project-auth-token.0', value: 'new0' },
      { name: 'sb-project-auth-token.1', value: 'new1' }
    ]);
    const setCookies = response.headers.getSetCookie();
    const names = setCookies.map((entry) => entry.split('=')[0]);
    expect(new Set(names).size).toBe(names.length);
    expect(setCookies.find((entry) => entry.startsWith('sb-project-auth-token='))).toContain(
      'switched'
    );
    for (const chunk of ['.0', '.1', '.2']) {
      expect(
        setCookies.find((entry) => entry.startsWith(`sb-project-auth-token${chunk}=`))
      ).toContain('Max-Age=0');
    }
    const joined = setCookies.join('\n');
    expect(joined).not.toMatch(/old[012]|new[01]/);
    expect(supabaseSsr.verifyOtp).toHaveBeenCalledTimes(1);
  });

  it('flushes rotated cookies and fails closed when verifyOtp throws after rotating them', async () => {
    supabaseSsr.getClaims.mockResolvedValue({
      data: { claims: { sub: 'current', email: 'current@example.test' } },
      error: null
    });
    const { cookie: pending, body } = await staged();
    const cookie = `${pending}; sb-project-auth-token.0=old0; sb-project-auth-token.1=old1`;
    const gone = { path: '/', maxAge: 0 };
    supabaseSsr.verifyOtp.mockImplementationOnce(async () => {
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token.0', value: 'rotated0', options: { path: '/' } },
        { name: 'sb-project-auth-token.1', value: '', options: gone }
      ]);
      throw new Error('private provider failure');
    });

    const response = await submit(cookie, body);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1&next=%2Fmatches%2Fe1`);
    const setCookies = response.headers.getSetCookie();
    expect(setCookies.find((entry) => entry.startsWith('sb-project-auth-token.0='))).toContain(
      'rotated0'
    );
    expect(setCookies.find((entry) => entry.startsWith('sb-project-auth-token.1='))).toContain(
      'Max-Age=0'
    );
    expect(setCookies.join('\n')).not.toMatch(/old[01]/);
    expect(response.headers.get('cache-control')).toBe('private, no-store');
  });

  it('resists replay of the original link, cookie and form after a successful confirmation', async () => {
    // Mirrors GoTrue: an invite token hash verifies once; a spent hash is rejected.
    const spent = new Set<string>();
    supabaseSsr.verifyOtp.mockImplementation(async ({ token_hash }) => {
      if (spent.has(token_hash))
        return { error: new Error('Email link is invalid or has expired') };
      spent.add(token_hash);
      supabaseSsr.setSessionCookies([
        { name: 'sb-project-auth-token', value: 'invite-session', options: { path: '/' } }
      ]);
      return { error: null };
    });
    // Original pending-invite cookie and exact form payload captured from the first request.
    const { cookie, body } = await staged();
    const original = new URLSearchParams(body);

    const first = await submit(cookie, body);
    expect(first.headers.get('location')).toBe(`${BASE}/matches/e1`);
    expect(first.headers.getSetCookie().join('\n')).toContain(
      'sb-project-auth-token=invite-session'
    );

    // A stolen copy of the cookie still reads the confirmation (stateless) but grants no session.
    const readHeaders = new Headers();
    const reread = await readInviteConfirmation(
      new Request(`${BASE}/auth/confirm-invite`, { headers: { cookie } }),
      readHeaders
    );
    expect(reread).not.toBeNull();
    expect(readHeaders.getSetCookie()).toEqual([]);

    const replay = await submit(cookie, original);
    expect(replay.status).toBe(303);
    expect(replay.headers.get('location')).toBe(`${BASE}/login?authError=1&next=%2Fmatches%2Fe1`);
    expect(replay.headers.getSetCookie().join('\n')).not.toContain('sb-project-auth-token');
    expect(supabaseSsr.verifyOtp).toHaveBeenCalledTimes(2);
  });

  it('rejects cross-site, missing/null Origin, foreign Fetch Metadata and wrong content type before Auth', async () => {
    const { cookie, body } = await staged();
    supabaseSsr.createServerClient.mockClear();
    const invalidHeaders: Record<string, string>[] = [
      { origin: 'https://attacker.test' },
      { origin: '' },
      { origin: 'null' },
      { 'sec-fetch-site': 'cross-site' },
      { 'sec-fetch-site': 'same-site' },
      { 'content-type': 'application/json' }
    ];
    for (const overrides of invalidHeaders) {
      const response = await submit(cookie, body, overrides);
      expect(response.status).toBe(403);
      expect(response.headers.get('cache-control')).toBe('private, no-store');
    }
    expect(supabaseSsr.createServerClient).not.toHaveBeenCalled();
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
  });

  it('rejects missing, forged, mismatched and expired signed state before verifyOtp', async () => {
    const { cookie, body } = await staged();
    expect((await submit('', body)).status).toBe(403);
    expect((await submit(cookie, new URLSearchParams())).status).toBe(403);
    expect((await submit(cookie, new URLSearchParams({ csrf: '0'.repeat(64) }))).status).toBe(403);
    const other = await staged('/matches/another');
    expect((await submit(other.cookie, body)).status).toBe(403);
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 601_000);
    try {
      expect((await submit(cookie, body)).status).toBe(403);
      expect(
        await readInviteConfirmation(
          new Request(`${BASE}/auth/confirm-invite`, { headers: { cookie } })
        )
      ).toBeNull();
    } finally {
      clock.mockRestore();
    }
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
  });

  it('binds the warning to trusted claims and refuses stale account switches', async () => {
    supabaseSsr.getClaims.mockResolvedValue({
      data: { claims: { sub: 'current-account', email: 'current@example.test' } },
      error: null
    });
    const { cookie, confirmation, body } = await staged();
    expect(confirmation.email).toBe('current@example.test');
    expect(confirmation.account).toBe('current-account');
    supabaseSsr.getClaims.mockResolvedValue({
      data: { claims: { sub: 'another-account', email: 'another@example.test' } },
      error: null
    });
    expect((await submit(cookie, body)).status).toBe(403);
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
  });

  it('normalizes hostile next on invitation success and safely handles spent/forged hashes', async () => {
    for (const next of ['//evil.com', 'https://evil.com', '/auth/confirm-invite']) {
      const { cookie, body } = await staged(next);
      supabaseSsr.verifyOtp.mockResolvedValue({ error: null });
      expect((await submit(cookie, body)).headers.get('location')).toBe(`${BASE}/dashboard`);
    }
    const { cookie, body } = await staged();
    supabaseSsr.verifyOtp.mockResolvedValue({ error: new Error('provider-private-detail') });
    const failure = await submit(cookie, body);
    expect(failure.status).toBe(303);
    expect(failure.headers.get('location')).toBe(`${BASE}/login?authError=1&next=%2Fmatches%2Fe1`);
    expect(failure.headers.getSetCookie()[0]).toContain('Max-Age=0');
  });

  it('uses Secure host-only confirmation cookies on HTTPS, retaining authCookieOptions', async () => {
    const response = await GET({
      request: new Request('https://app.example/auth/callback?token_hash=abc&type=invite')
    });
    const cookie = response.headers.getSetCookie()[0];
    expect(cookie).toContain('__Host-pf-invite-confirmation=');
    expect(cookie).toContain('Secure');
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).not.toContain('Domain=');
  });

  it('keeps PKCE exchange authoritative when both code and hash are supplied', async () => {
    supabaseSsr.exchangeCodeForSession.mockResolvedValue({ error: null });
    const response = await callbackRequest('?code=pkce&token_hash=abc&type=invite');
    expect(response.headers.get('location')).toBe(`${BASE}/dashboard`);
    expect(supabaseSsr.exchangeCodeForSession).toHaveBeenCalledExactlyOnceWith('pkce');
    expect(supabaseSsr.verifyOtp).not.toHaveBeenCalled();
  });

  it('falls back to /login?authError=1 when no code is present', async () => {
    const response = await callbackRequest('');
    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe(`${BASE}/login?authError=1`);
    expect(supabaseSsr.exchangeCodeForSession).not.toHaveBeenCalled();
  });
});
