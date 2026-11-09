import { afterEach, expect, it, vi } from 'vitest';

vi.mock('workbox-precaching', () => ({
  cleanupOutdatedCaches: vi.fn<() => void>(),
  matchPrecache: vi.fn<() => Promise<undefined>>(),
  precache: vi.fn<() => void>()
}));

afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

it('registers real push/click events, closes notification, performs no fetch or account cache access', async () => {
  type WorkerEvent = {
    data?: { json(): unknown };
    notification?: { data: unknown; close(): void };
    waitUntil(promise: Promise<unknown>): void;
  };
  const listeners = new Map<string, (event: WorkerEvent) => void>();
  const notificationId = 'd7381c74-c888-4fb3-8e6f-6d46113cb949';
  const showNotification = vi.fn<() => Promise<void>>().mockResolvedValue(undefined);
  const openWindow = vi.fn<(url: string) => Promise<void>>().mockResolvedValue(undefined);
  const fetch = vi.fn<() => Promise<Response>>();
  const cacheMatch = vi.fn<() => void>();
  vi.stubGlobal('PRECACHE_MANIFEST', []);
  vi.stubGlobal('fetch', fetch);
  vi.stubGlobal('caches', { match: cacheMatch });
  vi.stubGlobal('self', {
    location: { origin: 'https://app.example' },
    registration: { showNotification },
    clients: { matchAll: () => Promise.resolve([]), openWindow },
    addEventListener: (type: string, listener: (event: WorkerEvent) => void) =>
      listeners.set(type, listener)
  });
  await import('../src/features/pwa/service-worker');
  const tasks: Promise<unknown>[] = [];
  const waitUntil = (promise: Promise<unknown>) => {
    tasks.push(promise);
  };
  listeners.get('push')!({
    data: {
      json: () => ({
        version: 1,
        notificationId,
        category: 'community',
        title: 'Update',
        body: 'Open app'
      })
    },
    waitUntil
  });
  const close = vi.fn<() => void>();
  listeners.get('notificationclick')!({
    notification: { data: { notificationId, href: 'https://evil.example' }, close },
    waitUntil
  });
  expect(close).toHaveBeenCalledOnce();
  await Promise.all(tasks);
  expect(showNotification).toHaveBeenCalledOnce();
  expect(openWindow).toHaveBeenCalledWith('https://app.example/notifications/' + notificationId);
  expect(fetch).not.toHaveBeenCalled();
  expect(cacheMatch).not.toHaveBeenCalled();
});
