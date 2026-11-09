import { useEffect } from 'react';

// Registry of in-progress work (pending mutations, unsaved forms) that a service-worker update must
// not interrupt. Components mark themselves active; the update controller defers the reload.
const blockers = new Set<symbol>();
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((listener) => listener());

export const isUpdateBlocked = () => blockers.size > 0;

export function subscribeUpdateGuard(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function useUpdateGuard(active: boolean) {
  useEffect(() => {
    if (!active) return undefined;
    const token = Symbol('update-blocker');
    blockers.add(token);
    notify();
    return () => {
      blockers.delete(token);
      notify();
    };
  }, [active]);
}
