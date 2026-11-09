// Pure service-worker cache policy. The worker only ever serves precached public build assets and the
// public offline document; nothing else is read from or written to CacheStorage.
export const LEGACY_RUNTIME_CACHES = ['static-assets'];
export const OFFLINE_DOCUMENT_URL = '/offline.html';
export const SKIP_WAITING_MESSAGE = 'SKIP_WAITING';

type RequestLike = Pick<Request, 'method' | 'mode' | 'url' | 'headers'>;

export function isSkipWaitingMessage(data: unknown) {
  return (
    typeof data === 'object' && data !== null && Reflect.get(data, 'type') === SKIP_WAITING_MESSAGE
  );
}

// Same-origin endpoints that serve private data. They are excluded by path even if the URL ends
// like an asset (for example /api/export.js), so the allowlist is never the only line of defence.
export const PRIVATE_PATH_PREFIXES = ['/_serverFn/', '/auth/', '/api/'];

export function isPrivatePath(pathname: string) {
  return PRIVATE_PATH_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

// Non-navigation, same-origin GET without an Authorization header, outside every private path. The
// precache lookup then decides whether the URL is on the public allowlist.
export function isPrecacheCandidate(request: RequestLike, origin: string) {
  const url = new URL(request.url);
  return (
    request.method === 'GET' &&
    request.mode !== 'navigate' &&
    url.origin === origin &&
    !isPrivatePath(url.pathname) &&
    !request.headers.has('authorization')
  );
}

// Clears runtime caches created by the previous generateSW worker without touching other caches.
export async function removeLegacyCaches(cacheStorage: Pick<CacheStorage, 'keys' | 'delete'>) {
  const names = await cacheStorage.keys();
  await Promise.all(
    names
      .filter((name) => LEGACY_RUNTIME_CACHES.includes(name))
      .map((name) => cacheStorage.delete(name))
  );
}

const PRECACHE_PREFIX = 'workbox-precache';

// Drops anything private that ever reached a cache this worker owns (a precache entry for a private
// path, or an entry that is not a plain public GET), leaving the allowlisted public assets intact.
export async function purgePrivateCacheEntries(cacheStorage: {
  keys(): Promise<string[]>;
  open(name: string): Promise<Pick<Cache, 'keys' | 'delete'>>;
}) {
  const names = (await cacheStorage.keys()).filter((name) => name.startsWith(PRECACHE_PREFIX));
  await Promise.all(
    names.map(async (name) => {
      const cache = await cacheStorage.open(name);
      const requests = await cache.keys();
      await Promise.all(
        requests
          .filter((entry) => isPrivatePath(new URL(entry.url).pathname))
          .map((entry) => cache.delete(entry))
      );
    })
  );
}

export const AUTH_CALLBACK_PATH = '/auth/callback';

// A failed OAuth/PKCE callback must surface as a failure, never as the offline success-looking page.
export function isAuthCallbackNavigation(request: Pick<Request, 'url'>) {
  return new URL(request.url).pathname === AUTH_CALLBACK_PATH;
}

// Private SSR always goes to the network. Only a failed network falls back to the public offline
// document; HTTP errors are returned untouched and auth callbacks never fall back at all.
export function createNavigationHandler({
  fetchFn,
  matchOffline
}: {
  fetchFn: (request: Request) => Promise<Response>;
  matchOffline: () => Promise<Response | undefined>;
}) {
  return async (request: Request) => {
    try {
      return await fetchFn(request);
    } catch (error) {
      if (isAuthCallbackNavigation(request)) throw error;
      const offline = await matchOffline();
      if (offline) return offline;
      throw error;
    }
  };
}
