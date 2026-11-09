import { describe, expect, it, vi } from 'vitest';
import {
  cleanupPushDevice,
  createPushController,
  type PushApi,
  type PushDeps
} from '../src/features/notifications/push-controller';
import type { PwaCapabilities } from '../src/features/pwa/install-state';

const PUBLIC_KEY =
  'BD7OaBbljzNT-T8qXAyjFDuSUf2_-pfv05bxZB1_OrzgHgV80uBt_sSLXNrA6H8f30I7GDmv0_9SYBSQsCeZjEw';
const OTHER_KEY =
  'BEl62iUYgUivxIkv69yViEuiBIa-Ib9-SkvMeAtA3LFgDzkrxZJjSgSnfckjBJuBkr3qBUYIHBQFLXYp5Nksh8U';
const supported: PwaCapabilities = {
  secureContext: true,
  serviceWorker: true,
  pushManager: true,
  notification: true,
  standalone: false,
  ios: false
};
const bytes = (key: string) => {
  const decoded = Buffer.from(key, 'base64url');
  const buffer = new ArrayBuffer(decoded.length);
  new Uint8Array(buffer).set(decoded);
  return buffer;
};

function fakeSubscription(
  endpoint: string,
  key = PUBLIC_KEY,
  expirationTime: number | null = null
) {
  const subscription = {
    endpoint,
    expirationTime,
    options: { applicationServerKey: bytes(key) },
    unsubscribe: vi.fn<() => Promise<boolean>>().mockResolvedValue(true),
    toJSON: () => ({
      endpoint,
      expirationTime,
      keys: { p256dh: 'p'.repeat(87), auth: 'a'.repeat(22) }
    })
  };
  return subscription;
}
type FakeSubscription = ReturnType<typeof fakeSubscription>;

function setup(
  options: {
    capabilities?: Partial<PwaCapabilities>;
    permission?: NotificationPermission;
    requested?: NotificationPermission;
    existing?: FakeSubscription | null;
    online?: boolean;
    config?: { enabled: boolean; publicKey: string | null } | Error;
    reconcile?: Awaited<ReturnType<PushApi['reconcile']>>;
    register?: Awaited<ReturnType<PushApi['register']>>[];
    retire?: boolean;
    created?: FakeSubscription[];
  } = {}
) {
  let permission = options.permission ?? 'default';
  let current = options.existing ?? null;
  const created = options.created ?? [fakeSubscription('https://push.example/new')];
  const subscribe = vi.fn<() => Promise<FakeSubscription>>(async () => {
    const next = created.shift();
    if (!next) throw new Error('subscribe failed');
    current = next;
    return next;
  });
  const registration = {
    pushManager: {
      getSubscription: vi.fn<() => Promise<FakeSubscription | null>>(async () => current),
      subscribe
    }
  };
  const registerResults = [...(options.register ?? [{ ok: true } as const])];
  const api = {
    getConfig: vi.fn<PushApi['getConfig']>(async () => {
      const config = options.config ?? { enabled: true, publicKey: PUBLIC_KEY };
      if (config instanceof Error) throw config;
      return config;
    }),
    reconcile: vi.fn<PushApi['reconcile']>(
      async () =>
        options.reconcile ?? { ok: true, current: 'none', retiredReason: null, otherDevices: 2 }
    ),
    register: vi.fn<PushApi['register']>(async () => registerResults.shift() ?? { ok: true }),
    retire: vi.fn<PushApi['retire']>(async () => ({ ok: options.retire ?? true }))
  };
  const requestPermission = vi.fn<() => Promise<NotificationPermission>>(async () => {
    permission = options.requested ?? 'granted';
    return permission;
  });
  const deps: PushDeps = {
    api,
    capabilities: () => ({ ...supported, ...options.capabilities }),
    permission: () => permission,
    requestPermission,
    online: () => options.online ?? true,
    locale: () => 'en',
    getRegistration: async () => registration,
    now: () => 1_000
  };
  return {
    controller: createPushController(deps),
    api,
    requestPermission,
    subscribe,
    registration,
    created
  };
}

