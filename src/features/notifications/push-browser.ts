import { detectPwaCapabilities } from '../pwa/install-state';
import {
  cleanupPushDevice,
  type PushApi,
  type PushDeps,
  type PushRegistrationLike
} from './push-controller';
import {
  getPushConfig,
  reconcileMyPushDevices,
  registerMyPushSubscription,
  retireMyPushSubscription
} from './push.functions';
import type { PushLocale } from './push.validators';

const REGISTRATION_TIMEOUT_MS = 5000;

export function toPushLocale(language: string | undefined): PushLocale {
  if (language?.toLowerCase().startsWith('pt')) return 'pt-BR';
  if (language?.toLowerCase().startsWith('es')) return 'es';
  return 'en';
}

const api: PushApi = {
  getConfig: () => getPushConfig(),
  reconcile: (data) => reconcileMyPushDevices({ data }),
  register: (data) => registerMyPushSubscription({ data }),
  retire: (data) => retireMyPushSubscription({ data })
};

// The service worker is only registered in production builds; do not wait on it forever elsewhere.
async function getRegistration(): Promise<PushRegistrationLike | null> {
  if (!('serviceWorker' in navigator)) return null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((resolve) => {
    timer = setTimeout(() => resolve(null), REGISTRATION_TIMEOUT_MS);
  });
  try {
    return await Promise.race([navigator.serviceWorker.ready, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

export function createBrowserPushDeps(getLanguage: () => string | undefined): PushDeps {
  return {
    api,
    capabilities: () => detectPwaCapabilities(),
    permission: () => Notification.permission,
    requestPermission: () => Notification.requestPermission(),
    online: () => navigator.onLine,
    locale: () => toPushLocale(getLanguage()),
    getRegistration,
    now: () => Date.now()
  };
}

// Called before sign-out while the session is still valid. Never blocks sign-out for long.
export async function cleanupPushDeviceForLogout(): Promise<void> {
  const deps = createBrowserPushDeps(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const limit = new Promise<void>((resolve) => {
    timer = setTimeout(resolve, REGISTRATION_TIMEOUT_MS);
  });
  try {
    await Promise.race([cleanupPushDevice(deps), limit]);
  } finally {
    clearTimeout(timer);
  }
}
