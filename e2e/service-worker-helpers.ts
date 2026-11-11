import { expect, type BrowserContext, type Page, type Worker } from '@playwright/test';
import { waitForHydratedPage } from './auth-helpers';

// Hypothesised mechanism (PAF-175, class 1, UNCONFIRMED): a fresh context has an empty CacheStorage,
// so every real-worker case pays one full install (the worker precaches the whole public build
// through the single preview server) before it can answer a request. Under a saturated gate that
// install is the suspected long pole; it would be confirmed by a failure snapshot showing the
// worker still `installing` at timeout.
//
// Liveness contract (PAF-171): nothing here awaits a promise that may never settle. `ready` stays
// pending forever when no registration succeeds, `page.evaluate` and `Worker.evaluate` have no
// timeout of their own, and `waitForEvent` is unbounded under the repo's zero actionTimeout. Every
// wait is therefore an `expect.poll` (bounded by the global assertion budget) over an IMMEDIATE
// observation of the registration (`getRegistration` resolves without waiting for activation).
// Deterministic defects (wrong script/scope, redundant worker, no support) fail on first sight; a
// failure carries a non-blocking evidence snapshot instead of a bare "received undefined".

export const BUILT_WORKER_PATH = '/sw.js';
export const BUILT_WORKER_SCOPE = '/';

export type RegistrationSnapshot = {
  scope: string | null;
  scriptUrl: string | null;
  state: string | null;
};

/** One immediate, non-waiting read of the page's root worker registration. */
export type WorkerObservation = {
  supported: boolean;
  secureContext: boolean;
  scope: string | null;
  scriptUrl: string | null;
  installing: string | null;
  waiting: string | null;
  active: string | null;
  controlled: boolean;
};

export type WorkerPhase = 'absent' | 'installing' | 'installed' | 'activating' | 'activated';
export type ObserveWorker = (page: Page) => Promise<WorkerObservation>;
export type WorkerWaitOptions = {
  observe?: ObserveWorker;
  /** Defaults to the global assertion budget. */
  timeout?: number;
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

/**
 * Maps an observation to its lifecycle phase. Throws for states that can never recover into the
 * built, root-scoped worker (unsupported, wrong scope/script, redundant); `absent` and the
 * in-flight phases are the only ones worth waiting through.
 */
export function classifyWorker(observation: WorkerObservation): WorkerPhase {
  if (!observation.supported)
    throw new Error(
      `Service workers unavailable (secureContext=${observation.secureContext}); the built worker cannot register`
    );
  if (observation.scope === null) return 'absent';
  if (new URL(observation.scope).pathname !== BUILT_WORKER_SCOPE)
    throw new Error(`Unexpected worker scope: ${observation.scope}`);
  const states = [observation.installing, observation.waiting, observation.active];
  if (states.every((state) => state === null)) return 'absent';
  if (observation.scriptUrl === null || !isBuiltWorkerUrl(observation.scriptUrl))
    throw new Error(`Unexpected worker script: ${observation.scriptUrl ?? 'none'}`);
  if (states.includes('redundant')) throw new Error('Built worker became redundant');
  if (observation.active === 'activated') return 'activated';
  if (observation.active === 'activating') return 'activating';
  if (observation.waiting !== null) return 'installed';
  return 'installing';
}

/** The built worker already known to the context, if any. */
export function builtWorker(context: BrowserContext): Worker | undefined {
  return context.serviceWorkers().find((worker) => isBuiltWorkerUrl(worker.url()));
}

/** Reads the root registration without waiting for `ready` (which never settles unregistered). */
export const observeWorker: ObserveWorker = (page) =>
  page.evaluate(async (): Promise<WorkerObservation> => {
    const container = navigator.serviceWorker;
    const base = {
      supported: container !== undefined,
      secureContext: window.isSecureContext,
      controlled: container?.controller != null
    };
    const registration = container ? await container.getRegistration('/') : undefined;
    const current = registration?.active ?? registration?.waiting ?? registration?.installing;
    return {
      ...base,
      scope: registration?.scope ?? null,
      scriptUrl: current?.scriptURL ?? null,
      installing: registration?.installing?.state ?? null,
      waiting: registration?.waiting?.state ?? null,
      active: registration?.active?.state ?? null
    };
  });

const CONTEXT_DESTROYED = /execution context was destroyed|navigation/i;

async function bounded<T>(work: Promise<T>, label: string, ms = 3_000): Promise<T | string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const expired = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve(`${label}: no answer in ${ms}ms`), ms);
  });
  try {
    return await Promise.race([
      work.catch((error: unknown) => `${label}: ${message(error)}`),
      expired
    ]);
  } finally {
    clearTimeout(timer);
  }
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error));

