// Worker-level backstop for the shared-cache boundary. Individual handlers already set
// private/no-store through requireAuthenticatedClient; this closes every response they miss
// (SSR HTML, auth redirects/errors, server-function transport) without touching public assets.
export const PRIVATE_CACHE_CONTROL = 'private, no-store';

const PRIVATE_PATH_PREFIXES = ['/_serverFn/', '/auth/', '/api/'];
const SUPABASE_AUTH_COOKIE = /(?:^|;\s*)sb-[^=;]*=/;

type RequestLike = Pick<Request, 'url' | 'headers'>;

function isPrivateRequest(request: RequestLike) {
  const { pathname } = new URL(request.url);
  return (
    PRIVATE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix)) ||
    SUPABASE_AUTH_COOKIE.test(request.headers.get('cookie') ?? '')
  );
}

function needsPrivatePolicy(request: RequestLike, response: Response) {
  if (response.headers.has('set-cookie') || isPrivateRequest(request)) return true;
  // Locale- and theme-dependent SSR documents are never shared either.
  return (response.headers.get('content-type') ?? '').toLowerCase().startsWith('text/html');
}

function hasNoStore(headers: Headers) {
  return /(?:^|,)\s*no-store\s*(?:,|$)/i.test(headers.get('cache-control') ?? '');
}

/**
 * Returns the response unchanged when it is a public asset or already private/no-store;
 * otherwise a copy (body stream and every Set-Cookie preserved) with private/no-store and a
 * Vary on the request inputs that select the representation.
 */
export function applyPrivateResponsePolicy(request: RequestLike, response: Response) {
  if (!needsPrivatePolicy(request, response)) return response;
  const alreadyPrivate = hasNoStore(response.headers) && response.headers.has('vary');
  if (alreadyPrivate) return response;
  const next = new Response(response.body, response);
  next.headers.set('Cache-Control', PRIVATE_CACHE_CONTROL);
  next.headers.append('Vary', 'Cookie');
  next.headers.append('Vary', 'Accept-Language');
  return next;
}