describe('push controller reconcile', () => {
  it('starts in loading and reports a default-permission device without prompting', async () => {
    const { controller, requestPermission } = setup();
    expect(controller.getSnapshot().status).toBe('loading');
    await controller.reconcile();
    expect(controller.getSnapshot()).toEqual({
      status: 'permissionDefault',
      pending: null,
      otherDevices: 2
    });
    expect(requestPermission).not.toHaveBeenCalled();
  });

  it('reports granted-not-subscribed, denied, and unsupported', async () => {
    const granted = setup({ permission: 'granted' });
    await granted.controller.reconcile();
    expect(granted.controller.getSnapshot().status).toBe('grantedNotSubscribed');

    const denied = setup({ permission: 'denied' });
    await denied.controller.reconcile();
    expect(denied.controller.getSnapshot().status).toBe('denied');

    for (const missing of [
      'serviceWorker',
      'pushManager',
      'notification',
      'secureContext'
    ] as const) {
      const unsupported = setup({ capabilities: { [missing]: false } });
      await unsupported.controller.reconcile();
      expect(unsupported.controller.getSnapshot().status).toBe('unsupported');
      expect(unsupported.api.getConfig).not.toHaveBeenCalled();
    }
  });

  it('requires an installed app on iOS browsers, even when push APIs are missing', async () => {
    const browser = setup({ capabilities: { ios: true, pushManager: false, notification: false } });
    await browser.controller.reconcile();
    expect(browser.controller.getSnapshot().status).toBe('installRequired');

    const installed = setup({ capabilities: { ios: true, standalone: true } });
    await installed.controller.reconcile();
    expect(installed.controller.getSnapshot().status).toBe('permissionDefault');
  });

  it('reports config unavailable for a disabled, failing or key-less config, and offline', async () => {
    for (const config of [
      { enabled: false, publicKey: null },
      { enabled: true, publicKey: null },
      new Error('boom')
    ]) {
      const { controller } = setup({ config });
      await controller.reconcile();
      expect(controller.getSnapshot().status).toBe('configUnavailable');
    }
    const offline = setup({ online: false });
    await offline.controller.reconcile();
    expect(offline.controller.getSnapshot().status).toBe('offline');
    expect(offline.api.getConfig).not.toHaveBeenCalled();
  });

  it('shows enabled only when the native subscription is active in the registry', async () => {
    const subscription = fakeSubscription('https://push.example/a');
    const active = setup({
      permission: 'granted',
      existing: subscription,
      reconcile: { ok: true, current: 'active', retiredReason: null, otherDevices: 1 }
    });
    await active.controller.reconcile();
    expect(active.controller.getSnapshot()).toEqual({
      status: 'enabled',
      pending: null,
      otherDevices: 1
    });

    const unregistered = setup({ permission: 'granted', existing: subscription });
    await unregistered.controller.reconcile();
    expect(unregistered.controller.getSnapshot().status).toBe('grantedNotSubscribed');

    const retired = setup({
      permission: 'granted',
      existing: subscription,
      reconcile: { ok: true, current: 'retired', retiredReason: 'endpoint_gone', otherDevices: 0 }
    });
    await retired.controller.reconcile();
    expect(retired.controller.getSnapshot().status).toBe('expired');
  });

  it('retires and unsubscribes on application server key mismatch and on expiry, preserving others', async () => {
    const stale = fakeSubscription('https://push.example/old', OTHER_KEY);
    const mismatch = setup({ permission: 'granted', existing: stale });
    await mismatch.controller.reconcile();
    expect(mismatch.controller.getSnapshot().status).toBe('keyChanged');
    expect(mismatch.api.retire).toHaveBeenCalledWith({
      endpoint: 'https://push.example/old',
      reason: 'key_changed'
    });
    expect(stale.unsubscribe).toHaveBeenCalled();

    const expired = fakeSubscription('https://push.example/exp', PUBLIC_KEY, 500);
    const lapsed = setup({ permission: 'granted', existing: expired });
    await lapsed.controller.reconcile();
    expect(lapsed.controller.getSnapshot().status).toBe('expired');
    expect(lapsed.api.retire).toHaveBeenCalledWith({
      endpoint: 'https://push.example/exp',
      reason: 'expired'
    });
  });

  it('cleans up a leftover subscription when permission was revoked', async () => {
    const leftover = fakeSubscription('https://push.example/revoked');
    const { controller, api } = setup({ permission: 'denied', existing: leftover });
    await controller.reconcile();
    expect(controller.getSnapshot().status).toBe('denied');
    expect(api.retire).toHaveBeenCalledWith({
      endpoint: 'https://push.example/revoked',
      reason: 'permission_revoked'
    });
    expect(leftover.unsubscribe).toHaveBeenCalled();
  });
});

