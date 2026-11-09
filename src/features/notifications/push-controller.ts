import type { PwaCapabilities } from '../pwa/install-state';
import type { PushCurrentDevice, PushFailureCode } from './push.functions';
import type { PushLocale, PushRetireReason, PushSubscriptionInput } from './push.validators';

export type PushStatus =
  | 'loading'
  | 'configUnavailable'
  | 'unsupported'
  | 'installRequired'
  | 'offline'
  | 'permissionDefault'
  | 'denied'
  | 'grantedNotSubscribed'
  | 'enabled'
  | 'expired'
  | 'keyChanged'
  | 'subscriptionFailed'
  | 'saveFailed'
  | 'cleanupFailed'
  | 'deviceDisabled';
export type PushSnapshot = {
  status: PushStatus;
  pending: 'enabling' | 'disabling' | null;
  otherDevices: number;
};

export type PushApi = {
  getConfig(): Promise<{ enabled: boolean; publicKey: string | null }>;
  reconcile(input: {
    endpoint: string | null;
    locale: PushLocale;
  }): Promise<
    | { ok: true; current: PushCurrentDevice; retiredReason: string | null; otherDevices: number }
    | { ok: false }
  >;
  register(input: {
    subscription: PushSubscriptionInput;
    locale: PushLocale;
  }): Promise<{ ok: true } | { ok: false; code: PushFailureCode }>;
  retire(input: { endpoint: string; reason: PushRetireReason }): Promise<{ ok: boolean }>;
};

// Structural subset of the DOM push types, so the controller is testable without a browser.
export type PushSubscriptionLike = Pick<
  PushSubscription,
  'endpoint' | 'expirationTime' | 'unsubscribe' | 'toJSON'
> & { options: Pick<PushSubscriptionOptions, 'applicationServerKey'> };
export type PushRegistrationLike = {
  pushManager: {
    getSubscription(): Promise<PushSubscriptionLike | null>;
    subscribe(options: PushSubscriptionOptionsInit): Promise<PushSubscriptionLike>;
  };
};

export type PushDeps = {
  api: PushApi;
  capabilities(): PwaCapabilities;
  permission(): NotificationPermission;
  requestPermission(): Promise<NotificationPermission>;
  online(): boolean;
  locale(): PushLocale;
  getRegistration(): Promise<PushRegistrationLike | null>;
  now(): number;
};

const ENABLEABLE: PushStatus[] = [
  'permissionDefault',
  'grantedNotSubscribed',
  'expired',
  'keyChanged',
  'subscriptionFailed',
  'saveFailed',
  'deviceDisabled'
];
// Retired by the user's own action: the browser subscription (if still present) is simply re-registered.
const USER_RETIRED = ['user_disabled', 'logout'];

export function decodeBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value
    .replaceAll('-', '+')
    .replaceAll('_', '/')
    .padEnd(Math.ceil(value.length / 4) * 4, '=');
  const binary = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(binary.length));
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function keyMatches(subscription: PushSubscriptionLike, publicKey: string): boolean {
  const current = subscription.options?.applicationServerKey;
  if (!current) return false;
  const actual = new Uint8Array(current);
  const expected = decodeBase64Url(publicKey);
  return (
    actual.length === expected.length && actual.every((byte, index) => byte === expected[index])
  );
}

function toInput(subscription: PushSubscriptionLike): PushSubscriptionInput | null {
  const json = subscription.toJSON();
  const { p256dh, auth } = json.keys ?? {};
  if (!json.endpoint || !p256dh || !auth) return null;
  return {
    endpoint: json.endpoint,
    keys: { p256dh, auth },
    expirationTime: json.expirationTime ?? null
  };
}

