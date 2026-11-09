import { useSyncExternalStore } from 'react';

export type PwaCapabilities = {
  secureContext: boolean;
  serviceWorker: boolean;
  pushManager: boolean;
  notification: boolean;
  standalone: boolean;
  ios: boolean;
};

export type InstallSnapshot = {
  ready: boolean;
  installed: boolean;
  canPrompt: boolean;
  ios: boolean;
  supported: boolean;
};

type InstallPromptEvent = Event & {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
};
export type InstallOutcome = 'accepted' | 'dismissed' | 'unavailable';

const STANDALONE_QUERY = '(display-mode: standalone)';
// Neutral state used for SSR and the first client render so hydration always matches.
const NEUTRAL: InstallSnapshot = {
  ready: false,
  installed: false,
  canPrompt: false,
  ios: false,
  supported: false
};

// Capability detection is primary; the UA only identifies iOS/iPadOS, where installing to the Home
// Screen is the sole path (iPadOS reports a Mac platform with touch points).
export function detectPwaCapabilities(win: Window = window): PwaCapabilities {
  const nav = win.navigator as Navigator & { standalone?: boolean };
  return {
    secureContext: win.isSecureContext,
    serviceWorker: 'serviceWorker' in nav,
    pushManager: 'PushManager' in win,
    notification: 'Notification' in win,
    standalone: (win.matchMedia?.(STANDALONE_QUERY).matches ?? false) || nav.standalone === true,
    ios:
      /iPad|iPhone|iPod/.test(nav.userAgent) ||
      (nav.platform === 'MacIntel' && nav.maxTouchPoints > 1)
  };
}

const isInstallPromptEvent = (event: Event): event is InstallPromptEvent =>
  'prompt' in event && 'userChoice' in event;

let snapshot = NEUTRAL;
let deferredPrompt: InstallPromptEvent | null = null;
let stop: (() => void) | null = null;
const listeners = new Set<() => void>();

function publish(next: Partial<InstallSnapshot>) {
  snapshot = { ...snapshot, ...next };
  listeners.forEach((listener) => listener());
}

function start() {
  const capabilities = detectPwaCapabilities();
  snapshot = {
    ready: true,
    installed: capabilities.standalone,
    canPrompt: false,
    ios: capabilities.ios,
    supported: capabilities.secureContext && capabilities.serviceWorker
  };
  const media = window.matchMedia?.(STANDALONE_QUERY);
  const onPrompt = (event: Event) => {
    event.preventDefault();
    if (!isInstallPromptEvent(event)) return;
    deferredPrompt = event;
    publish({ canPrompt: true });
  };
  const onInstalled = () => {
    deferredPrompt = null;
    publish({ installed: true, canPrompt: false });
  };
  const onDisplayMode = () => publish({ installed: detectPwaCapabilities().standalone });
  window.addEventListener('beforeinstallprompt', onPrompt);
  window.addEventListener('appinstalled', onInstalled);
  media?.addEventListener('change', onDisplayMode);
  stop = () => {
    window.removeEventListener('beforeinstallprompt', onPrompt);
    window.removeEventListener('appinstalled', onInstalled);
    media?.removeEventListener('change', onDisplayMode);
    deferredPrompt = null;
    snapshot = NEUTRAL;
  };
}

// Listeners attach with the first subscriber and detach with the last.
export function subscribeInstallState(listener: () => void) {
  listeners.add(listener);
  if (!stop) start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) {
      stop?.();
      stop = null;
    }
  };
}

// App-level capture: Chromium may fire beforeinstallprompt long before the install panel mounts, so
// the app root holds a subscription from hydration. The event is retained until consumed or installed.
export function captureInstallPrompt() {
  return subscribeInstallState(() => undefined);
}

// The browser prompt is single-use: it is consumed whatever the user chooses. The offer stays
// published while the native prompt is open so the initiating control keeps its focus, and is
// withdrawn only once the outcome is known.
export async function promptInstall(): Promise<InstallOutcome> {
  const event = deferredPrompt;
  if (!event) return 'unavailable';
  deferredPrompt = null;
  try {
    await event.prompt();
    return (await event.userChoice).outcome;
  } catch {
    return 'unavailable';
  } finally {
    publish({ canPrompt: false });
  }
}

export function useInstallState() {
  return useSyncExternalStore(
    subscribeInstallState,
    () => snapshot,
    () => NEUTRAL
  );
}
