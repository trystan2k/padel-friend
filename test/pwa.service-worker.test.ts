import { describe, expect, it, vi } from 'vitest';
import {
  OFFLINE_DOCUMENT_URL,
  createNavigationHandler,
  isPrecacheCandidate,
  isSkipWaitingMessage,
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
