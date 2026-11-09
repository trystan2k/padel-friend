/** @vitest-environment jsdom */
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/features/notifications/push.functions', () => ({
  getPushConfig: vi.fn<() => Promise<never>>(),
  reconcileMyPushDevices: vi.fn<() => Promise<never>>(),
  registerMyPushSubscription: vi.fn<() => Promise<never>>(),
  retireMyPushSubscription: vi.fn<() => Promise<never>>()
}));
import { cleanupPushDeviceForLogout } from '../src/features/notifications/push-browser';

function stubPushEnvironment(serviceWorker: Partial<ServiceWorkerContainer>) {
  vi.stubGlobal('PushManager', function PushManager() {});
  Object.defineProperty(navigator, 'serviceWorker', { value: serviceWorker, configurable: true });
}

describe('cleanupPushDeviceForLogout', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    Reflect.deleteProperty(navigator, 'serviceWorker');
  });

  it('does not wait for a worker that was never registered', async () => {
    vi.useFakeTimers();
    // `ready` would never settle: logout must not depend on it.
    const ready = new Promise<ServiceWorkerRegistration>(() => undefined);
    stubPushEnvironment({
      ready,
      getRegistration: vi.fn<() => Promise<undefined>>().mockResolvedValue(undefined)
    });
    let settled = false;
    void cleanupPushDeviceForLogout().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(true);
  });

  it('is bounded when the registration lookup hangs', async () => {
    vi.useFakeTimers();
    stubPushEnvironment({ getRegistration: () => new Promise(() => undefined) });
    let settled = false;
    void cleanupPushDeviceForLogout().then(() => {
      settled = true;
    });
    await vi.advanceTimersByTimeAsync(1999);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    expect(settled).toBe(true);
  });
});