describe('push controller enable', () => {
  it('requests permission synchronously from the gesture and awaits registration before enabled', async () => {
    const { controller, requestPermission, subscribe, api } = setup();
    await controller.reconcile();
    const pending = controller.enable();
    // Called before any microtask ran: still inside the user gesture.
    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot().pending).toBe('enabling');
    await pending;
    expect(subscribe).toHaveBeenCalledTimes(1);
    expect(api.register).toHaveBeenCalledTimes(1);
    expect(controller.getSnapshot()).toMatchObject({ status: 'enabled', pending: null });
  });

  it('does not enable when the prompt is denied or dismissed', async () => {
    const denied = setup({ requested: 'denied' });
    await denied.controller.reconcile();
    await denied.controller.enable();
    expect(denied.controller.getSnapshot().status).toBe('denied');
    expect(denied.subscribe).not.toHaveBeenCalled();

    const dismissed = setup({ requested: 'default' });
    await dismissed.controller.reconcile();
    await dismissed.controller.enable();
    expect(dismissed.controller.getSnapshot()).toMatchObject({
      status: 'permissionDefault',
      pending: null
    });
  });

  it('reuses the granted permission without prompting', async () => {
    const { controller, requestPermission } = setup({ permission: 'granted' });
    await controller.reconcile();
    await controller.enable();
    expect(requestPermission).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('enabled');
  });

  it('reports a subscribe failure explicitly and allows retry', async () => {
    const { controller, created } = setup({ created: [] });
    await controller.reconcile();
    await controller.enable();
    expect(controller.getSnapshot().status).toBe('subscriptionFailed');
    created.push(fakeSubscription('https://push.example/retry'));
    await controller.enable();
    expect(controller.getSnapshot().status).toBe('enabled');
  });

  it('compensates a failed registry save by unsubscribing the new subscription', async () => {
    const created = fakeSubscription('https://push.example/new');
    const { controller } = setup({ created: [created], register: [{ ok: false, code: 'failed' }] });
    await controller.reconcile();
    await controller.enable();
    expect(created.unsubscribe).toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ status: 'saveFailed', pending: null });
  });

  it('maps an unavailable config on save to config unavailable', async () => {
    const { controller } = setup({ register: [{ ok: false, code: 'unavailable' }] });
    await controller.reconcile();
    await controller.enable();
    expect(controller.getSnapshot().status).toBe('configUnavailable');
  });

  it('drops an endpoint owned by another account and enrols a fresh one', async () => {
    const stale = fakeSubscription('https://push.example/shared');
    const fresh = fakeSubscription('https://push.example/fresh');
    const { controller, api } = setup({
      permission: 'granted',
      existing: stale,
      created: [fresh],
      register: [{ ok: false, code: 'endpointConflict' }, { ok: true }]
    });
    await controller.reconcile();
    await controller.enable();
    expect(stale.unsubscribe).toHaveBeenCalled();
    expect(api.register).toHaveBeenCalledTimes(2);
    expect(controller.getSnapshot().status).toBe('enabled');
  });

  it('ignores enable from states that cannot enable', async () => {
    const { controller, requestPermission } = setup({ permission: 'denied' });
    await controller.reconcile();
    await controller.enable();
    expect(requestPermission).not.toHaveBeenCalled();
  });
});

describe('push controller disable this device', () => {
  const enabled = () =>
    setup({
      permission: 'granted',
      existing: fakeSubscription('https://push.example/mine'),
      reconcile: { ok: true, current: 'active', retiredReason: null, otherDevices: 1 }
    });

  it('retires the registry row, then unsubscribes, leaving other devices alone', async () => {
    const { controller, api, registration } = enabled();
    await controller.reconcile();
    await controller.disableDevice();
    const subscription = await registration.pushManager.getSubscription();
    expect(api.retire).toHaveBeenCalledWith({
      endpoint: 'https://push.example/mine',
      reason: 'user_disabled'
    });
    expect(subscription?.unsubscribe).toHaveBeenCalled();
    expect(controller.getSnapshot()).toMatchObject({ status: 'deviceDisabled', otherDevices: 1 });
  });

  it('reports cleanup failure when retire fails and keeps the browser subscription for retry', async () => {
    const { controller, registration } = setup({
      permission: 'granted',
      existing: fakeSubscription('https://push.example/mine'),
      reconcile: { ok: true, current: 'active', retiredReason: null, otherDevices: 0 },
      retire: false
    });
    await controller.reconcile();
    await controller.disableDevice();
    const subscription = await registration.pushManager.getSubscription();
    expect(subscription?.unsubscribe).not.toHaveBeenCalled();
    expect(controller.getSnapshot().status).toBe('cleanupFailed');
    await controller.disableDevice();
    expect(controller.getSnapshot().status).toBe('cleanupFailed');
  });

  it('reports cleanup failure when unsubscribe fails after retiring', async () => {
    const { controller, registration } = enabled();
    await controller.reconcile();
    const subscription = await registration.pushManager.getSubscription();
    subscription?.unsubscribe.mockResolvedValueOnce(false);
    await controller.disableDevice();
    expect(controller.getSnapshot().status).toBe('cleanupFailed');
    await controller.disableDevice();
    expect(controller.getSnapshot().status).toBe('deviceDisabled');
  });
});

describe('logout cleanup', () => {
  it('retires and unsubscribes while authenticated, and never throws', async () => {
    const subscription = fakeSubscription('https://push.example/logout');
    const api = { retire: vi.fn<PushApi['retire']>(async () => ({ ok: true })) };
    const registrationOf = (current: FakeSubscription) => ({
      pushManager: { getSubscription: async () => current, subscribe: async () => current }
    });
    await cleanupPushDevice({
      api,
      capabilities: () => supported,
      getRegistration: async () => registrationOf(subscription)
    });
    expect(api.retire).toHaveBeenCalledWith({
      endpoint: 'https://push.example/logout',
      reason: 'logout'
    });
    expect(subscription.unsubscribe).toHaveBeenCalled();

    await expect(
      cleanupPushDevice({
        api: { retire: async () => Promise.reject(new Error('offline')) },
        capabilities: () => supported,
        getRegistration: async () => registrationOf(subscription)
      })
    ).resolves.toBeUndefined();
    await expect(
      cleanupPushDevice({
        api,
        capabilities: () => ({ ...supported, serviceWorker: false }),
        getRegistration: async () => null
      })
    ).resolves.toBeUndefined();
  });
});
