import { useSyncExternalStore } from 'react';

function subscribe(): () => void {
  return () => {};
}

function getClientSnapshot(): boolean {
  return true;
}

function getServerSnapshot(): boolean {
  return false;
}

/**
 * `false` while server rendering and during the hydration pass, `true` once
 * React owns the DOM. Server-rendered controls stay inert until this flips so a
 * pre-hydration submit cannot fall back to a native navigation.
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, getClientSnapshot, getServerSnapshot);
}
