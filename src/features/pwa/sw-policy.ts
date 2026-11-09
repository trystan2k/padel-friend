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

// Non-navigation, same-origin, credential-free GET only. The precache lookup then decides whether
// the URL is on the allowlist; private SSR, server functions, APIs and Supabase never match.
export function isPrecacheCandidate(request: RequestLike, origin: string) {
  return (
    request.method === 'GET' &&
    request.mode !== 'navigate' &&
    new URL(request.url).origin === origin &&
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