// Device state machine for Web Push. The native PushManager subscription is the device identity; the
// saved account preference is intent only and never consulted here. requestPermission is reachable only
// through enable(), which the UI calls from a click.
export function createPushController(deps: PushDeps) {
  let snapshot: PushSnapshot = { status: 'loading', pending: null, otherDevices: 0 };
  let registration: PushRegistrationLike | null = null;
  let publicKey: string | null = null;
  let generation = 0;
  const listeners = new Set<() => void>();

  const publish = (next: Partial<PushSnapshot>) => {
    snapshot = { ...snapshot, ...next };
    listeners.forEach((listener) => listener());
  };

  async function register(subscription: PushSubscriptionLike) {
    const input = toInput(subscription);
    if (!input) return { ok: false, code: 'failed' } as const;
    try {
      return await deps.api.register({ subscription: input, locale: deps.locale() });
    } catch {
      return { ok: false, code: 'failed' } as const;
    }
  }

  async function retire(endpoint: string, reason: PushRetireReason) {
    try {
      return (await deps.api.retire({ endpoint, reason })).ok;
    } catch {
      return false;
    }
  }

  async function dropLocal(subscription: PushSubscriptionLike, reason: PushRetireReason) {
    await retire(subscription.endpoint, reason);
    await subscription.unsubscribe().catch(() => false);
  }

  async function reconcile() {
    if (snapshot.pending) return;
    const run = ++generation;
    const stale = () => run !== generation;
    const capabilities = deps.capabilities();
    if (capabilities.ios && !capabilities.standalone) return publish({ status: 'installRequired' });
    if (
      !(
        capabilities.secureContext &&
        capabilities.serviceWorker &&
        capabilities.pushManager &&
        capabilities.notification
      )
    )
      return publish({ status: 'unsupported' });
    if (!deps.online()) return publish({ status: 'offline' });
    try {
      const config = await deps.api.getConfig();
      if (stale()) return;
      if (!config.enabled || !config.publicKey) return publish({ status: 'configUnavailable' });
      publicKey = config.publicKey;
      registration = await deps.getRegistration();
      if (stale()) return;
      if (!registration) return publish({ status: 'unsupported' });
      const permission = deps.permission();
      const subscription = await registration.pushManager.getSubscription();
      if (stale()) return;
      if (permission === 'denied') {
        if (subscription) await dropLocal(subscription, 'permission_revoked');
        return publish({ status: 'denied' });
      }
      const fallback = permission === 'granted' ? 'grantedNotSubscribed' : 'permissionDefault';
      if (!subscription || permission !== 'granted') {
        const other = await deps.api.reconcile({ endpoint: null, locale: deps.locale() });
        if (stale()) return;
        return publish({ status: fallback, otherDevices: other.ok ? other.otherDevices : 0 });
      }
      if (!keyMatches(subscription, config.publicKey)) {
        await dropLocal(subscription, 'key_changed');
        return publish({ status: 'keyChanged' });
      }
      if (subscription.expirationTime !== null && subscription.expirationTime <= deps.now()) {
        await dropLocal(subscription, 'expired');
        return publish({ status: 'expired' });
      }
      const result = await deps.api.reconcile({
        endpoint: subscription.endpoint,
        locale: deps.locale()
      });
      if (stale()) return;
      if (!result.ok) return publish({ status: 'configUnavailable' });
      const status: PushStatus =
        result.current === 'active'
          ? 'enabled'
          : result.current === 'retired' && !USER_RETIRED.includes(result.retiredReason ?? '')
            ? 'expired'
            : 'grantedNotSubscribed';
      publish({ status, otherDevices: result.otherDevices });
    } catch {
      if (!stale()) publish({ status: deps.online() ? 'configUnavailable' : 'offline' });
    }
  }

  async function enable() {
    const reg = registration;
    const key = publicKey;
    if (snapshot.pending || !reg || !key || !ENABLEABLE.includes(snapshot.status)) return;
    generation += 1;
    let permission = deps.permission();
    if (permission === 'default') {
      publish({ pending: 'enabling' });
      // First await of the handler: the native prompt is requested inside the user gesture.
      permission = await deps.requestPermission().catch((): NotificationPermission => 'default');
      if (permission !== 'granted') {
        return publish({
          status: permission === 'denied' ? 'denied' : 'permissionDefault',
          pending: null
        });
      }
    } else if (permission === 'denied') {
      return publish({ status: 'denied' });
    }
    publish({ pending: 'enabling' });
    const subscribe = () =>
      reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: decodeBase64Url(key)
      });
    let subscription: PushSubscriptionLike;
    try {
      const existing = await reg.pushManager.getSubscription();
      if (existing && !keyMatches(existing, key)) await existing.unsubscribe();
      subscription = existing && keyMatches(existing, key) ? existing : await subscribe();
    } catch {
      return publish({ status: 'subscriptionFailed', pending: null });
    }
    let saved = await register(subscription);
    if (!saved.ok && saved.code === 'endpointConflict') {
      // Another account still holds this endpoint: drop it and enrol a fresh one for this account.
      try {
        await subscription.unsubscribe();
        subscription = await subscribe();
      } catch {
        return publish({ status: 'subscriptionFailed', pending: null });
      }
      saved = await register(subscription);
    }
    if (!saved.ok) {
      await subscription.unsubscribe().catch(() => false);
      return publish({
        status: saved.code === 'unavailable' ? 'configUnavailable' : 'saveFailed',
        pending: null
      });
    }
    publish({ status: 'enabled', pending: null });
  }

  // Registry first, browser second: a failure at either step is reported and retryable, and the
  // endpoint stays known until both succeed.
  async function disableDevice() {
    const reg = registration;
    if (
      snapshot.pending ||
      !reg ||
      (snapshot.status !== 'enabled' && snapshot.status !== 'cleanupFailed')
    )
      return;
    generation += 1;
    publish({ pending: 'disabling' });
    try {
      const subscription = await reg.pushManager.getSubscription();
      if (subscription) {
        if (!(await retire(subscription.endpoint, 'user_disabled'))) throw new Error('RETIRE');
        if (!(await subscription.unsubscribe())) throw new Error('UNSUBSCRIBE');
      }
      publish({ status: 'deviceDisabled', pending: null });
    } catch {
      publish({ status: 'cleanupFailed', pending: null });
    }
  }

  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    getSnapshot: () => snapshot,
    reconcile,
    enable,
    disableDevice,
    // Invalidates in-flight reconciles; subscribers manage their own listeners.
    dispose: () => {
      generation += 1;
    }
  };
}

// Logout hook: best effort and bounded, so signing out is never blocked by a dead network. Retire the
// registry row while still authenticated, then drop the browser subscription.
export async function cleanupPushDevice(
  deps: Pick<PushDeps, 'capabilities' | 'getRegistration'> & { api: Pick<PushApi, 'retire'> }
) {
  try {
    const capabilities = deps.capabilities();
    if (!(capabilities.serviceWorker && capabilities.pushManager)) return;
    const reg = await deps.getRegistration();
    const subscription = await reg?.pushManager.getSubscription();
    if (!subscription) return;
    await deps.api
      .retire({ endpoint: subscription.endpoint, reason: 'logout' })
      .catch(() => undefined);
    await subscription.unsubscribe().catch(() => false);
  } catch {
    // Payload privacy does not depend on this cleanup; the endpoint is retired on its next send.
  }
}
