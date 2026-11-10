import { describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_DOCUMENT_URL,
  createNavigationHandler,
  isAuthCallbackNavigation,
  isPrecacheCandidate,
  isPrivatePath,
  isSkipWaitingMessage,
  purgePrivateCacheEntries,
  removeLegacyCaches
} from '../src/features/pwa/sw-policy';

const origin = 'http://127.0.0.1:4173';
const request = (
  url: string,
  init: { method?: string; mode?: RequestMode; headers?: HeadersInit } = {}
) => ({
  url,
  method: init.method ?? 'GET',
  mode: init.mode ?? 'no-cors',
  headers: new Headers(init.headers)
});

describe('isPrecacheCandidate', () => {
  it('accepts same-origin credential-free non-navigation GETs only', () => {
    expect(isPrecacheCandidate(request(origin + '/assets/app-AbCdEf12.js'), origin)).toBe(true);
    expect(
      isPrecacheCandidate(request(origin + '/manifest.webmanifest', { mode: 'cors' }), origin)
    ).toBe(true);
  });

  it.each([
    ['navigation', request(origin + '/dashboard', { mode: 'navigate' })],
    ['non-GET', request(origin + '/_serverFn/x', { method: 'POST' })],
    [
      'cross-origin Supabase auth',
      request('http://127.0.0.1:54321/auth/v1/token', { mode: 'cors' })
    ],
    ['cross-origin image', request('https://images.example.com/a.png')],
    [
      'authorization header',
      request(origin + '/api/me', { headers: { Authorization: 'Bearer x' } })
    ]
  ])('rejects %s', (_name, candidate) => {
    expect(isPrecacheCandidate(candidate, origin)).toBe(false);
  });
});

describe('private endpoints with asset-like suffixes', () => {
  it.each(['/api/export.js', '/_serverFn/abc.css', '/auth/v1/logo.png', '/auth/callback'])(
    'is never a precache candidate: %s',
    (path) => {
      expect(isPrecacheCandidate(request(origin + path, { mode: 'cors' }), origin)).toBe(false);
    }
  );
});

describe('removeLegacyCaches', () => {
  it('deletes only the legacy generic runtime cache', async () => {
    const names = ['static-assets', 'workbox-precache-v2-' + origin + '/', 'unrelated-app'];
    const deleted: string[] = [];
    await removeLegacyCaches({
      keys: () => Promise.resolve(names),
      delete: (name) => {
        deleted.push(name);
        return Promise.resolve(true);
      }
    });
    expect(deleted).toEqual(['static-assets']);
  });
});

describe('purgePrivateCacheEntries', () => {
  const entry = (path: string) => new Request(origin + path);

  function fakeStorage(contents: Record<string, string[]>) {
    const deleted: string[] = [];
    return {
      deleted,
      storage: {
        keys: () => Promise.resolve(Object.keys(contents)),
        open: (name: string) =>
          Promise.resolve({
            keys: () => Promise.resolve((contents[name] ?? []).map(entry)),
            delete: (entryRequest: RequestInfo | URL) => {
              deleted.push(name + ':' + new URL(new Request(entryRequest).url).pathname);
              return Promise.resolve(true);
            }
          })
      }
    };
  }

  it('removes private entries from owned precaches and keeps public assets and foreign caches', async () => {
    const { storage, deleted } = fakeStorage({
      'workbox-precache-v2-http://x/': [
        '/assets/app-AbCdEf12.js',
        '/_serverFn/old',
        '/api/me.js',
        '/offline.html'
      ],
      'unrelated-app': ['/api/keep']
    });
    await purgePrivateCacheEntries(storage);
    expect(deleted).toEqual([
      'workbox-precache-v2-http://x/:/_serverFn/old',
      'workbox-precache-v2-http://x/:/api/me.js'
    ]);
  });

  it('purges cached private SSR documents and keeps every allowlisted public entry', async () => {
    const { storage, deleted } = fakeStorage({
      'workbox-precache-v2-http://x/': [
        '/dashboard',
        '/matches/123',
        '/index.html',
        '/assets/app-AbCdEf12.js',
        '/assets/fonts/inter-Zz09_-aB.woff2',
        '/manifest.webmanifest',
        '/icon.svg',
        '/icons/icon-192.png',
        '/offline.html'
      ]
    });
    await purgePrivateCacheEntries(storage);
    expect(deleted).toEqual([
      'workbox-precache-v2-http://x/:/dashboard',
      'workbox-precache-v2-http://x/:/matches/123',
      'workbox-precache-v2-http://x/:/index.html'
    ]);
  });

  it('matches the private path prefixes only', () => {
    expect(['/api/x', '/_serverFn/y', '/auth/callback'].every(isPrivatePath)).toBe(true);
    expect(['/assets/auth.js', '/offline.html', '/apiary.js'].some(isPrivatePath)).toBe(false);
  });
});

describe('createNavigationHandler', () => {
  const navigate = new Request(origin + '/dashboard');

  it('always uses the network when it works, including HTTP errors', async () => {
    const matchOffline = vi.fn<() => Promise<Response | undefined>>(() =>
      Promise.resolve(new Response('offline'))
    );
    const failed = new Response('server error', { status: 500 });
    const handler = createNavigationHandler({
      fetchFn: () => Promise.resolve(failed),
      matchOffline
    });
    expect(await handler(navigate)).toBe(failed);
    expect(matchOffline).not.toHaveBeenCalled();
  });

  it('returns only the public offline document when the network fails', async () => {
    const offline = new Response('offline');
    const handler = createNavigationHandler({
      fetchFn: () => Promise.reject(new TypeError('Failed to fetch')),
      matchOffline: () => Promise.resolve(offline)
    });
    expect(await handler(navigate)).toBe(offline);
  });

  it('keeps the failure honest when no offline document is cached', async () => {
    const handler = createNavigationHandler({
      fetchFn: () => Promise.reject(new TypeError('Failed to fetch')),
      matchOffline: () => Promise.resolve(undefined)
    });
    await expect(handler(navigate)).rejects.toThrow('Failed to fetch');
  });

  it('never masks a failed auth callback with the offline document', async () => {
    const matchOffline = vi.fn<() => Promise<Response | undefined>>(() =>
      Promise.resolve(new Response('offline'))
    );
    const handler = createNavigationHandler({
      fetchFn: () => Promise.reject(new TypeError('Failed to fetch')),
      matchOffline
    });
    await expect(handler(new Request(origin + '/auth/callback?code=abc'))).rejects.toThrow(
      'Failed to fetch'
    );
    expect(matchOffline).not.toHaveBeenCalled();
  });

  it('matches only the auth callback path', () => {
    expect(isAuthCallbackNavigation(new Request(origin + '/auth/callback?code=x'))).toBe(true);
    for (const path of ['/dashboard', '/auth/callback/extra', '/login?next=/auth/callback'])
      expect(isAuthCallbackNavigation(new Request(origin + path))).toBe(false);
  });

  it('serves the offline document from a stable public URL', () => {
    expect(OFFLINE_DOCUMENT_URL).toBe('/offline.html');
  });
});

describe('isSkipWaitingMessage', () => {
  it('matches only the explicit update message', () => {
    expect(isSkipWaitingMessage({ type: 'SKIP_WAITING' })).toBe(true);
    for (const data of [null, undefined, 'SKIP_WAITING', {}, { type: 'OTHER' }])
      expect(isSkipWaitingMessage(data)).toBe(false);
  });
});
