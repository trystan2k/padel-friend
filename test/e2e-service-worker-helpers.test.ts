import type { BrowserContext, Page } from '@playwright/test';
import { describe, expect, it, vi } from 'vitest';
import { waitForHydratedPage } from '../e2e/auth-helpers';
import {
  activatedBuiltWorker,
  assertBuiltRegistration,
  classifyWorker,
  controlledByBuiltWorker,
  installBuiltWorker,
  isBuiltWorkerUrl,
  type ObserveWorker,
  type RegistrationSnapshot,
  type WorkerObservation
} from '../e2e/service-worker-helpers';

vi.mock('../e2e/auth-helpers', () => ({
  waitForHydratedPage: vi.fn<() => Promise<void>>(async () => undefined)
}));

const built: RegistrationSnapshot = {
  scope: 'http://127.0.0.1:4173/',
  scriptUrl: 'http://127.0.0.1:4173/sw.js',
  state: 'activated'
};

describe('isBuiltWorkerUrl', () => {
  it('matches the built worker script regardless of origin or query', () => {
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/sw.js')).toBe(true);
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/sw.js?v=1')).toBe(true);
  });

  it('rejects other scripts and malformed URLs', () => {
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/assets/sw.js')).toBe(false);
    expect(isBuiltWorkerUrl('http://127.0.0.1:4173/other.js')).toBe(false);
    expect(isBuiltWorkerUrl('not a url')).toBe(false);
  });
});

describe('assertBuiltRegistration', () => {
  it('accepts the activated built worker at the root scope', () => {
    expect(() => assertBuiltRegistration(built)).not.toThrow();
  });

  it('rejects a wrong scope', () => {
    expect(() =>
      assertBuiltRegistration({ ...built, scope: 'http://127.0.0.1:4173/app/' })
    ).toThrow(/scope/);
    expect(() => assertBuiltRegistration({ ...built, scope: null })).toThrow(/scope/);
  });

  it('rejects a wrong or missing script', () => {
    expect(() =>
      assertBuiltRegistration({ ...built, scriptUrl: 'http://127.0.0.1:4173/x.js' })
    ).toThrow(/script/);
    expect(() => assertBuiltRegistration({ ...built, scriptUrl: null })).toThrow(/script/);
  });

  it('rejects a worker that is not yet activated', () => {
    for (const state of ['installing', 'installed', 'activating', null])
      expect(() => assertBuiltRegistration({ ...built, state })).toThrow(/not activated/);
  });
});

const SCRIPT = 'http://127.0.0.1:4173/sw.js';
const SCOPE = 'http://127.0.0.1:4173/';
const observation = (overrides: Partial<WorkerObservation> = {}): WorkerObservation => ({
  supported: true,
  secureContext: true,
  scope: SCOPE,
  scriptUrl: SCRIPT,
  installing: null,
  waiting: null,
  active: 'activated',
  controlled: true,
  ...overrides
});
const unregistered = observation({ scope: null, scriptUrl: null, active: null, controlled: false });
const installing = observation({ installing: 'installing', active: null, controlled: false });
const activated = (controlled = false) => observation({ controlled });

describe('classifyWorker', () => {
  it('maps registration states to lifecycle phases', () => {
    expect(classifyWorker(unregistered)).toBe('absent');
    expect(classifyWorker(observation({ active: null }))).toBe('absent');
    expect(classifyWorker(installing)).toBe('installing');
    expect(
      classifyWorker(observation({ installing: null, waiting: 'installed', active: null }))
    ).toBe('installed');
    expect(classifyWorker(observation({ active: 'activating' }))).toBe('activating');
    expect(classifyWorker(activated())).toBe('activated');
  });

  it('fails on first sight for states that cannot recover', () => {
    expect(() => classifyWorker(observation({ supported: false, secureContext: false }))).toThrow(
      /unavailable \(secureContext=false\)/
    );
    expect(() => classifyWorker(observation({ scope: 'http://127.0.0.1:4173/app/' }))).toThrow(
      /scope/
    );
    expect(() => classifyWorker(observation({ scriptUrl: 'http://127.0.0.1:4173/x.js' }))).toThrow(
      /script/
    );
    expect(() => classifyWorker(observation({ installing: 'redundant', active: null }))).toThrow(
      /redundant/
    );
  });
});

type FakeWorker = { url: () => string };