/**
 * Non-blocking snapshot appended to a lifecycle failure. Never awaits `ready`, every probe is
 * individually bounded, and only public facts are read (paths, states, status codes: no storage,
 * cookies, query strings or tokens).
 */
export async function workerEvidence(
  page: Page,
  observe: ObserveWorker = observeWorker
): Promise<Record<string, unknown>> {
  if (page.isClosed()) return { page: 'closed' };
  const url = new URL(page.url(), 'http://invalid.test');
  const script = url.origin === 'http://invalid.test' ? null : new URL(BUILT_WORKER_PATH, url);
  const [observation, hydrated, scriptProbe] = await Promise.all([
    bounded(observe(page), 'observation'),
    bounded(page.locator('html').getAttribute('data-app-hydrated', { timeout: 1_000 }), 'hydrated'),
    script
      ? bounded(
          page
            .context()
            .request.get(script.href, { timeout: 3_000, failOnStatusCode: false })
            .then((response) => ({
              status: response.status(),
              contentType: response.headers()['content-type'] ?? null
            })),
          'script'
        )
      : 'script: page has no http origin'
  ]);
  return {
    path: url.pathname,
    hydrated,
    observation,
    script: scriptProbe,
    contextWorkers: page
      .context()
      .serviceWorkers()
      .map((worker) => new URL(worker.url()).pathname)
  };
}

async function withEvidence(page: Page, error: unknown, observe: ObserveWorker): Promise<Error> {
  const evidence = await workerEvidence(page, observe).catch((cause: unknown) => ({
    evidence: message(cause)
  }));
  return new Error(`${message(error)}\nWorker evidence: ${JSON.stringify(evidence)}`, {
    cause: error
  });
}

async function phaseOf(page: Page, observe: ObserveWorker): Promise<WorkerPhase | 'navigating'> {
  try {
    return classifyWorker(await observe(page));
  } catch (error) {
    // A navigation between polls only invalidates this sample; a closed page or any other error stays loud.
    if (error instanceof Error && CONTEXT_DESTROYED.test(error.message)) return 'navigating';
    throw error;
  }
}

/** Waits (bounded) until the page's root registration is the activated built worker. */
export async function activatedBuiltWorker(
  page: Page,
  { observe = observeWorker, timeout }: WorkerWaitOptions = {}
): Promise<void> {
  try {
    await expect
      .poll(() => phaseOf(page, observe), { message: 'built worker activation', timeout })
      .toBe('activated');
  } catch (error) {
    throw await withEvidence(page, error, observe);
  }
}

/**
 * Waits for the page to be controlled by the activated built worker. The worker does not claim
 * clients, so one reload is needed only when the page is still uncontrolled (a second launch does
 * the same for a real user).
 */
export async function controlledByBuiltWorker(
  page: Page,
  options: WorkerWaitOptions = {}
): Promise<void> {
  const { observe = observeWorker, timeout } = options;
  await activatedBuiltWorker(page, options);
  try {
    if (!(await observe(page)).controlled) {
      await page.reload();
      await waitForHydratedPage(page);
    }
    await expect
      .poll(async () => (await observe(page)).controlled, {
        message: 'page controlled by the built worker',
        timeout
      })
      .toBe(true);
  } catch (error) {
    throw await withEvidence(page, error, observe);
  }
}

/**
 * Navigates to `path`, waits for the built worker to install, activate and control the page, and
 * returns its handle. The handle is read from the context after control is proven, so a late
 * `serviceworker` event cannot hang the case: the bounded poll reports a missing worker instead.
 */
export async function installBuiltWorker(
  context: BrowserContext,
  page: Page,
  path: string,
  options: WorkerWaitOptions = {}
): Promise<Worker> {
  await page.goto(path);
  await waitForHydratedPage(page);
  await controlledByBuiltWorker(page, options);
  await expect
    .poll(() => builtWorker(context) !== undefined, {
      message: 'built worker handle announced to the context',
      timeout: options.timeout
    })
    .toBe(true);
  const installed = builtWorker(context);
  if (!installed) throw new Error('Built service worker handle disappeared');
  return installed;
}
