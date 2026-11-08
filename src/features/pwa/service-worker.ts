import { cleanupOutdatedCaches, matchPrecache, precache } from 'workbox-precaching';
import {
  OFFLINE_DOCUMENT_URL,
  createNavigationHandler,
  isPrecacheCandidate,
  isSkipWaitingMessage,
  removeLegacyCaches
} from './sw-policy';

type WaitUntilEvent = Event & { waitUntil(promise: Promise<unknown>): void };
type FetchEvent = Event & { request: Request; respondWith(response: Promise<Response>): void };
type MessageEvent = Event & { data: unknown };
// Replaced by workbox-build injectManifest with the allowlisted precache entries (scripts/pwa-build.mjs).
declare const PRECACHE_MANIFEST: Parameters<typeof precache>[0];
type WorkerScope = {
  location: Location;
  skipWaiting(): Promise<void>;
  addEventListener(type: 'activate', listener: (event: WaitUntilEvent) => void): void;
  addEventListener(type: 'fetch', listener: (event: FetchEvent) => void): void;
  addEventListener(type: 'message', listener: (event: MessageEvent) => void): void;
};

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the DOM lib types self as Window; the worker scope is declared locally
const worker = self as unknown as WorkerScope;
const handleNavigation = createNavigationHandler({
  fetchFn: (request) => fetch(request),
  matchOffline: () => matchPrecache(OFFLINE_DOCUMENT_URL)
});

precache(PRECACHE_MANIFEST);
cleanupOutdatedCaches();

// The update is user-controlled: a new worker waits until the page confirms with SKIP_WAITING.
worker.addEventListener('message', (event) => {
  if (isSkipWaitingMessage(event.data)) void worker.skipWaiting();
});

worker.addEventListener('activate', (event) => {
  event.waitUntil(removeLegacyCaches(caches));
});

worker.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (request.mode === 'navigate') {
    event.respondWith(handleNavigation(request));
    return;
  }
  if (!isPrecacheCandidate(request, worker.location.origin)) return;
  const precached = matchPrecache(request);
  event.respondWith(precached.then((response) => response ?? fetch(request)));
});