// Small typed fake: only the Playwright members the helpers touch, with matching signatures.
function fakePage({ closed = false, workers = [] as FakeWorker[] | (() => FakeWorker[]) } = {}) {
  const reload = vi.fn<() => Promise<null>>(async () => null);
  const goto = vi.fn<() => Promise<null>>(async () => null);
  const context = {
    serviceWorkers: () => (typeof workers === 'function' ? workers() : workers),
    request: {
      get: vi.fn<() => Promise<{ status: () => number; headers: () => Record<string, string> }>>(
        async () => ({
          status: () => 200,
          headers: () => ({ 'content-type': 'text/javascript' })
        })
      )
    }
  };
  const page = {
    isClosed: () => closed,
    url: () => 'http://127.0.0.1:4173/login?code=secret-token',
    goto,
    reload,
    locator: () => ({ getAttribute: async () => 'true' }),
    context: () => context
  };
  return {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow Playwright double
    page: page as unknown as Page,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrow Playwright double
    context: context as unknown as BrowserContext,
    reload,
    goto
  };
}

async function failureOf(work: Promise<unknown>): Promise<string> {
  try {
    await work;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  throw new Error('Expected the wait to fail');
}

const sequence = (...steps: (WorkerObservation | Error)[]): ObserveWorker => {
  let index = 0;
  return async () => {
    const step = steps[Math.min(index, steps.length - 1)]!;
    index += 1;
    if (step instanceof Error) throw step;
    return step;
  };
};

describe('activatedBuiltWorker', () => {
  it('waits through a delayed registration and install, then resolves', async () => {
    const { page } = fakePage();
    const observe = sequence(unregistered, unregistered, installing, activated());
    await expect(activatedBuiltWorker(page, { observe, timeout: 5_000 })).resolves.toBeUndefined();
  });

  it('survives a navigation between polls', async () => {
    const { page } = fakePage();
    const observe = sequence(
      new Error(
        'page.evaluate: Execution context was destroyed, most likely because of a navigation'
      ),
      activated()
    );
    await expect(activatedBuiltWorker(page, { observe, timeout: 5_000 })).resolves.toBeUndefined();
  });

  it('never-ready fails inside the budget with an evidence snapshot instead of hanging', async () => {
    const { page } = fakePage();
    const started = Date.now();
    const text = await failureOf(
      activatedBuiltWorker(page, { observe: sequence(unregistered), timeout: 300 })
    );
    expect(Date.now() - started).toBeLessThan(3_000);
    expect(text).toMatch(/built worker activation/);
    expect(text).toMatch(/Worker evidence: /);
    expect(text).toContain('"scope":null');
    expect(text).toContain('"status":200');
    expect(text).toContain('"path":"/login"');
    expect(text).not.toContain('secret-token');
  });

  it('a stalled install reports the in-flight phase in its evidence', async () => {
    const { page } = fakePage();
    const text = await failureOf(
      activatedBuiltWorker(page, { observe: sequence(installing), timeout: 300 })
    );
    expect(text).toContain('"installing":"installing"');
  });

  it('redacts worker URL queries from the failure evidence', async () => {
    const { page } = fakePage();
    const leaky = observation({
      scope: `${SCOPE}?key=secret-scope`,
      scriptUrl: `${SCRIPT}?token=secret-script`,
      installing: 'installing',
      active: null,
      controlled: false
    });
    const text = await failureOf(
      activatedBuiltWorker(page, { observe: sequence(leaky), timeout: 300 })
    );
    expect(text).toContain('"scriptUrl":"/sw.js"');
    expect(text).toContain('"scope":"/"');
    expect(text).not.toContain('secret-script');
    expect(text).not.toContain('secret-scope');
  });

  it('redacts queries from deterministic wrong-script failures', async () => {
    const { page } = fakePage();
    const observe = sequence(
      observation({ scriptUrl: 'http://127.0.0.1:4173/x.js?token=secret-x' })
    );
    const text = await failureOf(activatedBuiltWorker(page, { observe, timeout: 5_000 }));
    expect(text).toMatch(/Unexpected worker script: \/x\.js/);
    expect(text).not.toContain('secret-x');
  });

  it('a redundant worker fails on first sight', async () => {
    const { page } = fakePage();
    const observe = vi.fn<ObserveWorker>(
      sequence(observation({ installing: 'redundant', active: null }))
    );
    await expect(activatedBuiltWorker(page, { observe, timeout: 5_000 })).rejects.toThrow(
      /redundant/
    );
    expect(observe.mock.calls.length).toBeLessThanOrEqual(3);
  });

  it('a wrong worker fails on first sight', async () => {
    const { page } = fakePage();
    const observe = sequence(observation({ scriptUrl: 'http://127.0.0.1:4173/other.js' }));
    await expect(activatedBuiltWorker(page, { observe, timeout: 5_000 })).rejects.toThrow(/script/);
  });

  it('closing the page during the wait is reported, not retried', async () => {
    const { page } = fakePage({ closed: true });
    const observe = vi.fn<ObserveWorker>(
      sequence(new Error('page.evaluate: Target page, context or browser has been closed'))
    );
    const text = await failureOf(activatedBuiltWorker(page, { observe, timeout: 5_000 }));
    expect(text).toMatch(/has been closed/);
    expect(text).toContain('"page":"closed"');
    expect(observe).toHaveBeenCalledTimes(1);
  });
});

describe('controlledByBuiltWorker', () => {
  it('reloads once when the activated worker does not control the page yet', async () => {
    const { page, reload } = fakePage();
    const observe = sequence(activated(false), activated(false), activated(true));
    await controlledByBuiltWorker(page, { observe, timeout: 5_000 });
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('does not reload a page that is already controlled', async () => {
    const { page, reload } = fakePage();
    await controlledByBuiltWorker(page, { observe: sequence(activated(true)), timeout: 5_000 });
    expect(reload).not.toHaveBeenCalled();
  });

  it('fails inside the budget when an observation after activation never settles', async () => {
    const { page } = fakePage();
    let calls = 0;
    const observe: ObserveWorker = async () => {
      calls += 1;
      if (calls <= 1) return activated(false);
      return new Promise<WorkerObservation>(() => undefined);
    };
    const started = Date.now();
    const text = await failureOf(controlledByBuiltWorker(page, { observe, timeout: 300 }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(text).toMatch(/worker observation: no answer/);
    expect(text).toMatch(/Worker evidence: /);
  });

  it('a stalled poll observation shares the deadline instead of hanging', async () => {
    const { page } = fakePage();
    let calls = 0;
    const observe: ObserveWorker = async () => {
      calls += 1;
      if (calls <= 2) return activated(calls === 1);
      return new Promise<WorkerObservation>(() => undefined);
    };
    const started = Date.now();
    const text = await failureOf(controlledByBuiltWorker(page, { observe, timeout: 300 }));
    expect(Date.now() - started).toBeLessThan(5_000);
    expect(text).toMatch(/Worker evidence: /);
  });

  it('reload and hydration time does not consume the control observation budget', async () => {
    const { page } = fakePage();
    vi.mocked(waitForHydratedPage).mockImplementationOnce(
      () => new Promise((resolve) => setTimeout(resolve, 400))
    );
    let calls = 0;
    const observe: ObserveWorker = async () => {
      calls += 1;
      if (calls === 1) return activated(false);
      if (calls === 2) return activated(false);
      await new Promise((resolve) => setTimeout(resolve, 50));
      return activated(true);
    };
    await expect(controlledByBuiltWorker(page, { observe, timeout: 300 })).resolves.toBeUndefined();
  });

  it('fails with evidence when control never arrives after the reload', async () => {
    const { page, reload } = fakePage();
    await expect(
      controlledByBuiltWorker(page, { observe: sequence(activated(false)), timeout: 300 })
    ).rejects.toThrow(/page controlled by the built worker[\s\S]*Worker evidence/);
    expect(reload).toHaveBeenCalledTimes(1);
  });
});

describe('installBuiltWorker', () => {
  const worker: FakeWorker = { url: () => SCRIPT };

  it('returns the handle even when the serviceworker event trails the page-side registration', async () => {
    let reads = 0;
    const { page, context } = fakePage({ workers: () => (reads++ < 3 ? [] : [worker]) });
    const installed = await installBuiltWorker(context, page, '/notifications', {
      observe: sequence(activated(true)),
      timeout: 5_000
    });
    expect(installed).toBe(worker);
  });

  it('fails inside the budget when the worker handle is never announced', async () => {
    const { page, context } = fakePage();
    await expect(
      installBuiltWorker(context, page, '/notifications', {
        observe: sequence(activated(true)),
        timeout: 300
      })
    ).rejects.toThrow(/built worker handle announced/);
  });

  it('surfaces a navigation failure without waiting on the worker', async () => {
    const { page, context, goto } = fakePage();
    goto.mockRejectedValueOnce(new Error('net::ERR_CONNECTION_REFUSED'));
    await expect(installBuiltWorker(context, page, '/notifications')).rejects.toThrow(
      /ERR_CONNECTION_REFUSED/
    );
  });
});
