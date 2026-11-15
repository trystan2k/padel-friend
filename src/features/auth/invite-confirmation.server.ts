import { createServerClient, parseCookieHeader, serializeCookieHeader } from '@supabase/ssr';
import { authCookieOptions } from '../../lib/supabase/cookie-options';
import type { Database } from '../../lib/supabase/database.types';
import { normalizeReturnPath } from './return-path';

function cookieName(request: Request) {
  return new URL(request.url).protocol === 'https:'
    ? '__Host-pf-invite-confirmation'
    : 'pf-invite-confirmation';
}
const MAX_AGE = 10 * 60;

type PendingInvite = {
  tokenHash: string;
  next: string;
  expires: number;
  secret: string;
};

export function privateInviteHeaders() {
  return new Headers({
    'Cache-Control': 'private, no-store',
    'Referrer-Policy': 'no-referrer'
  });
}

function cookieOptions(url: URL) {
  return {
    ...authCookieOptions(url.protocol),
    httpOnly: true,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: MAX_AGE
  };
}

function pendingInvite(request: Request): PendingInvite | null {
  const value = parseCookieHeader(request.headers.get('cookie') ?? '').find(
    (cookie) => cookie.name === cookieName(request)
  )?.value;
  if (!value) return null;
  try {
    const pending: unknown = JSON.parse(value);
    if (
      typeof pending !== 'object' ||
      pending === null ||
      !('tokenHash' in pending) ||
      typeof pending.tokenHash !== 'string' ||
      !pending.tokenHash ||
      pending.tokenHash.length > 1024 ||
      !('next' in pending) ||
      typeof pending.next !== 'string' ||
      !('expires' in pending) ||
      typeof pending.expires !== 'number' ||
      pending.expires <= Date.now() ||
      pending.expires > Date.now() + MAX_AGE * 1000 ||
      !('secret' in pending) ||
      typeof pending.secret !== 'string' ||
      !/^[a-f0-9]{64}$/.test(pending.secret)
    )
      return null;
    return {
      tokenHash: pending.tokenHash,
      next: normalizeReturnPath(pending.next),
      expires: pending.expires,
      secret: pending.secret
    };
  } catch {
    return null;
  }
}

export function stageInvite(request: Request, tokenHash: string, next: string) {
  const url = new URL(request.url);
  const headers = privateInviteHeaders();
  const pending: PendingInvite = {
    tokenHash,
    next: normalizeReturnPath(next),
    expires: Date.now() + MAX_AGE * 1000,
    secret: Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
      byte.toString(16).padStart(2, '0')
    ).join('')
  };
  headers.append(
    'Set-Cookie',
    serializeCookieHeader(cookieName(request), JSON.stringify(pending), cookieOptions(url))
  );
  // Do not propagate the bearer token to rendered URLs, assets or navigation.
  headers.set('Location', new URL('/auth/confirm-invite', url).toString());
  return new Response(null, { status: 303, headers });
}

function inviteClient(request: Request, headers?: Headers) {
  return createServerClient<Database>(
    import.meta.env.VITE_SUPABASE_URL,
    import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    {
      cookieOptions: authCookieOptions(new URL(request.url).protocol),
      cookies: {
        getAll: () =>
          parseCookieHeader(request.headers.get('cookie') ?? '').filter(
            (cookie): cookie is { name: string; value: string } => cookie.value !== undefined
          ),
        setAll(cookies) {
          // Reading confirmation must not replace/refresh the browser's session.
          for (const { name, value, options } of cookies) {
            headers?.append('Set-Cookie', serializeCookieHeader(name, value, options));
          }
        }
      }
    }
  );
}

// getClaims may rotate the refresh token, so its cookie updates must reach the browser. A failed
// check is "unknown", never "no account": callers fail closed instead of replacing the session.
async function currentAccount(request: Request, headers: Headers) {
  try {
    const { data, error } = await inviteClient(request, headers).auth.getClaims();
    if (error) return null;
    const claims = data?.claims;
    return {
      account: typeof claims?.sub === 'string' ? claims.sub : '',
      email: typeof claims?.email === 'string' ? claims.email : null
    };
  } catch {
    return null;
  }
}

function message(pending: PendingInvite, account: string) {
  return new TextEncoder().encode(
    JSON.stringify([pending.tokenHash, pending.next, pending.expires, account])
  );
}

function signingKey(secret: string) {
  return crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify']
  );
}

export async function readInviteConfirmation(request: Request, headers = new Headers()) {
  const pending = pendingInvite(request);
  if (!pending) return null;
  const identity = await currentAccount(request, headers);
  if (!identity) return { error: 'verification_failed' as const };
  const signature = await crypto.subtle.sign(
    'HMAC',
    await signingKey(pending.secret),
    message(pending, identity.account)
  );
  return {
    ...identity,
    csrf: Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join(
      ''
    )
  };
}

export async function confirmInvite(request: Request) {
  const url = new URL(request.url);
  const headers = privateInviteHeaders();
  const forbidden = () => new Response(null, { status: 403, headers });
  const fetchSite = request.headers.get('sec-fetch-site');
  if (
    request.headers.get('origin') !== url.origin ||
    (fetchSite !== null && fetchSite !== 'same-origin') ||
    request.headers.get('content-type')?.split(';')[0]?.trim() !==
      'application/x-www-form-urlencoded'
  )
    return forbidden();

  const pending = pendingInvite(request);
  if (!pending) return forbidden();
  const form = new URLSearchParams(await request.text());
  const csrf = form.get('csrf') ?? '';
  const account = form.get('account') ?? '';
  if (!/^[a-f0-9]{64}$/.test(csrf)) return forbidden();
  const signature = Uint8Array.from(csrf.match(/../g) ?? [], (byte) => Number.parseInt(byte, 16));
  if (
    !(await crypto.subtle.verify(
      'HMAC',
      await signingKey(pending.secret),
      signature,
      message(pending, account)
    ))
  )
    return forbidden();
  // A stale tab must not switch an account different from the warning shown. An unverifiable
  // current session never proceeds to verifyOtp.
  const current = await currentAccount(request, headers);
  if (!current) {
    headers.set('Location', new URL('/login?authError=1', url).toString());
    return new Response(null, { status: 303, headers });
  }
  if (current.account !== account) return forbidden();

  headers.append(
    'Set-Cookie',
    serializeCookieHeader(cookieName(request), '', {
      ...cookieOptions(url),
      maxAge: 0
    })
  );
  const { error } = await inviteClient(request, headers).auth.verifyOtp({
    token_hash: pending.tokenHash,
    type: 'invite'
  });
  const destination = error
    ? new URL('/login?authError=1', url)
    : new URL(normalizeReturnPath(pending.next), url);
  if (error && pending.next !== '/dashboard') destination.searchParams.set('next', pending.next);
  headers.set('Location', destination.toString());
  return new Response(null, { status: 303, headers });
}
