import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

// Mechanism (PAF-175, class 1): a fresh context has an empty CacheStorage, so every real-worker case
// pays one full install (the worker precaches the whole public build through the single preview
// server) before it can answer a request. Under a saturated gate that install, not the test body,
// is the long pole, and the previous helpers hid it: they read `context.serviceWorkers()[0]` right
// after `ready`, which is either empty (the `serviceworker` event is delivered separately from the
// page-side promise) or not yet the built worker, so a case could proceed against a worker that was
// not the installed, activated one and then stall inside `context.close()` with that install still
// in flight. The helper subscribes to the worker event BEFORE navigating, then waits on explicit
// signals only: registration shape, "activated", and controller (reload only when still uncontrolled).

export const BUILT_WORKER_PATH = '/sw.js';
export const BUILT_WORKER_SCOPE = '/';

export type RegistrationSnapshot = {
  scope: string | null;
  scriptUrl: string | null;
  state: string | null;
};

/** True when the URL is the built worker script (any origin, any query). */
export function isBuiltWorkerUrl(url: string): boolean {
  try {
    return new URL(url).pathname === BUILT_WORKER_PATH;
  } catch {
    return false;
  }
}

/** Throws unless the snapshot is the activated built worker registered at the root scope. */
export function assertBuiltRegistration(snapshot: RegistrationSnapshot): void {
  if (snapshot.scope === null || new URL(snapshot.scope).pathname !== BUILT_WORKER_SCOPE)
    throw new Error(`Unexpected worker scope: ${snapshot.scope ?? 'none'}`);
  if (snapshot.scriptUrl === null || !isBuiltWorkerUrl(snapshot.scriptUrl))
    throw new Error(`Unexpected worker script: ${snapshot.scriptUrl ?? 'none'}`);
  if (snapshot.state !== 'activated')
    throw new Error(`Built worker is not activated: ${snapshot.state ?? 'none'}`);
}

/** The built worker already known to the context, if any. */
export function builtWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers().find((worker) => isBuiltWorkerUrl(worker.url()));
}

/**
 * Waits for the page to be controlled by the activated built worker. `ready` resolves with the
 * active registration; the worker does not claim clients, so one reload is needed only when the
 * page is still uncontrolled (a second launch does the same for a real user).
 */
export async function controlledByBuiltWorker(page: Page): Promise<void> {
  const registration = () =>
    page.evaluate(async (): Promise<RegistrationSnapshot> => {
      const ready = await navigator.serviceWorker.ready;
      return {
        scope: ready.scope,
        scriptUrl: ready.active?.scriptURL ?? null,
        state: ready.active?.state ?? null
      };
    });
  await expect.poll(async () => (await registration()).state).toBe('activated');
  assertBuiltRegistration(await registration());
  if (!(await page.evaluate(() => navigator.serviceWorker.controller !== null))) {
    await page.reload();
    await waitForHydratedPage(page);
  }
  await expect
    .poll(() => page.evaluate(() => navigator.serviceWorker.controller !== null))
    .toBe(true);
}

/**
 * Navigates to `path`, waits for the built worker to install, activate and control the page, and
 * returns it. The worker event is subscribed before navigation so it cannot be missed.
 */
export async function installBuiltWorker(
  context: BrowserContext,
  page: Page,
  path: string
): Promise<Worker> {
  const known = builtWorker(context);
  const announced = known
    ? Promise.resolve(known)
    : context.waitForEvent('serviceworker', {
        predicate: (worker) => isBuiltWorkerUrl(worker.url())
      });
  // The page may be torn down before the event; the awaited branch below still reports that.
  announced.catch(() => undefined);
  await page.goto(path);
  await waitForHydratedPage(page);
  await controlledByBuiltWorker(page);
  return announced;
}
